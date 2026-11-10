# 多組 Wi-Fi 與教室配網

## 使用方式

- 未綁定裝置開機先嘗試已儲存網路；有連線時顯示「一般 Wi-Fi 傳送」QR。
- 手機與裝置連上相同 Wi-Fi（例如 `T2-308教室`），掃碼後依 APP 建立旅客／取得授權，前往裝置本機頁。預設只儲存家中網路，不離開教室 Wi-Fi；用教室連線完成旅客綁定。
- 配對畫面兩個按鈕可以切換「一般 Wi-Fi 傳送」和「裝置暫時熱點傳送」。切換後重新掃描 QR。Wi-Fi 若禁止同網路裝置互連，使用暫時熱點方式。
- 本機頁一次可新增 1–10 組網路；多次新增不會刪除其他既存設定。相同 SSID 的應用程式管理設定會更新，不會重複建立。
- 在一般 Wi-Fi 模式預設只儲存，亦可勾選立即嘗試連線；暫時熱點模式必須立即連上一組可用網路後才能完成。
- 儲存並不代表驗證成功：不在附近的家中網路會於之後開機嘗試。支援 WPA/WPA2 個人密碼及開放網路；企業登入、網頁登入及純 WPA3 網路需另外設定。

## 開機順序與斷網

1. 嘗試其他已存 Wi-Fi（依 NetworkManager 優先級）。
2. 全部失敗後才嘗試教室網路。`T2-308教室`／`t2308` 為備援，舊設定的高優先級也會降至 `-999`；可用 `--fallback-ssid` 指定其他教室名稱。
3. 所有網路都失敗，開啟暫時熱點與網路設定 QR。已綁定裝置保留 Device ID、deviceSecret、Passenger ID、旅客名字；不重新建立旅客或呼叫綁定完成 API。
4. 已綁定裝置：手機先加入螢幕上的暫時 Wi-Fi，再用手機內建相機掃 QR，即可開啟本機網路設定；不需要 APP 登入或網際網路。
5. 設定成功後回到主畫面。連上 Wi-Fi 但雲端暫時異常時保留綁定並顯示離線重試；離線頁亦可點「設定 Wi-Fi」。

執行中的裝置斷 Wi-Fi 後也會重新嘗試已存網路。進入網路設定後不會反覆切走熱點，讓手機能完成輸入。

## 密碼與資料

家中密碼只由手機送至裝置本機頁，交給 NetworkManager 儲存；不經 Notion／Vercel、不寫入 `device.json`、不記錄至日誌。一般 Wi-Fi 模式使用區網 HTTP，限可信任網路；同網路互連受限時改用裝置有密碼的暫時熱點。QR 的設定授權位於 URL fragment，15 分鐘有效。逾期只更新授權，不更換正使用中的熱點密碼。已儲存網路的密碼不會回傳至設定頁。

## 更新

先合併本 PR、完成裝置端 Vercel 部署，並更新手機 APP。APP 支援舊熱點 QR，建議先更新 APP，再更新 Pi：

```bash
cd ~/SleepAirlineS3
git pull --ff-only
bash hardware/install-kiosk.sh
bash hardware/install-pairing-service.sh
sudo systemctl enable --now sleep-airline-bridge.service sleep-airline-pairing.service
sudo systemctl restart sleep-airline-bridge.service sleep-airline-pairing.service
sudo reboot
```

若之前使用臨時測試模式，以上會重新啟用正式配對服務。不要刪除 `~/.config/sleep-airline/device.json` 或 NetworkManager 連線資料。

## 實機驗收

- 教室 Wi-Fi：未綁定開機 → 一般 Wi-Fi QR → 手機在同網路 → 儲存兩組不在附近的家中 Wi-Fi → 完成綁定，仍連教室網路。
- 在同時存在其他已存網路與教室網路的地方重開機：優先連其他網路；其他皆不可用才連教室。
- 全部已存網路不可用：已綁定裝置應顯示網路修復 QR；手機加入熱點、掃碼、輸入正確網路後回主畫面，旅客不變。
- 錯誤密碼：失敗後回到同一熱點；原設定頁能修改重送，不能永久停用按鈕。15 分鐘過期後重新掃碼。
- 關閉 WAN 但保留 Wi-Fi：顯示雲端連線問題，不清除綁定。
- 切換一般 Wi-Fi／暫時熱點後，兩邊 QR、步驟與網路名稱應一致。

自動測試使用模擬 NetworkManager，不能取代實體 Pi、教室網路隔離規則、手機切網與重開機測試。
