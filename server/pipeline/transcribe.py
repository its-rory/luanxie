"""Whisper 本地/云端 API 转写。支持云端 API 或是本地 mlx-whisper、faster-whisper、openai-whisper。"""
import asyncio
import os
from .. import config

WHISPER_MODEL = "turbo"  # 默认本地模型名，对应 large-v3-turbo

_lock = asyncio.Lock()
_model_instance = None


async def _transcribe_via_api(audio_path: str) -> str:
    import httpx
    import base64

    # 检查是否为多模态 Chat 语音模型 (如 Qwen-Omni, GPT-4o, Audio 等)
    model_lower = config.TRANSCRIPTION_MODEL.lower()
    is_chat_model = any(k in model_lower for k in ["omni", "audio", "instruct", "chat", "gpt-4o", "gemini"])

    filename = os.path.basename(audio_path)
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    if ext == "wave":
        ext = "wav"

    if is_chat_model:
        # 走 /v1/chat/completions 接口
        url = f"{config.TRANSCRIPTION_BASE_URL.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {config.TRANSCRIPTION_API_KEY}",
            "Content-Type": "application/json"
        }

        # 读取音频并转为 base64
        with open(audio_path, "rb") as f:
            audio_base64 = base64.b64encode(f.read()).decode("utf-8")

        payload = {
            "model": config.TRANSCRIPTION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": audio_base64,
                                "format": ext or "mp3"
                            }
                        },
                        {
                            "type": "text",
                            "text": "Please transcribe this audio strictly word-for-word, only return the transcription text, do not add any explanation, translation, or notes."
                        }
                    ]
                }
            ]
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=payload, timeout=60.0)
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"].strip()

    else:
        # 走标准的 /v1/audio/transcriptions 接口
        url = f"{config.TRANSCRIPTION_BASE_URL.rstrip('/')}/audio/transcriptions"
        headers = {
            "Authorization": f"Bearer {config.TRANSCRIPTION_API_KEY}"
        }

        # 确定 MIME 类型
        mime_type = "audio/mpeg"
        if ext == "wav":
            mime_type = "audio/wav"
        elif ext == "ogg":
            mime_type = "audio/ogg"
        elif ext == "m4a":
            mime_type = "audio/m4a"

        with open(audio_path, "rb") as f:
            files = {
                "file": (filename, f, mime_type)
            }
            data = {
                "model": config.TRANSCRIPTION_MODEL
            }
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, files=files, data=data, timeout=60.0)
                response.raise_for_status()
                result = response.json()
                return result["text"].strip()


def _transcribe_sync(audio_path: str) -> str:
    global _model_instance

    # 1. 尝试导入 mlx_whisper (仅 macOS Apple Silicon)
    try:
        import mlx_whisper
        # mlx-whisper 使用特定的 HF repo 格式
        model_name = "mlx-community/whisper-large-v3-turbo"
        result = mlx_whisper.transcribe(audio_path, path_or_hf_repo=model_name)
        return result["text"].strip()
    except ImportError:
        pass

    # 2. 尝试导入 faster_whisper
    try:
        from faster_whisper import WhisperModel
        if _model_instance is None:
            # device="auto" 自动检测 cuda (GPU) 或 cpu
            # compute_type="default" 根据设备选择最佳计算精度 (如 float16 / int8 / float32)
            _model_instance = WhisperModel(WHISPER_MODEL, device="auto", compute_type="default")
        segments, info = _model_instance.transcribe(audio_path, beam_size=5)
        return "".join(segment.text for segment in segments).strip()
    except ImportError:
        pass

    # 3. 尝试导入 openai-whisper 作为最后的备用
    try:
        import whisper
        if _model_instance is None:
            _model_instance = whisper.load_model(WHISPER_MODEL)
        result = _model_instance.transcribe(audio_path)
        return result["text"].strip()
    except ImportError:
        pass

    raise ImportError(
        "未找到可用的 Whisper 库。请设置 TRANSCRIPTION_API_KEY 使用云端 API，"
        "或本地安装 mlx-whisper (macOS) / faster-whisper/openai-whisper (Linux/Windows)。"
    )


async def transcribe(media_path: str) -> str:
    path = str(config.DATA_DIR / media_path)

    # 如果配置了云端转写 API，优先使用 API，支持并发，不需要获取本地模型锁
    if config.TRANSCRIPTION_API_KEY:
        return await _transcribe_via_api(path)

    async with _lock:  # 本地模型非线程安全, 串行执行
        return await asyncio.to_thread(_transcribe_sync, path)

