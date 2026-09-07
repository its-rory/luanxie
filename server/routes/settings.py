import asyncio
import base64
import os
import tempfile
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from .._sanitizer import sanitize_error_text, sanitize_exception
from .. import config

router = APIRouter(prefix="/api/settings", tags=["settings"])

_K_MAX = 500
_URL_MAX = 400
_MODEL_MAX = 200
_NAME_MAX = 100
_HEADER_MAX = 2000

# 1x1 像素透明 PNG base64，用于为视觉模型测试提供最小有效载荷
_TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


class SettingsUpdate(BaseModel):
    TEXT_PROVIDER_NAME: str = Field("", max_length=_NAME_MAX)
    TEXT_API_KEY: str = Field("", max_length=_K_MAX)
    TEXT_BASE_URL: str = Field("", max_length=_URL_MAX)
    TEXT_MODEL: str = Field("", max_length=_MODEL_MAX)
    TEXT_HEADERS: str = Field("", max_length=_HEADER_MAX)

    IMAGE_PROVIDER_NAME: str = Field("", max_length=_NAME_MAX)
    IMAGE_API_KEY: str = Field("", max_length=_K_MAX)
    IMAGE_BASE_URL: str = Field("", max_length=_URL_MAX)
    IMAGE_MODEL: str = Field("", max_length=_MODEL_MAX)
    IMAGE_HEADERS: str = Field("", max_length=_HEADER_MAX)

    AUDIO_PROVIDER_NAME: str = Field("", max_length=_NAME_MAX)
    AUDIO_API_KEY: str = Field("", max_length=_K_MAX)
    AUDIO_BASE_URL: str = Field("", max_length=_URL_MAX)
    AUDIO_MODEL: str = Field("", max_length=_MODEL_MAX)
    AUDIO_HEADERS: str = Field("", max_length=_HEADER_MAX)

    MERGE_PROVIDER_NAME: str = Field("", max_length=_NAME_MAX)
    MERGE_API_KEY: str = Field("", max_length=_K_MAX)
    MERGE_BASE_URL: str = Field("", max_length=_URL_MAX)
    MERGE_MODEL: str = Field("", max_length=_MODEL_MAX)
    MERGE_HEADERS: str = Field("", max_length=_HEADER_MAX)

    MODEL_PROVIDERS: str = Field("", max_length=50000)

    ADMIN_PASSWORD: str = Field("", max_length=200)

    AUTO_MERGE_EXISTING_CONFIDENCE: str = "medium"
    AUTO_MERGE_NEW_CONFIDENCE: str = "high"


class TestRequest(BaseModel):
    task: str = Field(..., max_length=20)  # text, image, audio, merge
    provider: str = Field(..., max_length=_NAME_MAX)
    api_key: str = Field(..., max_length=_K_MAX)
    base_url: str = Field(..., max_length=_URL_MAX)
    model: str = Field(..., max_length=_MODEL_MAX)
    headers: str = Field("", max_length=_HEADER_MAX)


def _validate_base_url(base_url: str) -> str | None:
    """校验 test 端点 base_url:仅允许 http/https、阻断链路本地/云元数据段(169.254.*)。
    localhost 与私网放行(支持本地自建模型);其余不做限制。"""
    import ipaddress, socket
    from urllib.parse import urlparse

    base_url = (base_url or "").strip()
    if not base_url:
        return "Base URL 不能为空"

    parsed = urlparse(base_url)
    if parsed.scheme not in ("http", "https"):
        return f"不支持的 URL 协议: {parsed.scheme or '(none)'}, 仅允许 http/https"

    hostname = parsed.hostname or ""
    if not hostname:
        return "无效的主机名"

    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        addr_infos = []

    for info in addr_infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
            if ip.is_link_local:
                return f"已阻断针对链路本地/元数据地址的请求: {hostname} ({ip_str})"
            if isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.IPv4Network("169.254.0.0/16"):
                return f"已阻断针对元数据地址的请求: {hostname} ({ip_str})"
        except ValueError:
            pass

    return None


