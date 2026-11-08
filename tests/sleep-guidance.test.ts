import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fallbackSleepInvitation,
  formatSleepGuidancePrompt,
  type SleepNote,
} from '../src/lib/flight/sleep-guidance';

test('empty sleep notes are not used as a prompt', () => {
  assert.equal(formatSleepGuidancePrompt([]), null);
  assert.equal(formatSleepGuidancePrompt([{
    moodAfter: null, sleepQuality: null, selfReportedSleepMinutes: null,
    sleepOpportunityMinutes: null, landingTime: null,
  }]), null);
});

test('high mood becomes an encouraging prompt and never a scolding one', () => {
  const prompt = formatSleepGuidancePrompt([{
    moodAfter: 88, sleepQuality: 4, selfReportedSleepMinutes: 50,
    sleepOpportunityMinutes: 62, landingTime: '2026-11-08T20:00:00.000Z',
  }]);
  assert.ok(prompt);
  assert.match(prompt, /最近一次心情 0–100（微笑高分、不笑低分）：88/);
  assert.match(prompt, /自述睡眠品質 1–5：4/);
  assert.match(prompt, /禁止責備/);
  assert.match(prompt, /心情不錯/);
  assert.match(prompt, /不必加油打氣/);
});

test('low mood asks for a lighter invitation without blame', () => {
  const prompt = formatSleepGuidancePrompt([{
    moodAfter: 18, sleepQuality: null, selfReportedSleepMinutes: null,
    sleepOpportunityMinutes: 40, landingTime: null,
  }]);
  assert.ok(prompt);
  assert.match(prompt, /什麼都不用做好/);
  assert.match(prompt, /更慢、更輕/);
  assert.match(prompt, /禁止責備/);
});

test('earlier mood records stay in the prompt for the next generation', () => {
  const notes: SleepNote[] = [
    { moodAfter: 72, sleepQuality: null, selfReportedSleepMinutes: null, sleepOpportunityMinutes: null, landingTime: null },
    { moodAfter: 41, sleepQuality: null, selfReportedSleepMinutes: null, sleepOpportunityMinutes: null, landingTime: null },
    { moodAfter: 30, sleepQuality: 2, selfReportedSleepMinutes: null, sleepOpportunityMinutes: null, landingTime: null },
  ];
  const prompt = formatSleepGuidancePrompt(notes);
  assert.ok(prompt);
  assert.match(prompt, /更早的心情紀錄：41、30/);
});

test('fallback sleep lines stay encouraging at low and high scores', () => {
  const low = fallbackSleepInvitation([{
    moodAfter: 12, sleepQuality: null, selfReportedSleepMinutes: null,
    sleepOpportunityMinutes: null, landingTime: null,
  }], 'zh');
  const high = fallbackSleepInvitation([{
    moodAfter: 90, sleepQuality: null, selfReportedSleepMinutes: null,
    sleepOpportunityMinutes: null, landingTime: null,
  }], 'zh');
  assert.match(low, /什麼都不用做好/);
  assert.match(high, /再把身體交給今晚/);
  assert.doesNotMatch(low, /不好|改善|分數/);
  assert.doesNotMatch(high, /不好|改善|分數/);
});
