import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrivalHello, arrivalLifeContext, generateMorningArrival, timeAdjustedGreeting } from '../src/lib/ai/morning-content';

test('arrivals welcome passengers at every local hour, including midnight', () => {
  for (const time of [null, '當地上午', '當地下午', '當地深夜', '當地凌晨', 'night']) {
    assert.equal(arrivalHello(time), '歡迎抵達');
  }
  assert.equal(timeAdjustedGreeting('晚安', '當地深夜'), '你好');
  assert.equal(timeAdjustedGreeting('早安', '當地深夜'), '你好');
  assert.equal(timeAdjustedGreeting('Good night', 'night'), 'Hello');
});
test('local activity is qualified, and unknown time has no invented activity', () => {
  assert.match(arrivalLifeContext('當地深夜'), /多數人可能已經睡了.*不按門鈴/);
  assert.match(arrivalLifeContext('當地上午'), /有人可能正吃早餐/);
  assert.match(arrivalLifeContext('當地傍晚'), /晚餐/);
  assert.equal(arrivalLifeContext(null), '');
  assert.equal(arrivalLifeContext('當地時間未知'), '');
});
test('fallback keeps the local language, neutral arrival greeting and midnight humor', async () => {
  const saved = [process.env.OPENAI_API_KEY, process.env.OPENAI_API];
  delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_API;
  try {
    for (const time of ['當地上午', '當地深夜', '當地凌晨']) {
      const result = await generateMorningArrival({ country: '日本', city: '東京', countryIso: 'JP',
        localGreeting: 'こんにちは', localTimeLabel: time }, 0);
      assert.match(result.voiceText, /こんにちは|こんばんは/);
      assert.match(result.voiceText, /歡迎抵達/);
      assert.doesNotMatch(result.voiceText, /晚安|好夢|繼續睡/);
      if (time !== '當地上午') assert.match(result.voiceText, /多數人可能已經睡了/);
    }
  } finally {
    for (const [index, name] of ['OPENAI_API_KEY', 'OPENAI_API'].entries()) {
      if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
    }
  }
});
