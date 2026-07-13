"""Haiku 一次调用完成:净化 + 主题匹配(+ 图片内容提取)。"""
import base64
import json
import mimetypes

from .. import config, db
from ..models import TopicDecision
from . import prompts
from .llm import call_structured


def _topic_list_block(query_text: str) -> str:
    """主题清单:少于阈值全量,否则 FTS5 候选 + 最近更新兜底。"""
    topics = db.list_topics()
    if not topics:
        return prompts.CLASSIFY_NO_TOPICS_NOTE
    partial = False
    if len(topics) >= config.TOPIC_LIST_FULL_LIMIT:
        candidates = {t["id"]: t for t in db.topic_candidates(query_text, limit=30)}
        for t in topics[:10]:  # 最近更新的 10 个兜底
            candidates.setdefault(t["id"], t)
        topics = list(candidates.values())
        partial = True
    lines = [
        f"{t['id']} | {t['title']} | {t['summary'][:80]} | "
        f"{','.join(json.loads(t['tags']))}"
        for t in topics
    ]
    block = prompts.CLASSIFY_TOPIC_LIST_HEADER + "\n".join(lines)
    if partial:
        block += prompts.CLASSIFY_TOPIC_LIST_PARTIAL_NOTE
    return block


def _image_block(media_path: str) -> dict:
    path = config.DATA_DIR / media_path
    media_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    data = base64.standard_b64encode(path.read_bytes()).decode()
    return {"type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data}}


def classify(capture: dict) -> tuple[TopicDecision, dict]:
    """返回 (决策, token用量)。文本输入用 raw_text/transcript,图片直接传图。"""
    model = config.TEXT_MODEL
    provider = config.TEXT_PROVIDER_NAME
    api_key = config.TEXT_API_KEY
    base_url = config.TEXT_BASE_URL

    if capture["type"] == "image":
        query_text = ""
        content: list | str = [
            _image_block(capture["media_path"]),
            {"type": "text", "text": prompts.CLASSIFY_IMAGE_INSTRUCTION},
        ]
        if config.IMAGE_MODEL:
            model = config.IMAGE_MODEL
            provider = config.IMAGE_PROVIDER_NAME or provider
            api_key = config.IMAGE_API_KEY or api_key
            base_url = config.IMAGE_BASE_URL or base_url
    else:
        query_text = capture["transcript"] or capture["raw_text"] or ""
        content = prompts.classify_user_text(query_text)

    # system 分两块:冻结指令 + 主题清单(清单只在主题变化时变,加缓存断点)
    system = [
        {"type": "text", "text": prompts.CLASSIFY_SYSTEM},
        {"type": "text", "text": _topic_list_block(query_text),
         "cache_control": {"type": "ephemeral"}},
    ]
    decision, usage = call_structured(
        model=model,
        max_tokens=4096,
        system=system,
        content=content,
        schema=TopicDecision,
        tool_name="submit_decision",
        tool_description="提交净化后的文本与主题归属判断",
        provider=provider,
        api_key=api_key,
        base_url=base_url,
    )
    # 防御:模型选了 existing 但 topic_id 不在库里 → 降级为新主题
    if decision.action == "existing":
        if not decision.topic_id or not db.get_topic(decision.topic_id):
            decision.action = "new"
            decision.new_topic_title = decision.new_topic_title or (
                decision.clean_text[:20] or "未命名主题")
            decision.confidence = "low"
    if decision.action == "new" and not decision.new_topic_title:
        decision.new_topic_title = decision.clean_text[:20] or "未命名主题"
    return decision, usage
