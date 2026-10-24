export type ReviewEntry = {
  account: string;
  score: number | null;
  comment: string;
  at: string;
};

/** 讀取與寫入都用 1–5。大於 5 的舊 10 分制折半。 */
export function normalizeReviewScore(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Math.round(Number(value));
  if (n <= 0) return null;
  if (n > 5) return Math.max(1, Math.min(5, Math.round(n / 2)));
  return Math.max(1, Math.min(5, n));
}

function clipAccount(value: string): string {
  return value.replace(/^@/, '').trim().slice(0, 20);
}

function peelTimestamp(comment: string, at: string): { comment: string; at: string } {
  const match = comment.match(/^(\d{4}\/\d{1,2}\/\d{1,2}[^\n]*)\n+([\s\S]*)$/);
  if (!match) return { comment: comment.trim(), at };
  return { at: at || match[1].trim(), comment: match[2].trim() };
}

function parseHeader(header: string): Pick<ReviewEntry, 'account' | 'score' | 'at'> {
  const dotted = header.split(/\s*·\s*/).map((part) => part.trim()).filter(Boolean);
  if (dotted[0]?.startsWith('@')) {
    const bits = dotted[0].replace(/^@/, '').split(/\s+/).filter(Boolean);
    const account = clipAccount(bits[0] || '');
    const rest = dotted.slice(1);
    if (bits[1] && /^\d{1,2}$/.test(bits[1])) {
      return { account, score: Number(bits[1]), at: rest.join(' · ') };
    }
    if (rest[0] && /^\d{1,2}$/.test(rest[0])) {
      return { account, score: Number(rest[0]), at: rest.slice(1).join(' · ') };
    }
    return { account, score: null, at: rest.join(' · ') };
  }
  const modern = header.match(/^@([^\s]+)\s+(\d+)(?:\s+(.*))?$/);
  if (modern) {
    return { account: clipAccount(modern[1]), score: Number(modern[2]), at: (modern[3] || '').trim() };
  }
  const named = header.match(/^@([^\s]+)(?:\s+(.*))?$/);
  if (named) {
    return { account: clipAccount(named[1]), score: null, at: (named[2] || '').trim() };
  }
  const scored = header.match(/^(.*)\s+分數\s+(\d+)\s*$/);
  if (scored) {
    const bits = scored[1].trim().split(/\s+/);
    return {
      account: clipAccount(bits[bits.length - 1] || '匿名'),
      score: Number(scored[2]),
      at: bits.slice(0, -1).join(' '),
    };
  }
  const bits = header.trim().split(/\s+/);
  return {
    account: clipAccount(bits[bits.length - 1] || '匿名'),
    score: null,
    at: bits.slice(0, -1).join(' '),
  };
}

function collectReviewEntries(comments: string, normalize: boolean): ReviewEntry[] {
  const text = (comments || '').trim();
  if (!text) return [];
  const entries: ReviewEntry[] = [];
  const block = /\[([^\]]+)\]\n?([\s\S]*?)(?=\n\[|$)/g;
  let match: RegExpExecArray | null;
  while ((match = block.exec(text))) {
    const header = parseHeader(match[1].trim());
    if (!header.account) continue;
    const peeled = peelTimestamp(match[2], header.at);
    entries.push({
      account: header.account,
      score: normalize ? normalizeReviewScore(header.score) : header.score,
      at: peeled.at,
      comment: peeled.comment,
    });
  }
  return entries;
}

export function parseReviewEntries(comments: string): ReviewEntry[] {
  return collectReviewEntries(comments, true);
}

export function parseReviewEntriesRaw(comments: string): ReviewEntry[] {
  return collectReviewEntries(comments, false);
}

export function formatReviewEntry(entry: ReviewEntry): string {
  const bits = [`@${entry.account}`];
  if (entry.score != null) bits.push(String(entry.score));
  if (entry.at) bits.push(entry.at);
  return `[${bits.join(' · ')}]\n${entry.comment}`.trim();
}

export function upsertReviewEntry(
  comments: string,
  account: string,
  score: number | null,
  comment: string
): ReviewEntry[] {
  const name = clipAccount(account);
  const stamp = new Date().toLocaleString('zh-TW', { hour12: false });
  const rest = parseReviewEntries(comments).filter(
    (item) => item.account.toLowerCase() !== name.toLowerCase()
  );
  const nextScore = normalizeReviewScore(score);
  rest.push({
    account: name,
    score: nextScore,
    comment: comment.trim() || (nextScore != null ? `文字評分 ${nextScore} 分` : ''),
    at: stamp,
  });
  return rest;
}

export function serializeReviewEntries(entries: ReviewEntry[]): string {
  return entries.map(formatReviewEntry).join('\n\n').slice(-18000);
}

export function scoreForAccount(comments: string, account: string | null | undefined): number | null {
  if (!account) return null;
  const name = clipAccount(account).toLowerCase();
  const found = parseReviewEntries(comments).find((item) => item.account.toLowerCase() === name);
  return found?.score ?? null;
}
