# iPhone／Safari 降落體驗修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 iPhone 16 Pro 的窗框與飛行文字保持在安全區內、以生成雲層改善降落視覺，並徹底阻止 Safari 在第一次觸碰時循環播放 `captain.mp3`。

**Architecture:** 視窗版改以頂部錨定的內容流配置，飛行與抵達資訊使用對稱欄位維持文字中心線。Safari 只以無聲 WAV 預熱兩個媒體載體，正式廣播才把機長音效切成單次播放；語音播放期間把音樂底床壓至近乎靜音。降落雲霧使用一張透明生成素材與單一 transform 動畫。

**Tech Stack:** 原生 HTML／CSS／JavaScript、Web Audio API、HTMLAudioElement、Node.js assertion scripts、Cursor image generation

---

## 檔案分工

- `public/broadcast-audio.js`：Safari 媒體載體狀態與降落混音。
- `scripts/check-broadcast-audio-safari-state.mjs`：模擬 Safari 的音訊狀態回歸測試。
- `public/style.css`：手機窗框流式配置、文字中心線及低功耗雲層動畫。
- `public/index.html`：將 CSS 白霧節點替換成生成圖片。
- `public/images/landing-cloud-wisps.png`：透明背景的明亮側視白雲素材。
- `scripts/check-window-responsive.mjs`：多尺寸安全區與中心線靜態驗證。

### Task 1：阻止 Safari 手勢預熱循環 captain.mp3

**Files:**
- Modify: `scripts/check-broadcast-audio-safari-state.mjs:104-130`
- Modify: `public/broadcast-audio.js:319-402, 921-1055, 1513-1522`

- [ ] **Step 1：先改測試，要求兩個預熱載體都只能播放無聲 WAV**

將第一次 `primeFromUserGesture()` 後的斷言改為：

```js
assert.match(keepalive.src, /^data:audio\/wav;base64,/, 'keepalive must use silent WAV');
assert.match(captain.src, /^data:audio\/wav;base64,/, 'captain carrier must warm with silent WAV');
assert.notEqual(captain.src, 'media/captain.mp3', 'first touch must not start captain.mp3');
assert.equal(captain.loop, true, 'captain carrier may only loop the silent WAV');

const warmPlayCount = captain.playCount;
window.BroadcastAudio.primeFromUserGesture();
assert.match(captain.src, /^data:audio\/wav;base64,/);
assert.equal(captain.playCount, warmPlayCount, 'repeated gestures must not restart the carrier');
```

正式播放後增加：

```js
await window.BroadcastAudio.playCaptainIntro({ handoff: true });
assert.match(captain.src, /^data:audio\/wav;base64,/, 'captain must return to silent WAV');
assert.equal(captain.dataset.src, captain.src);
assert.equal(captain.loop, true, 'only the restored silent WAV may loop');
```

- [ ] **Step 2：執行測試並確認因現有預熱 captain.mp3 而失敗**

Run:

```bash
node scripts/check-broadcast-audio-safari-state.mjs
```

Expected: FAIL，訊息包含 `captain carrier must warm with silent WAV`。

- [ ] **Step 3：建立通用的無聲載體復原函式**

在 `public/broadcast-audio.js` 將復原邏輯集中為：

```js
function resetAudioCarrierToSilent(audio) {
  if (!audio) return;
  try { audio.pause(); } catch { /* noop */ }
  try { audio.currentTime = 0; } catch { /* 尚未可 seek */ }
  try {
    const played = tryPlayKeepAlive(audio, SILENT_KEEPALIVE);
    if (played && typeof played.catch === 'function') played.catch(() => {});
  } catch { /* keepalive is best effort */ }
}

function resetKeepAliveToSilent() {
  resetAudioCarrierToSilent(keepAliveAudio || document.getElementById('ceremony-keepalive'));
}

function resetCaptainCarrierToSilent() {
  resetAudioCarrierToSilent(captainGestureAudio || document.getElementById('ceremony-captain-gesture'));
}
```

- [ ] **Step 4：讓手勢預熱只啟動無聲 WAV**

在 `primeFromUserGesture()` 的 Safari 分支使用：

```js
const captain = ensureCaptainGestureElement();
if (!captain.paused && captain.dataset.src === SILENT_KEEPALIVE) {
  mediaUnlocked = true;
  return true;
}
try {
  const playPromise = tryPlayKeepAlive(captain, SILENT_KEEPALIVE);
  mediaUnlocked = true;
  if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
  return true;
} catch {
  return false;
}
```

