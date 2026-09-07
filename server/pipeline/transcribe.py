"""Whisper 本地/云端 API 转写。支持云端 API 或是本地 mlx-whisper、faster-whisper、openai-whisper。"""
import asyncio
import os
import subprocess
from .. import config

WHISPER_MODEL = "turbo"  # 默认本地模型名，对应 large-v3-turbo

_lock = asyncio.Lock()
_faster_whisper_model = None
_openai_whisper_model = None


def _ensure_mp3_format(audio_path: str) -> str:
    """使用 ffmpeg 将输入音频转换为兼容且体积更小的 mp3 格式（适合 STT 端点）。"""
    ext = os.path.splitext(audio_path)[1].lower()
    if ext == ".mp3":
        return audio_path

    output_path = os.path.splitext(audio_path)[0] + "_transcribe.mp3"
    if os.path.exists(output_path):
        return output_path

    try:
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
        return audio_path


def _ensure_wav_format(audio_path: str) -> str:
    """使用 ffmpeg 将输入音频转换为通用的 16kHz 单声道 16-bit PCM WAV 格式（适合多模态 Chat 模型）。"""
    ext = os.path.splitext(audio_path)[1].lower()
    if ext == ".wav":
        return audio_path

    output_path = os.path.splitext(audio_path)[0] + "_transcribe.wav"
    if os.path.exists(output_path):
        return output_path

    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", audio_path,
                "-ar", "16000",
                "-ac", "1",
                "-c:a", "pcm_s16le",
                output_path
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True
        )
        return output_path
    except Exception:
        return audio_path


async def _transcribe_via_api(audio_path: str) -> str:
    import httpx
    import base64

    # 1. 解析自定义 Headers 与专属认证
    custom_headers_raw = getattr(config, "AUDIO_HEADERS", "")
    headers = config.resolve_headers(
        custom_headers_raw,
        base_url=config.AUDIO_BASE_URL,
        provider=config.AUDIO_PROVIDER_NAME
    )
    headers["Authorization"] = f"Bearer {config.AUDIO_API_KEY}"

    # 2. 检查是否为专属语音识别 (STT) 专用模型 (如 Whisper, SenseVoice, FunASR)
    # 这类模型必须使用 /v1/audio/transcriptions 接口；其他多模态对话模型则走 /v1/chat/completions
    model_lower = config.AUDIO_MODEL.lower()
    is_stt_model = any(k in model_lower for k in ["whisper", "sensevoice", "funasr"])

    if not is_stt_model:
        # 多模态对话接口 (/chat/completions)
        # 转码为通用 16kHz PCM WAV 格式
        target_path = await asyncio.to_thread(_ensure_wav_format, audio_path)

        url = f"{config.AUDIO_BASE_URL.rstrip('/')}/chat/completions"
        chat_headers = dict(headers)
        chat_headers["Content-Type"] = "application/json"

        with open(target_path, "rb") as f:
            audio_base64 = base64.b64encode(f.read()).decode("utf-8")

        prompt_text = "请将这段音频精准逐字转写为文字，只输出转写内容，不要包含任何多余的解释、翻译、前言后语或时间戳。"

        # 优先采用 OpenAI 多模态音频 input_audio 规范
        payload_input_audio = {
            "model": config.AUDIO_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {"type": "input_audio", "input_audio": {"data": audio_base64, "format": "wav"}}
                    ]
                }
            ],
            "max_tokens": 4096
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=chat_headers, json=payload_input_audio, timeout=180.0)
            if resp.status_code == 400 and ("input_audio" in resp.text or "format" in resp.text):
                # 上游若仅支持旧版 audio_url 规范，自动降级重试
                payload_audio_url = {
                    "model": config.AUDIO_MODEL,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "audio_url", "audio_url": {"url": f"data:audio/wav;base64,{audio_base64}"}},
                                {"type": "text", "text": prompt_text}
                            ]
                        }
                    ],
                    "max_tokens": 4096
                }
                resp = await client.post(url, headers=chat_headers, json=payload_audio_url, timeout=180.0)

            resp.raise_for_status()
            result = resp.json()
            choice = result.get("choices", [{}])[0]
            msg = choice.get("message", {})
            content = (msg.get("content") or "").strip()
            if not content:
                # 思考模型（如 mimo-v2.5 等）输出可能位于 reasoning_content 中
                content = (msg.get("reasoning_content") or "").strip()
            return content

    else:
        # 走标准的 /v1/audio/transcriptions 接口
        target_path = await asyncio.to_thread(_ensure_mp3_format, audio_path)
        filename = os.path.basename(target_path)
        url = f"{config.AUDIO_BASE_URL.rstrip('/')}/audio/transcriptions"
        mime_type = "audio/mpeg"

        with open(target_path, "rb") as f:
            files = {
                "file": (filename, f, mime_type)
            }
            data = {
                "model": config.AUDIO_MODEL
            }
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, files=files, data=data, timeout=300.0)
                response.raise_for_status()
                result = response.json()
                return result["text"].strip()


def _transcribe_sync(audio_path: str) -> str:
    # 1. 尝试导入 mlx_whisper (仅 macOS Apple Silicon)
    try:
        import mlx_whisper
        model_name = "mlx-community/whisper-large-v3-turbo"
        result = mlx_whisper.transcribe(audio_path, path_or_hf_repo=model_name)
        return result["text"].strip()
    except ImportError:
        pass

    # 2. 尝试导入 faster_whisper
    try:
        from faster_whisper import WhisperModel
        global _faster_whisper_model
        if _faster_whisper_model is None:
            _faster_whisper_model = WhisperModel(WHISPER_MODEL, device="auto", compute_type="default")
        segments, info = _faster_whisper_model.transcribe(audio_path, beam_size=5)
        return "".join(segment.text for segment in segments).strip()
    except ImportError:
        pass

    # 3. 尝试导入 openai-whisper 作为最后的备用
    try:
        import whisper
        global _openai_whisper_model
        if _openai_whisper_model is None:
            _openai_whisper_model = whisper.load_model(WHISPER_MODEL)
        result = _openai_whisper_model.transcribe(audio_path)
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
    temp_wav = os.path.splitext(path)[0] + "_transcribe.wav"

    try:
        if config.AUDIO_API_KEY:
            return await _transcribe_via_api(path)

        async with _lock:  # 本地模型非线程安全, 串行执行
            return await asyncio.to_thread(_transcribe_sync, path)
    finally:
        for p in (temp_mp3, temp_wav):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
