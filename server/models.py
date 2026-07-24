"""Pydantic 模型:API 响应与 AI 结构化输出。"""
from typing import Literal

from pydantic import BaseModel, Field


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
    new_topic_title: str | None = Field(None, max_length=40)  # reassign 到新主题


class TopicPatch(BaseModel):
    # M4: 给可写入字段加上长度上限,防超大内容/超长标签列表。
    title: str | None = Field(None, max_length=200)
    summary: str | None = Field(None, max_length=2000)
    body_md: str | None = Field(None, max_length=200000)
    tags: list[str] | None = Field(None, max_length=40)  # 最多 40 个标签


class CapturePatch(BaseModel):
    clean_text: str | None = Field(None, max_length=100000)
    raw_text: str | None = Field(None, max_length=50000)
    transcript: str | None = Field(None, max_length=100000)
    title: str | None = Field(None, max_length=200)
