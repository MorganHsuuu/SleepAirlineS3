import { listReviewSamples, type ReviewSample } from '../notion/reviews';
import { parseReviewEntries } from './ratings';

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
      rows.push({
        sampleId: item.sampleId,
        score: item.textScore,
        account: item.reviewer,
        note: item.comments,
        text,
      });
    }
  }
  return rows.sort((a, b) => b.score - a.score);
}

function pickNotes(samples: ReviewSample[], kind: 'takeoff' | 'landing'): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const item of samples) {
    const text = kind === 'takeoff' ? item.takeoffBroadcast : item.landingBroadcast;
    if (!text.trim()) continue;
    const entries = parseReviewEntries(item.comments);
    const pushNote = (account: string, score: number | null, comment: string) => {
      const note = cleanNote(comment);
      if (!note) return;
      const key = note.toLocaleLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const who = account ? `@${account}` : '';
      const scoreBit = score != null ? `${score}分｜` : '';
      notes.push(`${scoreBit}${who}｜${note}`.replace(/｜{2,}/g, '｜').replace(/^｜/, ''));
    };
    if (entries.length) {
      for (const entry of entries) pushNote(entry.account, entry.score, entry.comment);
      continue;
    }
    if (item.comments.trim()) pushNote(item.reviewer, item.textScore, item.comments);
  }
  return notes.slice(0, 8);
}

function formatRow(row: RatedRow): string {
  const who = row.account ? `@${row.account}` : '';
  const note = cleanNote(row.note, 120);
  return `${row.score}分｜${who}｜${clip(row.text)}${note ? `｜評：${note}` : ''}`;
}

function blockFor(samples: ReviewSample[], kind: 'takeoff' | 'landing'): string {
  const rated = pickRated(samples, kind);
  const notes = pickNotes(samples, kind);
  if (!rated.length && !notes.length) return '';
  const good = rated.filter((item) => item.score >= 8).slice(0, 3);
  const bad = rated.filter((item) => item.score <= 4).slice(-3).reverse();
  const fallbackGood = good.length ? good : rated.slice(0, 1);
  const fallbackBad = bad.length ? bad : (rated.length > 1 ? rated.slice(-1) : []);
  const lines = [
    kind === 'takeoff'
      ? '審查台過往起飛廣播的評分與評語。高分請靠近其具體程度與節奏；低分與評語點名的空話、套句、重複風景、不像這個地方的內容不要再犯。不要複製這裡的廣播原文。'
      : '審查台過往降落廣播的評分與評語。高分請靠近其具體程度與節奏；低分與評語點名的空話、套句、重複風景、不像這個城市的內容不要再犯。不要複製這裡的廣播原文。',
  ];
  if (fallbackGood.length) {
    lines.push('高分：');
    lines.push(...fallbackGood.map((item) => `- ${formatRow(item)}`));
  }
  if (fallbackBad.length && fallbackBad[0].sampleId !== fallbackGood[0]?.sampleId) {
    lines.push('低分：');
    lines.push(...fallbackBad.map((item) => `- ${formatRow(item)}`));
  }
  if (notes.length) {
    lines.push('近期評語（必須吸收）：');
    lines.push(...notes.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}

export async function loadReviewCalibration(): Promise<{ takeoff: string; landing: string }> {
  try {
    const samples = await listReviewSamples(80);
    return {
      takeoff: blockFor(samples, 'takeoff'),
      landing: blockFor(samples, 'landing'),
    };
  } catch {
    return { takeoff: '', landing: '' };
  }
}
