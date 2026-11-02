import { listReviewSamples, type ReviewSample } from '../notion/reviews';
import { normalizeReviewScore, parseReviewEntries } from './ratings';

function clip(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

function cleanNote(note: string, max = 120): string {
  const text = clip(note.replace(/\[[^\]]+\]/g, ''), max);
  if (!text || /^文字評分\s*\d+\s*分$/.test(text)) return '';
  return text;
}

export function taipeiYmd(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date);
}

export function stampYmd(value: string): string {
  const normalized = String(value || '').replace(/\u202f|\u00a0/g, ' ').trim();
  const slash = normalized.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    return `${slash[1]}-${String(slash[2]).padStart(2, '0')}-${String(slash[3]).padStart(2, '0')}`;
  }
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) return taipeiYmd(new Date(parsed));
  return '';
}

export function isTodayStamp(value: string, now = new Date()): boolean {
  const ymd = stampYmd(value);
  return Boolean(ymd) && ymd === taipeiYmd(now);
}

type RatedRow = {
  sampleId: string;
  score: number;
  account: string;
  note: string;
  text: string;
};

function pickRated(samples: ReviewSample[], kind: 'takeoff' | 'landing'): RatedRow[] {
  const rows: RatedRow[] = [];
  for (const item of samples) {
    const text = kind === 'takeoff' ? item.takeoffBroadcast : item.landingBroadcast;
    if (!text.trim()) continue;
    const entries = parseReviewEntries(item.comments).filter((entry) => entry.score != null);
    if (entries.length) {
      for (const entry of entries) {
        rows.push({
          sampleId: item.sampleId,
          score: entry.score as number,
          account: entry.account,
          note: entry.comment,
          text,
        });
      }
      continue;
    }
    if (item.textScore != null) {
      const score = normalizeReviewScore(item.textScore);
      if (score == null) continue;
      rows.push({
        sampleId: item.sampleId,
        score,
        account: item.reviewer,
        note: item.comments,
        text,
      });
    }
  }
  return rows.sort((a, b) => b.score - a.score);
}

function formatNoteLine(account: string, score: number | null, note: string): string {
  const who = account ? `@${account}` : '';
  const scoreBit = score != null ? `${score}分｜` : '';
  return `${scoreBit}${who}｜${note}`.replace(/｜{2,}/g, '｜').replace(/^｜/, '');
}

function collectNotes(
  samples: ReviewSample[],
  kind: 'takeoff' | 'landing',
  now = new Date()
): { today: string[]; earlier: string[] } {
  const today: string[] = [];
  const earlier: string[] = [];
  const seen = new Set<string>();
  for (const item of samples) {
    const text = kind === 'takeoff' ? item.takeoffBroadcast : item.landingBroadcast;
    if (!text.trim()) continue;
    const entries = parseReviewEntries(item.comments);
    const pushNote = (account: string, score: number | null, comment: string, at: string) => {
      const fresh = isTodayStamp(at, now) || isTodayStamp(item.updatedAt, now) || isTodayStamp(item.createdAt, now);
      const note = cleanNote(comment, fresh ? 800 : 180);
      if (!note) return;
      const key = note.toLocaleLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const line = formatNoteLine(account, score, note);
      if (fresh) today.push(line);
      else earlier.push(line);
    };
    if (entries.length) {
      for (const entry of entries) {
        pushNote(entry.account, entry.score, entry.comment, entry.at);
      }
      continue;
    }
    if (item.comments.trim()) {
      pushNote(item.reviewer, item.textScore, item.comments, item.updatedAt || item.createdAt);
    }
  }
  return { today, earlier: earlier.slice(0, 6) };
}

function formatRow(row: RatedRow): string {
  const who = row.account ? `@${row.account}` : '';
  const note = cleanNote(row.note, 180);
  return `${row.score}分｜${who}｜${clip(row.text)}${note ? `｜評：${note}` : ''}`;
}

export function buildReviewCalibration(
  samples: ReviewSample[],
  kind: 'takeoff' | 'landing',
  now = new Date()
): string {
  const rated = pickRated(samples, kind);
  const { today, earlier } = collectNotes(samples, kind, now);
  if (!rated.length && !today.length && !earlier.length) return '';
  const good = rated.filter((item) => item.score >= 4).slice(0, 3);
  const bad = rated.filter((item) => item.score <= 2).slice(-3).reverse();
  const fallbackGood = good.length ? good : rated.slice(0, 1);
  const fallbackBad = bad.length ? bad : (rated.length > 1 ? rated.slice(-1) : []);
  const lines = [
    kind === 'takeoff'
      ? '審查台評語是生成指令，不是可選風格。今日評語權重最高，必須整段遵守；高分請靠近其具體程度與節奏；低分與評語點名的空話、套句、重複風景、不像這個地方的內容不要再犯。不要複製這裡的廣播原文。'
      : '審查台評語是生成指令，不是可選風格。今日評語權重最高，必須整段遵守；高分請靠近其具體程度與節奏；低分與評語點名的空話、套句、重複風景、不像這個城市的內容不要再犯。不要複製這裡的廣播原文。',
  ];
  if (today.length) {
    lines.push('今日評語（最高優先，必須整段當成 prompt 遵守）：');
    lines.push(...today.map((item) => `- ${item}`));
  }
  if (fallbackGood.length) {
    lines.push('高分：');
    lines.push(...fallbackGood.map((item) => `- ${formatRow(item)}`));
  }
  if (fallbackBad.length && fallbackBad[0].sampleId !== fallbackGood[0]?.sampleId) {
    lines.push('低分：');
    lines.push(...fallbackBad.map((item) => `- ${formatRow(item)}`));
  }
  if (earlier.length) {
    lines.push('較早評語：');
    lines.push(...earlier.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}

export async function loadReviewCalibration(): Promise<{ takeoff: string; landing: string }> {
  try {
    const samples = await listReviewSamples(80);
    const now = new Date();
    return {
      takeoff: buildReviewCalibration(samples, 'takeoff', now),
      landing: buildReviewCalibration(samples, 'landing', now),
    };
  } catch {
    return { takeoff: '', landing: '' };
  }
}
