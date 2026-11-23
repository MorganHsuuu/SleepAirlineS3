import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectPreviousArrivalStory } from '../src/lib/flight/arrival-story';
import { generateMorningArrival, parseMorningResponse } from '../src/lib/ai/morning-content';
const current = { flightId: 'current', passengerId: 'p1', takeoffTime: '2026-11-23T14:00:00Z' };
const rich = (text: string) => ({ rich_text: [{ plain_text: text }] });
function page(id: string, when: string, text: string, passenger = 'p1', status = 'landed') {
  return { properties: { 'Flight ID': { title: [{ plain_text: id }] }, 'Passenger ID': rich(passenger),
    'Status': { select: { name: status } }, 'Landing Time': { date: { start: when } }, 'Immigration Note': rich(text) } };
}
test('selects the latest nonblank story before this flight, even if it is weeks old', () => {
  const rows = [page('old', '2026-10-03T08:00:00Z', '舊故事'), page('recent', '2026-10-15T08:00:00Z', '最近的故事'),
    page('empty', '2026-11-22T08:00:00Z', '   ')];
  assert.equal(selectPreviousArrivalStory(rows, current)?.flightId, 'recent');
});
test('excludes other passengers, current/future flights and unfinished flights', () => {
  const rows = [page('other', '2026-11-22T08:00:00Z', '其他乘客的故事', 'p2'),
    page('current', '2026-11-23T13:00:00Z', '本趟'), page('future', '2026-11-24T08:00:00Z', '未來'),
    page('unfinished', '2026-11-22T08:00:00Z', '未降落', 'p1', 'in_flight'), page('missing', '', '日期不明')];
  assert.equal(selectPreviousArrivalStory(rows, current), null);
  assert.equal(selectPreviousArrivalStory([page('ok', '2026-11-22T08:00:00Z', '故事')], { ...current, passengerId: '' }), null);
});
test('reads every rich-text fragment and caps model input without splitting Unicode', () => {
  const row = page('ok', '2026-11-20T08:00:00Z', '');
  row.properties['Immigration Note'] = { rich_text: [{ plain_text: '第一段' }, { plain_text: '第二段' }] };
  assert.equal(selectPreviousArrivalStory([row], current)?.text, '第一段第二段');
  row.properties['Immigration Note'] = rich('🌙'.repeat(900));
  assert.equal(Array.from(selectPreviousArrivalStory([row], current)!.text).length, 800);
});
test('model echo is included only when a prior story exists; missing or dated echoes fall back', async () => {
  const saved = [process.env.OPENAI_API_KEY, process.env.OPENAI_API];
  delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_API;
  try {
    const input = { city: 'Taipei', country: 'Taiwan', countryIso: 'TW', localTimeLabel: '當地上午' };
    const base = await generateMorningArrival(input, 0);
    const data = { ...base, sceneTheme: { themeId: 'landmark', subject: { zh: base.localFeature, en: 'Taipei 101' } },
      storyEcho: '你之前提到和朋友吃了晚餐，那個相聚的片段，機長記得。' };
    const withStory = { ...input, previousStory: '上次和朋友吃晚餐。' };
    const parsed = parseMorningResponse(JSON.stringify(data), withStory, 'landmark');
    assert.ok(parsed, JSON.stringify({ feature: base.localFeature, voice: base.voiceText }));
    assert.match(parsed.voiceText, /你之前提到和朋友吃了晚餐/);
    assert.equal(parsed.imagePrompt.includes('朋友吃'), false);
    const noStory = parseMorningResponse(JSON.stringify(data), input, 'landmark');
    assert.ok(noStory); assert.doesNotMatch(noStory.voiceText, /你之前提到/);
    assert.equal(parseMorningResponse(JSON.stringify({ ...data, storyEcho: '' }), withStory, 'landmark'), null);
    assert.equal(parseMorningResponse(JSON.stringify({ ...data, storyEcho: '你昨天和朋友吃了晚餐。' }), withStory, 'landmark'), null);
    const fallback = await generateMorningArrival(withStory, 0);
    assert.match(fallback.voiceText, /你之前留給我們的那段故事/);
    assert.doesNotMatch(fallback.voiceText, /你昨天|你昨晚/);
  } finally {
    for (const [index, key] of ['OPENAI_API_KEY', 'OPENAI_API'].entries()) {
      if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
    }
  }
});
