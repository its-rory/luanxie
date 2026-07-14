"""Pydantic 模型:API 响应与 AI 结构化输出。"""
from typing import Literal

from pydantic import BaseModel


class TopicDecision(BaseModel):
    """classify 阶段的结构化输出:净化文 + 主题归属判断。"""
    clean_text: str
    action: Literal["existing", "new"]
    topic_id: str | None = None
    new_topic_title: str | None = None
    confidence: Literal["high", "medium", "low"]
    reason: str


class MergedNote(BaseModel):
    """merge 阶段的结构化输出:完整重写后的主题笔记。"""
    title: str
    summary: str
    body_md: str
    tags: list[str]


class ReviewAction(BaseModel):
    """待确认队列的用户裁决。"""
    action: Literal["approve", "reassign", "reject"]
    topic_id: str | None = None        # reassign 到已有主题
    new_topic_title: str | None = None  # reassign 到新主题


class TopicPatch(BaseModel):
    title: str | None = None
    summary: str | None = None
    body_md: str | None = None
    tags: list[str] | None = None


class CapturePatch(BaseModel):
    clean_text: str | None = None
    raw_text: str | None = None
    transcript: str | None = None
