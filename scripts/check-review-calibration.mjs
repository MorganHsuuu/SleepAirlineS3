import assert from 'node:assert/strict';
import { buildReviewCalibration } from '../src/lib/review/calibration.ts';

const now = new Date('2026-11-02T08:00:00+08:00');

const todayComment = [
  '「先把眼睛閉上。」也可以加個肩膀跟呼吸的引導。',
  '「光跟著這裡的天氣走。」可以調整成「陽光照亮了...」可以形容得具體一點。',
  '有個可愛的小事：很喜歡吃 taco，晚上常聚在一起。這裡也許需要較完整的敘事，誰喜歡吃taco。',
].join('\n');

const samples = [
  {
    notionId: 'p1',
    sampleId: 'RV-TODAY',
    phase: 'landing',
    routeDirection: 'eastbound',
    durationMinutes: 90,
    landingHour: 8,
    departureLocation: 'Yala, Thailand',
    arrivalLocation: '卡布聖盧卡斯, 墨西哥',
    takeoffBroadcast: '歡迎搭乘 Sleep Airline，這裡是機長。我們從也拉出發，往東飛。先把眼睛閉上。我們即將起飛。Sleep Airline 感謝您的搭乘，請好好休息，祝你有個好眠。',
    landingBroadcast: 'Hola。傍晚好，我們到了卡布聖盧卡斯。光跟著這裡的天氣走。從也拉飛過來，空中待了 8 小時。有個可愛的小事：很喜歡吃 taco，晚上常聚在一起。',
    imagePrompt: 'Cabo San Lucas scenery',
    imageUrl: '',
    comments: `[@Newton661104 · 3 · 2026/11/2 02:24:39]\n${todayComment}`,
    reviewer: 'Newton661104',
    textScore: 3,
    createdAt: '2026-11-02T02:24:00.000+00:00',
    updatedAt: '2026-11-02T02:24:00.000+00:00',
  },
  {
    notionId: 'p2',
    sampleId: 'RV-OLD',
    phase: 'landing',
    routeDirection: 'eastbound',
    durationMinutes: 90,
    landingHour: 8,
    departureLocation: '臺北',
    arrivalLocation: 'Jolo, Philippines',
    takeoffBroadcast: '歡迎搭乘。',
    landingBroadcast: '窗外是Jolo街頭看得見的屋宇與招牌。',
    imagePrompt: '',
    imageUrl: '',
    comments: '[@2222 · 1 · 2026/10/26 14:34:39]\n文法詭異，請參考繁體中文的語言邏輯',
    reviewer: '2222',
    textScore: 1,
    createdAt: '2026-10-26T14:34:00.000+00:00',
    updatedAt: '2026-10-26T14:34:00.000+00:00',
  },
];

const landing = buildReviewCalibration(samples, 'landing', now);
assert.match(landing, /今日評語（最高優先，必須整段當成 prompt 遵守）/);
assert.match(landing, /誰喜歡吃taco/);
assert.match(landing, /陽光照亮了/);
assert.match(landing, /肩膀跟呼吸/);
assert.doesNotMatch(landing.split('今日評語')[1].split('較早評語')[0], /文法詭異/);
assert.match(landing, /較早評語/);
assert.match(landing, /文法詭異/);

const takeoff = buildReviewCalibration(samples, 'takeoff', now);
assert.match(takeoff, /今日評語（最高優先，必須整段當成 prompt 遵守）/);
assert.match(takeoff, /先把眼睛閉上/);

console.log('review calibration: today comments stay intact as high-priority prompts');