不得在此函式設定 `CAPTAIN_SFX.url`。

- [ ] **Step 5：正式機長片段結束後恢復無聲載體**

`playTimedClip()` 的 Safari 路徑傳入 `restoreSilent: true`：

```js
const ok = await playOnGestureElement(ensureCaptainGestureElement(), url, {
  seconds,
  volume,
  restoreSilent: true,
});
```

`playOnGestureElement()` 結束時依收到的 audio 呼叫 `resetAudioCarrierToSilent(audio)`；`stopCaptainIntro()` 也改呼叫 `resetCaptainCarrierToSilent()`。

- [ ] **Step 6：前景恢復只允許無聲載體**

在 `resumeAudioOnForeground()` 補上：

```js
if (captainGestureAudio && currentAudio !== captainGestureAudio
    && captainGestureAudio.dataset.src !== SILENT_KEEPALIVE) {
  resetCaptainCarrierToSilent();
}
```

- [ ] **Step 7：執行回歸測試並提交**

Run:

```bash
node scripts/check-broadcast-audio-safari-state.mjs
node --check public/broadcast-audio.js
```

Expected: 兩項 PASS，且輸出 `✓ Safari keepalive stays silent`。

Commit:

```bash
git add public/broadcast-audio.js scripts/check-broadcast-audio-safari-state.mjs
git commit -m "修正 Safari 首次觸碰循環機長音效"
```

### Task 2：提高降落語音的相對響度

**Files:**
- Modify: `scripts/check-broadcast-audio-safari-state.mjs`
- Modify: `public/broadcast-audio.js:16-32, 769-784`

- [ ] **Step 1：先加入語音混音安全值測試**

讀取 `public/broadcast-audio.js` 的原始碼後加入：

```js
assert.match(source, /const SPEECH_BED_VOLUME = 0\.006;/);
assert.match(
  source,
  /muteCeremonyBedForSpeech\(\)[\s\S]*fadeLandingBedVolume\(SPEECH_BED_VOLUME, ms\)/,
  'speech must duck the landing bed to near silence',
);
assert.doesNotMatch(
  source,
  /muteCeremonyBedForSpeech\(\)[\s\S]{0,500}fadeLandingBedVolume\(0\.08, ms\)/,
);
assert.match(
  source,
  /const speechOpts = \{ volume: 1, tag: 'speech'/,
  'Web Audio speech gain must stay below clipping level',
);
```

- [ ] **Step 2：執行測試並確認目前 0.08 音量造成失敗**

Run:

```bash
node scripts/check-broadcast-audio-safari-state.mjs
```

Expected: FAIL，缺少 `SPEECH_BED_VOLUME`。

- [ ] **Step 3：加入近乎靜音的底床常數並套用**

在音訊常數區加入：

```js
const SPEECH_BED_VOLUME = 0.006;
```

將 `muteCeremonyBedForSpeech()` 內的：

```js
fadeLandingBedVolume(0.08, ms)
```

改成：

```js
fadeLandingBedVolume(SPEECH_BED_VOLUME, ms)
```

同時將 `playPreparedSpeech()` 的 Web Audio 設定改成：

```js
const speechOpts = { volume: 1, tag: 'speech', fadeInMs: 0, padSec: immediate ? 0 : 0.48 };
```

HTML Audio 與瀏覽器 TTS 也維持音量 `1`，以壓低音樂而非超額增益來提高相對響度。

- [ ] **Step 4：執行測試並提交**

Run:

```bash
node scripts/check-broadcast-audio-safari-state.mjs
node --check public/broadcast-audio.js
```

Expected: PASS。

Commit:

```bash
git add public/broadcast-audio.js scripts/check-broadcast-audio-safari-state.mjs
git commit -m "讓降落廣播清楚壓過音樂底床"
```

### Task 3：讓 iPhone 窗框靠上並固定文字中心線

**Files:**
- Modify: `scripts/check-window-responsive.mjs`
- Modify: `public/style.css:101-147`

- [ ] **Step 1：先加入 iPhone 16 Pro 與文字中心線規則測試**

將響應式測試加入 402 × 874，並要求新的頂部錨定與對稱欄：

