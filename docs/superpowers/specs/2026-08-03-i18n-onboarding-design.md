# Sleep Airline — 雙語介面與首次 Onboarding 設計

**日期：** 2026-08-03  
**脈絡：** 論文研究系統（非工作坊空殼）；UI／語音／分享支援中英；語言偏好不寫入研究資料庫。

---

## 1. 目標

1. 提供 **繁體中文（zh）** 與 **English（en）** 雙語體驗。
2. 登入頁與主畫面可切換語言；切換後 **UI 文案立刻更新**。
3. **機長廣播、瀏覽器／OpenAI 語音、分享文案／圖卡文字** 依產生當下的語言；切語言不回溯改舊內容。
4. **第一次成功登入後** 播放新手教學：航空敘事風短故事頁 → 主畫面輕量高亮導覽；可略過、可之後手動重看。
5. 語言與 onboarding 狀態只存 **localStorage**，**不記錄到 Notion／後端研究庫**。

---

## 2. 非目標

- 不新增 Notion 欄位、不改鎖定 schema／data-mode／flights 寫入契約。
- 不做獨立「語言閘門」全螢幕頁（語言切換在登入頁上方與主畫面角落）。
- 不引入重量級 i18n／tour 套件（採輕量自製）。
- 不將 `locale` 寫入 Flight Log 或其他研究彙整表。
- 不要求已產生的廣播音訊／舊分享圖自動重新生成。

---

## 3. 決策摘要

| 項目 | 決策 |
|------|------|
| 語言切換位置 | 登入頁上方 + 主畫面角落；無獨立閘門 |
| 切換效果 | UI 立刻換；廣播／分享僅影響之後新產生的 |
| Onboarding 結構 | 3 頁航空敘事短故事 + ~4 步高亮導覽 |
| 觸發時機 | 每位使用者第一次成功登入後一次 |
| 持久化 | `localStorage`；可手動重看（預設重播故事+高亮） |
| 研究資料 | 不記錄語言偏好 |
| 實作路線 | 輕量 `i18n.js` + 自製 `onboarding.js` |

---

## 4. 架構

```
[localStorage: locale, onboardingDone]
        │
        ▼
 public/i18n.js  ──setLocale──►  DOM data-i18n + app.js t()
        │
        ├──► takeoff/land API body（選填 locale，僅供 AI）
        │         └── broadcast.ts / speech fallback（zh-TW | en-US）
        │
        └──► share templates / share-card markup（產生當下語言）

登入成功 ──► onboarding.js
              ├── 故事遮罩（3 頁，可略過）
              └── 高亮導覽（4 步，可略過）
                    └── 標記 onboardingDone
```

### 4.1 語言層（`public/i18n.js`）

- Keys：`zh` | `en`（`document.documentElement.lang` 對應 `zh-TW` / `en`）。
- Storage key：`sleepAirline_locale`。
- API：`getLocale()`、`setLocale(locale)`、`t(key, vars?)`、`applyDomTranslations(root?)`。
- 靜態字串：HTML 元素加 `data-i18n="key"`；可選 `data-i18n-attr="placeholder"` 等。
- 動態字串：`app.js`（及必要時 `workshop-local.js`）改呼叫 `t()`。
- 預設：無儲存值時可依 `navigator.language` 猜一次，否則 `zh`；之後以使用者選擇為準。

### 4.2 後端 AI（最小侵入）

- 起飛／降落請求可帶選填 `locale: "zh" | "en"`（不進 Notion）。
- `src/lib/ai/broadcast.ts`：依 `locale` 切換 system／user prompt 語言與 fallback 模板。
- OpenAI TTS：仍跟輸入文字走；`public/broadcast-audio.js` fallback：`utter.lang` 與 voice 依 locale（`zh-TW` / `en-US`）。
- 社交提示／空域顯示名等使用者可見字串：能走前端字典者優先；若由後端回傳短文，一併依 `locale` 產出。

### 4.3 分享

- Terminal 邀請：`title` / `text` 用字典模板。
- 抵達分享卡：圖卡 DOM 文案與 `navigator.share`／clipboard 文字用產生當下 locale。
- URL query（`terminal`、`login` 等）維持既有契約，不因語言改變。

---

## 5. Onboarding UX

