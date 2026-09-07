"""统一 LLM 调用层:按 Provider 分流,强制结构化输出。"""
import json
import logging
from typing import TypeVar
from pydantic import BaseModel
from .. import config

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

import threading

_clients = {}
_clients_lock = threading.Lock()

# 已知上游工具调用能力登记(影响首发 tool_choice,避免注定失败的 400 往返)。
_NO_FORCED_TOOL_CHOICE_PROVIDERS = (
    "opencodego",
    "opencode",
    "siliconflow",
)


def _force_forced_tool_choice(provider: str, base_url: str | None) -> bool:
    """是否对首发使用 forced tool_choice。True=forced 硬保证;False=首发 auto。"""
    key = f"{provider} {base_url or ''}".lower()
    return not any(p in key for p in _NO_FORCED_TOOL_CHOICE_PROVIDERS)


def get_client(provider: str, api_key: str | None = None, base_url: str | None = None, extra_headers: dict | None = None):
    provider_lower = provider.lower()
    url_lower = (base_url or "").lower()

    if "anthropic" in provider_lower or "anthropic" in url_lower:
        resolved_type = "anthropic"
    else:
        resolved_type = "openai"

    # 注入与解析路由 Headers
    default_headers = dict(extra_headers or {})
    if "opencode" in url_lower or "opencode" in provider_lower:
        headers_lower = {k.lower() for k in default_headers}
        if "x-opencode-session" not in headers_lower:
            default_headers["x-opencode-session"] = "luanxie-session-affinity-01"
        if "x-opencode-client" not in headers_lower:
            default_headers["x-opencode-client"] = "luanxie"

    headers_cache_key = tuple(sorted(default_headers.items()))

    if resolved_type == "openai":
        resolved_key = api_key or config.OPENAI_API_KEY or None
        resolved_url = base_url or config.OPENAI_BASE_URL or None
        cache_key = ("openai", resolved_key, resolved_url, headers_cache_key)
        with _clients_lock:
            if cache_key not in _clients:
                import openai
                _clients[cache_key] = openai.OpenAI(
                    api_key=resolved_key,
                    base_url=resolved_url,
                    default_headers=default_headers or None
                )
            return _clients[cache_key]

    elif resolved_type == "anthropic":
        resolved_key = api_key or config.ANTHROPIC_API_KEY or None
        resolved_url = base_url or config.ANTHROPIC_BASE_URL or None
        cache_key = ("anthropic", resolved_key, resolved_url, headers_cache_key)
        with _clients_lock:
            if cache_key not in _clients:
                import anthropic
                _clients[cache_key] = anthropic.Anthropic(
                    api_key=resolved_key,
                    base_url=resolved_url,
                    default_headers=default_headers or None
                )
            return _clients[cache_key]
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


def _flatten_system(system: list | str) -> str:
    """OpenAI 协议仅支持单段 string system prompt,将列表压平。"""
    if isinstance(system, str):
        return system
    chunks = []
    for block in system:
        if isinstance(block, dict) and "text" in block:
            chunks.append(block["text"])
        elif isinstance(block, str):
            chunks.append(block)
    return "\n\n".join(chunks)


