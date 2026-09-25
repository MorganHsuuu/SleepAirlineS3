import assert from 'node:assert/strict';
import { toNotionImagePrompt } from '../src/lib/notion/landscape-images';

const fullPrompt = `${'a'.repeat(1998)}🌌${'b'.repeat(400)}`;
const storedPrompt = toNotionImagePrompt(fullPrompt);

assert.ok(fullPrompt.length > 2000);
assert.equal(storedPrompt.length, 2000);
assert.ok(storedPrompt.endsWith('🌌'));
assert.equal(fullPrompt.includes('b'), true);
assert.equal(storedPrompt.includes('b'), false);

console.log('✓ 完整提示詞保留給生圖，寫入 Notion 時安全限制為 2000 字元');
