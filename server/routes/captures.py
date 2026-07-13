"""捕获入口:接收文字/音频/图片,落库后交给 pipeline。"""
import uuid

from fastapi import APIRouter, Form, HTTPException, UploadFile

from .. import config, db

router = APIRouter(prefix="/api/captures", tags=["captures"])

ALLOWED_MEDIA = {
    "audio": {".m4a", ".mp4", ".webm", ".wav", ".mp3", ".ogg"},
    "image": {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"},
}


MAX_UPLOAD_SIZE = 25 * 1024 * 1024  # 25MB

@router.post("")
async def create_capture(type: str = Form(...), text: str | None = Form(None),
                         file: UploadFile | None = None):
    if type == "text":
        if not text or not text.strip():
            raise HTTPException(400, "text capture 需要非空 text 字段")
        cap = db.create_capture("text", raw_text=text.strip())
    elif type in ("audio", "image"):
        if file is None:
            raise HTTPException(400, f"{type} capture 需要上传 file")
        suffix = ("." + file.filename.rsplit(".", 1)[-1].lower()
                  if file.filename and "." in file.filename else "")
        if suffix not in ALLOWED_MEDIA[type]:
            raise HTTPException(400, f"不支持的{type}格式: {suffix or '未知'}")
        
        content = await file.read(MAX_UPLOAD_SIZE + 1)
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(413, "文件大小超出限制(最大 25MB)")
            
        name = f"{uuid.uuid4().hex[:12]}{suffix}"
        dest = config.MEDIA_DIR / name
        dest.write_bytes(content)
        cap = db.create_capture(type, media_path=f"media/{name}")
    else:
        raise HTTPException(400, "type 必须是 text/audio/image")

    from ..pipeline.worker import enqueue
    await enqueue(cap["id"])
    return cap


@router.get("")
def list_captures(status: str | None = None, limit: int = 50, offset: int = 0):
    limit = min(limit, 200)
    return db.list_captures(status=status, limit=limit, offset=offset)


@router.get("/{capture_id}")
def get_capture(capture_id: str):
    cap = db.get_capture(capture_id)
    if not cap:
        raise HTTPException(404, "capture 不存在")
    cap["logs"] = db.logs_for(capture_id)
    if cap["topic_id"]:
        topic = db.get_topic(cap["topic_id"])
        cap["topic_title"] = topic["title"] if topic else None
    return cap


@router.post("/{capture_id}/retry")
async def retry_capture(capture_id: str):
    cap = db.get_capture(capture_id)
    if not cap:
        raise HTTPException(404, "capture 不存在")
    if cap["status"] not in ("failed", "rejected"):
        raise HTTPException(400, f"状态 {cap['status']} 不可重试")
    db.update_capture(capture_id, status="pending", error=None, retry_count=0)
    from ..pipeline.worker import enqueue
    await enqueue(capture_id)
    return db.get_capture(capture_id)


@router.delete("/{capture_id}")
def delete_capture(capture_id: str):
    cap = db.get_capture(capture_id)
    if not cap:
        raise HTTPException(404, "capture 不存在")
    if cap["status"] == "done":
        raise HTTPException(400, "已合并进主题的 capture 不可删除")
    if cap["media_path"]:
        (config.DATA_DIR / cap["media_path"]).unlink(missing_ok=True)
    db.delete_capture(capture_id)
    return {"ok": True}
