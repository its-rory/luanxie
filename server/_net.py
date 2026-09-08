"""客户端 IP 解析:仅在受信代理后才信任 X-Forwarded-For,否则用直连 IP。

解决的问题:
- 非代理环境下不信任 X-Forwarded-For,防止伪造头绕过限频/登录失败计数。
- 反代后所有用户共享代理 IP(一人瞎试密码会把全站锁死)→ 受信代理下取 XFF 第一个值。
受信代理清单由 .env 的 TRUSTED_PROXIES(逗号分隔 IP)指定,默认空=总是用直连 IP。
"""
from fastapi import Request

from . import config


def _trusted_proxy(direct_ip: str) -> bool:
    trusted_raw = (config.TRUSTED_PROXIES or "").split(",")
    trusted = {t.strip() for t in trusted_raw if t.strip()}
    if not trusted:
        return False
    return (direct_ip or "") in trusted


def client_ip(request: Request) -> str:
    try:
        direct = request.client.host if request.client else None
    except Exception:
        direct = None
    direct = direct or "unknown"
    xff = request.headers.get("x-forwarded-for")
    if xff and _trusted_proxy(direct):
        first = xff.split(",")[0].strip()
        return first or direct
    return direct


def normalize_base_url(base_url: str | None, protocol: str = "openai") -> str:
    """智能标准化 Base URL:
    - 针对 Anthropic 协议: 剥离用户可能多填的 /v1 后缀,防止 SDK 内部拼出 /v1/v1/messages
    - 针对 OpenAI 兼容协议: 若用户只填了根域名(如 https://api.openai.com),自动补齐 /v1
    """
    if not base_url:
        return ""
    url_clean = base_url.strip().rstrip("/")
    if not url_clean:
        return ""
    prot_lower = (protocol or "").lower()
    if "anthropic" in prot_lower:
        if url_clean.endswith("/v1"):
            return url_clean[:-3]
        return url_clean
    else:
        from urllib.parse import urlparse
        p = urlparse(url_clean)
        if not p.path or p.path in ("", "/"):
            return f"{url_clean}/v1"
        return url_clean