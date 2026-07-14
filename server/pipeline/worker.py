"""流水线 worker:asyncio 队列 + 单消费者串行状态机。

状态机:pending → transcribing(audio) → classifying → awaiting_review | merging → done | failed
幂等:每阶段只依据 capture.status 推进;启动时把非终态的 captures 重新入队。
串行消费天然避免两条 capture 并发合并同一主题的竞态。
"""
import asyncio
import json
import traceback

from .. import config, db, events
from ..models import TopicDecision
from . import classify as classify_mod
from . import merge as merge_mod
from . import transcribe as transcribe_mod

_queue: asyncio.Queue[str] = asyncio.Queue()

MAX_RETRIES = 3
CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2, "never": 99}


async def enqueue(capture_id: str) -> None:
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


_merge_lock = asyncio.Lock()


async def run_merge(capture_id: str, decision: TopicDecision) -> None:
    """merge 阶段。也被 review 批准路径直接调用。"""
    async with _merge_lock:
        cap = _set_status(capture_id, "merging")
        db.log(capture_id, "merge", "start")
        if decision.action == "new":
            topic = db.create_topic(decision.new_topic_title,
                                    summary=decision.clean_text[:100])
        else:
            topic = db.get_topic(decision.topic_id)
            if topic:
                db.update_topic_summary(topic["id"], decision.clean_text[:100])
        if topic is None:
            raise ValueError(f"Topic not found for action={decision.action}, topic_id={decision.topic_id}, title={decision.new_topic_title}")
        db.update_capture(capture_id, topic_id=topic["id"])
        
        db.log(capture_id, "merge", "ok", json.dumps({"status": "associated"}))
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
            await _retry_or_fail(capture_id, f"API 暂时性错误: {e}", retryable=True)
        else:
            db.log(capture_id, "error", "error", traceback.format_exc()[-1500:])
            await _retry_or_fail(capture_id, str(e), retryable=False)


async def _retry_or_fail(capture_id: str, error: str, *, retryable: bool) -> None:
    cap = db.get_capture(capture_id)
    retries = cap["retry_count"] + 1
    if retryable and retries < MAX_RETRIES:
        db.update_capture(capture_id, retry_count=retries, error=error)
        delay = 5 * (2 ** retries)
        db.log(capture_id, "retry", "start", f"第{retries}次重试,{delay}s 后")
        await asyncio.sleep(delay)
        await enqueue(capture_id)
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
            _queue.task_done()


def queue_depth() -> int:
    return _queue.qsize()
