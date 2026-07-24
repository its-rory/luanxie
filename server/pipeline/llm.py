"""LLM 调用薄封装:强制 tool use 拿结构化输出 + Pydantic 校验重试。

支持 Anthropic 协议与 OpenAI 协议双通。
用 tool use 而非 output_config/messages.parse 的原因:兼容第三方端点普遍支持 tool call,一条代码路径通吃。
"""
import json
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .. import config

T = TypeVar("T", bound=BaseModel)

import threading

_clients = {}
_clients_lock = threading.Lock()

# 已知上游工具调用能力登记(影响首发 tool_choice,避免注定失败的 400 往返)。
# 默认所有 OpenAI 协议上游都支持 forced tool call(硬保证结构化输出);
# 在此显式登记"不支持 forced/required"的上游,_call_openai 对它们首发 "auto",
# 由已有的三路兜底解析(tool_calls → reasoning_content 的 <antml:invoke> 提取 → 正文 JSON)保障结构化输出。
# 例:OpenCode Console Go(DeepSeek-v4 系列等)对 forced tool_choice 直接回 400 "Upstream request failed"。
# 例:硅基流动 Qwen3-VL 系列(Thinking/Instruct)对 forced/required tool_choice 回 400 code 20015,
# 其中 Instruct 系列在 auto 下也不产出结构化(请用 Thinking 版本如 Qwen3-VL-8B-Thinking), Thinking 在 auto 下稳定产出 tool_call。
_NO_FORCED_TOOL_CHOICE_PROVIDERS = (
    "opencodego",
    "siliconflow",
)


def _force_forced_tool_choice(provider: str, base_url: str | None) -> bool:
    """是否对首发使用 forced tool_choice。True=forced 硬保证;False=首发 auto。"""
    key = f"{provider} {base_url or ''}".lower()
    return not any(p in key for p in _NO_FORCED_TOOL_CHOICE_PROVIDERS)


def get_client(provider: str, api_key: str | None = None, base_url: str | None = None):
    provider_lower = provider.lower()
    url_lower = (base_url or "").lower()

    if "anthropic" in provider_lower or "anthropic" in url_lower:
        resolved_type = "anthropic"
    else:
        resolved_type = "openai"

    if resolved_type == "openai":
        resolved_key = api_key or config.OPENAI_API_KEY or None
        resolved_url = base_url or config.OPENAI_BASE_URL or None
        cache_key = ("openai", resolved_key, resolved_url)
        with _clients_lock:
            if cache_key not in _clients:
                import openai
                _clients[cache_key] = openai.OpenAI(
                    api_key=resolved_key,
                    base_url=resolved_url
                )
            return _clients[cache_key]
    elif resolved_type == "anthropic":
        resolved_key = api_key or config.ANTHROPIC_API_KEY or None
        resolved_url = base_url or config.ANTHROPIC_BASE_URL or None
        cache_key = ("anthropic", resolved_key, resolved_url)
        with _clients_lock:
            if cache_key not in _clients:
                import anthropic
                _clients[cache_key] = anthropic.Anthropic(
                    api_key=resolved_key,
                    base_url=resolved_url
                )
            return _clients[cache_key]
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


def _flatten_system(system) -> str:
    """将 Anthropic 列表格式的 system prompt 扁平化为纯文本字符串以兼容 OpenAI。"""
    if isinstance(system, str):
        return system
    elif isinstance(system, list):
        parts = []
        for block in system:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "\n\n".join(parts)
    return ""


