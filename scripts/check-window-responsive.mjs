import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

const requiredRules = [
  [
    '窗框以固定比例及穩定的寬高預算縮放',
    /body\.window-only \.window-frame\{[^}]*aspect-ratio:388 \/ 458;[^}]*width:min\(88vw,540px,calc\(\(100svh - clamp\(218px,40svh,306px\)\) \* 388 \/ 458\)\);height:auto;min-height:0;max-height:none/,
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
    /\.leg-strip\.is-flying\{[^}]*width:max-content;max-width:78%/,
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
    '降落資訊以置中直向堆疊',
    /\.leg-strip\.is-landed\{[^}]*width:max-content;max-width:78%/,
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
    '窗內指南針文字有最小字級',
    /\.leg-mini-compass\{[^}]*font-size:clamp\(7px,1\.55cqi,10px\)/,
  ],
  [
    '短螢幕會縮小外部指南針',
    /body\.window-only \.dial-wrap\{width:clamp\(110px,min\(38vw,25svh\),178px\);height:clamp\(110px,min\(38vw,25svh\),178px\)/,
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

assert.match(
  css,
  /body\.window-only \.window-area\{[^}]*flex:0 0 auto;[^}]*justify-content:flex-start;[^}]*padding-top:clamp\(12px,2\.4svh,22px\)/,
  '視窗版窗框應靠上並保留固定安全間距',
);

const frameWidth = (viewportWidth, viewportHeight) => {
  const reserve = Math.min(306, Math.max(218, viewportHeight * 0.4));
  return Math.min(viewportWidth * 0.88, 540, (viewportHeight - reserve) * 388 / 458);
};

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [402, 874],
  [430, 932],
  [592, 789],
  [1024, 768],
]) {
  const frameW = frameWidth(width, height);
  const frameH = frameW * 458 / 388;
  const topGap = Math.min(22, Math.max(12, height * 0.024));
  assert.ok(frameW >= Math.min(width * 0.88, 280), `${width}x${height} 的窗框不應異常縮小`);
  assert.ok(frameH <= height - 210, `${width}x${height} 的窗框應保留控制區安全高度`);
  assert.ok(Math.abs(frameW / frameH - 388 / 458) < 0.001, `${width}x${height} 的窗框比例應固定`);
  assert.ok(topGap >= 12 && topGap <= 22, `${width}x${height} 的窗框上方間距需落在安全範圍`);
}

assert.match(css, /\.window-shade,\.window-shade\.closed,\.window-shade\.peek\{inset:0;/);
assert.match(css, /\.window-glass\{container-type:size\}/);
assert.match(
  html,
  /<img class="landing-cloud-wisps" src="images\/landing-cloud-wisps\.png" alt="">/,
  '降落雲霧應使用生成的透明圖片',
);
assert.match(
  css,
  /\.leg-strip\{[^}]*left:50%;bottom:8%;[^}]*flex-direction:column;[^}]*align-items:center/,
  '航線資訊應整組置中於窗戶中下',
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

const narrowDial = Math.max(110, Math.min(320 * 0.38, 568 * 0.25, 178));
assert.ok(narrowDial <= 122, '320x568 的指南針需保留南向標記安全空間');

console.log('✓ 窗框使用固定比例與穩定的響應式尺寸');
console.log('✓ 航線與時間資訊具有可讀的最小字級');
console.log('✓ 遮板仍以窗戶安全區為定位基準');
