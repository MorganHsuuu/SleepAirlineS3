import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getNotionClient, isNotionConfigured } from '../src/lib/notion/client.ts';
import {
  isSystemReviewSample,
  resolveReviewDbId,
  updateReviewSample,
} from '../src/lib/notion/reviews.ts';
import {
  normalizeReviewScore,
  parseReviewEntriesRaw,
  serializeReviewEntries,
} from '../src/lib/review/ratings.ts';

function rewriteFen(comment, nextScore) {
  if (nextScore == null) return comment;
  return String(comment || '').replace(/文字評分\s*\d+\s*分/g, `文字評分 ${nextScore} 分`);
}

const dbId = await resolveReviewDbId();
if (!isNotionConfigured() || !dbId) {
  throw new Error('審查庫尚未接上，無法換算舊分數。');
}

const client = getNotionClient();
const pages = [];
let cursor;
do {
  const response = await client.databases.query({
    database_id: dbId,
    start_cursor: cursor,
    page_size: 100,
  });
  pages.push(...response.results);
  cursor = response.has_more ? response.next_cursor : undefined;
} while (cursor);

function readSample(page) {
  const props = page.properties || {};
  const title = (props['Sample ID']?.title || []).map((part) => part.plain_text).join('');
  const comments = (props.Comments?.rich_text || []).map((part) => part.plain_text).join('');
  const textScore = props['Text Score']?.number ?? null;
  return { notionId: page.id, sampleId: title, comments, textScore };
}

let changed = 0;
const report = [];
for (const page of pages) {
  const sample = readSample(page);
  if (isSystemReviewSample(sample)) continue;
  const nextText = normalizeReviewScore(sample.textScore);
  const entries = parseReviewEntriesRaw(sample.comments);
  let commentsChanged = false;
  const nextEntries = entries.map((entry) => {
    const nextScore = normalizeReviewScore(entry.score);
    const nextComment = rewriteFen(entry.comment, nextScore);
    if (nextScore !== entry.score || nextComment !== entry.comment) commentsChanged = true;
    return { ...entry, score: nextScore, comment: nextComment };
  });
  const nextComments = commentsChanged ? serializeReviewEntries(nextEntries) : sample.comments;
  const textChanged = nextText !== sample.textScore;
  if (!textChanged && !commentsChanged) continue;
  await updateReviewSample(sample.sampleId, {
    textScore: nextText,
    comments: nextComments,
  });
  changed += 1;
  report.push({
    sampleId: sample.sampleId,
    textScore: [sample.textScore, nextText],
    entryScores: entries.map((entry, index) => [entry.score, nextEntries[index].score]),
  });
}

console.log(JSON.stringify({ pages: pages.length, changed, report }, null, 2));
