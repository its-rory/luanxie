"""轻量内存限频:按 key(通常是客户端 IP)滑动窗口计数。

单进程内有效;不持久化、不跨 worker。够防滥用,不追求精确多实例隔离。
线程安全。用于 POST /api/captures 等易被刷的端点。
"""
import threading
import time
from collections import defaultdict


class SlidingWindowRateLimiter:
    def __init__(self, max_calls: int, window_seconds: float):
        self.max_calls = max_calls
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def allow(self, key: str) -> tuple[bool, int]:
        """返回 (是否允许, 重试前应等待秒数)。"""
        now = time.time()
        with self._lock:
            hits = [t for t in self._hits[key] if now - t < self.window]
            if len(hits) >= self.max_calls:
                wait = self.window - (now - hits[0])
                return False, max(int(wait) + 1, 1)
            hits.append(now)
            self._hits[key] = hits
            return True, 0