/** S3 專用資料庫：每次窗簾關閉到打開的體驗各一列，不寫入 S2 共用總表。 */
export const DASHBOARD_TITLE = 'Sleep Airline S3 Sleep Sessions';

const GROUP_COLORS = [
  'blue', 'green', 'orange', 'purple', 'pink',
  'red', 'yellow', 'gray', 'brown', 'default',
] as const;

/** 舊版小隊選項（group_01 … group_15）；保留給歷史 Select 資料相容。 */
export const GROUP_OPTIONS = Array.from({ length: 15 }, (_, i) => ({
  name: `group_${String(i + 1).padStart(2, '0')}`,
  color: GROUP_COLORS[i % GROUP_COLORS.length],
}));

const STATUS_OPTIONS = [
  { name: 'not_started', color: 'gray' as const },
  { name: 'in_flight', color: 'yellow' as const },
  { name: 'landed', color: 'green' as const },
];

const ROUTE_DIRECTION_OPTIONS = [
  'auto', 'eastbound', 'westbound', 'northbound', 'southbound',
  'northeast', 'northwest', 'southeast', 'southwest', 'circular', 'unknown',
].map((name) => ({ name, color: 'default' as const }));

const BROADCAST_STYLE_OPTIONS = [
  'formal_captain', 'poetic', 'playful', 'flight_attendant', 'radio_host', 'custom',
].map((name, i) => ({ name, color: (['blue', 'purple', 'yellow', 'pink', 'orange', 'gray'] as const)[i] }));

const SOCIAL_CUE_OPTIONS = [
  'teammate_arrival', 'teammate_departure', 'route_convergence', 'teammate_in_sky',
  'parallel_heading', 'same_departure', 'heading_contrast', 'squad_in_sky',
  'fresh_arrival', 'first_of_night', 'relay_flight', 'early_landing', 'late_landing', 'solo',
  // 舊版（保留以相容歷史紀錄）
  'same_sky', 'same_region', 'nearby_region',
].map((name, i) => ({
  name,
  color: (['blue', 'purple', 'green', 'orange', 'yellow', 'pink', 'gray', 'brown', 'red', 'default'] as const)[
    i % 10
  ],
}));

/** Notion 表格建議欄位順序（既有表請在 UI 依此拖曳；API 無法自動排序） */
export const DASHBOARD_PROPERTY_ORDER = [
  // 識別
  'Flight ID',
  'Passenger ID',
  'Name',
  'Group ID',
  'Status',
  // 起飛
  'Departure Location',
  'Departure Latitude',
  'Departure Longitude',
  'Takeoff Time',
  'Client Time Zone',
  'Takeoff Broadcast Style',
  'Takeoff Broadcast',
  'Route Direction',
  // 降落
  'Landing Time',
  'Flight Duration Minutes',
  'Sleep Opportunity Minutes',
  'Self-reported Sleep Minutes',
  'Sleep Quality',
  'Mood Before',
  'Mood After',
  'Estimated Flight Distance KM',
  'Arrival Location',
  'Arrival Latitude',
  'Arrival Longitude',
  'Captain Broadcast',
  // 社交
  'Social Cue Type',
  'Social Cue Text',
  'Related Passenger',
  // 系統
  'Research consent',
  'Consent time',
  'Created At',
  'Updated At',
] as const;

export function getDashboardProperties() {
  return {
    // ── 識別 ──
    'Flight ID': { title: {} },
    'Passenger ID': { rich_text: {} },
    'Name': { rich_text: {} },
    'Group ID': { number: { format: 'number' as const } },
    'Status': { select: { options: STATUS_OPTIONS } },
    // ── 起飛 ──
    'Departure Location': { rich_text: {} },
    'Departure Latitude': { number: { format: 'number' as const } },
    'Departure Longitude': { number: { format: 'number' as const } },
    'Takeoff Time': { date: {} },
    'Client Time Zone': { rich_text: {} },
    'Takeoff Broadcast Style': { select: { options: BROADCAST_STYLE_OPTIONS } },
    'Takeoff Broadcast': { rich_text: {} },
    'Route Direction': { select: { options: ROUTE_DIRECTION_OPTIONS } },
    // ── 降落 ──
    'Landing Time': { date: {} },
    'Flight Duration Minutes': { number: { format: 'number' as const } },
    'Sleep Opportunity Minutes': { number: { format: 'number' as const } },
    'Self-reported Sleep Minutes': { number: { format: 'number' as const } },
    'Sleep Quality': { number: { format: 'number' as const } },
    'Mood Before': { number: { format: 'number' as const } },
    'Mood After': { number: { format: 'number' as const } },
    'Estimated Flight Distance KM': { number: { format: 'number' as const } },
    'Arrival Location': { rich_text: {} },
    'Arrival Latitude': { number: { format: 'number' as const } },
    'Arrival Longitude': { number: { format: 'number' as const } },
    'Captain Broadcast': { rich_text: {} },
    // ── 社交 ──
    'Social Cue Type': { select: { options: SOCIAL_CUE_OPTIONS } },
    'Social Cue Text': { rich_text: {} },
    'Related Passenger': { rich_text: {} },
    // ── 系統 ──
    'Research consent': { checkbox: {} },
    'Consent time': { date: {} },
    'Created At': { date: {} },
    'Updated At': { date: {} },
  };
}

export const DEFAULT_PARENT_PAGE_ID = '388a7f1b413c8015824ff6fb8bc1d65b';

export function normalizeNotionId(id: string): string {
  return id.replace(/-/g, '');
}
