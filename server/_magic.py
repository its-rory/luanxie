"""上传文件 MIME 嗅探:基于文件头魔数,不依赖外部库。

仅覆盖项目 ALLOWED_MEDIA 范围内的图片/音频常见格式,
避免单纯信任上传扩展名被绕过。判定三类:audio/image/unknown。
信任策略:无法识别 → unknown,宽容不阻断;仅当签名明确指向另一类时拒绝跨类伪装。
"""
from typing import Tuple


def _classify_head(head: bytes) -> str:
    """audio / image / unknown。"""
    if len(head) < 4:
        return "unknown"
    # EBML(matroska/webm)
    if head.startswith(b"\x1aE\xdf\xa3"):
        return "audio"
    # Ogg
    if head.startswith(b"OggS"):
        return "audio"
    # MP3
    if head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2") or head.startswith(b"ID3"):
        return "audio"
    # RIFF: WAVE→audio, WEBP→image, 其它→unknown
    if head.startswith(b"RIFF") and len(head) >= 12:
        fourcc = head[8:12]
        if fourcc == b"WAVE":
            return "audio"
        if fourcc == b"WEBP":
            return "image"
        return "unknown"
    # ISO BMFF(m4a/mp4/heic): 偏移 4..8 = 'ftyp'
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        audio_brands = {b"M4A ", b"M4V ", b"mp41", b"mp42", b"isom", b"iso2", b"iso3", b"iso4", b"iso5", b"iso6", b"dash", b"avc1"}
        image_brands = {b"heic", b"heix", b"hevc", b"hevx", b"mif1"}
        if brand in audio_brands:
            return "audio"
        if brand in image_brands:
            return "image"
    # 常见图片容器
    if head.startswith(b"\xff\xd8\xff"):
        return "image"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image"
    if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"):
        return "image"
    return "unknown"


def sniff_media(buf: bytes, declared_type: str) -> Tuple[bool, str | None]:
    """buf 与声明的类型(音频/图片)是否在头部签名上自洽。

    返回 (ok, detected_category)。
    - 签名明确属于另一类 → False(拒绝跨类伪装)
    - 无法识别(unknown)→ True(宽容放行)
    - 与声明一致 → True
    """
    detected = _classify_head((buf or b"")[:16])
    if detected == "unknown":
        return True, None
    if detected != declared_type:
        return False, detected
    return True, detected