async def test_api_config(task: str, provider: str, api_key: str, base_url: str, model: str, custom_headers: str = "") -> str:
    if not api_key:
        return "API Key 不能为空"
    url_err = _validate_base_url(base_url)
    if url_err:
        return url_err
    try:
        import httpx
        from ..pipeline.llm import get_client

        provider_name = provider.lower()
        url_lower = (base_url or "").lower()
        if "anthropic" in provider_name or "anthropic" in url_lower:
            client_type = "anthropic"
        else:
            client_type = "openai"

        # 解析用户自定义与专属请求头
        resolved_headers = config.resolve_headers(custom_headers, base_url=base_url, provider=provider)

        # 获取已注入 header 的通用客户端
        client = get_client(provider, api_key=api_key, base_url=base_url, extra_headers=resolved_headers)

        if task in ("text", "merge"):
            def run_chat():
                if client_type == "openai":
                    return client.chat.completions.create(
                        model=model,
                        messages=[{"role": "user", "content": "ping"}],
                        max_tokens=5,
                        timeout=25.0
                    )
                else:
                    return client.messages.create(
                        model=model,
                        messages=[{"role": "user", "content": "ping"}],
                        max_tokens=5,
                        timeout=25.0
                    )
            await asyncio.to_thread(run_chat)

        elif task == "image":
            def run_vision():
                if client_type == "openai":
                    vision_content = [
                        {"type": "text", "text": "ping"},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{_TINY_PNG_B64}"}}
                    ]
                    return client.chat.completions.create(
                        model=model,
                        messages=[{"role": "user", "content": vision_content}],
                        max_tokens=5,
                        timeout=30.0
                    )
                else:
                    anthropic_content = [
                        {"type": "text", "text": "ping"},
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": _TINY_PNG_B64
                            }
                        }
                    ]
                    return client.messages.create(
                        model=model,
                        messages=[{"role": "user", "content": anthropic_content}],
                        max_tokens=5,
                        timeout=30.0
                    )
            await asyncio.to_thread(run_vision)

        elif task == "audio":
            sample_rate = 8000
            data_size = 8000
            file_size = 44 + data_size
            
            header = bytearray(44)
            header[0:4] = b'RIFF'
            header[4:8] = (file_size - 8).to_bytes(4, 'little')
            header[8:12] = b'WAVE'
            header[12:16] = b'fmt '
            header[16:20] = (16).to_bytes(4, 'little')
            header[20:22] = (1).to_bytes(2, 'little')
            header[22:24] = (1).to_bytes(2, 'little')
            header[24:28] = sample_rate.to_bytes(4, 'little')
            header[28:32] = sample_rate.to_bytes(4, 'little')
            header[32:34] = (1).to_bytes(2, 'little')
            header[34:36] = (8).to_bytes(2, 'little')
            header[36:40] = b'data'
            header[40:44] = data_size.to_bytes(4, 'little')
            
            DUMMY_WAV = bytes(header) + bytes([128] * data_size)
            
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(DUMMY_WAV)
                tmp_path = tmp.name

            try:
                model_lower = model.lower()
                is_stt = any(k in model_lower for k in ["whisper", "sensevoice", "funasr"])

                def run_audio():
                    base_headers = dict(resolved_headers)
                    base_headers["Authorization"] = f"Bearer {api_key}"

                    if is_stt:
                        url = f"{base_url.rstrip('/')}/audio/transcriptions"
                        headers = base_headers
                        with open(tmp_path, "rb") as f:
                            files = {"file": ("test.wav", f.read(), "audio/wav")}
                        res = httpx.post(url, headers=headers, files=files, data={"model": model}, timeout=30.0)
                        res.raise_for_status()
                    else:
                        url = f"{base_url.rstrip('/')}/chat/completions"
                        audio_base64 = base64.b64encode(DUMMY_WAV).decode("utf-8")
                        payload = {
                            "model": model,
                            "messages": [{
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": "ping"},
                                    {"type": "input_audio", "input_audio": {"data": audio_base64, "format": "wav"}}
                                ]
                            }],
                            "max_tokens": 5
                        }
                        headers = dict(base_headers)
                        headers["Content-Type"] = "application/json"
                        res = httpx.post(url, headers=headers, json=payload, timeout=40.0)
                        res.raise_for_status()

                await asyncio.to_thread(run_audio)
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

        return ""
    except Exception as e:
        return sanitize_exception(e)


def resolve_key(incoming: str, key_name: str) -> str:
    if incoming == "••••••••":
        from .. import config
        return getattr(config, key_name, "")
    return incoming


@router.get("")
def get_settings():
    from .. import config
    keys = [
        "ADMIN_PASSWORD",
        "AUTO_MERGE_EXISTING_CONFIDENCE",
        "AUTO_MERGE_NEW_CONFIDENCE",
        "TEXT_PROVIDER_NAME", "TEXT_API_KEY", "TEXT_BASE_URL", "TEXT_MODEL", "TEXT_HEADERS",
        "IMAGE_PROVIDER_NAME", "IMAGE_API_KEY", "IMAGE_BASE_URL", "IMAGE_MODEL", "IMAGE_HEADERS",
        "AUDIO_PROVIDER_NAME", "AUDIO_API_KEY", "AUDIO_BASE_URL", "AUDIO_MODEL", "AUDIO_HEADERS",
        "MERGE_PROVIDER_NAME", "MERGE_API_KEY", "MERGE_BASE_URL", "MERGE_MODEL", "MERGE_HEADERS",
        "MODEL_PROVIDERS",
    ]
    result = {}
    for k in keys:
        val = getattr(config, k, "")
        if "API_KEY" in k and val:
            result[k] = "••••••••"
        elif k == "ADMIN_PASSWORD" and val:
            result[k] = "••••••••"
        else:
            result[k] = val
    return result


@router.post("")
async def save_settings(payload: SettingsUpdate):
    allowed_confidences = {"high", "medium", "low", "never"}
    if payload.AUTO_MERGE_EXISTING_CONFIDENCE not in allowed_confidences:
        raise HTTPException(400, f"无效的自动合并置信度(已有主题): {payload.AUTO_MERGE_EXISTING_CONFIDENCE}")
    if payload.AUTO_MERGE_NEW_CONFIDENCE not in allowed_confidences:
        raise HTTPException(400, f"无效的自动合并置信度(新主题): {payload.AUTO_MERGE_NEW_CONFIDENCE}")

    new_pw = payload.ADMIN_PASSWORD or ""
    if new_pw not in ("", "••••••••"):
        if len(new_pw) < 6:
            raise HTTPException(400, "管理员密码至少 6 位")
        if new_pw == "admin":
            raise HTTPException(400, "管理员密码不能使用出厂弱密码 'admin'")
        db.set_setting("ADMIN_PASSWORD", new_pw)

    data = payload.model_dump()
    for k, v in data.items():
        if k == "ADMIN_PASSWORD":
            continue
        if "API_KEY" in k:
            if v and v != "••••••••":
                db.set_setting(k, v)
        else:
            db.set_setting(k, v or "")

    return {"ok": True}


@router.post("/test")
async def test_endpoint(payload: TestRequest):
    resolved_key = resolve_key(payload.api_key, f"{payload.task.upper()}_API_KEY")
    err = await test_api_config(payload.task, payload.provider, resolved_key, payload.base_url, payload.model, payload.headers)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True}
