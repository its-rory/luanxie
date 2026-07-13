#!/bin/bash
# 乱写APP 启动脚本:以 HTTP 模式启动后端服务。
set -e
cd "$(dirname "$0")/.."

# 动态查找 uv
UV="$(command -v uv || true)"
if [ -z "$UV" ]; then
  if [ -f "$HOME/.local/bin/uv" ]; then
    UV="$HOME/.local/bin/uv"
  elif [ -f "/opt/homebrew/bin/uv" ]; then
    UV="/opt/homebrew/bin/uv"
  elif [ -f "/usr/local/bin/uv" ]; then
    UV="/usr/local/bin/uv"
  elif [ -f "/usr/bin/uv" ]; then
    UV="/usr/bin/uv"
  else
    echo "警告: 未在 PATH 或常用路径中找到 uv, 尝试直接使用 uv"
    UV="uv"
  fi
fi

PORT="${PORT:-8787}"

# 动态获取局域网 IP
get_local_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1"
  elif command -v hostname >/dev/null 2>&1; then
    # Linux 获取第一个局域网 IP
    hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
  elif command -v ip >/dev/null 2>&1; then
    ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || echo "127.0.0.1"
  else
    echo "127.0.0.1"
  fi
}

LOCAL_IP=$(get_local_ip)

echo "乱写APP 启动中: http://$LOCAL_IP:$PORT"
exec "$UV" run uvicorn server.main:app --host 0.0.0.0 --port "$PORT"
