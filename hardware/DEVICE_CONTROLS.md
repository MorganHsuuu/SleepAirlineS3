# 樹莓派：兩個磁簧與方位旋鈕

本版透過樹莓派上的 `device_bridge.py`，讓同一台樹莓派的瀏覽器讀取元件狀態，再呼叫網頁原有的起飛、降落與方位功能。支援正式網址的全螢幕頁面，以及 `/classic/`。

## 接線（接線前先關機）

| 元件 | 接線 | Raspberry Pi 實體腳位 |
| --- | --- | --- |
| 起飛磁簧 | 一端 BCM GPIO17，另一端 GND | Pin 11、Pin 6 或其他 GND |
| 降落磁簧 | 一端 BCM GPIO27，另一端 GND | Pin 13、共用 GND |
| ADS1115 VDD | 3.3V | Pin 1 |
| ADS1115 GND | GND | Pin 6 或其他 GND |
| ADS1115 SDA | BCM GPIO2 / SDA | Pin 3 |
| ADS1115 SCL | BCM GPIO3 / SCL | Pin 5 |
| ADS1115 ADDR | GND，I2C 位址為 `0x48` | 共用 GND |
| ADS1115 ALRT | 不接 | — |
| 可變電阻兩個外側腳 | 一端 3.3V，另一端 GND | 共用電源與 GND |
| 可變電阻中間腳 | ADS1115 A0 | — |

磁簧為兩線、常開型，使用內建 pull-up。GPIO 與這組旋鈕電路使用 3.3V，不接 5V。

## 第一次安裝

在樹莓派執行：

```bash
sudo apt update
sudo apt install python3-gpiozero python3-smbus i2c-tools
sudo raspi-config
```

選 **Interface Options → I2C → Enable**。依畫面提示重新啟動後，檢查：

```bash
i2cdetect -y 1
```

應在表格中看到 `48`。沒有時，先確認 ADS1115 的供電、SDA、SCL、ADDR 接線。

## 啟動與操作

1. 若原本正在執行 `reed_test.py` 或 `reed_bridge.py`，在它的終端機按 Ctrl+C 停止，以釋放 GPIO17 和連接埠 8765。
2. 在此專案根目錄執行：

   ```bash
   python3 hardware/device_bridge.py
   ```

   若使用原本的 [磁簧測試 repo](https://github.com/yuhsiangc0620/raspberry-pi-reed-sensor-test)，先 `git pull`，再執行根目錄的 `python3 device_bridge.py`。兩份啟動方式擇一，程式內容相同。

3. 保持終端機開啟，在**同一台樹莓派**的 Chromium 開 [全螢幕裝置頁](https://sleep-airline-s3.vercel.app/?device=1)。允許網頁存取本機裝置；先點一下畫面啟用聲音。舊版外觀可使用 [classic 裝置頁](https://sleep-airline-s3.vercel.app/classic/?device=1)。
4. 看到「裝置控制已連線」後，移開兩個磁鐵。轉動旋鈕會在窗內顯示方位：北 → 東北 → 東 → 東南 → 南 → 西南 → 西 → 西北。
5. 磁鐵靠近 **GPIO17 起飛磁簧**：以目前方位起飛。移開它不會觸發降落。
6. 磁鐵靠近 **GPIO27 降落磁簧**：降落。如果起飛動畫仍在進行，這次降落要求會等待到巡航後執行。
7. 降落與原有心情回報流程結束後，可以轉動旋鈕選下一趟方位，再移開、重新靠近起飛磁簧。

開網頁或斷線重連時，只記住磁簧目前狀態，不會因磁鐵已靠近就自動起飛／降落。每次動作需重新靠近；兩個磁簧同時觸發會忽略該次操作。起飛、巡航、降落動畫和心情回報期間，實體旋鈕不更改航向；它不填寫心情資料。

一次只開一個啟用裝置控制的網頁分頁，避免同一組元件驅動多個航班。未加 `?device=1` 的頁面不會讀取這三個元件。全螢幕頁原有的 `?reed=1` 仍搭配舊版單磁簧程式；這組新接線請改用 `?device=1`。

## 排查與調整

- 瀏覽器顯示未連線：確認執行的是 `device_bridge.py`、網址包含 `?device=1`，並允許網站存取本機裝置。
- 先在樹莓派瀏覽器打開 `http://127.0.0.1:8765/state`。旋鈕會改變 `voltage` 和 `direction`；磁簧靠近會增加 `takeoffCount` 或 `landCount`。這個網址只供查看讀值，測試後回到 Vercel 分頁。
- 出現 `Address already in use`：先停止舊的 bridge 程式。
- 旋鈕反向：使用 `python3 hardware/device_bridge.py --reverse`（磁簧 repo 則去掉 `hardware/`）。
- 旋鈕無法到最左／右方位：查看兩端實際電壓，再指定例如 `--min-voltage 0.05 --max-voltage 3.25`。
- ADC 暫時斷線：網頁顯示提示並保留原方位，磁簧仍可運作；程式會自動重試 ADC。尚未開放／不支援本機裝置存取的瀏覽器，需要換用支援的 Chromium 並允許權限。

## 維護者資訊

- 合併 PR 後，確認 Vercel 正式部署已包含 `public/device-controls.js` 和兩個頁面的載入修改。
- 前端共享控制器僅負責把硬體事件送進既有 `setDirection`、`doTakeoff`、`doLand` 流程，不更動後端 API、Notion schema 或全螢幕樣式。
- 連接程式僅監聽 `127.0.0.1:8765`，不需在 Vercel 設定新的 API key、環境變數或資料庫。CORS 限定正式網站；預覽網址須明確指定 `--origin https://你的預覽網域`。
- `/state` protocol v2：`session` 是每次 Python 啟動的新識別碼；`takeoffCount`、`landCount` 是靠近次數，因此短暫靠近後移開也能被輪詢讀到；`direction` 為 0–7，ADC 異常時為 `null`。重連時丟棄離線期間的動作。
- 方位輸入使用平滑與遲滯，降低方位邊界抖動。ADS1115 A0 使用 ±4.096V 量程、128 SPS、單次轉換；[TI 資料表](https://www.ti.com/lit/ds/symlink/ads1115.pdf)說明暫存器設定。
- 本機程式測試（模擬輸入，不代表實際硬體驗收）：

  ```bash
  node --test tests/device-controls.test.cjs
  PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_device_bridge.py'
  npm run check:contract
  npm run build
  ```

最後請在實際樹莓派確認 ADC、GPIO、瀏覽器權限與音效播放。
