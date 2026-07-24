import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from .._sanitizer import sanitize_error_text, sanitize_exception

router = APIRouter(prefix="/api/settings", tags=["settings"])

# M4: 设置字段统一长度上限,防超大值写入;API_KEY 留长一点兼容各类 token。
_K_MAX = 500
_URL_MAX = 400
_MODEL_MAX = 200
_NAME_MAX = 100

class SettingsUpdate(BaseModel):
    TEXT_PROVIDER_NAME: str = Field("", max_length=_NAME_MAX)
    TEXT_API_KEY: str = Field("", max_length=_K_MAX)
    TEXT_BASE_URL: str = Field("", max_length=_URL_MAX)
    TEXT_MODEL: str = Field("", max_length=_MODEL_MAX)

    IMAGE_PROVIDER_NAME: str = Field("", max_length=_NAME_MAX)
    IMAGE_API_KEY: str = Field("", max_length=_K_MAX)
    IMAGE_BASE_URL: str = Field("", max_length=_URL_MAX)
    IMAGE_MODEL: str = Field("", max_length=_MODEL_MAX)

    AUDIO_PROVIDER_NAME: str = Field("", max_length=_NAME_MAX)
    AUDIO_API_KEY: str = Field("", max_length=_K_MAX)
    AUDIO_BASE_URL: str = Field("", max_length=_URL_MAX)
    AUDIO_MODEL: str = Field("", max_length=_MODEL_MAX)

    MERGE_PROVIDER_NAME: str = Field("", max_length=_NAME_MAX)
    MERGE_API_KEY: str = Field("", max_length=_K_MAX)
    MERGE_BASE_URL: str = Field("", max_length=_URL_MAX)
    MERGE_MODEL: str = Field("", max_length=_MODEL_MAX)

    ADMIN_PASSWORD: str = Field("", max_length=200)

    AUTO_MERGE_EXISTING_CONFIDENCE: str = "medium"
    AUTO_MERGE_NEW_CONFIDENCE: str = "high"

class TestRequest(BaseModel):
    task: str = Field(..., max_length=20)  # text, image, audio, merge
    provider: str = Field(..., max_length=_NAME_MAX)
    api_key: str = Field(..., max_length=_K_MAX)
    base_url: str = Field(..., max_length=_URL_MAX)
    model: str = Field(..., max_length=_MODEL_MAX)

def _validate_base_url(base_url: str) -> str | None:
    """校验 test 端点 base_url:仅允许 http/https、阻断链路本地/云元数据段(169.254.*)。
    localhost 与私网放行(支持本地自建模型);其余不做限制。"""
    import ipaddress, socket
    from urllib.parse import urlparse
    u = (base_url or "").strip()
    if not u:
        return "Base URL 不能为空"
    try:
        parsed = urlparse(u)
    except Exception:
        return "Base URL 解析失败"
    if parsed.scheme not in ("http", "https"):
        return f"Base URL 必须是 http/https,不能是 '{parsed.scheme}'"
    host = parsed.hostname or ""
    if not host:
        return "Base URL 缺少主机名"
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return f"无法解析主机名 '{host}'"
    for info in infos:
        ip = info[4][0]
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if addr.is_link_local:
            return f"禁止访问链路本地/云元数据地址 '{ip}'(SSRF 防护)"
    return None


