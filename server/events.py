"""进程内事件广播:worker 推送 capture 状态变化,SSE 端点转发给前端。"""
import asyncio
import json

_subscribers: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    try:
        q.loop = asyncio.get_running_loop()
    except RuntimeError:
        q.loop = None
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def publish(event: dict) -> None:
    data = json.dumps(event, ensure_ascii=False)

    def safe_put(queue, payload):
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            _subscribers.discard(queue)

    for q in list(_subscribers):
        loop = getattr(q, "loop", None)
        if loop and loop.is_running():
            loop.call_soon_threadsafe(safe_put, q, data)
        else:
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                _subscribers.discard(q)
            except Exception:
                pass
