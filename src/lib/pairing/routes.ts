import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Router, type Request, type Response } from 'express';

const router = Router();
const prefix = process.env.PAIRING_REDIS_PREFIX || 'sleep-airline:pairing:v1';
const appOrigin = process.env.PAIRING_APP_ORIGIN || 'https://night-departures.vercel.app';
const grantLifetimeSeconds = 15 * 60;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const paxKey = (id: string) => `${prefix}:passenger:${id}`;
const deviceKey = (id: string) => `${prefix}:device:${id}`;
const sessionKey = (token: string) => `${prefix}:session:${sha(token)}`;
const usedKey = (nonce: string) => `${prefix}:used:${sha(nonce)}`;
const random = () => randomBytes(32).toString('base64url');
const validId = (id: unknown, prefix: string) => typeof id === 'string' && new RegExp(`^${prefix}-[A-Z0-9]{8,32}$`).test(id);
const validSecret = (value: unknown) => typeof value === 'string' && value.length >= 32 && value.length <= 128;

function configured() {
  return !!((process.env.PAIRING_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)
    && (process.env.PAIRING_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
    && process.env.PAIRING_SIGNING_SECRET?.length && process.env.PAIRING_SIGNING_SECRET.length >= 32);
}

async function redis<T>(args: Array<string | number>): Promise<T> {
  const url = process.env.PAIRING_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.PAIRING_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Pairing Redis unavailable');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`Pairing Redis HTTP ${response.status}`);
  const data = await response.json() as { result: T; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}

function sameHash(left: string, right: string) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', process.env.PAIRING_SIGNING_SECRET!).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token: unknown): { passengerId: string; deviceId: string; setupHash: string; expires: number; nonce: string } | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra) return null;
  const expected = createHmac('sha256', process.env.PAIRING_SIGNING_SECRET!).update(body).digest();
  const actual = Buffer.from(mac, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!validId(data.passengerId, 'PAX') || !validId(data.deviceId, 'SA') ||
      typeof data.setupHash !== 'string' || typeof data.nonce !== 'string' ||
      !Number.isInteger(data.expires) || data.expires < Date.now()) return null;
    return data;
  } catch { return null; }
}

function fail(res: Response, code: number, error: string) { res.status(code).json({ error }); }
async function passenger(req: Request): Promise<string | null> {
  const token = req.get('authorization')?.replace(/^Bearer /, '') || '';
  if (!validSecret(token)) return null;
  return await redis<string | null>(['GET', sessionKey(token)]);
}

router.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin === appOrigin || /^http:\/\/localhost:\d+$/.test(origin || '')) {
    res.setHeader('Access-Control-Allow-Origin', origin!);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (origin && origin !== appOrigin && !/^http:\/\/localhost:\d+$/.test(origin)) {
    fail(res, 403, 'origin_not_allowed'); return;
  }
  if (!configured()) { fail(res, 503, 'pairing_not_configured'); return; }
  next();
});

router.post('/passengers', async (req, res) => {
  try {
    const { passengerId, recoveryCode } = req.body || {};
    if (!validId(passengerId, 'PAX') || !validSecret(recoveryCode)) return fail(res, 400, 'invalid_identity');
    const created = await redis<number>(['HSETNX', paxKey(passengerId), 'recovery', sha(recoveryCode)]);
    if (created !== 1) return fail(res, 409, 'passenger_exists');
    const session = random();
    await redis(['SET', sessionKey(session), passengerId, 'EX', 30 * 86400]);
    res.status(201).json({ passengerId, session });
  } catch { fail(res, 503, 'pairing_store_unavailable'); }
});

router.post('/sessions', async (req, res) => {
  try {
    const { passengerId, recoveryCode } = req.body || {};
    if (!validId(passengerId, 'PAX') || !validSecret(recoveryCode)) return fail(res, 400, 'invalid_identity');
    const stored = await redis<string | null>(['HGET', paxKey(passengerId), 'recovery']);
    if (!stored || !sameHash(stored, sha(recoveryCode))) return fail(res, 401, 'invalid_recovery_code');
    const session = random();
    await redis(['SET', sessionKey(session), passengerId, 'EX', 30 * 86400]);
    res.json({ passengerId, session });
  } catch { fail(res, 503, 'pairing_store_unavailable'); }
});

