"""手动触发导出到 Obsidian。"""
from fastapi import APIRouter

from .. import exporter

router = APIRouter(prefix="/api/export", tags=["export"])


import asyncio


@router.post("")
async def export_now():
    exported = await asyncio.to_thread(exporter.export_all)
    return {"exported": exported, "count": len(exported)}
