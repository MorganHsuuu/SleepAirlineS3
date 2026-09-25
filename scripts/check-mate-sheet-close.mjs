import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, '..', 'public/style.css'), 'utf8');
const html = readFileSync(join(import.meta.dirname, '..', 'public/index.html'), 'utf8');

const checks = [
  ['隊友詳情保留主畫面點擊', css.includes('body.sheet-open:not([data-open-sheet="mate-sheet"]) #main-section')],
  ['隊友詳情停用底層 HUD', css.includes('body[data-open-sheet="mate-sheet"] .hud-top')],
  ['把手觸控區至少 72×36', /\.sheet-grip\s*\{[^}]*width:\s*72px;\s*height:\s*36px/s.test(css)],
  ['隊友把手是按鈕', html.includes('id="btn-close-mate"')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${label}`);
if (failed.length) process.exit(1);
