import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Router, type Request, type Response } from 'express';
import {
  PairingStoreError, bindDevice, createPassenger, devicesForPassenger, findDevice, findPassenger,
  unbindDevice,
} from './notion-store';

const router = Router();
const appOrigin = process.env.PAIRING_APP_ORIGIN || 'https://night-departures.vercel.app';
const grantLifetimeSeconds = 15 * 60;
const sessionLifetimeSeconds = 30 * 86400;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const validId = (id: unknown, prefix: string) => typeof id === 'string' && new RegExp(`^${prefix}-[A-Z0-9]{8,32}$`).test(id);
const validSecret = (value: unknown) => typeof value === 'string' && value.length >= 32 && value.length <= 128;

function configured() {
  return !!(process.env.NOTION_API_KEY && process.env.NOTION_PARENT_PAGE_ID && process.env.NOTION_PAIRING_DB_ID &&
    process.env.PAIRING_SIGNING_SECRET && process.env.PAIRING_SIGNING_SECRET.length >= 32);
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

function verifySigned(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra) return null;
  const expected = createHmac('sha256', process.env.PAIRING_SIGNING_SECRET!).update(body).digest();
  const actual = Buffer.from(mac, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object' || !Number.isInteger(data.expires) || data.expires < Date.now()) return null;
    return data;
  } catch { return null; }
}

function verifyGrant(token: unknown): { passengerId: string; deviceId: string; setupHash: string; nonce: string } | null {
  const data = verifySigned(token);
  if (!data || data.kind !== 'grant' || !validId(data.passengerId, 'PAX') || !validId(data.deviceId, 'SA') ||
    typeof data.setupHash !== 'string' || typeof data.nonce !== 'string') return null;
  return data as { passengerId: string; deviceId: string; setupHash: string; nonce: string };
}

function fail(res: Response, code: number, error: string) { res.status(code).json({ error }); }
function storeFailure(res: Response, cause: unknown) {
  if (cause instanceof PairingStoreError) {
    const conflict = ['duplicate_pairing_record', 'pairing_record_mismatch', 'multiple_device_bindings'].includes(cause.code);
    fail(res, conflict ? 409 : 503, cause.code);
    return;
  }
  const error = cause as { name?: string; code?: string; status?: number; message?: string } | null;
  console.error('pairing_store_unavailable', {
    name: error?.name, code: error?.code, status: error?.status, message: error?.message,
  });
  fail(res, 503, 'pairing_store_unavailable');
}

async function passenger(req: Request): Promise<string | null> {
  const token = req.get('authorization')?.replace(/^Bearer /, '') || '';
  const data = verifySigned(token);
  if (!data || data.kind !== 'session' || !validId(data.passengerId, 'PAX')) return null;
  const id = data.passengerId as string;
  return await findPassenger(id) ? id : null;
}

async function boundDevice(passengerId: string) {
  const devices = await devicesForPassenger(passengerId);
  if (devices.length > 1) throw new PairingStoreError('multiple_device_bindings');
  return devices[0] || null;
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
    if (!await createPassenger(passengerId, sha(recoveryCode))) return fail(res, 409, 'passenger_exists');
    const session = sign({ kind: 'session', passengerId, expires: Date.now() + sessionLifetimeSeconds * 1000, nonce: random() });
    res.status(201).json({ passengerId, session });
  } catch (cause) { storeFailure(res, cause); }
});

router.post('/sessions', async (req, res) => {
  try {
    const { passengerId, recoveryCode } = req.body || {};
    if (!validId(passengerId, 'PAX') || !validSecret(recoveryCode)) return fail(res, 400, 'invalid_identity');
    const stored = await findPassenger(passengerId);
    if (!stored || !sameHash(stored.recoveryHash, sha(recoveryCode))) return fail(res, 401, 'invalid_recovery_code');
    const session = sign({ kind: 'session', passengerId, expires: Date.now() + sessionLifetimeSeconds * 1000, nonce: random() });
    res.json({ passengerId, session });
  } catch (cause) { storeFailure(res, cause); }
});

