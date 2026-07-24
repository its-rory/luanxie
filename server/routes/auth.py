import hmac
import asyncio
import secrets
import time
import threading
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Response, Cookie, Request
from pydantic import BaseModel

from .. import config, db

router = APIRouter(prefix="/api/auth", tags=["auth"])

class LoginRequest(BaseModel):
    password: str

# 登录限频:按客户端 IP 统计失败次数,窗口 10 分钟内超过阈值则临时封锁,缓解在线爆破。
_LOGIN_FAIL_WINDOW = 600          # 10 分钟
_LOGIN_FAIL_LIMIT = 10            # 窗口内允许失败次数
_LOGIN_LOCK_SECONDS = 600         # 超限后封锁时长
_failed_attempts: dict[str, list[float]] = defaultdict(list)
_locks_until: dict[str, float] = {}
_fail_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    try:
        return request.client.host or "unknown"
    except Exception:
        return "unknown"


def _login_locked(ip: str) -> float:
    """返回剩余封锁秒数,0 表示未封锁。"""
    until = _locks_until.get(ip, 0)
    if until > time.time():
        return until - time.time()
    return 0.0


def _record_fail(ip: str) -> None:
    now = time.time()
    with _fail_lock:
        recent = [t for t in _failed_attempts[ip] if now - t < _LOGIN_FAIL_WINDOW]
        recent.append(now)
        _failed_attempts[ip] = recent
        if len(recent) >= _LOGIN_FAIL_LIMIT:
            _locks_until[ip] = now + _LOGIN_LOCK_SECONDS
            _failed_attempts[ip] = []


def _reset_fails(ip: str) -> None:
    with _fail_lock:
        _failed_attempts.pop(ip, None)
        _locks_until.pop(ip, None)


@router.post("/login")
async def login(payload: LoginRequest, response: Response, request: Request):
    ip = _client_ip(request)
    # 空密码视为未正确配置,拒绝任何登录(防止"清空密码=裸奔")。
    if not config.ADMIN_PASSWORD:
        await asyncio.sleep(2)
        raise HTTPException(status_code=401, detail="管理员密码未配置,请先在配置中设置密码")

    remaining = _login_locked(ip)
    if remaining > 0:
        raise HTTPException(status_code=429, detail=f"登录尝试过多,请 {int(remaining)} 秒后再试")

    if not hmac.compare_digest(payload.password, config.ADMIN_PASSWORD):
        _record_fail(ip)
        await asyncio.sleep(2)
        raise HTTPException(status_code=401, detail="密码错误")

    _reset_fails(ip)
    token = secrets.token_hex(32)
    expires_at = time.time() + 7 * 86400  # 7 days
    db.create_session(token, expires_at)

    # Set HTTP-only cookie with dynamic secure flag
    secure_cookie = request.url.scheme == "https"
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=secure_cookie,
        path="/",
        max_age=7 * 86400,
    )
    return {"ok": True}

@router.post("/logout")
def logout(response: Response, session_token: str | None = Cookie(None)):
    if session_token:
        db.delete_session(session_token)
    response.delete_cookie(key="session_token", path="/")
    return {"ok": True}

@router.get("/me")
def me(session_token: str | None = Cookie(None)):
    # 未配置密码时返回未登录(前端展示登录页,但登录会被拒绝),不再绕过鉴权直接放行。
    if not config.ADMIN_PASSWORD:
        return {"logged_in": False}
    if session_token and db.verify_session(session_token):
        return {"logged_in": True}
    return {"logged_in": False}

def check_auth(session_token: str | None = Cookie(None)):
    # 未配置密码 → 拒绝一切受保护访问(此前是放行,属高危)。
    if not config.ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="管理员密码未配置,服务已锁定")
    if not session_token or not db.verify_session(session_token):
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
