"""错误信息脱敏:抹掉上游 SDK traceback / repr 中的敏感信息(账号、URL、token、payload)。

定位问题(哪一阶段/哪一类失败)仍可定位,但不再把上游返回的原始内容回传给前端或写进可被 API 读取的日志。
原始 traceback 仅供服务器 stderr / 日志输出,不进 DB 的 processing_log.detail(后者经 captures GET 暴露)。
"""
import re

# 尽可能裁掉的片段
_SECRET_PATTERNS = [
    # API key 形态:sk-... / Bearer ...
    (re.compile(r"(sk-[A-Za-z0-9]{6})[A-Za-z0-9]*"), r"\1..."),
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+", re.IGNORECASE), r"\1***"),
    # URL 里的 token/密码 query
    (re.compile(r"([?&](?:token|access_token|password|api_key|key)=)[^&\s']+"), r"\1***"),
]

# 可保留给前端看的错误类型关键词(用于定位"是限流还是鉴权还是网络")
_KEEP_TYPE_HINT = (
    "RateLimit", "authentication", "Authentication", "NotFound", "Timeout",
    "connection", "Connection", "invalid_request", "Upstream", "400", "429", "500", "503",
)

_MAX_DETAIL_LEN = 300


def _truncate(s: str, n: int = _MAX_DETAIL_LEN) -> str:
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return s[:n] + "…"


def sanitize_error_text(text: str) -> str:
    """对任意字符串做脱敏 + 截断,用于落库后回传前端的错误摘要。"""
    if not text:
        return ""
    out = text
    for pat, repl in _SECRET_PATTERNS:
        out = pat.sub(repl, out)
    return _truncate(out, _MAX_DETAIL_LEN)


def sanitize_exception(e: BaseException) -> str:
    """从异常对象提取脱敏后的一句话摘要(类型 + 浓缩 message),不含 traceback。"""
    type_name = type(e).__name__
    msg = str(e)
    hint = next((h for h in _KEEP_TYPE_HINT if h in msg or h in type_name), "")
    msg = sanitize_error_text(msg)
    if hint and hint not in msg:
        msg = f"{hint}: {msg}" if msg else hint
    return f"{type_name}: {msg}" if msg else type_name


def short_traceback(e: BaseException, max_chars: int = 1500) -> str:
    """脱敏后的 traceback,仅用于服务器本地日志(stderr / journal),
    不应直接落库回传前端。这里仍做 token/key 抹除以防日志外泄。"""
    import traceback
    tb = traceback.format_exc()
    for pat, repl in _SECRET_PATTERNS:
        tb = pat.sub(repl, tb)
    if len(tb) > max_chars:
        tb = tb[-max_chars:]
    return tb