async def test_api_config(task: str, provider: str, api_key: str, base_url: str, model: str) -> str:
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

        # Resolve keys and urls locally
        client = get_client(provider, api_key=api_key, base_url=base_url)

        if task in ("text", "image", "merge"):
            def run_chat():
                if client_type == "openai":
                    return client.chat.completions.create(
                        model=model,
                        messages=[{"role": "user", "content": "ping"}],
                        max_tokens=5,
                        timeout=10.0
                    )
                else:
                    return client.messages.create(
                        model=model,
                        messages=[{"role": "user", "content": "ping"}],
                        max_tokens=5,
                        timeout=10.0
                    )
            await asyncio.to_thread(run_chat)
        elif task == "audio":
            import tempfile
            import os
            
            # Construct a 100% valid 1-second silence WAV file (8000Hz, 8-bit, Mono PCM)
            sample_rate = 8000
            data_size = 8000
            file_size = 44 + data_size
            
            header = bytearray(44)
            header[0:4] = b'RIFF'
            header[4:8] = (file_size - 8).to_bytes(4, 'little')
            header[8:12] = b'WAVE'
            header[12:16] = b'fmt '
            header[16:20] = (16).to_bytes(4, 'little')
            header[20:22] = (1).to_bytes(2, 'little')  # PCM
            header[22:24] = (1).to_bytes(2, 'little')  # Mono
            header[24:28] = sample_rate.to_bytes(4, 'little')
            header[28:32] = sample_rate.to_bytes(4, 'little')  # Byte rate
            header[32:34] = (1).to_bytes(2, 'little')  # Block align
            header[34:36] = (8).to_bytes(2, 'little')  # Bits per sample
            header[36:40] = b'data'
            header[40:44] = data_size.to_bytes(4, 'little')
            
            # 8-bit PCM silence level is 128 (0x80)
            DUMMY_WAV = bytes(header) + bytes([128] * data_size)
            
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(DUMMY_WAV)
                tmp_path = tmp.name

            try:
                model_lower = model.lower()
                is_stt = any(k in model_lower for k in ["whisper", "sensevoice", "funasr"])

                def run_audio():
                    if is_stt:
                        url = f"{base_url.rstrip('/')}/audio/transcriptions"
                        headers = {"Authorization": f"Bearer {api_key}"}
                        with open(tmp_path, "rb") as f:
                            files = {"file": ("test.wav", f.read(), "audio/wav")}
                        res = httpx.post(url, headers=headers, files=files, data={"model": model}, timeout=15.0)
                        res.raise_for_status()
                    else:
                        url = f"{base_url.rstrip('/')}/chat/completions"
                        import base64
                        audio_base64 = base64.b64encode(DUMMY_WAV).decode("utf-8")
                        payload = {
                            "model": model,
                            "messages": [{
                                "role": "user",
                                "content": [
                                    {"type": "audio_url", "audio_url": {"url": f"data:audio/wav;base64,{audio_base64}"}},
                                    {"type": "text", "text": "transcribe"}
                                ]
                            }]
                        }
                        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                        res = httpx.post(url, headers=headers, json=payload, timeout=15.0)
                        res.raise_for_status()

                await asyncio.to_thread(run_audio)
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

        return ""
    except Exception as e:
        # 不回传上游 SDK 原始异常串(可能含账号/URL/部分 payload),仅回脱敏摘要。
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
        "TEXT_PROVIDER_NAME", "TEXT_API_KEY", "TEXT_BASE_URL", "TEXT_MODEL",
        "IMAGE_PROVIDER_NAME", "IMAGE_API_KEY", "IMAGE_BASE_URL", "IMAGE_MODEL",
        "AUDIO_PROVIDER_NAME", "AUDIO_API_KEY", "AUDIO_BASE_URL", "AUDIO_MODEL",
        "MERGE_PROVIDER_NAME", "MERGE_API_KEY", "MERGE_BASE_URL", "MERGE_MODEL",
        "AUTO_MERGE_EXISTING_CONFIDENCE", "AUTO_MERGE_NEW_CONFIDENCE",
    ]
    result = {}
    for k in keys:
        val = getattr(config, k, "")
        if ("API_KEY" in k or k == "ADMIN_PASSWORD") and val:
            result[k] = "••••••••"
        else:
            result[k] = val
    return result

@router.post("")
async def save_settings(payload: SettingsUpdate):
    # Validate confidence levels
    allowed_confidences = {"high", "medium", "low", "never"}
    if payload.AUTO_MERGE_EXISTING_CONFIDENCE not in allowed_confidences:
        raise HTTPException(400, f"无效的自动合并置信度(已有主题): {payload.AUTO_MERGE_EXISTING_CONFIDENCE}")
    if payload.AUTO_MERGE_NEW_CONFIDENCE not in allowed_confidences:
        raise HTTPException(400, f"无效的自动合并置信度(新主题): {payload.AUTO_MERGE_NEW_CONFIDENCE}")

    # 密码单独处理:空或掩码→保持不动;非空新值→校验后写入,防止误清空锁死全站
    new_pw = payload.ADMIN_PASSWORD or ""
    if new_pw not in ("", "••••••••"):
        if len(new_pw) < 6:
            raise HTTPException(400, "管理员密码至少 6 位")
        if new_pw == "admin":
            raise HTTPException(400, "管理员密码不能使用出厂弱密码 'admin'")
        db.set_setting("ADMIN_PASSWORD", new_pw)

    # Save to SQLite
    data = payload.model_dump()
    for k, v in data.items():
        if k == "ADMIN_PASSWORD":
            continue
        if "API_KEY" in k:
            db.set_setting(k, resolve_key(v, k))
        else:
            db.set_setting(k, v)

    return {"ok": True}

@router.post("/test")
async def test_endpoint(payload: TestRequest):
    resolved_key = resolve_key(payload.api_key, f"{payload.task.upper()}_API_KEY")
    err = await test_api_config(payload.task, payload.provider, resolved_key, payload.base_url, payload.model)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True}
