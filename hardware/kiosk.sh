#!/usr/bin/env bash
# Raspberry Pi: wait for sensors + network, then open Sleep Airline fullscreen.
set -euo pipefail

URL="${SLEEP_AIRLINE_URL:-https://sleep-airline-s3.vercel.app/}"
case "$URL" in
  *kiosk=1*|*device=1*) ;;
  *\?*) URL="${URL}&kiosk=1" ;;
  *) URL="${URL}?kiosk=1" ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME_PROFILE="${HOME}/.cache/sleep-airline-chrome"
mkdir -p "$CHROME_PROFILE"
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -S "${XDG_RUNTIME_DIR}/wayland-0" ]; then
  export WAYLAND_DISPLAY=wayland-0
fi

wait_for_site() {
  local i
  for i in $(seq 1 60); do
    if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 4 "$URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
}

wait_for_bridge() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS --max-time 1 "http://127.0.0.1:8765/state" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

disable_blanking() {
  if command -v xset >/dev/null 2>&1; then
    xset s off 2>/dev/null || true
    xset -dpms 2>/dev/null || true
    xset s noblank 2>/dev/null || true
  fi
}

bridge_up() {
  curl -fsS --max-time 1 "http://127.0.0.1:8765/state" >/dev/null 2>&1
}

start_bridge() {
  if bridge_up; then
    return 0
  fi
  if command -v systemctl >/dev/null 2>&1; then
    sudo -n systemctl start sleep-airline-bridge.service 2>/dev/null || \
      systemctl --user start sleep-airline-bridge.service 2>/dev/null || true
    if wait_for_bridge; then
      return 0
    fi
  fi
  local bridge="$HERE/device_bridge.py"
  if [ ! -f "$bridge" ] || ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  nohup python3 "$bridge" >/tmp/sleep-airline-bridge.log 2>&1 &
  disown || true
  wait_for_bridge || true
}

CHROME="$(command -v chromium || true)"
if [ -z "$CHROME" ]; then
  CHROME="$(command -v chromium-browser || true)"
fi
if [ -z "$CHROME" ]; then
  echo "找不到 Chromium。請先執行: sudo apt install -y chromium" >&2
  exit 1
fi

start_bridge
BOOT_URL="$URL"
if command -v systemctl >/dev/null 2>&1 && \
    systemctl is-enabled --quiet sleep-airline-pairing.service; then
  pairing_status=""
  for i in $(seq 1 60); do
    pairing_status="$(curl -fsS --max-time 1 http://127.0.0.1:8766/api/status 2>/dev/null || true)"
    if [ -n "$pairing_status" ]; then break; fi
    sleep 1
  done
  if [ -z "$pairing_status" ]; then
    echo "配對服務未回應，請檢查 sleep-airline-pairing.service。" >&2
    BOOT_URL="http://127.0.0.1:8766/device"
  elif ! printf '%s' "$pairing_status" | python3 -c \
      'import json,sys; s=json.load(sys.stdin); sys.exit(0 if s.get("paired") and s.get("online") else 1)'; then
    BOOT_URL="http://127.0.0.1:8766/device"
  fi
fi
if [ "$BOOT_URL" = "$URL" ]; then wait_for_site; fi
disable_blanking

echo "正在全螢幕開啟 ${BOOT_URL}"
echo "感測器：http://127.0.0.1:8765/state"
echo "日誌：/tmp/sleep-airline-kiosk.log"
echo "沒有鍵盤時，用 SSH 關掉：pkill chromium"

OZONE=()
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  OZONE=(--ozone-platform=wayland)
fi

CHROME_ARGS=(
  "${OZONE[@]}"
  --user-data-dir="$CHROME_PROFILE"
  --disable-web-security
  --allow-running-insecure-content
  --kiosk
  --start-fullscreen
  --password-store=basic
  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble
  --disable-restore-session-state
  --disable-features=TranslateUI,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks
  --check-for-update-interval=31536000
  --autoplay-policy=no-user-gesture-required
  --no-first-run
  --overscroll-history-navigation=0
  "$BOOT_URL"
)

nohup "$CHROME" "${CHROME_ARGS[@]}" >/tmp/sleep-airline-kiosk.log 2>&1 &
disown || true
echo "已在背景全螢幕開啟（PID $!）。這個視窗可以繼續測磁鐵；Ctrl+C 不會關掉畫面。"
echo "要關全螢幕請打：pkill chromium"
