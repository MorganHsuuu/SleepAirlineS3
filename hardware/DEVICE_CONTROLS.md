# 樹莓派實體控制

正式裝置由 [樹莓派專案的 `device_kiosk.py`](https://github.com/yuhsiangc0620/raspberry-pi-reed-sensor-test) 啟動。它在同一台樹莓派上執行感測器橋接、首次配網頁及 Chromium。此網站的全螢幕主頁直接讀取本機橋接，沒有獨立感測器測試頁，也不需 `?device=1`。

| 元件 | 接線與動作 |
| --- | --- |
| 起飛磁簧 | BCM GPIO17（Pin 11）與 GND；磁鐵靠近時起飛 |
| 降落磁簧 | BCM GPIO27（Pin 13）與 GND；磁鐵靠近時降落 |
| ADS1115 | VDD 接 3.3V、GND 與 ADDR 接 GND、SDA 接 Pin 3、SCL 接 Pin 5；I2C 位址 `0x48` |
| 可變電阻 | 兩側接 3.3V 和 GND，中間腳接 ADS1115 A0；起飛前選八個方向 |

磁簧使用內建 pull-up。接線前先關機，GPIO 和旋鈕都不要接 5V。

主頁從 `http://127.0.0.1:8765/state` 讀取磁簧次數、方位和 ADC 錯誤，再呼叫現有的 `setDirection`、`doTakeoff`、`doLand`。樹莓派 Chromium 只要 8765 有資料就會聽磁鐵；`http://127.0.0.1:8766/api/status` 是正式 kiosk 的選配狀態頁（配網／裝置身分），沒開也不會擋住起飛降落。連線或 ADC 失敗會在正式畫面保留錯誤資訊，恢復後清除；普通訪客在非樹莓派的瀏覽器不會看到感測器錯誤。

兩個磁簧同時觸發會忽略該次動作；重連後先建立基準，不重播斷線期間的事件。ADC 失敗時保留前一次方位，磁簧仍可操作。完整安裝、配網和維護方式請看樹莓派專案 README。

## 開機自動全螢幕

在這台樹莓派上把 `hardware/` 拷過去（或直接 clone 本 repo），然後執行：

```bash
cd hardware
chmod +x install-kiosk.sh kiosk.sh
./install-kiosk.sh
sudo raspi-config   # System Options → Boot / Auto Login → Desktop Autologin
sudo reboot
```

開機後會等網路，再開 Chromium kiosk 進入 `https://sleep-airline-s3.vercel.app`。同資料夾若有 `device_bridge.py`，也會一併啟動，主頁才能讀到磁簧與旋鈕。

改網址：編輯 `~/sleep-airline-kiosk/kiosk.sh` 裡的 `SLEEP_AIRLINE_URL`。離開全螢幕可用 `Alt+F4`；沒有鍵盤時用 SSH 執行 `pkill chromium`。
