"""乱写APP 后端入口。"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, exporter
from .pipeline import worker
from .routes import captures, events_route, export, review, topics


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.get_conn()  # 建表
    consumer_task = asyncio.create_task(worker.consumer())
    export_task = None
    if config.EXPORT_INTERVAL_MINUTES > 0:
        async def periodic_export():
            while True:
                await asyncio.sleep(config.EXPORT_INTERVAL_MINUTES * 60)
                await asyncio.to_thread(exporter.export_all)
        export_task = asyncio.create_task(periodic_export())
    yield
    consumer_task.cancel()
    if export_task:
        export_task.cancel()


app = FastAPI(title="乱写", lifespan=lifespan)
app.include_router(captures.router)
app.include_router(topics.router)
app.include_router(review.router)
app.include_router(export.router)
app.include_router(events_route.router)


@app.get("/api/health")
def health():
    import importlib.util
    return {
        "queue_depth": worker.queue_depth(),
        "db": str(config.DB_PATH),
        "whisper_installed": bool(config.TRANSCRIPTION_API_KEY) or any(
            importlib.util.find_spec(lib) is not None
            for lib in ["mlx_whisper", "faster_whisper", "whisper"]
        ),
        "api_key_set": bool(config.ANTHROPIC_API_KEY),
        "export_dir": str(config.VAULT_EXPORT_DIR),
        "auto_merge_confidence": config.AUTO_MERGE_CONFIDENCE,
    }


# 前端静态托管(P2 构建后生效);SPA fallback 到 index.html
if config.WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        file = config.WEB_DIST / path
        if path and file.is_file():
            return FileResponse(file)
        return FileResponse(config.WEB_DIST / "index.html")
