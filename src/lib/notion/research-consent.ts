import { getNotionClient, isNotionConfigured } from './client';
import { getDashboardPropertyNames } from './schema-introspect';

export const RESEARCH_CONSENT_PROP = 'Research consent';
export const CONSENT_TIME_PROP = 'Consent time';

function isStampablePageId(pageId: string | null | undefined): pageId is string {
  return !!pageId && !pageId.startsWith('mem_') && !pageId.startsWith('pending_');
}

export function isResearchConsentGranted(body: { researchConsent?: unknown } | null | undefined): boolean {
  return body?.researchConsent === true;
}

/** 總表若已建立對應欄位，就把這次同意蓋到該航班列。沒有欄位則略過。 */
export async function stampResearchConsent(pageId: string | null | undefined, atIso?: string): Promise<void> {
  if (!isNotionConfigured() || !isStampablePageId(pageId)) return;
  const allowed = await getDashboardPropertyNames();
  const properties: Record<string, unknown> = {};
  if (allowed.has(RESEARCH_CONSENT_PROP)) {
    properties[RESEARCH_CONSENT_PROP] = { checkbox: true };
  }
  if (allowed.has(CONSENT_TIME_PROP)) {
    properties[CONSENT_TIME_PROP] = { date: { start: atIso || new Date().toISOString() } };
  }
  if (!Object.keys(properties).length) return;
  const client = getNotionClient();
  await client.pages.update({
    page_id: pageId,
    properties: properties as any,
  });
}
