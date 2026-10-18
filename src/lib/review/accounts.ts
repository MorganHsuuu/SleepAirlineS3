import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import {
  REVIEW_ACCOUNTS_SAMPLE_ID,
  createReviewSample,
  getReviewSample,
  updateReviewSample,
} from '../notion/reviews';

const COOKIE = 'sa_review_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type StoredAccount = {
  account: string;
  password: string;
  createdAt: string;
};

type AccountFile = { v: 1; accounts: StoredAccount[] };

function signingSecret(): string {
  return process.env.REVIEW_AUTH_SECRET
    || process.env.NOTION_API_KEY
    || process.env.NOTION_REVIEW_DB_ID
    || 'sleep-airline-review-lab';
}

export function normalizeReviewAccount(raw: string): string {
  return String(raw || '').trim().replace(/^@/, '').slice(0, 20);
}

export function validReviewAccount(value: string): boolean {
  return /^[\w\u4e00-\u9fff]{2,20}$/.test(value);
}

function validPassword(value: string): boolean {
  return value.length >= 4 && value.length <= 72;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 32).toString('hex'), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signToken(account: string): string {
  const payload = Buffer.from(JSON.stringify({
    a: account,
    exp: Date.now() + MAX_AGE_MS,
  })).toString('base64url');
  const mac = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra) return null;
  const expected = createHmac('sha256', signingSecret()).update(payload).digest();
  const actual = Buffer.from(mac, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { a?: string; exp?: number };
    if (!data?.a || !Number.isFinite(data.exp) || data.exp < Date.now()) return null;
    const account = normalizeReviewAccount(data.a);
    return validReviewAccount(account) ? account : null;
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function cookieHeader(value: string, clear = false): string {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  if (clear) {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}${secure}`;
}

export function setReviewAccountCookie(res: Response, account: string) {
  res.setHeader('Set-Cookie', cookieHeader(signToken(account)));
}

export function clearReviewAccountCookie(res: Response) {
  res.setHeader('Set-Cookie', cookieHeader('', true));
}

export function reviewAccountFromRequest(req: Request): string | null {
  return readToken(readCookie(req, COOKIE));
}

async function loadFile(): Promise<AccountFile> {
  const sample = await getReviewSample(REVIEW_ACCOUNTS_SAMPLE_ID);
  if (!sample?.comments) return { v: 1, accounts: [] };
  try {
    const parsed = JSON.parse(sample.comments) as AccountFile;
    if (parsed?.v === 1 && Array.isArray(parsed.accounts)) return parsed;
  } catch { /* empty registry */ }
  return { v: 1, accounts: [] };
}

async function saveFile(file: AccountFile): Promise<void> {
  const body = JSON.stringify(file);
  const existing = await getReviewSample(REVIEW_ACCOUNTS_SAMPLE_ID);
  if (existing) {
    await updateReviewSample(REVIEW_ACCOUNTS_SAMPLE_ID, { comments: body, phase: existing.phase });
    return;
  }
  await createReviewSample({
    sampleId: REVIEW_ACCOUNTS_SAMPLE_ID,
    phase: 'draft',
    comments: body,
    reviewer: 'system',
  });
}

export async function registerReviewAccount(accountRaw: string, password: string): Promise<string> {
  const account = normalizeReviewAccount(accountRaw);
  if (!validReviewAccount(account)) throw new Error('帳號請用 2–20 字，中英數或底線。');
  if (!validPassword(password)) throw new Error('密碼至少 4 個字。');
  const file = await loadFile();
  if (file.accounts.some((item) => item.account.toLowerCase() === account.toLowerCase())) {
    throw new Error('這個帳號已經有人用了。');
  }
  file.accounts.push({
    account,
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
  });
  await saveFile(file);
  return account;
}

export async function loginReviewAccount(accountRaw: string, password: string): Promise<string> {
  const account = normalizeReviewAccount(accountRaw);
  if (!validReviewAccount(account) || !validPassword(password)) {
    throw new Error('帳號或密碼不對。');
  }
  const file = await loadFile();
  const found = file.accounts.find((item) => item.account.toLowerCase() === account.toLowerCase());
  if (!found || !checkPassword(password, found.password)) {
    throw new Error('帳號或密碼不對。');
  }
  return found.account;
}
