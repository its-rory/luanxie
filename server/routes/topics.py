"""主题笔记:列表/详情/手工修正/版本历史/回滚。"""
import json

from fastapi import APIRouter, HTTPException

from .. import db
from ..models import TopicPatch

router = APIRouter(prefix="/api/topics", tags=["topics"])


def _with_tags(topic: dict) -> dict:
    topic["tags"] = json.loads(topic["tags"])
    return topic


@router.get("")
def list_topics(q: str | None = None):
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
    
    from .. import config
    if topic["export_filename"]:
        export_path = config.VAULT_EXPORT_DIR / topic["export_filename"]
        export_path.unlink(missing_ok=True)

    db.delete_topic(topic_id)
    return {"ok": True}
