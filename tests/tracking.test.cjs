const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/tracking.js'), 'utf8');
const sandbox = { window: {}, document: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const TrackingChart = sandbox.window.TrackingChart;

function flight(overrides) {
  return {
    flightId: 'FL-1',
    passengerId: 'PAX-F8CCB63A79A2ABF7',
    passengerName: '陳希愷',
    groupId: '0001',
    status: 'landed',
    takeoffTime: '2026-11-10T15:10:00.000Z',
    landingTime: '2026-11-10T16:02:00.000Z',
    sleepOpportunityMinutes: 52,
    flightDurationMinutes: 52,
    relatedPassenger: null,
    departureLocation: 'Taipei, Taiwan',
    arrivalLocation: 'Naga, Philippines',
    departureAirport: 'TPE',
    arrivalAirport: 'WNP',
    immigrationNote: '',
    ...overrides,
  };
}

test('normalizes 001 to terminal 0001', () => {
  assert.equal(TrackingChart.normalizeGroupId('001'), '0001');
  assert.equal(TrackingChart.normalizeGroupId('1'), '0001');
});

test('classifies night, day and nap from takeoff hour and duration', () => {
  const tz = 'Asia/Taipei';
  const now = new Date('2026-11-12T04:00:00.000Z');
  assert.equal(TrackingChart.classifyKind(flight({
    takeoffTime: '2026-11-10T15:10:00.000Z',
    sleepOpportunityMinutes: 52,
  }), tz, now), 'night');
  assert.equal(TrackingChart.classifyKind(flight({
    takeoffTime: '2026-11-10T01:00:00.000Z',
    sleepOpportunityMinutes: 180,
  }), tz, now), 'day');
  assert.equal(TrackingChart.classifyKind(flight({
    takeoffTime: '2026-11-10T05:30:00.000Z',
    sleepOpportunityMinutes: 40,
  }), tz, now), 'nap');
  assert.equal(TrackingChart.classifyKind(flight({
    takeoffTime: '2026-11-10T15:10:00.000Z',
    sleepOpportunityMinutes: 2,
  }), tz, now), 'blip');
});

test('builds a 14-day chart from 11/09 for the five terminal 0001 passengers', () => {
  const now = new Date('2026-11-12T04:00:00.000Z');
  const chart = TrackingChart.buildChart([
    flight({
      takeoffTime: '2026-11-09T15:10:00.000Z',
      landingTime: '2026-11-09T16:40:00.000Z',
      sleepOpportunityMinutes: 90,
      immigrationNote: 'Landing card filled at dawn.',
    }),
    flight({
      passengerId: 'PAX-37D428C61D98D16C',
      passengerName: 'Zephyra',
      takeoffTime: '2026-11-11T01:00:00.000Z',
      landingTime: '2026-11-11T08:00:00.000Z',
      sleepOpportunityMinutes: 420,
      status: 'in_flight',
    }),
  ], { groupId: '001', now, timezone: 'Asia/Taipei' });

  assert.equal(chart.groupId, '0001');
  assert.equal(chart.days.length, 14);
  assert.equal(chart.days[0].date, '2026-11-09');
  assert.equal(chart.days[13].date, '2026-11-22');
  assert.equal(chart.participants.length, 5);
  assert.equal(chart.participants[0].name, '方藝璇');
  assert.equal(chart.participants[1].name, '戴佑珊');
  assert.equal(chart.participants[2].name, '翎翎');
  assert.equal(chart.participants[3].name, 'Zephyra');
  assert.equal(chart.participants[4].name, '陳希愷');
  assert.equal(chart.participants[3].openCount, 1);
  const firstDay = chart.participants[4].days[0];
  assert.equal(firstDay.events[0].departureLocation, 'Taipei, Taiwan');
  assert.equal(firstDay.events[0].arrivalLocation, 'Naga, Philippines');
  assert.equal(firstDay.events[0].immigrationNote, 'Landing card filled at dawn.');
  assert.equal(firstDay.hasNote, true);
});

test('sleep bars sit on a continuous 14-day timeline from takeoff to landing', () => {
  const now = new Date('2026-11-12T04:00:00.000Z');
  const chart = TrackingChart.buildChart([
    flight({
      takeoffTime: '2026-11-09T16:00:00.000Z',
      landingTime: '2026-11-09T20:00:00.000Z',
      sleepOpportunityMinutes: 240,
    }),
  ], { groupId: '001', now, timezone: 'Asia/Taipei' });
  const bar = chart.participants[4].bars[0];
  assert.equal(Math.round(bar.startMin), 24 * 60);
  assert.equal(Math.round(bar.endMin), 24 * 60 + 240);
  assert.ok(bar.widthPct > bar.leftPct * 0);
  assert.equal(chart.totalMin, 14 * 24 * 60);
});

test('formats origin and destination with airport codes', () => {
  assert.equal(TrackingChart.formatPlace('Taipei, Taiwan', 'TPE', '出發地未記錄'), 'Taipei, Taiwan · TPE');
  assert.equal(TrackingChart.formatPlace('', '', '降落點未記錄'), '降落點未記錄');
});

test('labels sparse nights as intermittent and late starts as later shared', () => {
  assert.equal(TrackingChart.inferPattern(['night', '', '', 'night', '', '', '']).key, 'intermittent');
  assert.equal(TrackingChart.inferPattern(['', '', 'night', 'night', 'nap', '', '']).key, 'later_shared');
  assert.equal(TrackingChart.inferPattern(['night', 'night', 'night', 'night', '', '', '']).key, 'later_forgetting');
  assert.equal(TrackingChart.inferPattern(['night', 'night', 'night', 'night', 'night', 'night', 'night']).key, 'regular');
});
