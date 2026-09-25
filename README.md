# 甦醒航班 S3 · Window Edition

以 iPad mini 橫式畫面為主的舷窗體驗。這個版本沿用 SleepAirlineS2 的 Express 後端、城市資料、航向規則、機長廣播、音效引擎與降落風景圖 API，重新製作主要前端。

## 體驗流程

1. 拖動右側旋鈕，或用方向鍵選擇八方位航向。
2. 按「拉下窗簾・起飛」。機長廣播後，窗外進入雲層巡航。
3. 按「打開窗戶・降落」。先顯示出發地到目的地的地球儀飛行路線，機長在路線動畫期間廣播；接著循環播放雲層下降影片，等待抵達風景圖。
4. 圖片備妥後才播放著陸音效與最後的降落影片，再顯影抵達風景。生圖超時時會先顯示標示為示意的圖片，真實圖片晚到後自動替換。
5. 按「再飛一次」開始下一趟。

降落後可選填實際睡著的分鐘數與 1–5 分睡眠品質；窗簾關閉到打開的區間另記為 `Sleep Opportunity Minutes`，不當作客觀睡眠時長。

聲音開關可隨時切換。降落時會播放 S2 的隨機甦醒音景，廣播期間自動壓低，進場音效與音景交叉淡入淡出。

## 本機執行

```sh
npm ci
npm run dev
```

打開 http://localhost:3000。沒有設定 Notion 時，前端進入**體驗模式**，可直接走完互動流程，抵達風景為示意圖片。S3 的 `.env.local` 已填入獨立 Notion 頁面與資料庫 ID；將可存取這些資料庫的 `NOTION_API_KEY` 加入本機或部署環境，才會啟用即時紀錄。OpenAI 金鑰需另外設定，才會生成語音與降落圖。S3 保留原有 `/api/passenger`、`/api/flight/takeoff`、`/api/flight/progress`、`/api/flight/land`、`/api/scenery` 路徑，另有 `/api/flight/sleep-report` 寫入選填的自述睡眠資料。

## Notion 睡眠研究資料

S3 專用資料頁：[Sleep Airline S3 睡眠體驗研究](https://www.notion.so/3e5a7f1b413c80f592e8ce14af8c2ec0)。內有 [Sleep Sessions](https://www.notion.so/3e5a7f1b413c806ab922de8fac103782) 與 [Landing Scenery](https://www.notion.so/3e5a7f1b413c80ff9d88f9f3dc4d3474)。S2 原本兩個資料庫仍保留在上層；S3 程式會檢查新資料庫的名稱和父頁面，不接受 S2 資料庫 ID。

每趟航班以 `Flight ID` 建立一列，記錄乘客代碼與暱稱、Terminal、起飛和降落時間、裝置時區、出發與降落地點及座標、選擇方位、休息區間、飛行距離、機長廣播與研究同意時間。`Self-reported Sleep Minutes`、`Sleep Quality` 由使用者降落後選填；`Mood Before`、`Mood After` 欄位已預留，但目前介面不蒐集。請勿把休息區間解讀為實際睡眠，也不要由這些欄位推斷診斷。

啟用前需將 Notion Integration 連接到 S3 頁面與兩個資料庫，再設定 `NOTION_API_KEY`。目前未有可用金鑰，故本機仍為體驗模式。

## 驗證

```sh
npm run check:contract
npx tsc --noEmit
npm run build
```

主畫面在 `public/index.html`、`public/style.css`、`public/app.js`。兩張新製作的圖片放在 `public/images/`。後端與其他素材沿用 S2；請勿將含金鑰的 `.env.local` 提交到版本庫。
