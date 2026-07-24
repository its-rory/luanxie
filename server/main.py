"""乱写APP 后端入口。"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .pipeline import worker
from .routes import captures, events_route, review, settings, topics, auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.get_conn()  # 建表
    # 启动期强告警:密码缺失(服务将锁定)或仍是出厂默认值 admin(易被爆破)。stderr 直接打印,确保 systemd 日志可见。
    import sys
    pw = config.ADMIN_PASSWORD
    if not pw:
        print("[luanxie][SECURITY] ADMIN_PASSWORD 未配置:所有受保护端点已锁定,请尽快在设置中配置密码。",
              file=sys.stderr, flush=True)
    elif pw == "admin":
        print("[luanxie][SECURITY] ADMIN_PASSWORD 仍是出厂默认值 'admin',强烈建议修改。",
              file=sys.stderr, flush=True)
    consumer_task = asyncio.create_task(worker.consumer())
    yield
    consumer_task.cancel()
    try:
        await asyncio.wait_for(consumer_task, timeout=5.0)
    except (asyncio.CancelledError, Exception):
        pass


app = FastAPI(title="乱写", lifespan=lifespan)
app.include_router(auth.router)

# Protect all functional routes with session verification
app.include_router(captures.router, dependencies=[Depends(auth.check_auth)])
app.include_router(topics.router, dependencies=[Depends(auth.check_auth)])
app.include_router(review.router, dependencies=[Depends(auth.check_auth)])
app.include_router(settings.router, dependencies=[Depends(auth.check_auth)])
app.include_router(events_route.router, dependencies=[Depends(auth.check_auth)])


@app.get("/media/{filename}")
def get_media_file(filename: str, user: dict = Depends(auth.check_auth)):
    import os
    safe_name = os.path.basename(filename)
    if safe_name.startswith('.'):
        raise HTTPException(400, "非法文件名")
    file_path = (config.MEDIA_DIR / safe_name).resolve()
    if not file_path.is_relative_to(config.MEDIA_DIR.resolve()) or not file_path.is_file():
        raise HTTPException(404, "文件不存在")
    return FileResponse(file_path)


@app.get("/api/health")
def health():
    import importlib.util
    has_keys = bool(config.TEXT_API_KEY) and bool(config.IMAGE_API_KEY) and bool(config.AUDIO_API_KEY) and bool(config.MERGE_API_KEY)
    local_wh = any(
        importlib.util.find_spec(lib) is not None
        for lib in ["mlx_whisper", "faster_whisper", "whisper"]
    )
    cloud_wh = bool(config.AUDIO_API_KEY)
    return {
        "queue_depth": worker.queue_depth(),
        "whisper_installed": local_wh or cloud_wh,
        "local_whisper": local_wh,
        "cloud_whisper": cloud_wh,
        "api_key_set": has_keys,
        "auto_merge_existing_confidence": config.AUTO_MERGE_EXISTING_CONFIDENCE,
        "auto_merge_new_confidence": config.AUTO_MERGE_NEW_CONFIDENCE,
    }


# 前端静态托管(P2 构建后生效);SPA fallback 到 index.html
if config.WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        try:
            resolved_dist = config.WEB_DIST.resolve()
            file = (config.WEB_DIST / path).resolve()
            if path and file.is_file() and file.is_relative_to(resolved_dist):
                return FileResponse(file)
        except OSError:
            # 文件系统/路径异常按 SPA 语义回退 index.html;其它异常仍向上传播。
            pass
        return FileResponse(config.WEB_DIST / "index.html")

