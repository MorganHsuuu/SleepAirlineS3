import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const html = readFileSync(join(root, 'public/index.html'), 'utf8');
const app = readFileSync(join(root, 'public/app.js'), 'utf8');
const i18n = readFileSync(join(root, 'public/i18n.js'), 'utf8');

const checks = [
  ['不再提醒核取方塊', html.includes('id="avatar-prompt-never"')],
  ['依乘客保存偏好', app.includes('function avatarPromptDismissStorageKey(passengerId)')],
  ['提示前檢查偏好', app.includes('hasDismissedAvatarPrompt(passenger.passengerId)')],
  ['勾選時保存偏好', app.includes('saveAvatarPromptDismissed(passenger.passengerId')],
  ['中文文案', i18n.includes("'avatar.never': '不再提醒我'")],
  ['英文文案', i18n.includes("'avatar.never': 'Don’t remind me again'")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${label}`);
if (failed.length) process.exit(1);
