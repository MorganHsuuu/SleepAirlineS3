# 甦醒航班 · 出發體驗改版設計（Daybreak Glass）

日期：2026-07-02 · 狀態：已由 Morgan 於互動 demo 逐項批准

## 目標

把工作坊版的表單式 UI，改成沉浸式的「出發儀式」：地球為主角、玻璃面板浮在其上，
明亮、有期待感、航空公司的純粹感。**不動任何後端與資料契約。**

## 視覺語言

- **破曉天光**：白天（05–17 時）活潑明亮的晨藍→暖桃漸層；晚上（17–05 時）沉穩的靛藍→暮紫→琥珀地平線。依本地時間自動切換，topbar 可手動切換。
- **液態玻璃面板**（iOS 26 感）：半透明、backdrop-blur、亮邊、頂部高光弧。
- 金色 = 啟程（起飛鈕）、青綠 = 甦醒（降落鈕）。

## 佈局（響應式）

- 地球儀 = 全畫面背景（D3 orthographic + world-atlas Natural Earth，免 API key，CDN 失敗時優雅退化為漸層天空）。
- 手機：上 topbar／中 dock 面板／下小隊看板抽屜。桌面（≥900px）：看板移到右側欄，面板置中欄。
- 地球手勢：拖曳旋轉、滾輪/雙指縮放、雙擊回正。縮放錨點自適應（縮小自動回畫面正中，修正偏移 bug）。

## 互動流程

1. **登入**：玻璃卡浮在地球上（保留契約 id 與 UI 示範按鈕）。
2. **出發（ready）**：出發地 + 「航向」chip → 開啟**羅盤 sheet**（古典航海羅盤：拖針、點八方位、⚓ 讓命運決定、自動）。確認後同步到隱藏的 `#tk-direction`。液態玻璃**起飛鈕**浮在球上。
3. **起飛過場**：雲層上升動畫 → 鏡頭滑向出發點 → 廣播音波。
4. **飛行中**：只顯示**已飛時長**（每秒跳）與**累積距離**（12 km/分，與後端一致）。無進度條、無空域。地球上：有方向→航向線 + 飛機沿方位外推；auto→擴大的「可能圈」。**降落鈕**（青綠玻璃）。
5. **降落**：飛機沿弧線滑至真實落點 → 抵達面板（ARRIVED 印章動畫）→ 機長廣播（音波 + 文字）→ 風景圖**顯影動畫**（模糊→清晰）。
6. **機票收藏冊**：每次降落存 localStorage 票根（航線代碼、時長、距離、日期、印章），topbar 🎫 開啟票夾 sheet。不動 Notion。

## 契約（全數保留）

- id：login-form/input-pid/input-name/input-group/btn-login/tk-direction/btn-takeoff/btn-land/login-section/main-section（+ 顯示用 id 盡量沿用）。
- 函式：doLogin/doTakeoff/doLand/fetchBoard/refreshProgress；API 路徑與 body 欄位不變。
- workshop-local.js / broadcast-audio.js 介面不變；`npm run check:contract` 須通過。

## 不做（此版）

- 呼叫朋友／約定會合（下一子專案）
- 生圖/廣播的在地文化內容（子專案「在地靈魂」）
- 後端任何修改