```js
assert.match(
  css,
  /body\.window-only \.window-area\{[^}]*flex:0 0 auto;[^}]*justify-content:flex-start;[^}]*padding-top:clamp\(12px,2\.4svh,22px\)/,
);
assert.match(
  css,
  /\.leg-strip\.is-flying\{[^}]*width:76cqi;[^}]*grid-template-columns:clamp\(42px,12\.5cqi,52px\) minmax\(0,1fr\) clamp\(42px,12\.5cqi,52px\)/,
);
assert.match(
  css,
  /\.leg-strip\.is-landed\{[^}]*width:76cqi;[^}]*grid-template-columns:1fr minmax\(0,62cqi\) 1fr/,
);
```

尺寸清單加入：

```js
[402, 874],
```

並以 `topGap = Math.min(22, Math.max(12, height * 0.024))` 驗證窗框頂端在主內容安全區後 12–22px。

- [ ] **Step 2：執行測試並確認現有置中配置失敗**

Run:

```bash
node scripts/check-window-responsive.mjs
```

Expected: FAIL，指出 `.window-area` 尚未頂部錨定。

- [ ] **Step 3：讓窗框跟隨內容流靠上**

將視窗版區域改為：

```css
body.window-only .window-area{
  position:relative;
  z-index:1;
  width:100%;
  flex:0 0 auto;
  min-height:0;
  overflow:hidden;
  display:flex;
  align-items:center;
  justify-content:flex-start;
  padding-top:clamp(12px,2.4svh,22px);
  box-sizing:border-box;
}
```

保留既有窗框比例與寬度公式，使 320 × 568 仍可容納外部指南針。

- [ ] **Step 4：以對稱欄位固定飛行文字中心**

將飛行資訊外框改為三欄：

```css
.leg-strip.is-flying{
  z-index:5;
  width:76cqi;
  max-width:76%;
  grid-template-columns:clamp(42px,12.5cqi,52px) minmax(0,1fr) clamp(42px,12.5cqi,52px);
  column-gap:2.2cqi;
  justify-content:center;
  justify-items:start;
}
.leg-strip.is-flying .leg-mini-compass{grid-column:1;grid-row:1 / 3}
.leg-strip.is-flying .leg-heading-copy,
.leg-strip.is-flying .leg-origin-label{grid-column:2}
```

第三欄保留與指南針等寬空間，使第二欄中心精確對準玻璃中心。國旗維持絕對定位，不參與欄寬。

- [ ] **Step 5：讓抵達文字同樣以玻璃中心為基準**

使用對稱外欄：

```css
.leg-strip.is-landed{
  z-index:5;
  width:76cqi;
  max-width:76%;
  grid-template-columns:1fr minmax(0,62cqi) 1fr;
  justify-content:center;
}
.leg-strip.is-landed .leg-heading-copy,
.leg-strip.is-landed .leg-origin-label{grid-column:2}
.leg-strip.is-landed .leg-flag{
  grid-column:1;
  grid-row:1;
  justify-self:end;
  align-self:center;
}
```

目的地及 FROM 仍可省略，但左右至少保留 12% 玻璃邊界。

- [ ] **Step 6：執行測試並提交**

Run:

```bash
node scripts/check-window-responsive.mjs
git diff --check
```

Expected: PASS。

Commit:

```bash
git add public/style.css scripts/check-window-responsive.mjs
git commit -m "修正 iPhone 窗框位置與文字中心線"
```

### Task 4：用生成圖片取代 CSS 降落白霧

**Files:**
- Create: `public/images/landing-cloud-wisps.png`
- Modify: `public/index.html:52-56`
- Modify: `public/style.css:29-40`
- Modify: `scripts/check-window-responsive.mjs`

- [ ] **Step 1：先加入降落素材與低功耗動畫測試**

在 `scripts/check-window-responsive.mjs` 讀取 HTML 並加入：

```js
assert.match(
  html,
  /<img class="landing-cloud-wisps" src="images\/landing-cloud-wisps\.png" alt="">/,
);
assert.doesNotMatch(css, /\.landing-cloud-wisps\{[^}]*background:/);
assert.match(
  css,
  /\.landing-cloud-wisps\{[^}]*object-fit:contain;[^}]*will-change:transform,opacity/,
);
assert.match(
  css,
  /@media\(prefers-reduced-motion:reduce\)\{[^}]*\.landing-cloud-wisps\{display:none\}/,
);
```

- [ ] **Step 2：執行測試並確認目前 `<span>` 與 CSS 漸層失敗**

Run:

```bash
node scripts/check-window-responsive.mjs
```

Expected: FAIL，找不到 `landing-cloud-wisps.png` 圖片節點。

- [ ] **Step 3：生成透明降落雲層素材**

