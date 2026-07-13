"""Opus 合并:旧笔记 + 新片段 → 完整重写的新版本,带防丢信息兜底。"""
import json
from datetime import date

from .. import config, db
from ..models import MergedNote
from . import prompts
from .llm import call_structured

# 新 body 短于旧 body 的这个比例即判定可疑(可能丢信息),走降级路径
SHRINK_SUSPECT_RATIO = 0.7


def merge(capture: dict, topic: dict) -> tuple[dict, dict]:
    """把 capture 的净化文合并进 topic,落库并返回 (新topic, token用量)。"""
    fragment = capture["clean_text"] or capture["transcript"] or capture["raw_text"]
    today = date.today().isoformat()
    linkable = [t["title"] for t in db.list_topics() if t["id"] != topic["id"]][:100]
    current_tags = json.loads(topic["tags"])

    user_text = prompts.merge_user_text(
        topic_title=topic["title"],
        old_body=topic["body_md"],
        new_fragment=fragment,
        capture_id=capture["id"],
        date=today,
        linkable_titles=linkable,
        existing_tags=db.all_tags()[:60],
        current_tags=current_tags,
    )
    note, usage = call_structured(
        model=config.MERGE_MODEL,
        max_tokens=16000,
        system=[{"type": "text", "text": prompts.MERGE_SYSTEM,
                 "cache_control": {"type": "ephemeral"}}],
        content=user_text,
        schema=MergedNote,
        tool_name="submit_note",
        tool_description="提交合并后的完整主题笔记",
        provider=config.MERGE_PROVIDER_NAME,
        api_key=config.MERGE_API_KEY,
        base_url=config.MERGE_BASE_URL,
    )

    body = note.body_md
    title = note.title.strip() or topic["title"]
    suspicious = (
        topic["body_md"]
        and len(body) < len(topic["body_md"]) * SHRINK_SUSPECT_RATIO
    )
    if suspicious:
        # 疑似丢信息:不采纳重写结果,旧文 + 附录降级保底,人工可后续整理
        body = (
            f"{topic['body_md'].rstrip()}\n\n---\n\n"
            f"> [!warning] 以下为自动追加(AI 合并结果可疑,未采纳重写)\n\n"
            f"{fragment.strip()}\n\n"
            f"- {today} 收录:(降级追加) ^cap-{capture['id']}\n"
        )
        title = topic["title"]
        db.log(capture["id"], "merge", "ok",
               json.dumps({"degraded": "shrink_suspect", **usage}, ensure_ascii=False))

    # 标题若与其他主题撞名,保持原标题(title UNIQUE 约束)
    if title != topic["title"]:
        clash = db.get_topic_by_title(title)
        if clash and clash["id"] != topic["id"]:
            title = topic["title"]

    updated = db.update_topic(
        topic["id"], capture["id"],
        title=title, summary=note.summary, body_md=body, tags=note.tags[:6],
    )
    return updated, usage
