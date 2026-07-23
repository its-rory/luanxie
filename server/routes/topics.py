"""主题笔记:列表/详情/手工修正/版本历史/回滚。"""
import json

from fastapi import APIRouter, HTTPException

from .. import db
from ..models import TopicPatch, CapturePatch

router = APIRouter(prefix="/api/topics", tags=["topics"])


def _with_tags(topic: dict) -> dict:
    topic["tags"] = json.loads(topic["tags"])
    return topic


@router.get("")
def list_topics(q: str | None = None, title: str | None = None):
    if title:
        topic = db.get_topic_by_title(title)
        if topic:
            return [_with_tags(topic)]
        return []
    return [_with_tags(t) for t in db.list_topics(q)]


@router.get("/{topic_id}")
def get_topic(topic_id: str):
    topic = db.get_topic(topic_id)
    if not topic:
        raise HTTPException(404, "主题不存在")
    return _with_tags(topic)


@router.patch("/{topic_id}")
def patch_topic(topic_id: str, patch: TopicPatch):
    topic = db.get_topic(topic_id)
    if not topic:
        raise HTTPException(404, "主题不存在")
    if patch.title and patch.title != topic["title"]:
        clash = db.get_topic_by_title(patch.title)
        if clash:
            raise HTTPException(409, "标题与已有主题重复")
    updated = db.update_topic(
        topic_id, None,
        title=patch.title or topic["title"],
        summary=patch.summary if patch.summary is not None else topic["summary"],
        body_md=patch.body_md if patch.body_md is not None else topic["body_md"],
        tags=patch.tags if patch.tags is not None else json.loads(topic["tags"]),
    )
    return _with_tags(updated)


@router.get("/{topic_id}/versions")
def list_versions(topic_id: str):
    if not db.get_topic(topic_id):
        raise HTTPException(404, "主题不存在")
    return db.list_topic_versions(topic_id)


@router.post("/{topic_id}/rollback/{version}")
def rollback(topic_id: str, version: int):
    topic = db.get_topic(topic_id)
    if not topic:
        raise HTTPException(404, "主题不存在")
    snapshot = db.get_topic_version(topic_id, version)
    if not snapshot:
        raise HTTPException(404, f"版本 {version} 不存在")
    # 回滚 = 用快照内容写一个新版本(可再回滚回来,历史不丢)
    updated = db.update_topic(
        topic_id, None,
        title=topic["title"], summary=topic["summary"],
        body_md=snapshot["body_md"], tags=json.loads(topic["tags"]),
    )
    return _with_tags(updated)


@router.delete("/{topic_id}")
def delete_topic(topic_id: str):
    topic = db.get_topic(topic_id)
    if not topic:
        raise HTTPException(404, "主题不存在")
    db.delete_topic(topic_id)
    return {"ok": True}


# ---------- sub-card captures endpoints ----------

@router.get("/{topic_id}/captures")
def get_topic_captures(topic_id: str):
    if not db.get_topic(topic_id):
        raise HTTPException(404, "主题不存在")
    return db.list_captures_by_topic(topic_id)


@router.patch("/captures/{capture_id}")
def patch_capture(capture_id: str, patch: CapturePatch):
    cap = db.get_capture(capture_id)
    if not cap:
        raise HTTPException(404, "子卡片不存在")
        
    updated = db.update_capture_content(
        capture_id,
        clean_text=patch.clean_text if patch.clean_text is not None else (cap["clean_text"] or ""),
        raw_text=patch.raw_text if patch.raw_text is not None else cap["raw_text"],
        transcript=patch.transcript if patch.transcript is not None else cap["transcript"],
        media_path=cap["media_path"],
        title=patch.title if patch.title is not None else cap["title"]
    )
    if updated.get("topic_id"):
        topic_id = updated["topic_id"]
        caps = db.list_captures_by_topic(topic_id)
        if caps and caps[-1]["id"] == capture_id:
            db.update_topic_summary(topic_id, (updated["clean_text"] or "")[:100])
    return updated


@router.get("/captures/{capture_id}/versions")
def list_capture_versions(capture_id: str):
    if not db.get_capture(capture_id):
        raise HTTPException(404, "子卡片不存在")
    return db.list_capture_versions(capture_id)


@router.post("/captures/{capture_id}/rollback/{version}")
def rollback_capture(capture_id: str, version: int):
    if not db.get_capture(capture_id):
        raise HTTPException(404, "子卡片不存在")
    try:
        updated = db.rollback_capture(capture_id, version)
        if updated.get("topic_id"):
            topic_id = updated["topic_id"]
            caps = db.list_captures_by_topic(topic_id)
            if caps and caps[-1]["id"] == capture_id:
                db.update_topic_summary(topic_id, (updated["clean_text"] or "")[:100])
        return updated
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/captures/{capture_id}")
def delete_capture_route(capture_id: str):
    cap = db.get_capture(capture_id)
    if not cap:
        raise HTTPException(404, "子卡片不存在")
    topic_id = cap.get("topic_id")
    db.delete_capture(capture_id)
    topic_deleted = False
    if topic_id:
        remaining = db.list_captures_by_topic(topic_id)
        if not remaining:
            db.delete_topic(topic_id)
            topic_deleted = True
        else:
            new_latest_cap = remaining[-1]
            db.update_topic_summary(topic_id, (new_latest_cap["clean_text"] or "")[:100])
    return {"ok": True, "topic_deleted": topic_deleted}
