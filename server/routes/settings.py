import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db

router = APIRouter(prefix="/api/settings", tags=["settings"])

class SettingsUpdate(BaseModel):
    TEXT_PROVIDER_NAME: str
    TEXT_API_KEY: str
    TEXT_BASE_URL: str
    TEXT_MODEL: str

    IMAGE_PROVIDER_NAME: str
    IMAGE_API_KEY: str
    IMAGE_BASE_URL: str
    IMAGE_MODEL: str

    AUDIO_PROVIDER_NAME: str
    AUDIO_API_KEY: str
    AUDIO_BASE_URL: str
    AUDIO_MODEL: str

    MERGE_PROVIDER_NAME: str
    MERGE_API_KEY: str
    MERGE_BASE_URL: str
    MERGE_MODEL: str

    AUTO_MERGE_EXISTING_CONFIDENCE: str = "medium"
    AUTO_MERGE_NEW_CONFIDENCE: str = "high"

class TestRequest(BaseModel):
    task: str  # text, image, audio, merge
    provider: str
    api_key: str
    base_url: str
    model: str

async def test_api_config(task: str, provider: str, api_key: str, base_url: str, model: str) -> str:
    if not api_key:
        return "API Key 不能为空"
    try:
        import httpx
        from ..pipeline.llm import get_client
        
        provider_name = provider.lower()
        url_lower = (base_url or "").lower()
        if "anthropic" in provider_name or "anthropic" in url_lower:
            client_type = "anthropic"
        else:
            client_type = "openai"

        # Resolve keys and urls locally
        client = get_client(provider, api_key=api_key, base_url=base_url)

        if task in ("text", "image", "merge"):
            def run_chat():
                if client_type == "openai":
                    return client.chat.completions.create(
                        model=model,
                        messages=[{"role": "user", "content": "ping"}],
                        max_tokens=5,
                        timeout=10.0
                    )
                else:
                    return client.messages.create(
                        model=model,
                        messages=[{"role": "user", "content": "ping"}],
                        max_tokens=5,
                        timeout=10.0
                    )
            await asyncio.to_thread(run_chat)
        elif task == "audio":
            import tempfile
            import os
            
            # Construct a 100% valid 1-second silence WAV file (8000Hz, 8-bit, Mono PCM)
            sample_rate = 8000
            data_size = 8000
            file_size = 44 + data_size
            
            header = bytearray(44)
            header[0:4] = b'RIFF'
            header[4:8] = (file_size - 8).to_bytes(4, 'little')
            header[8:12] = b'WAVE'
            header[12:16] = b'fmt '
            header[16:20] = (16).to_bytes(4, 'little')
            header[20:22] = (1).to_bytes(2, 'little')  # PCM
            header[22:24] = (1).to_bytes(2, 'little')  # Mono
            header[24:28] = sample_rate.to_bytes(4, 'little')
            header[28:32] = sample_rate.to_bytes(4, 'little')  # Byte rate
            header[32:34] = (1).to_bytes(2, 'little')  # Block align
            header[34:36] = (8).to_bytes(2, 'little')  # Bits per sample
            header[36:40] = b'data'
            header[40:44] = data_size.to_bytes(4, 'little')
            
            # 8-bit PCM silence level is 128 (0x80)
            DUMMY_WAV = bytes(header) + bytes([128] * data_size)
            
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(DUMMY_WAV)
                tmp_path = tmp.name

            try:
                model_lower = model.lower()
                is_stt = any(k in model_lower for k in ["whisper", "sensevoice", "funasr"])

                def run_audio():
                    if is_stt:
                        url = f"{base_url.rstrip('/')}/audio/transcriptions"
                        headers = {"Authorization": f"Bearer {api_key}"}
                        with open(tmp_path, "rb") as f:
                            files = {"file": ("test.wav", f.read(), "audio/wav")}
                        res = httpx.post(url, headers=headers, files=files, data={"model": model}, timeout=15.0)
                        res.raise_for_status()
                    else:
                        url = f"{base_url.rstrip('/')}/chat/completions"
                        import base64
                        audio_base64 = base64.b64encode(DUMMY_WAV).decode("utf-8")
                        payload = {
                            "model": model,
                            "messages": [{
                                "role": "user",
                                "content": [
                                    {"type": "audio_url", "audio_url": {"url": f"data:audio/wav;base64,{audio_base64}"}},
                                    {"type": "text", "text": "transcribe"}
                                ]
                            }]
                        }
                        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                        res = httpx.post(url, headers=headers, json=payload, timeout=15.0)
                        res.raise_for_status()

                await asyncio.to_thread(run_audio)
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

        return ""
    except Exception as e:
        return str(e)

def resolve_key(incoming: str, key_name: str) -> str:
    if incoming == "••••••••":
        from .. import config
        return getattr(config, key_name, "")
    return incoming

@router.get("")
def get_settings():
    from .. import config
    keys = [
        "TEXT_PROVIDER_NAME", "TEXT_API_KEY", "TEXT_BASE_URL", "TEXT_MODEL",
        "IMAGE_PROVIDER_NAME", "IMAGE_API_KEY", "IMAGE_BASE_URL", "IMAGE_MODEL",
        "AUDIO_PROVIDER_NAME", "AUDIO_API_KEY", "AUDIO_BASE_URL", "AUDIO_MODEL",
        "MERGE_PROVIDER_NAME", "MERGE_API_KEY", "MERGE_BASE_URL", "MERGE_MODEL",
        "AUTO_MERGE_EXISTING_CONFIDENCE", "AUTO_MERGE_NEW_CONFIDENCE",
    ]
    result = {}
    for k in keys:
        val = getattr(config, k, "")
        if "API_KEY" in k and val:
            result[k] = "••••••••"
        else:
            result[k] = val
    return result

@router.post("")
async def save_settings(payload: SettingsUpdate):
    # Save to SQLite
    data = payload.model_dump()
    for k, v in data.items():
        if "API_KEY" in k:
            db.set_setting(k, resolve_key(v, k))
        else:
            db.set_setting(k, v)

    return {"ok": True}

@router.post("/test")
async def test_endpoint(payload: TestRequest):
    resolved_key = resolve_key(payload.api_key, f"{payload.task.upper()}_API_KEY")
    err = await test_api_config(payload.task, payload.provider, resolved_key, payload.base_url, payload.model)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True}
