#!/bin/bash
# 乱写APP 启动脚本:自动续期 Tailscale 证书(如可用)并以 HTTPS 启动;否则退回 HTTP。
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
CERT_DIR="data/certs"
mkdir -p "$CERT_DIR"

# 动态查找 Tailscale
TS=""
if [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
else
  TS="$(command -v tailscale || true)"
fi

# 动态查找 Python3 解释器
PYTHON_CMD="python3"
if ! command -v python3 >/dev/null 2>&1; then
  if command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
  fi
fi

if [ -n "$TS" ] && "$TS" status >/dev/null 2>&1; then
  # MagicDNS 主机名,如 mymac.tailxxxx.ts.net
  HOST=$("$TS" status --json | "$PYTHON_CMD" -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
  if "$TS" cert --cert-file "$CERT_DIR/cert.pem" --key-file "$CERT_DIR/key.pem" "$HOST" 2>/dev/null; then
    echo "HTTPS 模式: https://$HOST:$PORT"
    exec "$UV" run uvicorn server.main:app --host 0.0.0.0 --port "$PORT" \
      --ssl-certfile "$CERT_DIR/cert.pem" --ssl-keyfile "$CERT_DIR/key.pem"
  fi
fi

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

echo "未检测到 Tailscale,HTTP 模式(手机端录音功能不可用): http://$LOCAL_IP:$PORT"
exec "$UV" run uvicorn server.main:app --host 0.0.0.0 --port "$PORT"
