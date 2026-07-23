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
        del content  # Free uploaded file memory immediately

        if type == "audio":
            out_name = f"{uuid.uuid4().hex[:12]}.mp3"
            out_dest = config.MEDIA_DIR / out_name
            import subprocess
            import asyncio
            try:
                await asyncio.to_thread(
                    subprocess.run,
                    [
                        "ffmpeg", "-y", "-i", str(dest),
                        "-acodec", "libmp3lame",
                        "-ar", "16000",
                        "-ac", "1",
                        "-ab", "64k",
                        str(out_dest)
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True
                )
                dest.unlink(missing_ok=True)
                name = out_name
            except Exception:
                # Clean up partially written file on failure
                if out_dest.exists():
                    try:
                        out_dest.unlink(missing_ok=True)
                    except Exception:
                        pass

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


@router.get("/working-count")
def working_count():
    """在途作业数(排队/转写/归类/合并),供收件箱红点显示。"""
    return {"count": db.working_captures_count()}


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


from pydantic import BaseModel
class ReassignPayload(BaseModel):
    new_topic_title: str

@router.post("/{capture_id}/reassign")
async def reassign_capture(capture_id: str, payload: ReassignPayload):
    cap = db.get_capture(capture_id)
    if not cap:
        raise HTTPException(404, "capture 不存在")
    
    # 1. 记录旧主题 ID (获取但在 merge 成功后才修改，以防 merge 失败导致旧主题处于不一致的中间态)
    old_topic_id = cap.get("topic_id")
    
    # 2. 执行重新合并逻辑到新/已存在的主题中
    from ..models import TopicDecision
    from ..pipeline.worker import run_merge
    
    target_title = payload.new_topic_title.strip()
    existing_topic = db.get_topic_by_title(target_title)
    
    if existing_topic:
        decision = TopicDecision(
            clean_text=cap["clean_text"] or cap["transcript"] or cap["raw_text"] or "",
            action="existing",
            topic_id=existing_topic["id"],
            confidence="high",
            reason="用户在收件箱中手动重新指派至已有主题"
        )
    else:
        decision = TopicDecision(
            clean_text=cap["clean_text"] or cap["transcript"] or cap["raw_text"] or "",
            action="new",
            new_topic_title=target_title,
            confidence="high",
            reason="用户在收件箱中手动重新指派并独立"
        )
    
    db.update_capture(capture_id, status="pending")
    await run_merge(capture_id, decision)
    
    # 3. 只有当 merge 成功后，才从旧主题中剔除对应关联或清除空主题
    if old_topic_id:
        old_topic = db.get_topic(old_topic_id)
        if old_topic:
            remaining_caps = db.list_captures_by_topic(old_topic_id)
            if not remaining_caps:
                db.delete_topic(old_topic_id)
            else:
                new_latest_cap = remaining_caps[-1]
                db.update_topic_summary(old_topic_id, (new_latest_cap["clean_text"] or "")[:100])
                
                import json
                conn = db.get_conn()
                snapshot = conn.execute(
                    "SELECT body_md FROM topic_versions WHERE topic_id = ? AND capture_id = ? ORDER BY version DESC LIMIT 1",
                    (old_topic_id, capture_id)
                ).fetchone()
                
                if snapshot:
                    new_body = snapshot[0]
                else:
                    lines = old_topic["body_md"].split("\n")
                    new_lines = [l for l in lines if f"cap-{capture_id}" not in l]
                    new_body = "\n".join(new_lines)
                    
                db.update_topic(
                    old_topic_id, None,
                    title=old_topic["title"],
                    summary=old_topic["summary"],
                    body_md=new_body,
                    tags=json.loads(old_topic["tags"])
                )
                
    return db.get_capture(capture_id)
