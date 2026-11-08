import assert from 'node:assert/strict';
import { test } from 'node:test';
import { farewellSpotFor, spokenFarewellLine } from '../src/lib/flight/local-context';
import { fallbackCaptainBroadcast } from '../src/lib/ai/broadcast';
import { TAKEOFF_SPEECH_SPEED } from '../src/lib/ai/speech';

test('Taipei farewell uses Xinyi, never an invented district', () => {
  assert.equal(farewellSpotFor('Taipei'), '信義區');
  assert.equal(farewellSpotFor('台北, 臺灣'), '信義區');
  assert.equal(farewellSpotFor('Taipei', 'en'), 'Xinyi District');
  assert.match(spokenFarewellLine('Taipei'), /逛完信義區，現在要離開台北了/);
  assert.equal(farewellSpotFor('Kasama'), null);
  assert.equal(spokenFarewellLine('Kasama'), '');
});

test('takeoff fallback tells a leaving story then invites sleep', () => {
  const text = fallbackCaptainBroadcast(
    'takeoff',
    '小宇',
    'Taipei, Taiwan',
    null,
    'eastbound',
    null,
    '',
    {
      countryIso: 'TW',
      countryName: '臺灣',
      cityName: 'Taipei',
      culture: '台灣的夜市與便利商店是深夜社交核心。',
      morningGreeting: '你好',
      weatherSummary: null,
      localTimeLabel: null,
    }
  );
  assert.match(text, /歡迎搭乘 Sleep Airline，這裡是機長/);
  assert.match(text, /我們從台北出發，往東飛/);
  assert.match(text, /逛完信義區，現在要離開台北了/);
  assert.match(text, /您願意的話/);
  assert.match(text, /什麼都不必趕/);
  assert.match(text, /我們即將起飛。Sleep Airline 感謝您的搭乘，請好好休息，祝你有個好眠。/);
});

test('takeoff speech is slightly slower than landing', () => {
  assert.equal(TAKEOFF_SPEECH_SPEED, 0.9);
});
