# 樹莓派實體控制

此專案同時提供全螢幕 Chromium、感測器橋接與 `device_kiosk.py` 配對服務。裝置首次配網、配對 QR 和綁定狀態都由這個 repo 的 `hardware/` 管理；主頁直接讀取本機橋接。

| 元件 | 接線與動作 |
| --- | --- |
| 起飛磁簧 | BCM GPIO17（Pin 11）與 GND；磁鐵靠近時起飛 |
| 降落磁簧 | BCM GPIO27（Pin 13）與 GND；磁鐵靠近時降落 |
| 確認按鈕 | BCM GPIO22（Pin 15）與 GND；按下確認航向或心情。航向可不按，磁鐵仍可起飛；心情要先轉旋鈕再按 |
| ADS1115 | VDD 接 3.3V、GND 與 ADDR 接 GND、SDA 接 Pin 3、SCL 接 Pin 5；I2C 位址 `0x48` |
| 可變電阻 | 兩側接 3.3V 和 GND，中間腳接 ADS1115 A0；有止擋，轉到底即停。最低電壓是正北、最高是西北，不會從西北繞回正北 |

磁簧使用內建 pull-up。接線前先關機，GPIO 和旋鈕都不要接 5V。

主頁從 `http://127.0.0.1:8765/state` 讀取磁簧次數、方位和 ADC 錯誤，再呼叫現有的 `setDirection`、`doTakeoff`、`doLand`。樹莓派 Chromium 只要 8765 有資料就會聽磁鐵；`http://127.0.0.1:8766/api/status` 是正式 kiosk 的選配狀態頁（配網／裝置身分），沒開也不會擋住起飛降落。連線或 ADC 失敗會在正式畫面保留錯誤資訊，恢復後清除；普通訪客在非樹莓派的瀏覽器不會看到感測器錯誤。

兩個磁簧同時觸發會忽略該次動作；重連後先建立基準，不重播斷線期間的事件。ADC 失敗時磁簧仍可操作。旋鈕是單向行程，畫面指針也不會無限轉圈。

終端機測試磁鐵（橋接已在跑時）：

```bash
bash ~/SleepAirlineS3/hardware/watch-reeds.sh
```

或直接：

```bash
while true; do curl -sS http://127.0.0.1:8765/state; echo; sleep 0.2; done
```

## 開機自動啟動

開機會自動做兩件事，互不綁死：

1. **磁簧 + 旋鈕**（`device_bridge.py`）→ systemd `sleep-airline-bridge.service`，關瀏覽器也不會停
2. **全螢幕網站** → 桌面 autostart `kiosk.sh`

在樹莓派上：

```bash
cd ~/SleepAirlineS3
git pull
cd hardware
chmod +x install-kiosk.sh kiosk.sh
./install-kiosk.sh
./install-pairing-service.sh
sudo reboot
```

查看感測器服務：

```bash
systemctl status sleep-airline-bridge
curl -sS http://127.0.0.1:8765/state
sudo journalctl -u sleep-airline-bridge -n 40 --no-pager
```

`pkill chromium` 只關全螢幕，不要殺掉 bridge。改網址：編輯 `~/sleep-airline-kiosk/kiosk.sh` 裡的 `SLEEP_AIRLINE_URL`。

### 首次配對與之後開機

在同一個 `~/SleepAirlineS3/hardware` 目錄先執行 `./install-kiosk.sh`，再執行 `./install-pairing-service.sh`。後者保留現有服務，增加 `sleep-airline-pairing.service`，並讓橋接從 `~/.config/sleep-airline/device.json` 讀取旅客身分。新裝置預設進入藍牙配對畫面，安裝不會自動切換 Wi-Fi。

配對服務回報未綁定時，全螢幕瀏覽器開啟本機 QR；已綁定且連網時，直接進入正式飛機窗；已綁定但斷網時，顯示本機離線頁。三個狀態都使用同一個 Chromium 畫面，不會另開感測器測試分頁。

舊版 Wi-Fi 備用方式：裝置熱點沒有網際網路是正常的。手機先在原網路掃描 QR，取得授權後才切到裝置 Wi-Fi，開啟 `http://10.42.0.1:8766/setup` 輸入家中 Wi-Fi。送出後手機會離開裝置熱點，再回原網路查看綁定結果。熱點建立失敗或綁定卡住時，可在樹莓派終端機檢查：

```bash
curl -s localhost:8766/api/status
nmcli device status
nmcli networking connectivity
sudo journalctl -u sleep-airline-pairing -n 60 --no-pager
```

裝置身分檔保存在 `~/.config/sleep-airline/device.json`，家中 Wi-Fi 密碼由 NetworkManager 保存。請勿把身分檔、暫時熱點密碼或家中 Wi-Fi 密碼貼到 GitHub。

### 藍牙配對測試版

重新執行 `./install-pairing-service.sh` 後，首次未配對的開機畫面預設顯示 BLE 配對 QR，不會自動開啟裝置 Wi-Fi 熱點。APP 透過藍牙傳送 Wi-Fi 資料；裝置仍以 NetworkManager 連網，並把成功連上的網路設為高優先度自動連線。若手機 APP 尚未安裝或藍牙有問題，裝置畫面的「其他連線方式」可以暫時使用舊熱點方式。這個切換會關閉 Pi 目前的 Wi-Fi，若正在用 SSH，請先在裝置螢幕操作並預期 SSH 中斷。

裝置畫面 QR 指向 `https://night-departures.vercel.app/get-app`，下載頁須已發佈且填好實際 APP 測試版連結，才適合讓新旅客使用。測試時可先以 Xcode／Android Studio 安裝 APP；裝好後再掃一次 Pi 畫面 QR。

已配對但網路失效時，本機離線頁可按「重新設定 Wi-Fi」，保留 Passenger ID。這個按鈕只允許 Pi 本機畫面操作。`/device` 與 `/offline` 也只向 loopback 提供，以免教室網路上其他裝置讀到畫面內的配對密鑰。

檢查：

```bash
systemctl status sleep-airline-pairing bluetooth --no-pager
curl -s http://127.0.0.1:8766/api/status
sudo journalctl -u sleep-airline-pairing -n 80 --no-pager
nmcli device status
```

若 `bleReady` 長期為 false，可在 Pi 畫面使用備用熱點。回復舊預設啟動方式時，將 `sleep-airline-pairing.service` 的 `ExecStart` 參數 `--pairing-transport ble` 改成 `wifi`，再 `sudo systemctl daemon-reload && sudo systemctl restart sleep-airline-pairing`。這不會刪除既有配對紀錄或 NetworkManager 的 Wi-Fi 設定。
