import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const html = readFileSync(join(root, 'public/index.html'), 'utf8');
const app = readFileSync(join(root, 'public/app.js'), 'utf8');
const i18n = readFileSync(join(root, 'public/i18n.js'), 'utf8');

const checks = [
  ['精簡同意列', html.includes('class="consent-compact"')],
  ['研究說明視窗', html.includes('id="consent-dialog"')],
  ['研究說明按鈕', html.includes('id="btn-consent-details"')],
  ['未同意時登入按鈕停用', html.includes('id="btn-login" disabled')],
  ['勾選同步登入按鈕', app.includes('function syncResearchConsentButton()')],
  ['同意紀錄綁定乘客', app.includes('function researchConsentStorageKey(passengerId)')],
  ['已同意乘客不重複詢問', app.includes('function syncResearchConsentForPassenger()')],
  ['登入成功後保存同意', app.includes('saveResearchConsent(passengerId)')],
  ['柔和研究文案', i18n.includes('一起完成這趟研究航程')],
  ['同意並登機', i18n.includes("'login.submit': '同意並登機'")],
  ['回訪乘客顯示登入', i18n.includes("'login.submitReturning': '登入'")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}
if (failed.length) process.exit(1);
