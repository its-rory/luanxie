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

# 置信度阈值:达到该级别及以上的分类结果自动合并,低于则进 awaiting_review。
# 可选 high / medium / low;设为 low 即全自动。
AUTO_MERGE_CONFIDENCE = os.getenv("AUTO_MERGE_CONFIDENCE", "high")
if AUTO_MERGE_CONFIDENCE not in ("high", "medium", "low"):
    AUTO_MERGE_CONFIDENCE = "high"

# 主题数少于该值时全量清单进 prompt,否则用 FTS5 预筛
TOPIC_LIST_FULL_LIMIT = 150

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8787"))

# 静态默认配置
_STATIC_DEFAULTS = {
    "ADMIN_PASSWORD": "admin",
    "LLM_PROVIDER": "",
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_BASE_URL": "",
    "OPENAI_API_KEY": "",
    "OPENAI_BASE_URL": "",
    
    "TEXT_PROVIDER_NAME": "",
    "TEXT_API_KEY": "",
    "TEXT_BASE_URL": "",
    "TEXT_MODEL": "claude-haiku-4-5",
    
    "IMAGE_PROVIDER_NAME": "",
    "IMAGE_API_KEY": "",
    "IMAGE_BASE_URL": "",
    "IMAGE_MODEL": "",
    
    "AUDIO_PROVIDER_NAME": "",
    "AUDIO_API_KEY": "",
    "AUDIO_BASE_URL": "https://api.openai.com/v1",
    "AUDIO_MODEL": "whisper-1",
    
    "MERGE_PROVIDER_NAME": "",
    "MERGE_API_KEY": "",
    "MERGE_BASE_URL": "",
    "MERGE_MODEL": "claude-opus-4-8",
}

# 废弃的或兼容字段映射
_FALLBACK_MAPS = {
    "CLASSIFY_MODEL": "TEXT_MODEL",
    "CLASSIFY_API_KEY": "TEXT_API_KEY",
    "CLASSIFY_BASE_URL": "TEXT_BASE_URL",
    
    "VISION_MODEL": "IMAGE_MODEL",
    "VISION_API_KEY": "IMAGE_API_KEY",
    "VISION_BASE_URL": "IMAGE_BASE_URL",
    
    "TRANSCRIPTION_API_KEY": "AUDIO_API_KEY",
    "TRANSCRIPTION_BASE_URL": "AUDIO_BASE_URL",
    "TRANSCRIPTION_MODEL": "AUDIO_MODEL",
}

_last_env_mtime = 0

def reload_env_if_needed():
    global _last_env_mtime
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        try:
            mtime = env_path.stat().st_mtime
            if mtime != _last_env_mtime:
                load_dotenv(env_path, override=True)
                _last_env_mtime = mtime
        except Exception:
            pass

def __getattr__(name: str):
    reload_env_if_needed()
    target_name = _FALLBACK_MAPS.get(name, name)

    # 1. 尝试从数据库加载设置
    try:
        from . import db
        db_val = db.get_setting(target_name)
        if db_val is not None and db_val != "":
            return db_val
    except Exception:
        pass

    # 2. 尝试从环境变量加载设置
    env_val = os.getenv(target_name)
    if env_val is not None and env_val != "":
        return env_val

    # 3. 针对特定的 Audio / Text / Image 退避到原版的 .env 变量进行兜底
    if target_name == "AUDIO_API_KEY":
        v = os.getenv("TRANSCRIPTION_API_KEY")
        if v: return v
    elif target_name == "AUDIO_BASE_URL":
        v = os.getenv("TRANSCRIPTION_BASE_URL")
        if v: return v
    elif target_name == "AUDIO_MODEL":
        v = os.getenv("TRANSCRIPTION_MODEL")
        if v: return v
    elif target_name == "TEXT_MODEL":
        v = os.getenv("CLASSIFY_MODEL")
        if v: return v
    elif target_name == "IMAGE_MODEL":
        v = os.getenv("VISION_MODEL")
        if v: return v

    # 4. 退避到全局 OpenAI/Anthropic 配置
    if "API_KEY" in target_name:
        global_openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
        if global_openai_key: return global_openai_key
    elif "BASE_URL" in target_name:
        global_openai_url = os.getenv("OPENAI_BASE_URL") or os.getenv("ANTHROPIC_BASE_URL")
        if global_openai_url: return global_openai_url

    # 5. 返回静态默认值
    return _STATIC_DEFAULTS.get(target_name, "")

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
