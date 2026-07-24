"""流水线 worker:asyncio 队列 + 单消费者串行状态机。

状态机:pending → transcribing(audio) → classifying → awaiting_review | merging → done | failed
幂等:每阶段只依据 capture.status 推进;启动时把非终态的 captures 重新入队。
串行消费天然避免两条 capture 并发合并同一主题的竞态。
"""
import asyncio
import json
import sys
import traceback

from .. import config, db, events
from .._sanitizer import sanitize_exception, short_traceback
from ..models import TopicDecision
from . import classify as classify_mod
from . import transcribe as transcribe_mod

_TRACEBACK_MAX = 1500

_queue: asyncio.Queue[str] = asyncio.Queue()
# 在途去重:避免同一 capture 被多次入队并发处理(启动期 pending_captures + 后台延迟重入队 + 手动重试 可能重复)。
_inflight: set[str] = set()

MAX_RETRIES = 3           # 单次失败链内的自动重试上限(向后兼容保留)
MAX_TOTAL_RETRIES = 6     # 累计总重试上限(自动 + 手动合计),防无限重试耗配额
CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2, "never": 99}


async def enqueue(capture_id: str) -> None:
    # 去重:已在队列/处理中/已调度重试的,不重复入队。
    if capture_id in _inflight:
        return
    _inflight.add(capture_id)
    await _queue.put(capture_id)


def _publish(capture: dict) -> None:
    events.publish({"kind": "capture", **{
        k: capture.get(k) for k in
        ("id", "type", "status", "topic_id", "confidence", "error")}})


def _set_status(capture_id: str, status: str, **fields) -> dict:
    db.update_capture(capture_id, status=status, **fields)
    cap = db.get_capture(capture_id)
    _publish(cap)
    return cap


async def _transcribe_stage(cap: dict) -> dict:
    if cap["type"] != "audio" or cap["transcript"]:
        return cap
    cap = _set_status(cap["id"], "transcribing")
    db.log(cap["id"], "transcribe", "start")
    text = await transcribe_mod.transcribe(cap["media_path"])
    if not text:
        raise ValueError("转写结果为空(可能是无声音频)")
    db.update_capture(cap["id"], transcript=text)
    db.log(cap["id"], "transcribe", "ok", text[:200])
    return db.get_capture(cap["id"])


async def _classify_stage(cap: dict) -> tuple[dict, TopicDecision]:
    cap = _set_status(cap["id"], "classifying")
    db.log(cap["id"], "classify", "start")
    decision, usage = await asyncio.to_thread(classify_mod.classify, cap)
    db.update_capture(
        cap["id"],
        clean_text=decision.clean_text,
        confidence=decision.confidence,
        suggestion=decision.model_dump_json(),
    )
    # 图片没有独立转写阶段,把提取文本也存进 transcript 供检索/回看
    if cap["type"] == "image" and not cap["transcript"]:
        db.update_capture(cap["id"], transcript=decision.clean_text)
    db.log(cap["id"], "classify", "ok",
           json.dumps({"action": decision.action, "topic_id": decision.topic_id,
                       "new_title": decision.new_topic_title,
                       "confidence": decision.confidence,
                       "reason": decision.reason, **usage}, ensure_ascii=False))
    return db.get_capture(cap["id"]), decision


from pydantic import BaseModel, Field
from .llm import call_structured

class NamingDecision(BaseModel):
    sub_card_title: str = Field(description="A professional, very short title for this specific capture/message, 4 to 12 chars.")

async def generate_titles(clean_text: str) -> str:
    """仅生成子卡片标题。
    主题标题(new_topic_title)不再由 AI 重新命名:
    - 用户在待确认队列手动指定的主标题,或 classify 阶段 AI 的主题命名,都直接经由 decision.new_topic_title 传入,
      在此再让 AI 重命名会覆盖用户指定值,故主题标题一律沿用既有来源。
    """
    system_prompt = """你是一个专业的知识库整理助手。用户提供了一项新条目的AI解析内容。
请为这项条目生成最合适的名词短语命名：
**sub_card_title**：代表此项记录（子卡片）的具体标题，4~12字（如“一二期分拣机高度差”）。"""

    user_prompt = f"内容如下：\n{clean_text}"

    res, usage = await asyncio.to_thread(
        call_structured,
        model=config.MERGE_MODEL,
        system=system_prompt,
        content=user_prompt,
        schema=NamingDecision,
        tool_name="submit_naming",
        tool_description="Submit the generated sub-card title for this capture",
        provider=config.MERGE_PROVIDER_NAME,
        api_key=config.MERGE_API_KEY,
        base_url=config.MERGE_BASE_URL
    )
    return res.sub_card_title.strip()


_merge_lock = asyncio.Lock()


