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
    MODEL_GROUPS: str = Field("", max_length=10000)

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
        return "AI 地址不能为空"

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
        resolved_headers = config.resolve_headers(custom_headers, base_url=base_url, provider=provider)
        headers = dict(resolved_headers)
        headers["Authorization"] = f"Bearer {api_key}"

        url_clean = base_url.rstrip("/")
        prov_lower = provider.lower()
        url_lower = url_clean.lower()
        is_anthropic = "anthropic" in prov_lower or "anthropic" in url_lower

        # 智能标准化 Base URL:
        if is_anthropic:
            if url_clean.endswith("/v1"):
                effective_base_url = url_clean[:-3]
            else:
                effective_base_url = url_clean
        else:
            from urllib.parse import urlparse
            parsed_u = urlparse(url_clean)
            if not parsed_u.path or parsed_u.path in ("", "/"):
                effective_base_url = f"{url_clean}/v1"
            else:
                effective_base_url = url_clean

        # 1. 针对常规模型供应商，优先使用轻量级 GET /models 探针 (主流平台均秒级返回，不耗 Token，快速鉴权与探活)
        if not is_anthropic:
            try:
                async with httpx.AsyncClient(timeout=5.0) as http_client:
                    r = await http_client.get(f"{effective_base_url}/models", headers=headers)
                    if r.status_code == 200:
                        return ""  # 探活成功！
                    elif r.status_code in (401, 403):
                        return f"鉴权失败 (HTTP {r.status_code}): API Key 或自定义 Headers 无效"
            except Exception:
                pass  # 若目标代理未暴露 /models 路由，则平滑退避到极小化测试

        # 2. 模型名自适应容错：过滤路径型错误模型名（如误填的 zen/go/v1 等）
        test_model = (model or "").strip()
        if not test_model or test_model in ("zen/go/v1", "zen/audio/v1") or (test_model.startswith("zen/") and "/" in test_model):
            test_model = "deepseek-v4-flash" if "opencode" in url_lower else "deepseek-chat"

        # 3. 极速单 Token 探针 (max_retries=0，8 秒硬超时，杜绝长时间卡住)
        if is_anthropic:
            import anthropic
            anth_client = anthropic.Anthropic(
                api_key=api_key,
                base_url=effective_base_url,
                default_headers=resolved_headers or None,
                max_retries=0,
                timeout=8.0
            )
            def run_anth():
                return anth_client.messages.create(
                    model=test_model or "claude-3-haiku-20240307",
                    messages=[{"role": "user", "content": "hi"}],
                    max_tokens=1
                )
            await asyncio.to_thread(run_anth)
        else:
            import openai
            oai_client = openai.OpenAI(
                api_key=api_key,
                base_url=effective_base_url,
                default_headers=resolved_headers or None,
                max_retries=0,
                timeout=8.0
            )
            def run_oai():
                return oai_client.chat.completions.create(
                    model=test_model,
                    messages=[{"role": "user", "content": "hi"}],
                    max_tokens=1
                )
            await asyncio.to_thread(run_oai)

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
        "MODEL_GROUPS",
    ]
    result = {}
    import json
    for k in keys:
        val = getattr(config, k, "")
        if "API_KEY" in k and val:
            result[k] = "••••••••"
        elif k == "ADMIN_PASSWORD" and val:
            result[k] = "••••••••"
        elif k == "MODEL_PROVIDERS" and val:
            try:
                provs = json.loads(val)
                if isinstance(provs, list):
                    for p in provs:
                        if isinstance(p, dict) and p.get("apiKey"):
                            p["apiKey"] = "••••••••"
                    result[k] = json.dumps(provs, ensure_ascii=False)
                else:
                    result[k] = val
            except Exception:
                result[k] = val
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

    import json
    from .auth import hash_password

    new_pw = payload.ADMIN_PASSWORD or ""
    if new_pw not in ("", "••••••••"):
        if len(new_pw) < 6:
            raise HTTPException(400, "管理员密码至少 6 位")
        if new_pw == "admin":
            raise HTTPException(400, "管理员密码不能使用出厂弱密码 'admin'")
        hashed_pw = hash_password(new_pw)
        db.set_setting("ADMIN_PASSWORD", hashed_pw)
        db.clear_all_sessions()  # 改密后吊销所有旧 Token 强制重新登录

    data = payload.model_dump()

    # 处理 MODEL_PROVIDERS: 如果提交包含打码 key，保留已有真实 key
    if data.get("MODEL_PROVIDERS"):
        try:
            incoming_provs = json.loads(data["MODEL_PROVIDERS"])
            existing_raw = db.get_setting("MODEL_PROVIDERS", "")
            existing_provs = json.loads(existing_raw) if existing_raw else []
            existing_key_map = {
                p.get("id"): p.get("apiKey")
                for p in existing_provs
                if isinstance(p, dict) and p.get("apiKey") and p.get("apiKey") != "••••••••"
            }
            if isinstance(incoming_provs, list):
                for p in incoming_provs:
                    if isinstance(p, dict):
                        if p.get("apiKey") in ("••••••••", ""):
                            pid = p.get("id")
                            if pid in existing_key_map:
                                p["apiKey"] = existing_key_map[pid]
                data["MODEL_PROVIDERS"] = json.dumps(incoming_provs, ensure_ascii=False)
        except Exception:
            pass

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
