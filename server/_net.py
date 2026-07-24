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