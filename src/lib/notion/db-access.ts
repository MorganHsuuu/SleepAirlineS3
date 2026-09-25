import type { Client } from '@notionhq/client';
import { normalizeNotionId } from './dashboard-schema';

async function readDatabaseIdentity(client: Client, databaseId: string): Promise<{ title: string; parentPageId: string | null }> {
  const db = await client.databases.retrieve({ database_id: databaseId });
  const title = (db as { title?: { plain_text: string }[] }).title;
  const parent = (db as { parent?: { type?: string; page_id?: string } }).parent;
  return { title: title?.[0]?.plain_text ?? '', parentPageId: parent?.type === 'page_id' ? parent.page_id ?? null : null };
}

/** 驗證 env 中的 DB ID 是否可存取；失敗時改從父頁面依標題尋找。 */
export async function resolveDbIdWithFallback(params: {
  client: Client;
  envDbId?: string;
  expectedTitle: string;
  findOnParentPage: (client: Client, parentPageId: string) => Promise<string | null>;
  parentPageId: string;
}): Promise<string> {
  const { client, envDbId, expectedTitle, findOnParentPage, parentPageId } = params;

  if (envDbId) {
    const configuredId = normalizeNotionId(envDbId);
    const identity = await readDatabaseIdentity(client, configuredId);
    if (identity.title !== expectedTitle || normalizeNotionId(identity.parentPageId ?? '') !== normalizeNotionId(parentPageId)) {
      throw new Error(`Notion 資料庫不是 S3 專用的「${expectedTitle}」或不在指定的 S3 頁面，已停止寫入。`);
    }
    return configuredId;
  }

  const found = await findOnParentPage(client, parentPageId);
  if (found) return found;

  throw new Error(`找不到 S3 專用的「${expectedTitle}」，請確認 Integration 已連接 S3 頁面。`);
}

export function formatNotionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (/could not find database/i.test(msg)) {
    return (
      '找不到 Notion 資料庫，或 Integration 尚未加入該表。' +
      '請到 Notion 打開 Sleep Airline S3 Sleep Sessions → ⋯ → Connections → 加入 Integration；' +
      '並確認 Vercel 的 NOTION_DASHBOARD_DB_ID 是否正確。'
    );
  }

  if (/Sleep Airline S3 Sleep Sessions|Sleep Airline S3 Landing Scenery|NOTION_DASHBOARD|NOTION_LANDSCAPE|Integration/i.test(msg)) {
    return msg;
  }

  if (/unauthorized|forbidden|invalid api token|API token is invalid/i.test(msg)) {
    return 'Notion API Key 無效，或 Integration 沒有權限。請確認 Vercel 的 NOTION_API_KEY。';
  }

  return msg;
}
