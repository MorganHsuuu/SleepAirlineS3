import { formatNotionError } from './notion/db-access';
import { resolveDashboardDbId } from './notion/ensure-dashboard';
import { resolveLandscapeDbId } from './notion/ensure-landscape-db';
import { getDashboardPropertyNames, getLandscapePropertyNames } from './notion/schema-introspect';

export type DataMode = 'preview' | 'live';

export function getDataMode(): DataMode {
  const raw = process.env.SLEEP_AIRLINE_DATA_MODE?.trim().toLowerCase();
  if (raw === 'preview') return 'preview';
  if (raw === 'live') return 'live';
  return process.env.NOTION_API_KEY ? 'live' : 'preview';
}

export function isLiveDataMode(): boolean {
  return getDataMode() === 'live';
}

export async function getDataModeStatus(): Promise<{
  dataMode: DataMode;
  notionConfigured: boolean;
  notionReady: boolean;
  hint: string;
  notionError?: string;
}> {
  const dataMode = getDataMode();
  const hasKey = !!process.env.NOTION_API_KEY;
  const notionConfigured = dataMode === 'live' && hasKey;

  if (dataMode === 'preview') {
    return {
      dataMode,
      notionConfigured: false,
      notionReady: false,
      hint: '',
    };
  }

  if (!hasKey) {
    return {
      dataMode,
      notionConfigured: false,
      notionReady: false,
      hint: 'live 模式但未設定 NOTION_API_KEY，請在 Vercel 補上環境變數。',
    };
  }

  try {
    await resolveDashboardDbId();
    await resolveLandscapeDbId();
    const [flightProperties, sceneryProperties] = await Promise.all([
      getDashboardPropertyNames(), getLandscapePropertyNames(),
    ]);
    const requiredFlight = [
      'Flight ID', 'Passenger ID', 'Status', 'Takeoff Time', 'Landing Time',
      'Sleep Opportunity Minutes', 'Arrival Location', 'Route Direction',
    ];
    const requiredScenery = ['Entry ID', 'Flight ID', 'Image', 'Arrival Location'];
    const missing = [
      ...requiredFlight.filter((name) => !flightProperties.has(name)),
      ...requiredScenery.filter((name) => !sceneryProperties.has(name)),
    ];
    if (missing.length) throw new Error(`S3 Notion 欄位尚未建好：${missing.join('、')}`);
    return {
      dataMode,
      notionConfigured: true,
      notionReady: true,
      hint: '',
    };
  } catch (err) {
    return {
      dataMode,
      notionConfigured: true,
      notionReady: false,
      notionError: formatNotionError(err),
      hint: formatNotionError(err),
    };
  }
}
