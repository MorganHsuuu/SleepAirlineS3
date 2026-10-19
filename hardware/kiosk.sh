#!/usr/bin/env bash
# Raspberry Pi: wait for network, then open Sleep Airline fullscreen.
set -euo pipefail

URL="${SLEEP_AIRLINE_URL:-https://sleep-airline-s3.vercel.app}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

wait_for_site() {
  local i
  for i in $(seq 1 60); do
    if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 4 "$URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
}

disable_blanking() {
  if command -v xset >/dev/null 2>&1; then
    xset s off 2>/dev/null || true
    xset -dpms 2>/dev/null || true
    xset s noblank 2>/dev/null || true
  fi
}

start_bridge() {
  local bridge="$HERE/device_bridge.py"
  if [ ! -f "$bridge" ] || ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  if curl -fsS --max-time 1 "http://127.0.0.1:8765/state" >/dev/null 2>&1; then
    return 0
  fi
  python3 "$bridge" >/tmp/sleep-airline-bridge.log 2>&1 &
}

CHROME="$(command -v chromium || true)"
if [ -z "$CHROME" ]; then
  CHROME="$(command -v chromium-browser || true)"
fi
if [ -z "$CHROME" ]; then
  echo "找不到 Chromium。請先執行: sudo apt install -y chromium" >&2
  exit 1
fi

wait_for_site
disable_blanking
start_bridge

echo "正在全螢幕開啟 ${URL}"
echo "日誌：/tmp/sleep-airline-kiosk.log"
echo "沒有鍵盤時，用 SSH 關掉：pkill chromium"

OZONE=()
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  OZONE=(--ozone-platform=wayland)
fi

CHROME_ARGS=(
  "${OZONE[@]}"
  --kiosk
  --start-fullscreen
  --password-store=basic
  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble
  --disable-restore-session-state
  --disable-features=TranslateUI
  --check-for-update-interval=31536000
  --autoplay-policy=no-user-gesture-required
  --no-first-run
  --overscroll-history-navigation=0
  "$URL"
)

if [ -n "${SSH_CONNECTION:-}" ]; then
  "$CHROME" "${CHROME_ARGS[@]}" >/tmp/sleep-airline-kiosk.log 2>&1 &
  echo "已在樹莓派螢幕開啟（PID $!）。這個 SSH 視窗還可以繼續打指令。"
  exit 0
fi

exec "$CHROME" "${CHROME_ARGS[@]}" >/tmp/sleep-airline-kiosk.log 2>&1