async def run_merge(capture_id: str, decision: TopicDecision) -> None:
    """merge 阶段。也被 review 批准路径直接调用。"""
    async with _merge_lock:
        cap = _set_status(capture_id, "merging")
        db.log(capture_id, "merge", "start")
        
        # 1. 子卡片标题由合并 AI 自动命名;主题标题沿用 decision.new_topic_title
        #    (用户在待确认队列指定的主标题,或 classify 阶段 AI 的命名,二者都已落在 decision 上)。
        sub_title = None
        try:
            sub_title = await generate_titles(decision.clean_text)
        except Exception as e:
            db.log(capture_id, "merge", "warn", f"合并 AI 自动命名失败(已退回默认命名): {e}")

        if not sub_title:
            first_line = decision.clean_text.split('\n')[0].strip().replace('- ', '')
            sub_title = first_line[:12] + ("..." if len(first_line) > 12 else "")
            if not sub_title:
                sub_title = "未命名记录"

        # new_topic_title 直接沿用既有来源(用户指定优先;否则 classify 阶段 AI 命名);兜底防空
        new_topic_title = decision.new_topic_title or "新主题"

        if decision.action == "new":
            topic = db.create_topic(new_topic_title,
                                    summary=decision.clean_text[:100])
        else:
            topic = db.get_topic(decision.topic_id)
            if topic:
                db.update_topic_summary(topic["id"], decision.clean_text[:100])
        if topic is None:
            raise ValueError(f"Topic not found for action={decision.action}, topic_id={decision.topic_id}, title={new_topic_title}")
        
        # 将子卡片关联到主题，并存入自动生成的子卡片标题
        db.update_capture(capture_id, topic_id=topic["id"], title=sub_title)
        
        db.log(capture_id, "merge", "ok", json.dumps({"status": "associated", "sub_title": sub_title}))
        _set_status(capture_id, "done", processed_at=db.now())
        events.publish({"kind": "topic", "id": topic["id"], "title": topic["title"]})


async def _process(capture_id: str) -> None:
    cap = db.get_capture(capture_id)
    if cap is None or cap["status"] in ("done", "failed", "rejected"):
        return
    try:
        cap = await _transcribe_stage(cap)
        cap, decision = await _classify_stage(cap)
        threshold_key = "AUTO_MERGE_EXISTING_CONFIDENCE" if decision.action == "existing" else "AUTO_MERGE_NEW_CONFIDENCE"
        threshold_str = getattr(config, threshold_key, "high")
        threshold = CONFIDENCE_RANK.get(threshold_str, 2)
        decision_rank = CONFIDENCE_RANK.get(decision.confidence, 0)
        
        if decision_rank >= threshold:
            await run_merge(cap["id"], decision)
        else:
            _set_status(cap["id"], "awaiting_review")
            db.log(cap["id"], "review", "start", f"置信度不足 ({decision.confidence} < {threshold_str}), 等待用户确认")
    except Exception as e:
        is_api_err = False
        try:
            import anthropic
            if isinstance(e, (anthropic.RateLimitError, anthropic.InternalServerError, anthropic.APIConnectionError)):
                is_api_err = True
        except ImportError:
            pass

        try:
            import openai
            if isinstance(e, (openai.RateLimitError, openai.APIConnectionError, openai.InternalServerError)):
                is_api_err = True
        except ImportError:
            pass

        if is_api_err:
            await _retry_or_fail(capture_id, f"API 暂时性错误: {sanitize_exception(e)}", retryable=True)
        else:
            # 完整 traceback 仅打到本地服务器日志(stderr/journal),不进 DB(后者经 captures API 回传前端)。
            print(short_traceback(e, _TRACEBACK_MAX), file=sys.stderr, flush=True)
            await _retry_or_fail(capture_id, sanitize_exception(e), retryable=False)


async def _retry_or_fail(capture_id: str, error: str, *, retryable: bool) -> None:
    cap = db.get_capture(capture_id)
    retries = cap["retry_count"] + 1
    # 累计总上限:自动 + 手动合计不超过 MAX_TOTAL_RETRIES,避免反复手动重试无限耗上游配额。
    if retryable and retries <= MAX_TOTAL_RETRIES:
        db.update_capture(capture_id, status="pending", retry_count=retries, error=error)
        delay = min(5 * (2 ** min(retries, 5)), 160)  # 指数退避上限 160s
        db.log(capture_id, "retry", "start", f"第{retries}次重试,{delay}s 后(累计上限{MAX_TOTAL_RETRIES})")
        # 后台延迟再入队,不阻塞消费者处理其它 capture(原 await asyncio.sleep 会冻结整条流水线)。
        async def _delayed_requeue():
            await asyncio.sleep(delay)
            await enqueue(capture_id)
        asyncio.create_task(_delayed_requeue())
    else:
        _set_status(capture_id, "failed", error=error, retry_count=retries)
        db.log(capture_id, "error", "error", error)


async def consumer() -> None:
    # 崩溃恢复:非终态的 captures 重新入队
    for cap in db.pending_captures():
        await enqueue(cap["id"])
    while True:
        capture_id = await _queue.get()
        try:
            await _process(capture_id)
        except Exception:
            traceback.print_exc()
        finally:
            _inflight.discard(capture_id)
            _queue.task_done()


def queue_depth() -> int:
    return _queue.qsize()
