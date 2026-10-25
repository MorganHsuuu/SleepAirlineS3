#!/usr/bin/env bash
# Keep the existing S3 fullscreen kiosk and sensor bridge; add local pairing.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BRIDGE="${HOME}/sleep-airline-kiosk/device_bridge.py"
STATE="${HOME}/.config/sleep-airline/device.json"
PAIRING_UNIT="sleep-airline-pairing.service"
BRIDGE_UNIT="sleep-airline-bridge.service"
PYTHON="/usr/bin/python3"
DEVICE_USER="$(id -un)"
DEVICE_GROUP="$(id -gn)"
POLKIT_RULE="/etc/polkit-1/rules.d/00-sleep-airline-pairing.rules"

if [ ! -f "$BRIDGE" ] || ! systemctl cat "$BRIDGE_UNIT" >/dev/null 2>&1; then
  echo "請先在 SleepAirlineS3/hardware 執行 ./install-kiosk.sh，安裝全螢幕與感測器服務。" >&2
  exit 1
fi
if ! command -v nmcli >/dev/null 2>&1; then
  echo "找不到 NetworkManager (nmcli)。請先安裝 network-manager。" >&2
  exit 1
fi
# Use OS packages so this remains compatible with Raspberry Pi OS Bookworm.
sudo apt-get update
sudo apt-get install -y bluez python3-dbus-next python3-cryptography python3-qrcode
"$PYTHON" -c 'import dbus_next, cryptography, qrcode'
sudo systemctl enable --now bluetooth.service
if command -v rfkill >/dev/null 2>&1; then sudo rfkill unblock bluetooth; fi
# BlueZ system-bus policy grants its supported API to the bluetooth group.
getent group bluetooth >/dev/null || sudo groupadd --system bluetooth
sudo usermod -aG bluetooth "$DEVICE_USER"

# This service has no desktop login session, so NetworkManager's interactive
# authorization cannot prompt it while creating an AP or changing Wi-Fi.
sudo mkdir -p /etc/polkit-1/rules.d
cat <<EOF | sudo tee "$POLKIT_RULE" >/dev/null
polkit.addRule(function(action, subject) {
    if (subject.user == "$DEVICE_USER" &&
        [
            "org.freedesktop.NetworkManager.network-control",
            "org.freedesktop.NetworkManager.settings.modify.system",
            "org.freedesktop.NetworkManager.wifi.share.protected",
            "org.freedesktop.NetworkManager.wifi.scan"
        ].indexOf(action.id) >= 0) {
        return polkit.Result.YES;
    }
});
EOF
sudo chmod 0644 "$POLKIT_RULE"
sudo systemctl restart polkit.service

sudo mkdir -p "/etc/systemd/system/${BRIDGE_UNIT}.d"
printf '[Service]\nExecStart=\nExecStart=%s %s --identity-file %s\n' \
  "$PYTHON" "$BRIDGE" "$STATE" | \
  sudo tee "/etc/systemd/system/${BRIDGE_UNIT}.d/identity.conf" >/dev/null

cat <<EOF | sudo tee "/etc/systemd/system/${PAIRING_UNIT}" >/dev/null
[Unit]
Description=Sleep Airline BLE pairing and Wi-Fi setup
After=NetworkManager.service bluetooth.service
Wants=NetworkManager.service bluetooth.service

[Service]
Type=simple
User=${DEVICE_USER}
Group=${DEVICE_GROUP}
SupplementaryGroups=bluetooth
UMask=0077
Environment=HOME=${HOME}
WorkingDirectory=${HERE}
Environment=PYTHONUNBUFFERED=1
ExecStart=${PYTHON} ${HERE}/device_kiosk.py --no-browser --no-bridge --pairing-transport ble
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl restart "$BRIDGE_UNIT"
sudo systemctl enable "$PAIRING_UNIT"
sudo systemctl restart "$PAIRING_UNIT"

echo "已保留 S3 全螢幕與感測器服務，並加入本機配對服務。"
echo "首次開機顯示 APP 下載 QR 與藍牙引導；已配對且連網時直接進入飛機窗。"
echo "重新開機後檢查：systemctl status ${PAIRING_UNIT} ${BRIDGE_UNIT}"