def _convert_content_to_openai(content):
    """Anthropic 格式的 image content block 转 OpenAI 格式。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        new_content = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "image":
                src = block.get("source", {})
                if src.get("type") == "base64":
                    media_type = src.get("media_type", "image/jpeg")
                    data = src.get("data", "")
                    new_content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{data}"}
                    })
                else:
                    new_content.append(block)
            else:
                new_content.append(block)
        return new_content
    return content


def _call_anthropic(*, client, model: str, system: list | str, content, schema: type[T],
                    tool_name: str, tool_description: str,
                    max_tokens: int = 4096) -> tuple[T, dict]:
    tool = {
        "name": tool_name,
        "description": tool_description,
        "input_schema": schema.model_json_schema(),
    }
    messages = [{"role": "user", "content": content}]

    last_err: Exception | None = None
    for _ in range(2):
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool_name},
            messages=messages,
        )
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_creation_input_tokens": getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
            "cache_read_input_tokens": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
        }
        for block in response.content:
            if block.type == "tool_use" and block.name == tool_name:
                try:
                    return schema.model_validate(block.input), usage
                except Exception as e:
                    last_err = e
                    messages = messages + [
                        {"role": "assistant", "content": response.content},
                        {"role": "user", "content": [
                            {"type": "tool_result", "tool_use_id": block.id,
                             "content": f"参数校验失败,请重新调用 {tool_name}: {e}",
                             "is_error": True}]},
                    ]
                    break
        else:
            last_err = ValueError(f"模型未调用预期的 {tool_name} 工具")
            tool_use = [b for b in response.content if b.type == "tool_use"]
            if not tool_use:
                raise last_err
            messages = messages + [
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": tool_use[0].id,
                     "content": f"参数校验失败,请重新调用 {tool_name}: {last_err}",
                     "is_error": True}]},
            ]
    raise last_err


def _call_openai(*, client, model: str, system: list | str, content, schema: type[T],
                 tool_name: str, tool_description: str,
                 max_tokens: int = 4096,
                 force_tool_choice: bool = True) -> tuple[T, dict]:
    system_text = _flatten_system(system)
    openai_content = _convert_content_to_openai(content)

    tool = {
        "type": "function",
        "function": {
            "name": tool_name,
            "description": tool_description,
            "parameters": schema.model_json_schema(),
        }
    }
    messages = [
        {"role": "system", "content": system_text},
        {"role": "user", "content": openai_content}
    ]

    import openai
    tc_values = {
        "forced": {"type": "function", "function": {"name": tool_name}},
        "required": "required",
        "auto": "auto",
    }
    tc_mode = "forced" if force_tool_choice else "auto"

    def _create(tc):
        return client.chat.completions.create(
            model=model, max_tokens=max_tokens,
            messages=messages, tools=[tool], tool_choice=tc,
        )

    def _chat_with_degrade():
        nonlocal tc_mode
        modes = {
            "forced": ["forced", "required", "auto"],
            "required": ["required", "auto"],
            "auto": ["auto"],
        }[tc_mode]
        for m in modes:
            tc_mode = m
            try:
                return _create(tc_values[m])
            except openai.BadRequestError:
                if m == "auto":
                    raise
                continue

    last_err: Exception | None = None
    for _ in range(2):
        response = _chat_with_degrade()

        usage = {
            "input_tokens": response.usage.prompt_tokens if response.usage else 0,
            "output_tokens": response.usage.completion_tokens if response.usage else 0,
        }

        message = response.choices[0].message
        tool_calls = getattr(message, "tool_calls", None)
        tool_call = tool_calls[0] if tool_calls else None

        json_data = None
        if tool_call is not None and tool_call.function.name == tool_name:
            try:
                json_data = json.loads(tool_call.function.arguments)
            except Exception as e:
                last_err = e

        reasoning = getattr(message, "reasoning_content", None) or ""
        if json_data is None and reasoning:
            r_text = reasoning.strip()
            start_tag = "<tool_call>"
            end_tag = "</tool_call>"
            start_idx = r_text.find(start_tag)
            end_idx = r_text.find(end_tag)
            if start_idx != -1 and end_idx != -1:
                call_json_str = r_text[start_idx + len(start_tag):end_idx].strip()
                try:
                    raw_json = json.loads(call_json_str)
                    if "arguments" in raw_json:
                        json_data = raw_json["arguments"]
                    else:
                        json_data = raw_json
                except Exception as e:
                    last_err = e

        if json_data is None and message.content:
            text = message.content.strip()
            start_tag = "<tool_call>"
            end_tag = "</tool_call>"
            start_idx = text.find(start_tag)
            end_idx = text.find(end_tag)
            if start_idx != -1 and end_idx != -1:
                call_json_str = text[start_idx + len(start_tag):end_idx].strip()
                try:
                    raw_json = json.loads(call_json_str)
                    if "arguments" in raw_json:
                        json_data = raw_json["arguments"]
                    else:
                        json_data = raw_json
                except Exception as e:
                    last_err = e
            else:
                start = text.find("{")
                end = text.rfind("}")
                if start != -1 and end != -1:
                    try:
                        json_data = json.loads(text[start:end+1])
                    except Exception as e:
                        last_err = e

        if json_data is None:
            finish = getattr(response.choices[0], "finish_reason", "?") if response else "?"
            last_err = ValueError(
                f"模型未返回预期的 tool_call 函数调用，且正文中未包含有效 JSON "
                f"(finish_reason={finish}, has_reasoning={bool(reasoning)}, "
                f"content_len={len(message.content or '')}, out_tokens={usage.get('output_tokens')})"
            )
            continue

        try:
            return schema.model_validate(json_data), usage
        except Exception as e:
            last_err = e
            tc_id = tool_call.id if tool_call else "call_fallback"
            tc_name = tool_call.function.name if tool_call else tool_name
            tc_args = tool_call.function.arguments if tool_call else json.dumps(json_data, ensure_ascii=False)
            messages = messages + [
                {
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": [
                        {
                            "id": tc_id,
                            "type": "function",
                            "function": {
                                "name": tc_name,
                                "arguments": tc_args
                            }
                        }
                    ]
                },
                {
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": f"参数校验失败,请重新调用 {tool_name}: {e}"
                }
            ]
    raise last_err


def call_structured(*, model: str, system: list | str, content, schema: type[T],
                    tool_name: str, tool_description: str,
                    max_tokens: int = 4096,
                    provider: str | None = None,
                    api_key: str | None = None,
                    base_url: str | None = None,
                    extra_headers: dict | None = None) -> tuple[T, dict]:
    """强制模型调用一个'提交结果'工具,返回 (校验后的对象, 用量)。校验失败自动重试一次。"""
    resolved_provider = provider
    if not resolved_provider:
        resolved_provider = config.LLM_PROVIDER
    if not resolved_provider:
        if api_key or config.OPENAI_API_KEY:
            resolved_provider = "openai"
        elif config.ANTHROPIC_API_KEY:
            resolved_provider = "anthropic"
        else:
            resolved_provider = "openai"

    resolved_provider = resolved_provider.lower()
    url_lower = (base_url or "").lower()
    if "anthropic" in resolved_provider or "anthropic" in url_lower:
        client_type = "anthropic"
    else:
        client_type = "openai"

    # 如果没有显式传 extra_headers，尝试匹配任务配置
    if extra_headers is None:
        for task_pfx in ("TEXT", "IMAGE", "MERGE", "AUDIO"):
            cfg_url = getattr(config, f"{task_pfx}_BASE_URL", "")
            cfg_prov = getattr(config, f"{task_pfx}_PROVIDER_NAME", "")
            if (base_url and base_url == cfg_url) or (resolved_provider and resolved_provider == cfg_prov.lower()):
                raw_h = getattr(config, f"{task_pfx}_HEADERS", "")
                if raw_h:
                    extra_headers = config.parse_custom_headers(raw_h)
                    break

    client = get_client(resolved_provider, api_key=api_key, base_url=base_url, extra_headers=extra_headers)

    if client_type == "openai":
        return _call_openai(
            client=client, model=model, system=system, content=content, schema=schema,
            tool_name=tool_name, tool_description=tool_description, max_tokens=max_tokens,
            force_tool_choice=_force_forced_tool_choice(resolved_provider, base_url),
        )
    else:
        return _call_anthropic(
            client=client, model=model, system=system, content=content, schema=schema,
            tool_name=tool_name, tool_description=tool_description, max_tokens=max_tokens
        )
