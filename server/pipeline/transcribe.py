"""Whisper 本地/云端 API 转写。支持云端 API 或是本地 mlx-whisper、faster-whisper、openai-whisper。"""
import asyncio
import os
import subprocess
from .. import config

WHISPER_MODEL = "turbo"  # 默认本地模型名，对应 large-v3-turbo

_lock = asyncio.Lock()
_model_instance = None


def _ensure_mp3_format(audio_path: str) -> str:
    """使用 ffmpeg 将输入音频转换为兼容且体积更小的 mp3 格式。"""
    ext = os.path.splitext(audio_path)[1].lower()
    if ext == ".mp3":
        return audio_path

    output_path = os.path.splitext(audio_path)[0] + "_transcribe.mp3"
    if os.path.exists(output_path):
        return output_path

    try:
        # 将任意格式音频转为 16kHz, 单声道, 64k 码率的 mp3，体积小且保留完整语音信息
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", audio_path,
                "-acodec", "libmp3lame",
                "-ar", "16000",
                "-ac", "1",
                "-ab", "64k",
                output_path
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True
        )
        return output_path
    except Exception:
        # 如果转换失败，退回到原始路径
        return audio_path


async def _transcribe_via_api(audio_path: str) -> str:
    import httpx
    import base64

    # 1. 强力转码压缩音频为标准的 mp3 格式
    target_path = await asyncio.to_thread(_ensure_mp3_format, audio_path)
    ext = "mp3"

    # 检查是否为专属语音识别 (STT) 专用模型 (如 Whisper, SenseVoice, FunASR)
    # 这类模型必须使用 /v1/audio/transcriptions 接口；其他多模态对话模型则走 /v1/chat/completions
    model_lower = config.TRANSCRIPTION_MODEL.lower()
    is_stt_model = any(k in model_lower for k in ["whisper", "sensevoice", "funasr"])

    filename = os.path.basename(target_path)

    if not is_stt_model:
        # 走 /v1/chat/completions 接口
        url = f"{config.TRANSCRIPTION_BASE_URL.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {config.TRANSCRIPTION_API_KEY}",
            "Content-Type": "application/json"
        }

        # 读取音频并转为 base64
        with open(target_path, "rb") as f:
            audio_base64 = base64.b64encode(f.read()).decode("utf-8")

        payload = {
            "model": config.TRANSCRIPTION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "audio_url",
                            "audio_url": {
                                "url": f"data:audio/{ext};base64,{audio_base64}"
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
            response = await client.post(url, headers=headers, json=payload, timeout=300.0)
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

        with open(target_path, "rb") as f:
            files = {
                "file": (filename, f, mime_type)
            }
            data = {
                "model": config.TRANSCRIPTION_MODEL
            }
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, files=files, data=data, timeout=300.0)
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
    temp_mp3 = os.path.splitext(path)[0] + "_transcribe.mp3"

    try:
        # 如果配置了云端转写 API，优先使用 API，支持并发，不需要获取本地模型锁
        if config.TRANSCRIPTION_API_KEY:
            return await _transcribe_via_api(path)

        async with _lock:  # 本地模型非线程安全, 串行执行
            return await asyncio.to_thread(_transcribe_sync, path)
    finally:
        if os.path.exists(temp_mp3):
            try:
                os.remove(temp_mp3)
            except Exception:
                pass

