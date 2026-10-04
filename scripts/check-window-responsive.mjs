import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const classicCss = await readFile(new URL('../public/classic/style.css', import.meta.url), 'utf8');
const classicHtml = await readFile(new URL('../public/classic/index.html', import.meta.url), 'utf8');
const classicJs = await readFile(new URL('../public/classic/app.js', import.meta.url), 'utf8');

const requiredRules = [
  [
    '直式窗戶畫面佔滿實際可視範圍',
    /body\.window-only \.window-area\{[^}]*position:fixed;[^}]*width:var\(--view-w,100%\);height:var\(--view-h,100%\)/,
  ],
  [
    '滿版根節點改用動態可視高度',
    /html:has\(body\.window-only\),body\.window-only\{[^}]*height:100dvh/,
  ],
  [
    '窗框與玻璃取消橢圓外框並改滿版',
    /body\.window-only \.window-frame,body\.window-only \.window-rim,body\.window-only \.window-glass\{[^}]*width:100%;height:100%;[^}]*border-radius:0;padding:0/,
  ],
  [
    '滿版玻璃取消橢圓裁切',
    /body\.window-only \.window-glass\{clip-path:none;border-radius:0/,
  ],
  [
    '外框與旋鈕從直式畫面隱藏',
    /body\.window-only \.story,body\.window-only \.footer,body\.window-only \.window-index,body\.window-only \.controls,body\.window-only \.window-backdrop,body\.window-only \.frame-screw,body\.window-only \.window-reflection\{display:none\}/,
  ],
  [
    'FROM 標籤有可讀的最小字級',
    /\.leg-origin-label\{[^}]*font-size:clamp\(9px,2\.15cqi,14px\)/,
  ],
  [
    '出發地名稱有可讀的最小字級',
    /\.leg-place\.from\{[^}]*font-size:clamp\(10px,2\.75cqi,16px\)/,
  ],
  [
    '飛行資訊以置中直向堆疊排在窗戶中下',
    /body\.window-only \.leg-strip\.is-flying,body\.window-only \.leg-strip\.is-landed\{width:max-content;max-width:min\(78cqi,72%\)\}/,
  ],
  [
    '飛行中顯示指南針',
    /\.leg-strip\.is-flying \.leg-mini-compass\{display:block\}/,
  ],
  [
    '飛行中的 FROM 置中並可省略',
    /\.leg-strip\.is-flying \.leg-origin-label\{[^}]*text-align:center/,
  ],
  [
    '飛行方向文字置中',
    /\.leg-strip\.is-flying \.leg-heading-copy\{[^}]*justify-content:center/,
  ],
  [
    '降落後的 FROM 置中並可省略',
    /\.leg-strip\.is-landed \.leg-origin-label\{[^}]*text-align:center/,
  ],
  [
    '抵達目的地文字置中',
    /\.leg-strip\.is-landed \.leg-heading-copy\{[^}]*justify-content:center/,
  ],
  [
    '滿版飛行文字放大到直式可讀',
    /body\.window-only \.leg-place\.to\{font-size:clamp\(18px,min\(5\.2cqh,8\.4cqi\),96px\)\}/,
  ],
  [
    '滿版航線距離字級放大',
    /body\.window-only \.glass-copy \.glass-time\{font-size:clamp\(28px,min\(8\.4cqh,14cqi\),140px\)\}/,
  ],
  ['時間看板標籤有最小字級', /\.glass-copy \.glass-kicker\{font-size:clamp\(9px,2\.7cqi,14px\)/],
  ['時間看板時間有安全字級', /\.glass-copy \.glass-time\{font-size:clamp\(32px,11cqi,62px\)/],
  ['時間看板資訊有最小字級', /\.glass-copy \.glass-meta\{font-size:clamp\(11px,3\.5cqi,18px\)/],
  ['航線端點文字有最小字級', /\.glass-board \.glass-pin\{[^}]*font-size:clamp\(11px,3\.5cqi,18px\)/],
  ['窗內指南針文字群保留底部安全區', /\.glass-compass>\.glass-kicker\{margin-top:6cqh\}/],
];

for (const [message, pattern] of requiredRules) {
  assert.match(css, pattern, message);
}

assert.doesNotMatch(
  css,
  /body\.window-only \.window-frame\{[^}]*aspect-ratio:388 \/ 458/,
  '直式滿版不應再鎖橢圓窗框比例',
);
assert.doesNotMatch(
  css,
  /body\.window-only \.window-area\{[^}]*width:100vw/,
  '滿版窗戶不應用 100vw，避免超出可視範圍',
);
assert.match(
  js,
  /root\.style\.setProperty\('--view-w'/,
  '應把實際可視寬度寫進 --view-w',
);
assert.match(
  js,
  /window\.visualViewport\?\.addEventListener\('resize', syncViewportSize\)/,
  '畫面尺寸改變時應重算滿版變數',
);

assert.match(css, /\.window-shade,\.window-shade\.closed,\.window-shade\.peek\{inset:0;/);
assert.match(css, /\.window-glass\{container-type:size\}/);
assert.match(
  html,
  /<img class="landing-cloud-wisps" src="images\/landing-cloud-wisps\.png" alt="">/,
  '降落雲霧應使用生成的透明圖片',
);
assert.match(
  css,
  /\.leg-strip\{[^}]*left:50%;bottom:13%;[^}]*max-width:56%;[^}]*flex-direction:column;[^}]*align-items:center/,
  '航線資訊應整組置中，並留在橢圓下緣的安全寬度內',
);
assert.match(
  html,
  /<span class="leg-heading-text">\s*<span class="leg-flag" id="leg-flag"/,
  '國旗應放在目的地文字群旁',
);
assert.doesNotMatch(css, /\.landing-cloud-wisps\{[^}]*background:/);
assert.match(
  css,
  /\.landing-cloud-wisps\{[^}]*right:-78%;bottom:-24%;width:156%;height:110%;[^}]*object-fit:contain;[^}]*will-change:transform,opacity/,
  '生成雲層應使用單一可合成圖層',
);
assert.match(
  css,
  /@keyframes landing-wisps-pass\{0%\{transform:translate3d\(0,16%,0\)[^}]*\}[^@]*100%\{transform:translate3d\(-94%,-42%,0\)/,
  '降落雲層應由右下往左上移動',
);
assert.match(
  css,
  /\.leg-heading-text\{[^}]*position:relative;[^}]*display:flex/,
  '目的地文字需有獨立定位容器',
);
assert.match(
  css,
  /\.window-glass\[data-sky="night"\] \.inflight-scene/,
  '飛行與降落天空應能依當地時段切換',
);
assert.match(
  css,
  /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.landing-cloud-wisps\{display:none\}/,
  '減少動態時不移動前景雲層',
);

assert.match(
  classicCss,
  /body\.window-only \.window-frame\{[^}]*aspect-ratio:388 \/ 458/,
  'classic 分頁應保留橢圓窗框',
);
assert.match(classicCss, /@keyframes arrival-flash/, 'classic 分頁應保留降落閃光');
assert.match(classicJs, /glass\.classList\.add\('arrival-flash'\)/, 'classic 分頁應在降落時觸發閃光');
assert.match(classicHtml, /href="style\.css"/, 'classic 分頁應使用自己的樣式');
assert.match(classicHtml, /src="app\.js"/, 'classic 分頁應使用自己的腳本');

console.log('✓ 直式滿版只保留窗戶內畫面');
console.log('✓ 航線與時間資訊具有可讀的最小字級');
console.log('✓ 遮板仍以窗戶安全區為定位基準');
console.log('✓ /classic 仍是橢圓窗與降落閃光的舊版');
