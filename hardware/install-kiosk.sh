#!/usr/bin/env bash
# Run this ON the Raspberry Pi (Raspberry Pi OS Desktop).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/sleep-airline-kiosk"
AUTOSTART="${HOME}/.config/autostart"
DESKTOP="${AUTOSTART}/sleep-airline-kiosk.desktop"

mkdir -p "$DEST" "$AUTOSTART"
cp "$HERE/kiosk.sh" "$DEST/kiosk.sh"
chmod +x "$DEST/kiosk.sh"
if [ -f "$HERE/device_bridge.py" ]; then
  cp "$HERE/device_bridge.py" "$DEST/device_bridge.py"
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
fi

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  echo "尚未安裝 Chromium。正在安裝…"
  sudo apt update
  sudo apt install -y chromium || sudo apt install -y chromium-browser
fi

echo
echo "已設定開機全螢幕開啟 https://sleep-airline-s3.vercel.app"
echo "請再開一次 raspi-config，選："
echo "  System Options → Boot / Auto Login → Desktop Autologin"
echo "然後重開機："
echo "  sudo reboot"
echo
echo "離開全螢幕：Alt+F4 或 Ctrl+F11（視系統而定）"
echo "改網址：編輯 ${DEST}/kiosk.sh 裡的 SLEEP_AIRLINE_URL"
