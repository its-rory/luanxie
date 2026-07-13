"""集中配置:环境变量、路径、模型名。"""
import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

DATA_DIR = PROJECT_ROOT / "data"
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = DATA_DIR / "luanxie.db"
WEB_DIST = PROJECT_ROOT / "web" / "dist"

# LLM 接口服务配置 (支持 Anthropic 和 OpenAI 双协议)
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "").lower()  # anthropic 或 openai
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "")

# 语音转文字 API 配置 (如使用云端转写)
TRANSCRIPTION_API_KEY = os.getenv("TRANSCRIPTION_API_KEY", "")
TRANSCRIPTION_BASE_URL = os.getenv("TRANSCRIPTION_BASE_URL", "https://api.openai.com/v1")
TRANSCRIPTION_MODEL = os.getenv("TRANSCRIPTION_MODEL", "whisper-1")

# =====================================================================
# 1. 文字分类 (Text) 配置
# =====================================================================
TEXT_PROVIDER_NAME = os.getenv("TEXT_PROVIDER_NAME", "")
TEXT_API_KEY = os.getenv("TEXT_API_KEY", "") or os.getenv("CLASSIFY_API_KEY", "") or os.getenv("OPENAI_API_KEY", "") or os.getenv("ANTHROPIC_API_KEY", "")
TEXT_BASE_URL = os.getenv("TEXT_BASE_URL", "") or os.getenv("CLASSIFY_BASE_URL", "") or os.getenv("OPENAI_BASE_URL", "") or os.getenv("ANTHROPIC_BASE_URL", "")
TEXT_MODEL = os.getenv("TEXT_MODEL", "") or os.getenv("CLASSIFY_MODEL", "claude-haiku-4-5")

# =====================================================================
# 2. 图像分类 (Image) 配置
# =====================================================================
IMAGE_PROVIDER_NAME = os.getenv("IMAGE_PROVIDER_NAME", "")
IMAGE_API_KEY = os.getenv("IMAGE_API_KEY", "") or os.getenv("VISION_API_KEY", "") or os.getenv("OPENAI_API_KEY", "") or os.getenv("ANTHROPIC_API_KEY", "")
IMAGE_BASE_URL = os.getenv("IMAGE_BASE_URL", "") or os.getenv("VISION_BASE_URL", "") or os.getenv("OPENAI_BASE_URL", "") or os.getenv("ANTHROPIC_BASE_URL", "")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "") or os.getenv("VISION_MODEL", "")

# =====================================================================
# 3. 语音转文字 (Audio) 配置
# =====================================================================
AUDIO_PROVIDER_NAME = os.getenv("AUDIO_PROVIDER_NAME", "")
AUDIO_API_KEY = os.getenv("AUDIO_API_KEY", "") or os.getenv("TRANSCRIPTION_API_KEY", "")
AUDIO_BASE_URL = os.getenv("AUDIO_BASE_URL", "") or os.getenv("TRANSCRIPTION_BASE_URL", "https://api.openai.com/v1")
AUDIO_MODEL = os.getenv("AUDIO_MODEL", "") or os.getenv("TRANSCRIPTION_MODEL", "whisper-1")

# =====================================================================
# 4. 笔记合并 (Merge) 配置
# =====================================================================
MERGE_PROVIDER_NAME = os.getenv("MERGE_PROVIDER_NAME", "")
MERGE_API_KEY = os.getenv("MERGE_API_KEY", "") or os.getenv("OPENAI_API_KEY", "") or os.getenv("ANTHROPIC_API_KEY", "")
MERGE_BASE_URL = os.getenv("MERGE_BASE_URL", "") or os.getenv("OPENAI_BASE_URL", "") or os.getenv("ANTHROPIC_BASE_URL", "")
MERGE_MODEL = os.getenv("MERGE_MODEL", "") or os.getenv("MERGE_MODEL", "claude-opus-4-8")

# 置信度阈值:达到该级别及以上的分类结果自动合并,低于则进 awaiting_review。
# 可选 high / medium / low;设为 low 即全自动。
AUTO_MERGE_CONFIDENCE = os.getenv("AUTO_MERGE_CONFIDENCE", "high")
if AUTO_MERGE_CONFIDENCE not in ("high", "medium", "low"):
    AUTO_MERGE_CONFIDENCE = "high"

VAULT_EXPORT_DIR = Path(
    os.getenv(
        "VAULT_EXPORT_DIR",
        str(PROJECT_ROOT / "data" / "export"),
    )
)

# 定期导出间隔(分钟);0 = 关闭,仅手动导出
EXPORT_INTERVAL_MINUTES = int(os.getenv("EXPORT_INTERVAL_MINUTES", "0"))

# 主题数少于该值时全量清单进 prompt,否则用 FTS5 预筛
TOPIC_LIST_FULL_LIMIT = 150

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8787"))

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
