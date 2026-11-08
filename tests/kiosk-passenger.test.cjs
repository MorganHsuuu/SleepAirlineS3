const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const start = source.indexOf('function resolvePairedPassengerName(');
assert.notEqual(start, -1, 'resolvePairedPassengerName must exist');
const end = source.indexOf('\nfunction ', start + 1);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);

test('empty device name keeps the paired passenger name already on this kiosk', () => {
  assert.equal(
    ctx.resolvePairedPassengerName('PAX-1', '', { passengerId: 'PAX-1', name: '小明' }),
    '小明',
  );
});

test('placeholder 旅人 does not overwrite a real paired name', () => {
  assert.equal(
    ctx.resolvePairedPassengerName('PAX-1', '旅人', { passengerId: 'PAX-1', name: 'Morgan' }),
    'Morgan',
  );
});

test('a real incoming name still updates the kiosk profile', () => {
  assert.equal(
    ctx.resolvePairedPassengerName('PAX-1', '  新名  ', { passengerId: 'PAX-1', name: '舊名' }),
    '新名',
  );
});
