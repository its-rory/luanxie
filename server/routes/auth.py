import hmac
import asyncio
import secrets
import time
from fastapi import APIRouter, HTTPException, Response, Cookie, Request
from pydantic import BaseModel

from .. import config, db

router = APIRouter(prefix="/api/auth", tags=["auth"])

class LoginRequest(BaseModel):
    password: str

@router.post("/login")
async def login(payload: LoginRequest, response: Response):
    if not hmac.compare_digest(payload.password, config.ADMIN_PASSWORD):
        await asyncio.sleep(2)
        raise HTTPException(status_code=401, detail="密码错误")

    token = secrets.token_hex(32)
    expires_at = time.time() + 7 * 86400  # 7 days
    db.create_session(token, expires_at)

    # Set HTTP-only secure cookie
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
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
    if not config.ADMIN_PASSWORD:
        return {"logged_in": True}
    if session_token and db.verify_session(session_token):
        return {"logged_in": True}
    return {"logged_in": False}

def check_auth(session_token: str | None = Cookie(None)):
    if not config.ADMIN_PASSWORD:
        return
    if not session_token or not db.verify_session(session_token):
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
