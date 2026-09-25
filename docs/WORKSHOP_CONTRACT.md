# S3 與 S2 的資料契約

S3 舷窗介面沿用 S2 的後端。資料欄位與 API 以 `server.ts` 和 `workshop/contract.json` 的實際程式為準。

| 動作 | API | 主要欄位 |
| --- | --- | --- |
| 登機 | `POST /api/passenger` | `passengerId`, `name`, `groupId`, `researchConsent` |
| 起飛 | `POST /api/flight/takeoff` | `passengerId`, `name`, `groupId`, `routeDirection`, `researchConsent` |
| 進度 | `GET /api/flight/progress` | `passengerId` |
| 看板 | `GET /api/board` | `groupId` |
| 降落 | `POST /api/flight/land` | `passengerId`, `name`, `groupId` |
| 選填睡眠回報 | `POST /api/flight/sleep-report` | `passengerId`, `flightId`, `selfReportedSleepMinutes`, `sleepQuality` |
| 抵達圖片 | `GET /api/scenery` | `flightId` |

`groupId` 為四位數 Terminal 航站代碼，例如 `0002`。方向值為 `northbound`、`northeast`、`eastbound`、`southeast`、`southbound`、`southwest`、`westbound`、`northwest`。後端也接受 S2 其他方向值。

使用者未設定 Notion 時，S3 直接提供本機體驗模式，不會寫入研究資料庫。連線模式會顯示研究資料同意欄位，未同意不得登機。S3 的 Notion 資料庫與 S2 分開；`Takeoff Time` 和 `Landing Time` 是窗簾按鈕的觸發時間，`Sleep Opportunity Minutes` 由這兩者計算，實際睡眠僅在使用者選填後寫入 `Self-reported Sleep Minutes`。執行 `npm run check:contract` 可檢查函式、API 路徑與 DOM ID。
