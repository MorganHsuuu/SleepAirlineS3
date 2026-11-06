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

在同一個 `~/SleepAirlineS3/hardware` 目錄先執行 `./install-kiosk.sh`，再執行 `./install-pairing-service.sh`。後者保留現有服務，增加 `sleep-airline-pairing.service`，並讓橋接從 `~/.config/sleep-airline/device.json` 讀取旅客身分。安裝時會啟動裝置暫時 Wi-Fi；請在樹莓派桌面操作，避免 SSH 斷線。

配對服務回報未綁定時，全螢幕瀏覽器開啟本機 QR；已綁定且連網時，直接進入正式飛機窗；已綁定但斷網時，顯示本機離線頁。三個狀態都使用同一個 Chromium 畫面，不會另開感測器測試分頁。

裝置熱點沒有網際網路是正常的。手機先在原網路掃描 QR，取得授權後才切到裝置 Wi-Fi，開啟 `http://10.42.0.1:8766/setup` 輸入家中 Wi-Fi。送出後手機會離開裝置熱點，再回原網路查看綁定結果。熱點建立失敗或綁定卡住時，可在樹莓派終端機檢查：

```bash
curl -s localhost:8766/api/status
nmcli device status
nmcli networking connectivity
sudo journalctl -u sleep-airline-pairing -n 60 --no-pager
```

裝置身分檔保存在 `~/.config/sleep-airline/device.json`，家中 Wi-Fi 密碼由 NetworkManager 保存。請勿把身分檔、暫時熱點密碼或家中 Wi-Fi 密碼貼到 GitHub。


## 2026-11-06：航班狀態與旋鈕修正

- 旋鈕預設反轉：同時影響航向與心情讀值。沿用原方向可加 `--no-reverse`；不要同時對調外側接線並反轉軟體。
- 起飛中收到降落磁簧會忽略，不中斷也不排隊；起飛完成後須移開並重新靠近降落磁簧。
- 起飛完成會解除 busy，才能接受後續降落；起飛失敗或回應遺失時先查雲端，若已有航班就恢復飛行畫面，不重建航班。
- 已配對裝置開網頁時會同步雲端進行中的航班，解決「待機卻被告知尚未降落」的卡住狀況。
- 降落失敗會查詢同一 flightId 是否已落地；若雲端已完成，保留已抵達畫面。這不會取消、刪除或重寫既有航班。
- 起飛／降落錯誤會持續顯示在視窗中央，可關閉並在 Console 找到錯誤；確認航向也會在中央回饋。航向確認仍不是起飛必要條件。
- 開機連線失敗會顯示連線例外種類與原因，每 15 秒重試並保留配對。實際 Wi-Fi／DNS／TLS 問題仍須依訊息排查。

同學合併 PR 且 Vercel 部署完成後，網頁與 API 修正才會上線。這次也改了樹莓派橋接與離線診斷，因此在樹莓派更新安裝副本：

```bash
cd ~/SleepAirlineS3
git pull --ff-only
bash hardware/install-kiosk.sh
sudo systemctl restart sleep-airline-bridge.service sleep-airline-pairing.service
sudo reboot
```

已綁定裝置不用重新配對。不要刪除 `~/.config/sleep-airline/device.json`。

實機驗收：順時針轉旋鈕確認畫面同向；待機按 GPIO22 按鈕確認回饋；起飛途中觸發降落不可中斷，飛行中重新觸發才降落；重新開啟網頁應恢復雲端既有航班。首次起飛中斷的原始原因尚未取得，修正會恢復已建立的航班並保留後續錯誤供排查。
