#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
MODE="${MODE:-dev}" # dev or prod
PROVIDER="${PROVIDER:-auto}" # auto, cloudflared, or ngrok

if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is already in use. Set PORT=#### and try again."
    exit 1
  fi
fi

if [ "$MODE" = "prod" ]; then
  npm run build
  npm run start -- -H "$HOST" -p "$PORT" &
  APP_PID=$!
else
  npm run dev -- -H "$HOST" -p "$PORT" &
  APP_PID=$!
fi

cleanup() {
  kill "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 2

if [ "$PROVIDER" = "auto" ]; then
  if command -v cloudflared >/dev/null 2>&1; then
    PROVIDER="cloudflared"
  elif command -v ngrok >/dev/null 2>&1; then
    PROVIDER="ngrok"
  else
    echo "No tunnel provider found. Install cloudflared or ngrok first."
    echo "cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    echo "ngrok: https://ngrok.com/download (requires auth token)"
    exit 1
  fi
fi

if [ "$PROVIDER" = "cloudflared" ]; then
  echo "Starting Cloudflare tunnel on http://localhost:$PORT ..."
  cloudflared tunnel --url "http://localhost:$PORT"
elif [ "$PROVIDER" = "ngrok" ]; then
  echo "Starting ngrok tunnel on http://localhost:$PORT ..."
  ngrok http "$PORT"
else
  echo "Unknown PROVIDER: $PROVIDER (use cloudflared or ngrok)"
  exit 1
fi
