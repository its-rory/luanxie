"""乱写APP 后端入口。"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .pipeline import worker
from .routes import captures, events_route, review, settings, topics


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.get_conn()  # 建表
    consumer_task = asyncio.create_task(worker.consumer())
    yield
    consumer_task.cancel()


app = FastAPI(title="乱写", lifespan=lifespan)
app.include_router(captures.router)
app.include_router(topics.router)
app.include_router(review.router)
app.include_router(settings.router)
app.include_router(events_route.router)


@app.get("/api/health")
def health():
    import importlib.util
    has_keys = bool(config.TEXT_API_KEY) and bool(config.IMAGE_API_KEY) and bool(config.AUDIO_API_KEY) and bool(config.MERGE_API_KEY)
    return {
        "queue_depth": worker.queue_depth(),
        "db": str(config.DB_PATH),
        "whisper_installed": bool(config.AUDIO_API_KEY) or any(
            importlib.util.find_spec(lib) is not None
            for lib in ["mlx_whisper", "faster_whisper", "whisper"]
        ),
        "api_key_set": has_keys,
        "auto_merge_confidence": config.AUTO_MERGE_CONFIDENCE,
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
        except Exception:
            pass
        return FileResponse(config.WEB_DIST / "index.html")

