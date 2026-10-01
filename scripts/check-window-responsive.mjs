import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');

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
    '飛行中的 FROM 與目的地保留正間距',
    /\.leg-strip\.is-flying \.leg-origin-label\{[^}]*margin:\.7cqi 0 0;/,
  ],
  [
    '飛行資訊依內容置中並限制在安全寬度',
    /\.leg-strip\.is-flying\{[^}]*width:max-content;max-width:78%/,
  ],
  [
    '國旗不參與指南針與目的地的欄寬計算',
    /\.leg-strip\.is-flying \.leg-flag\{position:absolute;/,
  ],
  [
    '飛行中的 FROM 可在安全寬度內省略',
    /\.leg-strip\.is-flying \.leg-origin-label\{[^}]*grid-column:2;grid-row:2;[^}]*width:100%;min-width:0;max-width:100%;[^}]*overflow:hidden;text-overflow:ellipsis/,
  ],
  [
    '降落資訊依內容置中並限制在安全寬度',
    /\.leg-strip\.is-landed\{[^}]*width:max-content;max-width:78%/,
  ],
  [
    '降落目的地以國旗與文字兩欄排列',
    /\.leg-strip\.is-landed \.leg-destination\{display:contents\}/,
  ],
  [
    '降落後的 FROM 與目的地左對齊並可省略',
    /\.leg-strip\.is-landed \.leg-origin-label\{[^}]*grid-column:2;grid-row:3;width:100%;min-width:0;max-width:100%;[^}]*overflow:hidden;text-overflow:ellipsis/,
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

const frameWidth = (viewportWidth, viewportHeight) => {
  const reserve = Math.min(306, Math.max(218, viewportHeight * 0.4));
  return Math.min(viewportWidth * 0.88, 540, (viewportHeight - reserve) * 388 / 458);
};

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [592, 789],
  [1024, 768],
]) {
  const frameW = frameWidth(width, height);
  const frameH = frameW * 458 / 388;
  assert.ok(frameW >= Math.min(width * 0.88, 280), `${width}x${height} 的窗框不應異常縮小`);
  assert.ok(frameH <= height - 210, `${width}x${height} 的窗框應保留控制區安全高度`);
  assert.ok(Math.abs(frameW / frameH - 388 / 458) < 0.001, `${width}x${height} 的窗框比例應固定`);
}

assert.match(css, /\.window-shade,\.window-shade\.closed,\.window-shade\.peek\{inset:0;/);
assert.match(css, /\.window-glass\{container-type:size\}/);

const narrowDial = Math.max(110, Math.min(320 * 0.38, 568 * 0.25, 178));
assert.ok(narrowDial <= 122, '320x568 的指南針需保留南向標記安全空間');

console.log('✓ 窗框使用固定比例與穩定的響應式尺寸');
console.log('✓ 航線與時間資訊具有可讀的最小字級');
console.log('✓ 遮板仍以窗戶安全區為定位基準');