def _convert_content_to_openai(content):
    """将 Anthropic 格式的 image 块转换为 OpenAI 格式。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        new_content = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "image":
                    source = block.get("source", {})
                    media_type = source.get("media_type", "image/jpeg")
                    data = source.get("data", "")
                    new_content.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{media_type};base64,{data}"
                        }
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
            messages=messages,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool_name},
        )
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
        }
        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        if tool_use is None:
            last_err = ValueError("模型未返回 tool_use 块")
            continue
        try:
            return schema.model_validate(tool_use.input), usage
        except ValidationError as e:
            last_err = e
            messages = messages + [
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": tool_use.id,
                     "content": f"参数校验失败,请重新调用 {tool_name}: {e}",
                     "is_error": True}]},
            ]
    raise last_err  # type: ignore[misc]


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
    # tool_choice 取值表;tc_mode 跟踪"当前已降级到的最低档",跨校验重试轮次保留,避免重复打注定失败的 forced 请求。
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
        # 从当前 tc_mode 起,若上游对该 tool_choice 返回 400,逐级降级 forced→required→auto。
        # 安全网:不依赖 provider 报错文案匹配(避免如 "Upstream request failed" 这类文案踩空导致无法降级)。
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
                    raise  # 已无可降级档位,抛出让上层处理
                continue
        # 不可达

    last_err: Exception | None = None
    for _ in range(2):
        response = _chat_with_degrade()

        usage = {
            "input_tokens": response.usage.prompt_tokens,
            "output_tokens": response.usage.completion_tokens,
            "cache_read": 0,
        }

        message = response.choices[0].message
        tool_calls = getattr(message, "tool_calls", None)
        tool_call = tool_calls[0] if tool_calls else None

        json_data = None
        # 1. 尝试从正式的 tool_calls 中解析
        if tool_call is not None and tool_call.function.name == tool_name:
            try:
                json_data = json.loads(tool_call.function.arguments)
            except Exception as e:
                last_err = e

        # 2. 尝试从 reasoning_content (推理思考内容) 中提取 XML 格式的 tool_call
        reasoning = getattr(message, "reasoning_content", None) or ""
        if json_data is None and reasoning:
            r_text = reasoning.strip()
            start_tag = "<tool_call>"
            end_tag = "</tool_call>"
            start_idx = r_text.find(start_tag)
            end_idx = r_text.find(end_tag)
            if start_idx != -1 and end_idx != -1:
                json_str = r_text[start_idx + len(start_tag):end_idx].strip()
                try:
                    raw_json = json.loads(json_str)
                    if isinstance(raw_json, dict) and "arguments" in raw_json:
                        json_data = raw_json["arguments"]
                        if isinstance(json_data, str):
                            json_data = json.loads(json_data)
                    else:
                        json_data = raw_json
                except Exception as e:
                    last_err = e

        # 3. 尝试从正文 content 中提取 (包括 XML 格式和标准 JSON 格式)
        if json_data is None and message.content:
            text = message.content.strip()
            start_tag = "<tool_call>"
            end_tag = "</tool_call>"
            start_idx = text.find(start_tag)
            end_idx = text.find(end_tag)
            if start_idx != -1 and end_idx != -1:
                json_str = text[start_idx + len(start_tag):end_idx].strip()
                try:
                    raw_json = json.loads(json_str)
                    if isinstance(raw_json, dict) and "arguments" in raw_json:
                        json_data = raw_json["arguments"]
                        if isinstance(json_data, str):
                            json_data = json.loads(json_data)
                    else:
                        json_data = raw_json
                except Exception as e:
                    last_err = e
            else:
                # 寻找标准的 JSON 边界 { 和 }
                start = text.find("{")
                end = text.rfind("}")
                if start != -1 and end != -1:
                    try:
                        json_data = json.loads(text[start:end+1])
                    except Exception as e:
                        last_err = e

        if json_data is None:
            # 不再把完整 message 对象塞进异常(可能含上游 URL/账号/正文),仅保留可定位的事实。
            finish = getattr(response.choices[0], "finish_reason", "?") if response else "?"
            last_err = ValueError(
                f"模型未返回预期的 tool_call 函数调用，且正文中未包含有效 JSON "
                f"(finish_reason={finish}, has_reasoning={bool(reasoning)}, "
                f"content_len={len(message.content or '')}, out_tokens={usage.get('output_tokens')})"
            )
            continue

        try:
            return schema.model_validate(json_data), usage
        except (ValidationError, json.JSONDecodeError) as e:
            last_err = e
            tc_id = tool_call.id if tool_call else "call_fallback"
            tc_name = tool_call.function.name if (tool_call and getattr(tool_call, "function", None)) else tool_name
            tc_args = tool_call.function.arguments if (tool_call and getattr(tool_call, "function", None)) else json.dumps(json_data)
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
                    base_url: str | None = None) -> tuple[T, dict]:
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

    client = get_client(resolved_provider, api_key=api_key, base_url=base_url)

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
