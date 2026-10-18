import { listReviewSamples, type ReviewSample } from '../notion/reviews';
import { parseReviewEntries } from './ratings';

function clip(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
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

function formatRow(row: RatedRow): string {
  const who = row.account ? `@${row.account}` : '';
  const note = clip(row.note.replace(/\[[^\]]+\]/g, ''), 80);
  return `${row.score}分｜${who}｜${clip(row.text)}${note ? `｜評：${note}` : ''}`;
}

function blockFor(samples: ReviewSample[], kind: 'takeoff' | 'landing'): string {
  const rated = pickRated(samples, kind);
  if (!rated.length) return '';
  const good = rated.filter((item) => item.score >= 8).slice(0, 2);
  const bad = rated.filter((item) => item.score <= 4).slice(-2).reverse();
  const fallbackGood = good.length ? good : rated.slice(0, 1);
  const fallbackBad = bad.length ? bad : (rated.length > 1 ? rated.slice(-1) : []);
  const lines = [
    kind === 'takeoff' ? '審查台過往起飛廣播評分，高分請靠近，低分請避開同樣問題：' : '審查台過往降落廣播評分，高分請靠近，低分請避開同樣問題：',
  ];
  if (fallbackGood.length) {
    lines.push('高分：');
    lines.push(...fallbackGood.map((item) => `- ${formatRow(item)}`));
  }
  if (fallbackBad.length && fallbackBad[0].sampleId !== fallbackGood[0]?.sampleId) {
    lines.push('低分：');
    lines.push(...fallbackBad.map((item) => `- ${formatRow(item)}`));
  }
  return lines.join('\n');
}

export async function loadReviewCalibration(): Promise<{ takeoff: string; landing: string }> {
  try {
    const samples = await listReviewSamples(40);
    return {
      takeoff: blockFor(samples, 'takeoff'),
      landing: blockFor(samples, 'landing'),
    };
  } catch {
    return { takeoff: '', landing: '' };
  }
}