生成 1536 × 1024 PNG，使用下列提示：

```text
A broad photorealistic side-view bank of soft white cumulus clouds seen from an airplane during a bright clear daytime descent, sunlight illuminating the cloud tops, airy translucent feathered edges, layered depth and diagonal perspective from lower-left to upper-right, no land, no horizon, no aircraft, no text, isolated cloud mass on a fully transparent background, natural white and pale blue tones, cinematic but realistic.
```

輸出為 `public/images/landing-cloud-wisps.png`。檢查四邊透明且沒有白色矩形底。

- [ ] **Step 4：替換 DOM 與 CSS**

HTML 攫換為：

```html
<img class="landing-cloud-wisps" src="images/landing-cloud-wisps.png" alt="">
```

CSS 使用單一合成層：

```css
.landing-cloud-wisps{
  position:absolute;
  z-index:3;
  left:-72%;
  bottom:-28%;
  width:172%;
  height:128%;
  object-fit:contain;
  opacity:0;
  pointer-events:none;
  will-change:transform,opacity;
  filter:blur(1.5px);
}
.landing-cloud-scene.is-on .landing-cloud-wisps{
  animation:landing-wisps-pass 12.5s cubic-bezier(.3,.04,.22,1) 1s forwards;
}
@keyframes landing-wisps-pass{
  0%{transform:translate3d(0,18%,0) scale(.96);opacity:0}
  18%{opacity:.32}
  46%{opacity:.82}
  72%{opacity:.54}
  100%{transform:translate3d(92%,-34%,0) scale(1.12);opacity:0}
}
```

`.landing-cloud-scene` 保持在 `.window-glass` 內，沿用父層 `overflow:hidden` 與 `clip-path` 裁切。

- [ ] **Step 5：執行測試並提交**

Run:

```bash
node scripts/check-window-responsive.mjs
node --check public/app.js
git diff --check
```

Expected: PASS。

Commit:

```bash
git add public/images/landing-cloud-wisps.png public/index.html public/style.css scripts/check-window-responsive.mjs
git commit -m "改用生成雲層呈現明亮降落動態"
```

### Task 5：多尺寸與完整流程驗證

**Files:**
- Verify: `public/style.css`
- Verify: `public/index.html`
- Verify: `public/broadcast-audio.js`
- Verify: `scripts/check-window-responsive.mjs`
- Verify: `scripts/check-broadcast-audio-safari-state.mjs`

- [ ] **Step 1：執行所有自動檢查**

Run:

```bash
node scripts/check-window-responsive.mjs
node scripts/check-broadcast-audio-safari-state.mjs
node --import tsx scripts/check-morning-scene-variety.mjs
npx tsc --noEmit
node --check public/app.js
node --check public/broadcast-audio.js
npm run check:contract
git diff --check
```

Expected: 全部 exit 0。

- [ ] **Step 2：以瀏覽器檢查四種手機尺寸**

逐一設定：

```text
320 × 568
390 × 844
402 × 874
430 × 932
```

每一尺寸驗證：

- 窗框頂端位於 safe-area／topbar 下方 12–22px。
- 窗框與外部指南針完全在 viewport 內。
- 飛行及抵達文字中心與 `.window-glass` 中心誤差不超過 1px。
- 所有文字距玻璃左右邊界至少 12%。
- 降落雲層只在玻璃內，沒有白色矩形邊界，並由左下往右上掠過機翼。

- [ ] **Step 3：檢查 Safari 音訊狀態**

在 Safari 執行：

1. 第一次碰觸窗簾但不完成拖曳。
2. 停留至少 10 秒。
3. 重複碰觸兩次。
4. 切到背景再回前景。
5. 完成起飛與降落廣播。

Expected:

- 前四步完全聽不到 `captain.mp3`。
- 正式廣播前只播放一次 `captain.mp3`。
- 降落語音期間音樂近乎靜音，語音結束後才恢復低音量。

- [ ] **Step 4：檢查 lints、工作區及最後提交**

檢查所有修改檔案的 IDE diagnostics，排除 `.DS_Store` 與既有未追蹤 `public/images/icon-hero.png`。

Commit:

```bash
git add public/broadcast-audio.js public/index.html public/style.css \
  public/images/landing-cloud-wisps.png \
  scripts/check-broadcast-audio-safari-state.mjs scripts/check-window-responsive.mjs
git commit -m "完成 iPhone 與 Safari 降落體驗驗證"
```
