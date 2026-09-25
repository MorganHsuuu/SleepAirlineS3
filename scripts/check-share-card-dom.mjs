import { readFile } from 'node:fs/promises';

const [app, html, css, pkg] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
]);

const checks = [
  ['html2canvas dependency', pkg.includes('"html2canvas"')],
  ['local html2canvas browser script', html.includes('vendor/html2canvas.min.js')],
  ['DOM capture entry point', app.includes('captureMemoryCardBlob')],
  ['waits for document fonts', app.includes('document.fonts.ready')],
  ['share button excluded from capture', app.includes('data-html2canvas-ignore="true"')],
  ['capture stage styling', css.includes('.memory-share-capture')],
  ['SVG barcode survives capture', app.includes('memoryBarcodeSvg') && app.includes('memory-ticket-barcode')],
  ['SVG plane avoids emoji rendering', app.includes('memoryPlaneSvg') && app.includes('memory-plane-svg')],
  ['filled plane path for capture', app.includes('fill="currentColor"') && app.includes('memory-plane-svg--route')],
  ['capture keeps glass gradient', !css.includes('background: #3d4b68')],
  ['capture logo avoids checkerboard', css.includes('.memory-share-capture .memory-ticket-logo')],
  ['legacy hand-drawn renderer removed', !app.includes('function renderArrivalShareCard')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}
if (failed.length) process.exitCode = 1;
