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
- 起飛／降落錯誤以中下方低透明度文字顯示，詳細錯誤可在 Console 找到；確認航向也會以相同位置回饋。航向確認仍不是起飛必要條件。
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

## 長時間停留在磁簧端點

磁鐵可以持續停在任一端，不必維持離開。兩個磁簧的整組狀態須穩定 150 ms 才更新；停在同一端、離開成為中間空檔、再回到同一端，都不會重新觸發。必須實際到另一端並穩定感應，才重新允許下一個端點事件。起飛／降落磁簧各用 GPIO17／27，按鈕仍為 GPIO22。

網頁也有交替端點判定。兩個磁簧同時感應、重連或開機時已放著的磁鐵都不啟動航程。起飛中到達降落端不會中斷或排隊降落；請等起飛完成後，先回到起飛端，再移至降落端。降落途中提早回起飛端同樣不會排隊自動起飛。確認按鈕與旋鈕不受端點鎖影響。

另防止開機雲端查詢延遲回覆覆蓋剛完成的降落。若仍出現舊航班提示，需核對雲端是否留有先前測試或重複網頁建立的進行中紀錄；磁簧防抖不會刪除既有研究資料。

更新方式仍為合併與部署後，在樹莓派 `~/SleepAirlineS3` 執行 `git pull --ff-only`、`bash hardware/install-kiosk.sh`，然後 `sudo systemctl restart sleep-airline-bridge.service` 並重新整理網頁（或重開機）。必須更新安裝副本，僅部署 Vercel 無法套用樹莓派的 150 ms 濾波。

## 隱藏維護入口與低干擾提示

- 飛機窗、首次配對頁與離線頁都可用：畫面右下內側（距右邊約 18%、距底部 12%）有透明的 48px 觸控區，持續按住 4 秒開啟樹莓派桌面的終端機。滑走或提早放開會取消。一般點擊不會開啟。
- 已連上鍵盤時可按 `Ctrl + Alt + M` 開啟同一入口。關閉終端機視窗會回到原飛機窗；此入口不會關閉感測器。
- 終端機由本機 8766 配對服務開啟，固定啟動目前使用者的終端機，不執行網頁傳入的命令。需已登入 Raspberry Pi OS 圖形桌面；優先使用 lxterminal，缺少時請 `sudo apt install lxterminal`。本機路由只接受 loopback 來源與指定網頁 Origin，LAN／手機不能透過此路由開啟終端機。
- 飛機窗的錯誤／狀態提示改為中下方、約 24% 不透明度的小字，沒有底色、邊框或彈窗；白色差值混色會隨背景呈現黑白。詳細錯誤仍保留在瀏覽器 Console。隱藏操作是方便維護，不是身分驗證或權限提升。
- 藍牙鍵盤第一次仍需在樹莓派端完成配對／確認，可先用現有輸入設備或 SSH 操作；之後即可在藍牙範圍內用鍵盤輸入與維護，無須碰到主板。鍵盤不會把樹莓派畫面傳到另一台電腦。

套用本次維護功能：PR 合併與 Vercel 部署後，在 `~/SleepAirlineS3` 執行 `git pull --ff-only`、`bash hardware/install-kiosk.sh`，然後 `sudo systemctl restart sleep-airline-bridge.service sleep-airline-pairing.service`，重新整理網頁或重開機。務必重啟配對服務，新的維護 API 與離線頁入口才會載入。

## 防止重複視窗／廣播

`kiosk.sh` 現在以 `/run/user/<uid>/sleep-airline-kiosk.lock` 作為共同程序鎖；桌面自動啟動、labwc 和手動重複呼叫時只保留一個啟動程序。從 SSH 啟動也會在背景保留同一把鎖。使用獨立的 `~/.cache/sleep-airline-chrome` kiosk profile，避免被一般 Chromium 視窗接收啟動請求後提前釋放鎖。關閉 Chromium 後自動釋放，無須刪除鎖檔；系統需有 util-linux 的 `flock`（Raspberry Pi OS 一般已有）。

網頁另以同來源／同瀏覽器使用者資料的 Web Locks 限制裝置頁所有權：只有一頁會初始化航班控制、接收磁簧及播放廣播，其他重複頁等待；原頁關閉後才接手。普通手機／電腦訪客不受限制。不支援 Web Locks 的舊瀏覽器沿用原行為，因此 Pi 應使用既有新版 Chromium。同一台若刻意用不同瀏覽器或不同 profile 手動開啟裝置頁，不在跨分頁鎖的範圍內。

先前關閉所有 Chromium 再只開一個視窗後，回音消失，支持重複頁面播放的判斷；尚未取得實機程序清單，無法宣稱已證實唯一原因。此修正保留正常的背景音樂、機長廣播與音效轉場。

合併與部署後，在 Pi 執行 `git pull --ff-only`、`bash hardware/install-kiosk.sh`，再重開機，才會套用新的本機啟動鎖。驗收時連續啟動 kiosk.sh 兩次應只有一個飛機窗；同一瀏覽器另開第二個 `?kiosk=1` 頁面，應只由原頁回應磁簧與播放廣播。


## 配對頁避開上方實體窗簾

裝置 QR 配對頁整組內容（品牌、標題、QR、步驟與裝置資訊）向下增加 14% 螢幕高度的留白，底部保留 12% 空間，避免上方被窗簾遮住。只調整裝置配對頁，不更動手機 Wi-Fi 設定頁或飛機窗。此頁由 Pi 的 device_kiosk.py 產生，更新後需重啟 sleep-airline-pairing.service 並重新整理畫面，單獨部署 Vercel 不會更新此頁。
