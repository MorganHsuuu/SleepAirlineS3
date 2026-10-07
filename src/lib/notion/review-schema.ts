/** 心理師快速測試用資料庫。獨立於 Flight Log / Landing Scenery，不改主庫 schema。 */

export const REVIEW_DB_TITLE = 'Sleep Airline Review Lab';

const DIRECTION_OPTIONS = [
  'eastbound', 'westbound', 'northbound', 'southbound',
  'northeast', 'northwest', 'southeast', 'southwest',
].map((name) => ({ name, color: 'default' as const }));

const PHASE_OPTIONS = [
  { name: 'draft', color: 'gray' as const },
  { name: 'takeoff', color: 'yellow' as const },
  { name: 'landing', color: 'green' as const },
  { name: 'scenery', color: 'blue' as const },
];

export function getReviewProperties() {
  return {
    'Sample ID': { title: {} },
    Phase: { select: { options: PHASE_OPTIONS } },
    'Route Direction': { select: { options: DIRECTION_OPTIONS } },
    'Duration Minutes': { number: { format: 'number' as const } },
    'Landing Hour': { number: { format: 'number' as const } },
    'Departure Location': { rich_text: {} },
    'Arrival Location': { rich_text: {} },
    'Takeoff Broadcast': { rich_text: {} },
    'Landing Broadcast': { rich_text: {} },
    'Image Prompt': { rich_text: {} },
    Image: { files: {} },
    Comments: { rich_text: {} },
    Reviewer: { rich_text: {} },
    'Created At': { date: {} },
    'Updated At': { date: {} },
  };
}
