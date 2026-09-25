import assert from 'node:assert/strict';
import {
  buildSceneryPrompt,
  DEFAULT_SCENERY_IMAGE_MODEL,
  DEFAULT_SCENERY_IMAGE_QUALITY,
  describeSceneryLocalMoment,
} from '../src/lib/ai/scenery';

const prompt = buildSceneryPrompt('Marrakech', 'Morocco', 'Marrakech, Morocco');
const rioAtNight = buildSceneryPrompt('Rio de Janeiro', 'Brazil', 'Rio de Janeiro, Brazil', {
  landingTime: '2026-08-29T02:30:00.000Z',
  timezone: 'America/Sao_Paulo',
});
const antarctica = buildSceneryPrompt('Antarctica', 'Antarctica', 'Antarctica');
const netherlands = buildSceneryPrompt('Amsterdam', 'Netherlands', 'Amsterdam, Netherlands');
const localMoment = describeSceneryLocalMoment(
  '2026-08-29T02:30:00.000Z',
  'America/Sao_Paulo'
);

assert.equal(DEFAULT_SCENERY_IMAGE_MODEL, 'gpt-image-2');
assert.equal(DEFAULT_SCENERY_IMAGE_QUALITY, 'low');
assert.match(prompt, /dimensional travel postcard/i);
assert.match(prompt, /destination-specific color palette/i);
assert.match(prompt, /terrain/i);
assert.match(prompt, /local architecture/i);
assert.doesNotMatch(prompt, /Pixar/i);
assert.doesNotMatch(prompt, /warm gold, peach, fresh morning-blue/i);
assert.match(prompt, /generic houses must never be the main subject/i);
assert.match(prompt, /wildlife|flora|landform/i);
assert.match(rioAtNight, /Christ the Redeemer/i);
assert.match(rioAtNight, /local night/i);
assert.match(rioAtNight, /23:30/);
assert.match(antarctica, /penguins/i);
assert.match(netherlands, /windmills/i);
assert.match(netherlands, /tulip/i);
assert.equal(localMoment?.hour, 23);
assert.equal(localMoment?.label, 'local night');

console.log('✓ 降落圖依當地時間，以地標、動植物或自然景觀作為主體');
