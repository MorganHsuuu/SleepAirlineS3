/**
 * 建立獨立的「Sleep Airline Review Lab」資料庫。
 * 不會改 Flight Log / Landing Scenery 主庫。
 *
 * Usage:
 *   NOTION_REVIEW_PARENT_PAGE_ID=... npm run setup:review
 */
import * as fs from 'fs';
import * as path from 'path';
import { applyReviewDatabaseSchema, createReviewDatabase, findReviewDatabaseOnPage } from '../src/lib/notion/reviews';

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

async function main() {
  loadEnv();
  if (!process.env.NOTION_API_KEY) {
    console.error('請先設定 NOTION_API_KEY。');
    process.exit(1);
  }
  const arg = (process.argv[2] || '').replace(/-/g, '');
  const dbId = (process.env.NOTION_REVIEW_DB_ID || (arg.length >= 32 ? arg : '')).replace(/-/g, '');
  const parent = (process.env.NOTION_REVIEW_PARENT_PAGE_ID || '').replace(/-/g, '');

  if (dbId.length >= 32) {
    const properties = await applyReviewDatabaseSchema(dbId);
    console.log(`已把審查欄位寫進資料庫：${dbId}`);
    properties.forEach((item) => console.log(`  · ${item}`));
    return;
  }

  if (parent.length < 32) {
    console.error('請提供資料庫 ID 或獨立頁面 ID：NOTION_REVIEW_DB_ID / npm run setup:review -- <id>');
    process.exit(1);
  }

  const existing = await findReviewDatabaseOnPage(parent);
  const id = existing || await createReviewDatabase(parent);
  const properties = await applyReviewDatabaseSchema(id);
  console.log(existing ? `已找到審查庫：${id}` : `已建立審查庫：${id}`);
  properties.forEach((item) => console.log(`  · ${item}`));
  console.log('請把這個 ID 填進 Vercel / .env.local 的 NOTION_REVIEW_DB_ID。不要填進主庫欄位。');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