### 5.1 故事頁（航空敘事風）

- 全螢幕夜航氛圍；進度 `1/3`–`3/3`；「下一步」／「略過」。
- 文案雙語，與當下 locale 同步（導覽中途切語言則更新當頁文案）。
- 建議敘事弧（可實作時微調用字，結構固定為 3 頁）：
  1. 今夜起飛／睡眠航班設定  
  2. 選航向 → 入睡 → 醒來降落  
  3. 看板與回憶：和隊友交會、留下夜航紀錄  

### 5.2 高亮導覽（約 4 步）

1. 地球／航向選擇  
2. 起飛按鈕  
3. 小隊看板  
4. 降落相關區域  

每步：半透明遮罩、目標高亮、說明氣泡、「下一步」／「略過」。

### 5.3 觸發與重看

- 觸發：`doLogin` 成功且尚未完成 onboarding（建議 key：`sleepAirline_onboardingDone_v1`；可選擇與 passengerId 綁定，避免共用裝置互相蓋掉——**採綁定 passengerId**：`sleepAirline_onboardingDone_v1::{passengerId}`）。
- 「略過」或走完最後一步 → 標記完成。
- 主畫面入口「重看導覽」：預設重播 **故事 + 高亮**。
- Demo／未登入預覽：不強制 onboarding（僅真實登入成功後）。

---

## 6. UI 放置

- **登入頁**：標題列附近的 **中文 | EN** 切換（分段控制或文字切換，避免與現有金色 CTA 搶焦點）。
- **主畫面**：不干擾飛行操作的角落控制（與現有導覽／設定類入口並列若有）。
- **重看導覽**：主畫面次要操作（選單或文字連結），非主 CTA。

視覺延續現有夜航／玻璃質感；不另開一套設計系統。

---

## 7. 檔案影響

| 檔案 | 變更 |
|------|------|
| `public/i18n.js` | **新增** 字典與 locale API |
| `public/onboarding.js` | **新增** 故事 + 高亮 |
| `public/index.html` | `data-i18n`、語言切換、onboarding 容器、script 引入 |
| `public/style.css` | 語言切換、故事頁、高亮導覽樣式 |
| `public/app.js` | 接 locale、動態字串、登入後觸發 onboarding、分享模板 |
| `public/broadcast-audio.js` | TTS fallback 語言／voice |
| `public/workshop-local.js` | 本機 fallback 廣播／提示字串雙語（若仍使用） |
| `src/lib/ai/broadcast.ts` | 依 locale 產文 |
| `src/lib/ai/speech.ts` | 僅在有明確英文 voice 需求時微調（可選） |
| Notion／`server.ts`／data-mode | **不改**（API 可透傳選填 `locale` 至 AI 層，但不寫庫） |

實作後執行 `npm run check:contract`，確保表單 id／API／函式名不變。

---

## 8. 錯誤處理與邊界

- 缺翻譯 key：fallback 到 zh（或 key 本身），避免空白。
- TTS 失敗：既有瀏覽器 fallback，語言與 locale 一致。
- 無 OpenAI：模板廣播依 locale。
- 導覽目標 DOM 缺失（例如面板隱藏）：跳過該步或結束導覽並標記完成，不卡住流程。
- 登出再登入：若該 `passengerId` 已完成則不再自動播；可手動重看。

---

## 9. 驗收標準

1. 登入頁切換 zh↔en，可見文案（含 placeholder）立刻更新。  
2. 主畫面切換同上；起飛後新廣播語言正確；舊廣播文字／音訊不強制重產。  
3. 英文模式下分享邀請與抵達卡為英文。  
4. 新 passenger 首次登入自動進入故事→高亮；略過或完成後不再自動出現。  
5. 「重看導覽」可再次完整播放。  
6. `npm run check:contract` 通過；Notion 無新語言欄位。  
7. 桌面與手機皆可完成切語言與導覽（導覽氣泡不溢出螢幕）。

---

## 10. 測試計畫（實作後）

- 手動：首次登入 onboarding；第二次登入不自動播；重看入口。  
- 手動：zh／en 切換 UI、起飛廣播、降落廣播、分享。  
- 手動：無 API key 時模板廣播語言。  
- 契約：`npm run check:contract`。
