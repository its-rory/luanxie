"""LLM 调用薄封装:强制 tool use 拿结构化输出 + Pydantic 校验重试。

支持 Anthropic 协议与 OpenAI 协议双通。
用 tool use 而非 output_config/messages.parse 的原因:兼容第三方端点普遍支持 tool call,一条代码路径通吃。
"""
import json
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .. import config

T = TypeVar("T", bound=BaseModel)

_anthropic_client = None
_openai_client = None


def get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        import anthropic
        _anthropic_client = anthropic.Anthropic(
            api_key=config.ANTHROPIC_API_KEY or None,
            base_url=config.ANTHROPIC_BASE_URL or None
        )
    return _anthropic_client


def get_openai_client():
    global _openai_client
    if _openai_client is None:
        import openai
        _openai_client = openai.OpenAI(
            api_key=config.OPENAI_API_KEY or None,
            base_url=config.OPENAI_BASE_URL or None
        )
    return _openai_client


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


def _call_anthropic(*, model: str, system: list | str, content, schema: type[T],
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
        response = get_anthropic_client().messages.create(
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


def _call_openai(*, model: str, system: list | str, content, schema: type[T],
                  tool_name: str, tool_description: str,
                  max_tokens: int = 4096) -> tuple[T, dict]:
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
    last_err: Exception | None = None
    for _ in range(2):
        try:
            response = get_openai_client().chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=messages,
                tools=[tool],
                tool_choice={"type": "function", "function": {"name": tool_name}},
            )
        except openai.BadRequestError as e:
            err_msg = str(e).lower()
            if "tool_choice" in err_msg or "tool" in err_msg or "20015" in err_msg:
                try:
                    # 尝试降级为 "required" (强制要求调用工具，但不由 API 指定具体函数名)
                    response = get_openai_client().chat.completions.create(
                        model=model,
                        max_tokens=max_tokens,
                        messages=messages,
                        tools=[tool],
                        tool_choice="required",
                    )
                except openai.BadRequestError:
                    # 进一步降级为 "auto" (自动决定，部分不支持 forced tool call 的模型适用)
                    response = get_openai_client().chat.completions.create(
                        model=model,
                        max_tokens=max_tokens,
                        messages=messages,
                        tools=[tool],
                        tool_choice="auto",
                    )
            else:
                raise e

        usage = {
            "input_tokens": response.usage.prompt_tokens,
            "output_tokens": response.usage.completion_tokens,
            "cache_read": 0,
        }

        message = response.choices[0].message
        tool_calls = getattr(message, "tool_calls", None)
        tool_call = tool_calls[0] if tool_calls else None

        if tool_call is None or tool_call.function.name != tool_name:
            last_err = ValueError("模型未返回预期的 tool_call 函数调用")
            continue

        try:
            input_data = json.loads(tool_call.function.arguments)
            return schema.model_validate(input_data), usage
        except (ValidationError, json.JSONDecodeError) as e:
            last_err = e
            messages = messages + [
                {
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": [
                        {
                            "id": tool_call.id,
                            "type": "function",
                            "function": {
                                "name": tool_call.function.name,
                                "arguments": tool_call.function.arguments
                            }
                        }
                    ]
                },
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": f"参数校验失败,请重新调用 {tool_name}: {e}"
                }
            ]
    raise last_err


def call_structured(*, model: str, system: list | str, content, schema: type[T],
                    tool_name: str, tool_description: str,
                    max_tokens: int = 4096) -> tuple[T, dict]:
    """强制模型调用一个'提交结果'工具,返回 (校验后的对象, 用量)。校验失败自动重试一次。"""
    # 决定使用哪个 Provider
    use_openai = (config.LLM_PROVIDER == "openai") or (
        bool(config.OPENAI_API_KEY) and not bool(config.ANTHROPIC_API_KEY))

    if use_openai:
        return _call_openai(
            model=model, system=system, content=content, schema=schema,
            tool_name=tool_name, tool_description=tool_description, max_tokens=max_tokens
        )
    else:
        return _call_anthropic(
            model=model, system=system, content=content, schema=schema,
            tool_name=tool_name, tool_description=tool_description, max_tokens=max_tokens
        )
