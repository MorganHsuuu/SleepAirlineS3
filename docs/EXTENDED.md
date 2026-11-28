# Sleep Airline V3 / Extended

正式入口是 `/extended`。用原本的 GitHub 分支部署到同一個 Vercel 專案。個人頁沿用 V2 的日航與夜航色系、正射地球和玻璃面板，內建示範航點可直接操作。

## 個人旅程

使用旅客編號搭配 V3 的配對恢復碼登入。配對已有的旅客可沿用原本的身分，不需要 Redis。不曾配對的旅客需要 Extended 個別邀請碼。個人 API 路徑為 `/api/extended/personal`。

服務會讀取本人最近一筆完整降落。旅客可以把降落筆記存回同一張 Notion 航班頁。Extended 筆記使用頁面內名為「Sleep Airline · Extended 降落筆記」的引用區塊，避免內容進入會顯示原有 Immigration Note 的軌跡頁。沒有 Extended 筆記時，個人頁可讀取原 Immigration Note。更新筆記前會檢查頁面的版本內容，避免用過期內容覆蓋另一個視窗已經完成的編輯。

對話一輪輪保存在同一張航班頁。分身以本次筆記和同次航班的對話為主要記憶，沒有筆記時才找先前的筆記。生成照片使用該則文字已保存的場景。照片添入該航班頁，聊天介面可開啟原比例檢視。

## 既有伺服器設定

- Notion：沿用 `NOTION_API_KEY` 和 `NOTION_DASHBOARD_DB_ID`。配對驗證沿用 `NOTION_PAIRING_DB_ID` 和 `NOTION_PARENT_PAGE_ID`。
- 登入簽章：沿用 `PAIRING_SIGNING_SECRET`，或者使用專用的 `EXTENDED_SESSION_SECRET`。
- AI：沿用 `OPENAI_API_KEY` 或 `OPENAI_API`。選填 `EXTENDED_OPENAI_MODEL` 與 `EXTENDED_OPENAI_IMAGE_MODEL`。
- 非配對旅客：選填 `EXTENDED_MEMBERS_JSON`，其中每人有 `passengerId`、`alias` 和 `codeHash`。邀請碼以高熵亂數產生，伺服器只保留 SHA-256 雜湊。旅客編號本身不能登入。

瀏覽器的示範聊天保存在裝置內，與正式帳號的內容獨立。網站上的示範對話用伺服器即時生成，只送出相關前文和最新訊息。離線展示檔可以回看旅程，試聊請開正式網站。多人旅行群的規格仍在 [原始設計](Sleep-Airline-Parallel-Self-Framework.md)，本版網站只顯示個人旅程。

## 旅程時間軸

時間軸以旅客瀏覽器的日期分組，卡片另外顯示目的地當地的降落時間。航班從最新開始分批讀取。點開過去的航班只能查看原有照片、筆記和對話，回到最新旅程即可繼續聊天。

圖片優先使用 V3 Flight Log 的附件，較舊的照片則沿用原有降落風景查詢。沒有照片的航班仍保留日期與目的地。航班及照片查詢皆限定登入旅客的紀錄。