router.post('/grants', async (req, res) => {
  try {
    const id = await passenger(req);
    if (!id) return fail(res, 401, 'session_expired');
    const { deviceId, setupCode } = req.body || {};
    if (!validId(deviceId, 'SA') || !validSecret(setupCode)) return fail(res, 400, 'invalid_setup_code');
    const bound = await redis<string | null>(['HGET', paxKey(id), 'device']);
    if (bound && bound !== deviceId) return fail(res, 409, 'passenger_already_bound');
    const grant = sign({ passengerId: id, deviceId, setupHash: sha(setupCode), expires: Date.now() + grantLifetimeSeconds * 1000, nonce: random() });
    res.json({ grant, expiresIn: grantLifetimeSeconds });
  } catch { fail(res, 503, 'pairing_store_unavailable'); }
});

const completeScript = `
if redis.call('EXISTS', KEYS[2]) == 0 then return 'unknown_passenger' end
if redis.call('EXISTS', KEYS[3]) == 1 then return 'grant_used' end
local secret = redis.call('HGET', KEYS[1], 'secret')
if secret and secret ~= ARGV[1] then return 'device_identity_mismatch' end
local current = redis.call('HGET', KEYS[1], 'passenger')
if current and current ~= ARGV[2] then return 'device_already_bound' end
local prior = redis.call('HGET', KEYS[2], 'device')
if prior and prior ~= ARGV[3] then return 'passenger_already_bound' end
redis.call('HSET', KEYS[1], 'secret', ARGV[1], 'passenger', ARGV[2])
redis.call('HSET', KEYS[2], 'device', ARGV[3])
redis.call('SET', KEYS[3], '1', 'EX', 86400)
return 'paired'`;

router.post('/devices/complete', async (req, res) => {
  try {
    const { deviceId, deviceSecret, setupCode, grant } = req.body || {};
    const data = verify(grant);
    if (!validId(deviceId, 'SA') || !validSecret(deviceSecret) || !validSecret(setupCode) ||
      !data || data.deviceId !== deviceId || !sameHash(data.setupHash, sha(setupCode))) {
      return fail(res, 401, 'invalid_grant');
    }
    const outcome = await redis<string>(['EVAL', completeScript, 3,
      deviceKey(deviceId), paxKey(data.passengerId), usedKey(data.nonce), sha(deviceSecret), data.passengerId, deviceId]);
    if (outcome !== 'paired') return fail(res, 409, outcome);
    res.json({ status: 'paired', passengerId: data.passengerId, deviceId });
  } catch { fail(res, 503, 'pairing_store_unavailable'); }
});

router.get('/status', async (req, res) => {
  try {
    const id = await passenger(req);
    if (!id) return fail(res, 401, 'session_expired');
    const deviceId = await redis<string | null>(['HGET', paxKey(id), 'device']);
    res.json({ passengerId: id, deviceId, status: deviceId ? 'paired' : 'unpaired' });
  } catch { fail(res, 503, 'pairing_store_unavailable'); }
});

router.post('/devices/status', async (req, res) => {
  try {
    const { deviceId, deviceSecret } = req.body || {};
    if (!validId(deviceId, 'SA') || !validSecret(deviceSecret)) return fail(res, 400, 'invalid_device');
    const stored = await redis<string | null>(['HGET', deviceKey(deviceId), 'secret']);
    if (!stored || !sameHash(stored, sha(deviceSecret))) return fail(res, 404, 'device_not_registered');
    const passengerId = await redis<string | null>(['HGET', deviceKey(deviceId), 'passenger']);
    res.json({ deviceId, passengerId, status: passengerId ? 'paired' : 'unpaired' });
  } catch { fail(res, 503, 'pairing_store_unavailable'); }
});

const unbindScript = `
local device = redis.call('HGET', KEYS[1], 'device')
if not device then return 'unpaired' end
if device ~= ARGV[1] then return 'changed' end
if redis.call('HGET', KEYS[2], 'passenger') ~= ARGV[2] then return 'changed' end
redis.call('HDEL', KEYS[1], 'device')
redis.call('HDEL', KEYS[2], 'passenger')
return 'unpaired'`;

router.post('/unbind', async (req, res) => {
  try {
    const id = await passenger(req);
    if (!id) return fail(res, 401, 'session_expired');
    const deviceId = await redis<string | null>(['HGET', paxKey(id), 'device']);
    if (!deviceId) { res.json({ status: 'unpaired' }); return; }
    const result = await redis<string>(['EVAL', unbindScript, 2, paxKey(id), deviceKey(deviceId), deviceId, id]);
    if (result !== 'unpaired') return fail(res, 409, 'binding_changed');
    res.json({ status: 'unpaired' });
  } catch { fail(res, 503, 'pairing_store_unavailable'); }
});

export default router;
