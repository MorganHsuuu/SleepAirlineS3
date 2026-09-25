#!/usr/bin/env node
/**
 * 驗證 NOTION_LANDSCAPE_DB_ID 是否可連線（需 .env.local 含 NOTION_API_KEY）。
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const key = process.env.NOTION_API_KEY;
const dbId = (process.env.NOTION_LANDSCAPE_DB_ID || '3e5a7f1b413c80ff9d88f9f3dc4d3474').replace(/-/g, '');

if (!key) {
  console.error('❌ 請在 .env.local 設定 NOTION_API_KEY');
  process.exit(1);
}

const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
  headers: {
    Authorization: `Bearer ${key}`,
    'Notion-Version': '2022-06-28',
  },
});

if (!res.ok) {
  const body = await res.text();
  console.error('❌ 無法讀取 Landing Scenery 資料庫');
  console.error('   ID:', dbId);
  console.error('   HTTP', res.status, body.slice(0, 200));
  console.error('\n請到 Notion 該表 → ⋯ → Connections → 加入 Integration');
  process.exit(1);
}

const db = await res.json();
const title = db.title?.[0]?.plain_text ?? '(無標題)';
const props = Object.keys(db.properties ?? {});

console.log('✓ Landing Scenery 已連線');
console.log('  標題:', title);
console.log('  ID:  ', dbId);
console.log('  欄位:', props.length, '個 →', props.slice(0, 8).join(', '), props.length > 8 ? '…' : '');

const expected = [
  'Entry ID', 'Flight ID', 'Image', 'Image URL', 'Arrival Location',
];
const missing = expected.filter((p) => !props.includes(p));
if (missing.length) {
  console.warn('\n⚠ 建議欄位缺失:', missing.join(', '));
  console.warn('  對照 src/lib/notion/landscape-schema.ts');
}
