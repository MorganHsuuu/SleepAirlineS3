# S3 Notion 連線與資料定義

S3 在原本 `Sleep Airline` 頁面下有獨立的 [睡眠體驗研究頁](https://www.notion.so/3e5a7f1b413c80f592e8ce14af8c2ec0)。這個頁面作為 Notion 的資料夾；原 S2 Flight Log 與 Landing Scenery 不需修改。

| 用途 | 環境變數 | ID |
|---|---|---|
| S3 父頁面 | `NOTION_PARENT_PAGE_ID` | `3e5a7f1b413c80f592e8ce14af8c2ec0` |
| 睡眠／航班紀錄 | `NOTION_DASHBOARD_DB_ID` | `3e5a7f1b413c806ab922de8fac103782` |
| 降落風景圖片 | `NOTION_LANDSCAPE_DB_ID` | `3e5a7f1b413c80ff9d88f9f3dc4d3474` |

加上可存取上述三個頁面的 `NOTION_API_KEY` 後，S3 才進入即時資料模式。請將 Integration 連接到 S3 頁面與兩個資料庫；S3 會核對資料庫名稱與父頁面，不會把資料寫進 S2。

## 自動紀錄

- `Flight ID`、`Passenger ID`、`Name`（應使用暱稱）、`Group ID`、`Status`
- `Takeoff Time`、`Landing Time`：按鈕觸發當下的伺服器時間戳記
- `Sleep Opportunity Minutes`：兩個觸發時間的差，保留兩位小數；它是休息機會，不是客觀睡眠
- `Flight Duration Minutes`：S2 飛行敘事使用的整數分鐘，至少 1 分鐘
- `Departure Location`、`Arrival Location`、座標、`Route Direction`、`Estimated Flight Distance KM`
- `Client Time Zone`、`Research consent`、`Consent time`
- 機長廣播與社交提示欄位，維持 S2 的敘事資料流程

## 選填與預留

降落後的睡眠回報會填入 `Self-reported Sleep Minutes` 與 `Sleep Quality`（1–5）。`Mood Before`、`Mood After` 已預留，但目前介面不蒐集；加入心情量表前應先決定研究題目與同意內容。資料庫不儲存「憂鬱症診斷」推論。

Notion Integration Token 不得放進 Git；在本機 `.env.local` 或部署環境變數中設定。驗證可執行 `npm run notion:verify` 與 `GET /api/notion/schema`，再用測試代碼完成起飛、降落、睡眠回報，確認 S3 Sleep Sessions 出現一列，且 S2 Flight Log 沒有新增列。
