# 樹莓派實體控制

正式裝置保留此專案的全螢幕 Chromium 與感測器橋接；[樹莓派專案的 `device_kiosk.py`](https://github.com/yuhsiangc0620/raspberry-pi-reed-sensor-test) 在背景提供首次配網、配對 QR 與綁定狀態。此網站的主頁直接讀取本機橋接，沒有獨立感測器測試頁。

| 元件 | 接線與動作 |
| --- | --- |
| 起飛磁簧 | BCM GPIO17（Pin 11）與 GND；磁鐵靠近時起飛 |
| 降落磁簧 | BCM GPIO27（Pin 13）與 GND；磁鐵靠近時降落 |
| 確認按鈕 | BCM GPIO22（Pin 15）與 GND；按下確認航向或心情。航向可不按，磁鐵仍可起飛；心情要先轉旋鈕再按 |
| ADS1115 | VDD 接 3.3V、GND 與 ADDR 接 GND、SDA 接 Pin 3、SCL 接 Pin 5；I2C 位址 `0x48` |
| 可變電阻 | 兩側接 3.3V 和 GND，中間腳接 ADS1115 A0；有止擋，轉到底即停。最低電壓是正北、最高是西北，不會從西北繞回正北 |

磁簧使用內建 pull-up。接線前先關機，GPIO 和旋鈕都不要接 5V。

主頁從 `http://127.0.0.1:8765/state` 讀取磁簧次數、方位和 ADC 錯誤，再呼叫現有的 `setDirection`、`doTakeoff`、`doLand`。樹莓派 Chromium 只要 8765 有資料就會聽磁鐵；`http://127.0.0.1:8766/api/status` 是正式 kiosk 的選配狀態頁（配網／裝置身分），沒開也不會擋住起飛降落。連線或 ADC 失敗會在正式畫面保留錯誤資訊，恢復後清除；普通訪客在非樹莓派的瀏覽器不會看到感測器錯誤。

兩個磁簧同時觸發會忽略該次動作；重連後先建立基準，不重播斷線期間的事件。ADC 失敗時保留前一次方位，磁簧仍可操作。旋鈕是單向行程，畫面指針也不會無限轉圈。完整安裝、配網和維護方式請看樹莓派專案 README。

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

安裝上面的全螢幕與感測器服務後，再於 `~/raspberry-pi-reed-sensor-test` 執行 `./install-pairing-service.sh`。它保留現有服務，增加 `sleep-airline-pairing.service`，並讓橋接從 `~/.config/sleep-airline/device.json` 讀取旅客身分。完成後重新執行本專案的 `./install-kiosk.sh`，讓開機腳本更新到支援配對的版本，再重新開機。

配對服務回報未綁定時，全螢幕瀏覽器開啟本機 QR；已綁定且連網時，直接進入正式飛機窗；已綁定但斷網時，顯示本機離線頁。三個狀態都使用同一個 Chromium 畫面，不會另開感測器測試分頁。
