#!/usr/bin/env bash
# Run this ON the Raspberry Pi (Raspberry Pi OS Desktop).
# Installs: reed magnets + knob bridge (systemd) and fullscreen Chromium (desktop autostart).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/sleep-airline-kiosk"
AUTOSTART="${HOME}/.config/autostart"
DESKTOP="${AUTOSTART}/sleep-airline-kiosk.desktop"
SERVICE_NAME="sleep-airline-bridge.service"
PYTHON="$(command -v python3 || true)"

mkdir -p "$DEST" "$AUTOSTART"
cp "$HERE/kiosk.sh" "$DEST/kiosk.sh"
chmod +x "$DEST/kiosk.sh"
if [ -f "$HERE/device_bridge.py" ]; then
  cp "$HERE/device_bridge.py" "$DEST/device_bridge.py"
fi
if [ -f "$HERE/watch-reeds.sh" ]; then
  cp "$HERE/watch-reeds.sh" "$DEST/watch-reeds.sh"
  chmod +x "$DEST/watch-reeds.sh"
fi

cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Sleep Airline Kiosk
Comment=開機全螢幕開啟甦醒航班
Exec=${DEST}/kiosk.sh
X-GNOME-Autostart-enabled=true
Terminal=false
StartupNotify=false
EOF

if command -v labwc >/dev/null 2>&1 || [ -d "${HOME}/.config/labwc" ]; then
  mkdir -p "${HOME}/.config/labwc"
  LABWC_START="${HOME}/.config/labwc/autostart"
  touch "$LABWC_START"
  chmod +x "$LABWC_START"
  if ! grep -q "sleep-airline-kiosk/kiosk.sh" "$LABWC_START"; then
    printf '%s\n' "${DEST}/kiosk.sh &" >> "$LABWC_START"
  fi
fi

LX_START="${HOME}/.config/lxsession/LXDE-pi/autostart"
if [ -f "$LX_START" ] && ! grep -q "sleep-airline-kiosk/kiosk.sh" "$LX_START"; then
  printf '%s\n' "@${DEST}/kiosk.sh" >> "$LX_START"
fi

if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_blanking 1 || true
  sudo raspi-config nonint do_i2c 0 || true
fi

sudo usermod -aG gpio,i2c "$USER" 2>/dev/null || true

if command -v apt >/dev/null 2>&1; then
  sudo apt-get install -y python3-gpiozero python3-smbus python3-lgpio i2c-tools >/dev/null 2>&1 || \
    sudo apt install -y python3-gpiozero python3-smbus i2c-tools || true
fi

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  echo "尚未安裝 Chromium。正在安裝…"
  sudo apt update
  sudo apt install -y chromium || sudo apt install -y chromium-browser
fi

if [ -z "$PYTHON" ]; then
  echo "找不到 python3，無法安裝磁簧／旋鈕服務。" >&2
else
  if [ -f "$HERE/sleep-airline-bridge.service" ]; then
    pkill -f 'device_bridge.py' 2>/dev/null || true
    sleep 0.5
    unit="$(sed -e "s|__USER__|${USER}|g" -e "s|__DEST__|${DEST}|g" "$HERE/sleep-airline-bridge.service")"
    if ! getent group gpio >/dev/null 2>&1 || ! getent group i2c >/dev/null 2>&1; then
      unit="$(printf '%s\n' "$unit" | grep -v '^SupplementaryGroups=')"
    fi
    printf '%s\n' "$unit" | sudo tee "/etc/systemd/system/${SERVICE_NAME}" >/dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable --now "$SERVICE_NAME"
  fi
fi

echo
echo "已設定開機自動啟動："
echo "  1. 磁簧起飛／降落 + 旋鈕方位  →  systemd ${SERVICE_NAME}"
echo "  2. 全螢幕網站                    →  ${DESKTOP}"
echo
if curl -fsS --max-time 2 http://127.0.0.1:8765/state >/dev/null 2>&1; then
  echo "感測器橋接已在跑：http://127.0.0.1:8765/state"
  curl -sS http://127.0.0.1:8765/state
  echo
else
  echo "感測器橋接還沒回應。可看日誌："
  echo "  sudo journalctl -u ${SERVICE_NAME} -n 40 --no-pager"
fi
echo "請確認 raspi-config 已開 Desktop Autologin，然後重開機："
echo "  sudo reboot"
echo
echo "離開全螢幕：SSH 執行 pkill chromium（不要殺掉 bridge）"
echo "改網址：編輯 ${DEST}/kiosk.sh 裡的 SLEEP_AIRLINE_URL"
