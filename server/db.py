"""SQLite 薄封装:WAL 连接、schema、CRUD。单写者(worker 串行),无需连接池。"""
import json
import sqlite3
import uuid
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS captures (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('text','audio','image')),
  status        TEXT NOT NULL DEFAULT 'pending',
  raw_text      TEXT,
  media_path    TEXT,
  transcript    TEXT,
  clean_text    TEXT,
  topic_id      TEXT REFERENCES topics(id),
  confidence    TEXT,
  suggestion    TEXT,
  error         TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  processed_at  TEXT
);

CREATE TABLE IF NOT EXISTS topics (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL UNIQUE,
  summary          TEXT NOT NULL DEFAULT '',
  body_md          TEXT NOT NULL DEFAULT '',
  tags             TEXT NOT NULL DEFAULT '[]',
  version          INTEGER NOT NULL DEFAULT 0,
  exported_version INTEGER NOT NULL DEFAULT 0,
  export_filename  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    TEXT NOT NULL REFERENCES topics(id),
  version     INTEGER NOT NULL,
  body_md     TEXT NOT NULL,
  capture_id  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processing_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_id  TEXT NOT NULL,
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS topics_fts USING fts5(
  topic_id UNINDEXED, title, summary, tags
);

CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status);
CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  expires_at  REAL NOT NULL
);
"""

import threading

_local = threading.local()
_schema_initialized = False
_schema_lock = threading.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_conn() -> sqlite3.Connection:
    global _schema_initialized
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(config.DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        # M2: 写竞争时排队等待而非立即抛 "database is locked",5s 足够单写者 worker 串行完成。
        conn.execute("PRAGMA busy_timeout=5000")
        with _schema_lock:
            if not _schema_initialized:
                conn.executescript(SCHEMA)
                # Migration: add version to captures if it doesn't exist
                try:
                    conn.execute("ALTER TABLE captures ADD COLUMN version INTEGER NOT NULL DEFAULT 0")
                    conn.commit()
                except sqlite3.OperationalError:
                    pass
                # Migration: add title to captures if it doesn't exist
                try:
                    conn.execute("ALTER TABLE captures ADD COLUMN title TEXT")
                    conn.commit()
                except sqlite3.OperationalError:
                    pass
                # Migration: create capture_versions table
                conn.execute("""
                CREATE TABLE IF NOT EXISTS capture_versions (
                  id            INTEGER PRIMARY KEY AUTOINCREMENT,
                  capture_id    TEXT NOT NULL REFERENCES captures(id),
                  version       INTEGER NOT NULL,
                  clean_text    TEXT NOT NULL,
                  raw_text      TEXT,
                  transcript    TEXT,
                  media_path    TEXT,
                  title         TEXT,
                  created_at    TEXT NOT NULL
                )
                """)
                conn.commit()
                # Migration: add title to capture_versions if it doesn't exist (for existing tables)
                try:
                    conn.execute("ALTER TABLE capture_versions ADD COLUMN title TEXT")
                    conn.commit()
                except sqlite3.OperationalError:
                    pass
                _schema_initialized = True
        _local.conn = conn
    return conn


def _rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


# ---------- captures ----------

def create_capture(type_: str, raw_text: str | None = None,
                   media_path: str | None = None) -> dict:
    conn = get_conn()
    import sqlite3
    for _ in range(5):
        cap_id = uuid.uuid4().hex[:12]
        cap = {
            "id": cap_id,
            "type": type_,
            "status": "pending",
            "raw_text": raw_text,
            "media_path": media_path,
            "created_at": now(),
        }
        try:
            with conn:
                conn.execute(
                    "INSERT INTO captures (id, type, status, raw_text, media_path, created_at)"
                    " VALUES (:id, :type, :status, :raw_text, :media_path, :created_at)", cap)
            break
        except sqlite3.IntegrityError:
            continue
    else:
        raise ValueError("Failed to generate a unique capture ID after 5 attempts")
    return get_capture(cap_id)


def get_capture(capture_id: str) -> dict | None:
    cur = get_conn().execute("SELECT * FROM captures WHERE id=?", (capture_id,))
    row = cur.fetchone()
    return dict(row) if row else None


def list_captures(status: str | None = None, limit: int = 50, offset: int = 0) -> list[dict]:
    conn = get_conn()
    if status:
        cur = conn.execute(
            "SELECT * FROM captures WHERE status=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (status, limit, offset))
    else:
        cur = conn.execute(
            "SELECT * FROM captures ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset))
    return _rows(cur)


def update_capture(capture_id: str, **fields) -> None:
    if not fields:
        return
    allowed = {
        "type", "status", "raw_text", "media_path", "transcript", "clean_text",
        "topic_id", "confidence", "suggestion", "error", "retry_count", "created_at",
        "processed_at", "title"
    }
    for k in fields:
        if k not in allowed:
            raise ValueError(f"Invalid column: {k}")
    conn = get_conn()
    items = list(fields.items())
    cols = ", ".join(f"{k}=?" for k, _ in items)
    vals = [v for _, v in items]
    conn.execute(f"UPDATE captures SET {cols} WHERE id=?",
                 (*vals, capture_id))
    conn.commit()


def delete_capture(capture_id: str) -> None:
    conn = get_conn()
    cap = get_capture(capture_id)
    with conn:
        conn.execute("DELETE FROM processing_log WHERE capture_id=?", (capture_id,))
        conn.execute("DELETE FROM capture_versions WHERE capture_id=?", (capture_id,))
        conn.execute("DELETE FROM captures WHERE id=?", (capture_id,))
    if cap and cap.get("media_path"):
        try:
            (config.DATA_DIR / cap["media_path"]).unlink(missing_ok=True)
        except Exception:
            pass


def pending_captures() -> list[dict]:
    """非终态的 captures,启动时重新入队用。"""
    cur = get_conn().execute(
        "SELECT * FROM captures WHERE status NOT IN "
        "('done','failed','awaiting_review','rejected') ORDER BY created_at")
    return _rows(cur)


def working_captures_count() -> int:
    """在途作业数(pending/transcribing/classifying/merging),收件箱红点用。"""
    cur = get_conn().execute(
        "SELECT COUNT(*) FROM captures WHERE status IN "
        "('pending','transcribing','classifying','merging')")
    return cur.fetchone()[0]


# ---------- topics ----------

def create_topic(title: str, summary: str = "") -> dict:
    conn = get_conn()
    tid = uuid.uuid4().hex[:12]
    ts = now()
    try:
        conn.execute(
            "INSERT INTO topics (id, title, summary, created_at, updated_at)"
            " VALUES (?,?,?,?,?)", (tid, title, summary, ts, ts))
        conn.execute(
            "INSERT INTO topics_fts (topic_id, title, summary, tags) VALUES (?,?,?,?)",
            (tid, title, summary, "[]"))
        conn.commit()
    except sqlite3.IntegrityError:
        # title UNIQUE:并发/重试时复用已有主题
        conn.rollback()
        topic = get_topic_by_title(title)
        if topic is None:
            raise RuntimeError(f"Failed to retrieve existing topic with title '{title}' after IntegrityError")
        return topic
    topic = get_topic(tid)
    if topic is None:
        raise RuntimeError(f"Failed to retrieve newly created topic with id '{tid}'")
    return topic


def get_topic(topic_id: str) -> dict | None:
    row = get_conn().execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
    return dict(row) if row else None


def get_topic_by_title(title: str) -> dict | None:
    row = get_conn().execute("SELECT * FROM topics WHERE title=?", (title,)).fetchone()
    return dict(row) if row else None


def list_topics(q: str | None = None, limit: int = 50, offset: int = 0) -> list[dict]:
    limit = max(0, min(int(limit), 200))
    offset = max(0, int(offset))
    conn = get_conn()
    if q:
        try:
            cur = conn.execute(
                "SELECT t.* FROM topics t JOIN topics_fts f ON t.id=f.topic_id"
                " WHERE topics_fts MATCH ? ORDER BY t.updated_at DESC LIMIT ? OFFSET ?", (q, limit, offset))
            return _rows(cur)
        except sqlite3.OperationalError:
            like_query = f"%{q}%"
            cur = conn.execute(
                "SELECT id, title, summary, tags, version, exported_version,"
                " created_at, updated_at FROM topics"
                " WHERE title LIKE ? OR summary LIKE ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                (like_query, like_query, limit, offset))
            return _rows(cur)
    else:
        cur = conn.execute(
            "SELECT id, title, summary, tags, version, exported_version,"
            " created_at, updated_at FROM topics ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (limit, offset))
        return _rows(cur)


def topic_candidates(query_text: str, limit: int = 30) -> list[dict]:
    """FTS5 预筛候选主题(主题多时用);查询词取正文的非标点词。"""
    words = [w for w in "".join(
        c if c.isalnum() else " " for c in query_text).split() if len(w) > 1]
    if not words:
        return []
    match = " OR ".join(f'"{w}"' for w in words[:20])
    try:
        cur = get_conn().execute(
            "SELECT t.* FROM topics t JOIN topics_fts f ON t.id=f.topic_id"
            " WHERE topics_fts MATCH ? LIMIT ?", (match, limit))
        return _rows(cur)
    except sqlite3.OperationalError:
        return []


def update_topic(topic_id: str, capture_id: str | None, *, title: str,
                 summary: str, body_md: str, tags: list[str]) -> dict:
    """快照旧版本后写入新内容,version+1,同步 FTS。"""
    conn = get_conn()
    old = get_topic(topic_id)
    if old is None:
        raise ValueError(f"Topic with id '{topic_id}' not found")
    ts = now()
    with conn:
        conn.execute(
            "INSERT INTO topic_versions (topic_id, version, body_md, capture_id, created_at)"
            " VALUES (?,?,?,?,?)",
            (topic_id, old["version"], old["body_md"], capture_id, ts))
        conn.execute(
            "UPDATE topics SET title=?, summary=?, body_md=?, tags=?, version=version+1,"
            " updated_at=? WHERE id=?",
            (title, summary, body_md, json.dumps(tags, ensure_ascii=False), ts, topic_id))
        conn.execute("DELETE FROM topics_fts WHERE topic_id=?", (topic_id,))
        conn.execute(
            "INSERT INTO topics_fts (topic_id, title, summary, tags) VALUES (?,?,?,?)",
            (topic_id, title, summary, json.dumps(tags, ensure_ascii=False)))
    return get_topic(topic_id)


def list_topic_versions(topic_id: str) -> list[dict]:
    cur = get_conn().execute(
        "SELECT * FROM topic_versions WHERE topic_id=? ORDER BY version DESC",
        (topic_id,))
    return _rows(cur)


def get_topic_version(topic_id: str, version: int) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM topic_versions WHERE topic_id=? AND version=?",
        (topic_id, version)).fetchone()
    return dict(row) if row else None




def all_tags() -> list[str]:
    tags: set[str] = set()
    for row in get_conn().execute("SELECT tags FROM topics"):
        tags.update(json.loads(row["tags"]))
    return sorted(tags)


def delete_topic(topic_id: str) -> None:
    conn = get_conn()
    # 1. 查找所有关联的 captures，准备清理磁盘媒体文件
    cur = conn.execute("SELECT id, media_path FROM captures WHERE topic_id=?", (topic_id,))
    rows = cur.fetchall()
    capture_ids = [r["id"] for r in rows]
    
    with conn:
        # 1.5 删除 processing_log 记录
        if capture_ids:
            placeholders = ", ".join("?" for _ in capture_ids)
            conn.execute(f"DELETE FROM processing_log WHERE capture_id IN ({placeholders})", capture_ids)

        # 2. 删除 captures 记录
        conn.execute("DELETE FROM captures WHERE topic_id=?", (topic_id,))
        
        # 3. 删除 topic_versions 快照记录
        conn.execute("DELETE FROM topic_versions WHERE topic_id=?", (topic_id,))
        
        # 4. 从 FTS5 虚拟表中删除索引
        conn.execute("DELETE FROM topics_fts WHERE topic_id=?", (topic_id,))
        
        # 5. 删除 topic 本身
        conn.execute("DELETE FROM topics WHERE id=?", (topic_id,))
    
    # 6. 在事务成功提交后，物理删除磁盘媒体文件，防止遗留孤儿文件
    for row in rows:
        if row["media_path"]:
            try:
                (config.DATA_DIR / row["media_path"]).unlink(missing_ok=True)
            except Exception:
                pass


# ---------- processing log ----------

def log(capture_id: str, stage: str, status: str, detail: str | None = None) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO processing_log (capture_id, stage, status, detail, created_at)"
        " VALUES (?,?,?,?,?)", (capture_id, stage, status, detail, now()))
    conn.commit()


def logs_for(capture_id: str) -> list[dict]:
    cur = get_conn().execute(
        "SELECT * FROM processing_log WHERE capture_id=? ORDER BY id", (capture_id,))
    return _rows(cur)


# ---------- settings ----------

def get_setting(key: str, default: str = "") -> str | None:
    try:
        row = get_conn().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else default
    except sqlite3.OperationalError:
        return default


def set_setting(key: str, value: str) -> None:
    conn = get_conn()
    with conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))


# ---------- sessions ----------

def create_session(token: str, expires_at: float) -> None:
    conn = get_conn()
    import time
    with conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        conn.execute("INSERT INTO sessions (token, expires_at) VALUES (?, ?)", (token, expires_at))


def verify_session(token: str) -> bool:
    try:
        import time
        row = get_conn().execute(
            "SELECT expires_at FROM sessions WHERE token=?", (token,)).fetchone()
        if row:
            if row[0] > time.time():
                return True
            else:
                delete_session(token)
    except sqlite3.OperationalError:
        pass
    return False


def delete_session(token: str) -> None:
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))


# ---------- sub-card captures CRUD ----------

def list_captures_by_topic(topic_id: str) -> list[dict]:
    cur = get_conn().execute(
        "SELECT * FROM captures WHERE topic_id=? ORDER BY created_at ASC", (topic_id,)
    )
    return _rows(cur)


def update_topic_summary(topic_id: str, summary: str) -> None:
    conn = get_conn()
    ts = now()
    with conn:
        conn.execute(
            "UPDATE topics SET summary=?, updated_at=? WHERE id=?",
            (summary, ts, topic_id)
        )


def cleanup_topic_after_capture_move(topic_id: str) -> bool:
    """某 capture 改派离开该主题后,对旧主题做原子清理:
    - 主题已无任何 capture → 删除主题(连带版本),返回 True(已删);
    - 仍有 capture → 用最后一条的 clean_text 重算摘要,返回 False。
    主题正文(body_md)在当前数据模型下为空、靠 captures 表关联渲染,无需也不在此裁剪。
    """
    conn = get_conn()
    remaining = _rows(conn.execute(
        "SELECT id, clean_text FROM captures WHERE topic_id=? ORDER BY created_at ASC",
        (topic_id,)))
    if not remaining:
        with conn:
            conn.execute("DELETE FROM processing_log WHERE capture_id IN "
                         "(SELECT id FROM captures WHERE topic_id=?)", (topic_id,))
            conn.execute("DELETE FROM captures WHERE topic_id=?", (topic_id,))
            conn.execute("DELETE FROM topic_versions WHERE topic_id=?", (topic_id,))
            conn.execute("DELETE FROM topics_fts WHERE topic_id=?", (topic_id,))
            conn.execute("DELETE FROM topics WHERE id=?", (topic_id,))
        return True
    new_summary = (remaining[-1]["clean_text"] or "")[:100]
    ts = now()
    with conn:
        conn.execute("UPDATE topics SET summary=?, updated_at=? WHERE id=?",
                     (new_summary, ts, topic_id))
    return False


def update_capture_content(capture_id: str, *, clean_text: str, raw_text: str | None = None,
                           transcript: str | None = None, media_path: str | None = None,
                           title: str | None = None) -> dict:
    conn = get_conn()
    old = get_capture(capture_id)
    if old is None:
        raise ValueError(f"Capture with id '{capture_id}' not found")
    ts = now()
    with conn:
        # Snapshot the old version
        conn.execute(
            "INSERT INTO capture_versions (capture_id, version, clean_text, raw_text, transcript, media_path, title, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (capture_id, old.get("version", 0), old.get("clean_text") or "", old.get("raw_text"), old.get("transcript"), old.get("media_path"), old.get("title"), ts)
        )
        # Update current capture
        conn.execute(
            "UPDATE captures SET clean_text=?, raw_text=?, transcript=?, media_path=?, title=?, version=version+1"
            " WHERE id=?",
            (clean_text, raw_text, transcript, media_path, title if title is not None else old.get("title"), capture_id)
        )
    return get_capture(capture_id)


def list_capture_versions(capture_id: str) -> list[dict]:
    cur = get_conn().execute(
        "SELECT * FROM capture_versions WHERE capture_id=? ORDER BY version DESC",
        (capture_id,)
    )
    return _rows(cur)


def rollback_capture(capture_id: str, version: int) -> dict:
    conn = get_conn()
    old = get_capture(capture_id)
    if old is None:
        raise ValueError(f"Capture with id '{capture_id}' not found")
        
    row = conn.execute(
        "SELECT * FROM capture_versions WHERE capture_id=? AND version=?",
        (capture_id, version)
    ).fetchone()
    if not row:
        raise ValueError(f"Capture version {version} not found")
    snap = dict(row)
    
    ts = now()
    with conn:
        conn.execute(
            "INSERT INTO capture_versions (capture_id, version, clean_text, raw_text, transcript, media_path, title, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (capture_id, old.get("version", 0), old.get("clean_text") or "", old.get("raw_text"), old.get("transcript"), old.get("media_path"), old.get("title"), ts)
        )
        conn.execute(
            "UPDATE captures SET clean_text=?, raw_text=?, transcript=?, media_path=?, title=?, version=version+1"
            " WHERE id=?",
            (snap["clean_text"], snap["raw_text"], snap["transcript"], snap["media_path"], snap["title"], capture_id)
        )

    # M10: 回滚后若快照的 media_path 指向已被物理删除的文件,置空避免下游
    # _image_block/transcribe 触发 FileNotFoundError。文本类无 media_path 不受影响。
    new_media = snap["media_path"]
    if new_media and not (config.DATA_DIR / new_media).is_file():
        conn.execute("UPDATE captures SET media_path=NULL WHERE id=?", (capture_id,))
        conn.commit()
    return get_capture(capture_id)