router.post('/grants', async (req, res) => {
  try {
    const id = await passenger(req);
    if (!id) return fail(res, 401, 'session_expired');
    const { deviceId, setupCode } = req.body || {};
    if (!validId(deviceId, 'SA') || !validSecret(setupCode)) return fail(res, 400, 'invalid_setup_code');
    const bound = await boundDevice(id);
    if (bound && bound.deviceId !== deviceId) return fail(res, 409, 'passenger_already_bound');
    const grant = sign({ kind: 'grant', passengerId: id, deviceId, setupHash: sha(setupCode), expires: Date.now() + grantLifetimeSeconds * 1000, nonce: random() });
    res.json({ grant, expiresIn: grantLifetimeSeconds });
  } catch (cause) { storeFailure(res, cause); }
});

router.post('/devices/complete', async (req, res) => {
  try {
    const { deviceId, deviceSecret, setupCode, grant } = req.body || {};
    const data = verifyGrant(grant);
    if (!validId(deviceId, 'SA') || !validSecret(deviceSecret) || !validSecret(setupCode) ||
      !data || data.deviceId !== deviceId || !sameHash(data.setupHash, sha(setupCode))) {
      return fail(res, 401, 'invalid_grant');
    }
    if (!await findPassenger(data.passengerId)) return fail(res, 409, 'unknown_passenger');
    const device = await findDevice(deviceId);
    const secretHash = sha(deviceSecret);
    const grantHash = sha(data.nonce);
    if (device?.lastGrantHash === grantHash) return fail(res, 409, 'grant_used');
    if (device?.deviceSecretHash && !sameHash(device.deviceSecretHash, secretHash)) return fail(res, 409, 'device_identity_mismatch');
    if (device?.passengerId && device.passengerId !== data.passengerId) return fail(res, 409, 'device_already_bound');
    const prior = await boundDevice(data.passengerId);
    if (prior && prior.deviceId !== deviceId) return fail(res, 409, 'passenger_already_bound');
    await bindDevice({ deviceId, deviceSecretHash: secretHash, passengerId: data.passengerId, grantHash, existing: device });
    // Query again so concurrent edits or duplicate Notion rows fail closed.
    const current = await findDevice(deviceId);
    const bound = await boundDevice(data.passengerId);
    if (!current || current.passengerId !== data.passengerId || bound?.deviceId !== deviceId) {
      return fail(res, 409, 'binding_changed');
    }
    res.json({ status: 'paired', passengerId: data.passengerId, deviceId });
  } catch (cause) { storeFailure(res, cause); }
});

router.get('/status', async (req, res) => {
  try {
    const id = await passenger(req);
    if (!id) return fail(res, 401, 'session_expired');
    const deviceId = (await boundDevice(id))?.deviceId || null;
    res.json({ passengerId: id, deviceId, status: deviceId ? 'paired' : 'unpaired' });
  } catch (cause) { storeFailure(res, cause); }
});

router.post('/devices/status', async (req, res) => {
  try {
    const { deviceId, deviceSecret } = req.body || {};
    if (!validId(deviceId, 'SA') || !validSecret(deviceSecret)) return fail(res, 400, 'invalid_device');
    const stored = await findDevice(deviceId);
    if (!stored || !sameHash(stored.deviceSecretHash, sha(deviceSecret))) return fail(res, 404, 'device_not_registered');
    const passengerId = stored.passengerId;
    if (passengerId && (await boundDevice(passengerId))?.deviceId !== deviceId) return fail(res, 409, 'binding_changed');
    res.json({ deviceId, passengerId, status: passengerId ? 'paired' : 'unpaired' });
  } catch (cause) { storeFailure(res, cause); }
});

router.post('/unbind', async (req, res) => {
  try {
    const id = await passenger(req);
    if (!id) return fail(res, 401, 'session_expired');
    const device = await boundDevice(id);
    if (!device) { res.json({ status: 'unpaired' }); return; }
    const current = await findDevice(device.deviceId);
    if (!current || current.pageId !== device.pageId || current.passengerId !== id) return fail(res, 409, 'binding_changed');
    await unbindDevice(current);
    if (await boundDevice(id)) return fail(res, 409, 'binding_changed');
    res.json({ status: 'unpaired' });
  } catch (cause) { storeFailure(res, cause); }
});

export default router;
