"""导出主题笔记到 Obsidian vault(单向、增量、原子写)。"""
import json
import os
import re
from datetime import date

from . import config, db

_SANITIZE = re.compile(r'[/\\:*?"<>|#^\[\]]')


def _filename(title: str) -> str:
    name = _SANITIZE.sub("", title).strip() or "未命名"
    return f"{name[:80]}.md"


def _render(topic: dict) -> str:
    tags = json.loads(topic["tags"])
    tag_lines = "".join(f"\n  - {t}" for t in tags) if tags else " []"
    return (
        "---\n"
        f"luanxie_id: {topic['id']}\n"
        f"tags:{tag_lines}\n"
        f"updated: {date.today().isoformat()}\n"
        "---\n\n"
        f"# {topic['title']}\n\n"
        f"{topic['body_md'].strip()}\n"
    )


import threading

_export_lock = threading.Lock()


def export_all() -> list[dict]:
    """导出所有 version > exported_version 的主题,返回导出清单。"""
    with _export_lock:
        config.VAULT_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        results = []
        for topic in db.topics_to_export():
            filename = _filename(topic["title"])
            # 标题变更:删除旧文件,避免 vault 里残留双份
            old = topic["export_filename"]
            if old and old != filename:
                (config.VAULT_EXPORT_DIR / old).unlink(missing_ok=True)
            dest = config.VAULT_EXPORT_DIR / filename
            tmp = dest.with_suffix(".md.tmp")
            tmp.write_text(_render(topic), encoding="utf-8")
            os.replace(tmp, dest)  # 原子替换,iCloud 不会同步到半截文件
            db.mark_exported(topic["id"], topic["version"], filename)
            results.append({"topic_id": topic["id"], "title": topic["title"],
                            "file": filename, "version": topic["version"]})
        return results
