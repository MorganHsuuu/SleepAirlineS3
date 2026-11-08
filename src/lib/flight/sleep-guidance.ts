import type { Flight } from '../../types';
import { getLastLandedFlight, parseFlight } from '../notion/flights';
import { getNotionClient, isNotionConfigured } from '../notion/client';
import { resolveDashboardDbId } from '../notion/ensure-dashboard';

export type SleepNote = {
  moodAfter: number | null;
  sleepQuality: number | null;
  selfReportedSleepMinutes: number | null;
  sleepOpportunityMinutes: number | null;
  landingTime: string | null;
};

function toNote(flight: Flight): SleepNote {
  return {
    moodAfter: typeof flight.moodAfter === 'number' ? flight.moodAfter : null,
    sleepQuality: typeof flight.sleepQuality === 'number' ? flight.sleepQuality : null,
    selfReportedSleepMinutes: typeof flight.selfReportedSleepMinutes === 'number'
      ? flight.selfReportedSleepMinutes : null,
    sleepOpportunityMinutes: typeof flight.sleepOpportunityMinutes === 'number'
      ? flight.sleepOpportunityMinutes : null,
    landingTime: flight.landingTime || null,
  };
}

function hasRecord(note: SleepNote): boolean {
  return note.moodAfter != null
    || note.sleepQuality != null
    || note.selfReportedSleepMinutes != null
    || note.sleepOpportunityMinutes != null;
}

function moodBand(mood: number): 'high' | 'mid' | 'low' {
  if (mood >= 70) return 'high';
  if (mood >= 40) return 'mid';
  return 'low';
}

export function formatSleepGuidancePrompt(notes: SleepNote[]): string | null {
  const usable = notes.filter(hasRecord);
  if (!usable.length) return null;
  const latest = usable[0];
  const mood = latest.moodAfter;
  const band = mood == null ? null : moodBand(mood);
  const olderMoods = usable.slice(1)
    .map((note) => note.moodAfter)
    .filter((value): value is number => typeof value === 'number');
  const lines = [
    '這是這位乘客過往降落後的真實睡眠／心情紀錄，必須當成今晚起飛廣播的生成指令，不是可選彩蛋。',
    '禁止唸出分數或量表；禁止責備、檢討，也禁止比較昨晚睡得怎樣。',
    '用兩句睡眠引導，像朋友輕輕敲門，比平常再多一點陪伴，溫柔鼓勵今晚可以怎麼睡；不要變成教練、諮商或冥想課。',
  ];
  if (mood != null) {
    lines.push(`最近一次心情 0–100（微笑高分、不笑低分）：${mood}`);
  }
  if (olderMoods.length) {
    lines.push(`更早的心情紀錄：${olderMoods.join('、')}`);
  }
  if (latest.sleepQuality != null) {
    lines.push(`自述睡眠品質 1–5：${latest.sleepQuality}`);
  }
  if (latest.selfReportedSleepMinutes != null) {
    lines.push(`自述睡著約 ${latest.selfReportedSleepMinutes} 分鐘`);
  }
  if (latest.sleepOpportunityMinutes != null) {
    lines.push(`上一班休息區間約 ${latest.sleepOpportunityMinutes} 分鐘（不是客觀睡著時間）`);
  }
  if (band === 'high') {
    lines.push('引導方向：他上次醒來心情不錯。輕輕接住這種鬆的感覺，邀請今晚再把身體交給這段飛行，不必加油打氣。');
  } else if (band === 'mid') {
    lines.push('引導方向：今晚可以比上次更鬆一點。願意的話閉眼、肩膀放下就好，不勉強睡著。');
  } else if (band === 'low') {
    lines.push('引導方向：更慢、更輕。告訴他今晚什麼都不用做好，願意的話把眼睛閉上就夠了。');
  } else {
    lines.push('引導方向：用預設柔軟邀請：願意的話閉眼、肩膀放鬆、自然呼吸。');
  }
  return lines.join('\n');
}

export function fallbackSleepInvitation(notes: SleepNote[] | null | undefined, locale: 'zh' | 'en' = 'zh'): string {
  const mood = notes?.find((note) => typeof note.moodAfter === 'number')?.moodAfter;
  if (locale === 'en') {
    if (mood != null && mood < 40) {
      return 'If you like, there is nothing to get right tonight — close the eyes when you are ready, and let the shoulders drop. This flight will keep you company; there is nothing to rush. ';
    }
    if (mood != null && mood < 70) {
      return 'If you are willing, tonight can be even softer: close the eyes, ease the shoulders, and let the breath come on its own. Let this stretch of sky hold you for a while. ';
    }
    if (mood != null) {
      return 'If you are willing, settle in that same easy way — close the eyes, ease the shoulders, and let the body rest again. Tonight the cabin can keep that softness a little longer. ';
    }
    const cues = [
      'If you are willing, close your eyes, ease your shoulders, and breathe naturally. Let this flight keep you company. ',
      'If you like, let the eyes close, drop the shoulders, and let the breath come on its own. Nothing needs to be finished tonight. ',
      'Whenever you are ready, close your eyes, soften the shoulders, and breathe naturally. The night can take it from here. ',
    ];
    return cues[Math.abs(Number(mood) || 0) % cues.length];
  }
  if (mood != null && mood < 40) {
    return '您願意的話，今晚什麼都不用做好，把眼睛閉上，讓肩膀自己落下就夠了。這段飛行會慢慢陪著你，什麼都不必趕。';
  }
  if (mood != null && mood < 70) {
    return '您願意的話，今晚可以更鬆一點：把眼睛閉上，肩膀放下，呼吸自然就好，不勉強睡著。讓這段夜航再多陪你一會兒。';
  }
  if (mood != null) {
    return '您願意的話，可以再把身體交給今晚這段飛行，閉上眼睛，讓肩膀鬆開。機艙可以再把那份鬆的感覺留久一點。';
  }
  return '您願意的話，可以先把眼睛閉上，肩膀放鬆，自然而然地呼吸。今晚這段飛行會慢慢陪著你，什麼都不必趕。';
}

export async function loadPassengerSleepNotes(passengerId: string): Promise<SleepNote[]> {
  if (!passengerId) return [];
  if (!isNotionConfigured()) {
    const last = await getLastLandedFlight(passengerId);
    return last && hasRecord(toNote(last)) ? [toNote(last)] : [];
  }
  try {
    const client = getNotionClient();
    const dbId = await resolveDashboardDbId();
    const result = await client.databases.query({
      database_id: dbId,
      filter: {
        and: [
          { property: 'Passenger ID', rich_text: { equals: passengerId } },
          { property: 'Status', select: { equals: 'landed' } },
        ],
      },
      sorts: [{ property: 'Landing Time', direction: 'descending' }],
      page_size: 5,
    });
    return result.results
      .map((page) => toNote(parseFlight(page as unknown as Record<string, unknown>)))
      .filter(hasRecord);
  } catch {
    const last = await getLastLandedFlight(passengerId).catch(() => null);
    return last && hasRecord(toNote(last)) ? [toNote(last)] : [];
  }
}
