import asyncio
import json
import threading

_subscribers: set[asyncio.Queue] = set()
_subscribers_lock = threading.Lock()
_MAX_SUBSCRIBERS = 50  # M8: SSE 订阅上限,防大量连接无限增长内存


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    try:
        q.loop = asyncio.get_running_loop()
    except RuntimeError:
        q.loop = None
    with _subscribers_lock:
        if len(_subscribers) >= _MAX_SUBSCRIBERS:
            # 超限时丢弃一个最旧订阅保护内存;客户端断流会自动重连。
            try:
                _subscribers.pop()
            except KeyError:
                pass
        _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    with _subscribers_lock:
        _subscribers.discard(q)


def publish(event: dict) -> None:
    data = json.dumps(event, ensure_ascii=False)

    def safe_put(queue, payload):
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            with _subscribers_lock:
                _subscribers.discard(queue)

    with _subscribers_lock:
        subs = list(_subscribers)

    for q in subs:
        loop = getattr(q, "loop", None)
        if loop and loop.is_running():
            try:
                loop.call_soon_threadsafe(safe_put, q, data)
            except RuntimeError:
                # loop 在 is_running 检查后关闭,丢弃该订阅避免持续报错。
                with _subscribers_lock:
                    _subscribers.discard(q)
        else:
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                with _subscribers_lock:
                    _subscribers.discard(q)
            except Exception:
                pass
