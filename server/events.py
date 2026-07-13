import asyncio
import json
import threading

_subscribers: set[asyncio.Queue] = set()
_subscribers_lock = threading.Lock()


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    try:
        q.loop = asyncio.get_running_loop()
    except RuntimeError:
        q.loop = None
    with _subscribers_lock:
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
            loop.call_soon_threadsafe(safe_put, q, data)
        else:
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                with _subscribers_lock:
                    _subscribers.discard(q)
            except Exception:
                pass
