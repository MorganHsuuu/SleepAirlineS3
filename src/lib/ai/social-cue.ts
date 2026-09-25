import OpenAI from 'openai';
import type { SocialCueCandidate } from '../flight/social-candidates';

const DIRECTION_LABEL: Record<string, string> = {
  auto: '自動航線',
  eastbound: '向東',
  westbound: '向西',
  northbound: '向北',
  southbound: '向南',
  northeast: '東北',
  northwest: '西北',
  southeast: '東南',
  southwest: '西南',
  circular: '環形',
  unknown: '未定',
};

function factsToLines(facts: Record<string, string | number | null>): string {
  return Object.entries(facts)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

export function fallbackSocialCueText(candidate: SocialCueCandidate): string {
  const name = String(candidate.facts.teammateName ?? candidate.relatedPassenger ?? '');
  switch (candidate.cueType) {
    case 'teammate_arrival':
      return `${name} 已從 ${candidate.facts.departureLocation} 飛抵 ${candidate.facts.arrivalLocation}，飛行 ${candidate.facts.flightDuration}。`;
    case 'teammate_departure': {
      const dir = DIRECTION_LABEL[String(candidate.facts.routeDirection)] ?? String(candidate.facts.routeDirection);
      return `${name} 從 ${candidate.facts.departureLocation} 起飛，航向${dir}，已飛 ${candidate.facts.elapsedLabel}。`;
    }
    case 'route_convergence':
      return `若想靠近 ${name}（目前在 ${candidate.facts.teammatePlace}），可試著${candidate.facts.suggestDirection}飛行，約 ${candidate.facts.distanceKm} 公里。`;
    case 'teammate_in_sky':
      return `${name} 已夜航 ${candidate.facts.elapsedLabel}，估計還在 ${candidate.facts.skyRegion} 上空。`;
    case 'parallel_heading': {
      const dir = DIRECTION_LABEL[String(candidate.facts.routeDirection)] ?? String(candidate.facts.routeDirection);
      return `你和 ${name} 都選了${dir}——從 ${candidate.facts.selfDeparture} 與 ${candidate.facts.teammateDeparture} 出發的平行夜航。`;
    }
    case 'same_departure':
      return `你和 ${name} 都從 ${candidate.facts.departureLocation} 起飛——同城的夜航起點。`;
    case 'heading_contrast': {
      const selfDir = DIRECTION_LABEL[String(candidate.facts.selfDirection)] ?? String(candidate.facts.selfDirection);
      const otherDir = DIRECTION_LABEL[String(candidate.facts.teammateDirection)] ?? String(candidate.facts.teammateDirection);
      return `你航向${selfDir}，${name} 航向${otherDir}——小隊在夜空中走相反方向。`;
    }
    case 'squad_in_sky':
      return Number(candidate.facts.inFlightCount) > 0
        ? `小隊雷達掃到 ${candidate.facts.inFlightCount} 班還在夜航。`
        : `小隊雷達記下今晚已有 ${candidate.facts.landedCount} 班著陸。`;
    case 'fresh_arrival':
      return `${name} 剛在 ${candidate.facts.arrivalLocation} 降落。`;
    case 'first_of_night':
      return '今晚這片天空先交給你獨享，小隊雷達上還沒有其他航班。';
    case 'relay_flight':
      return `你已降落，${name} 仍在夜航中，從 ${candidate.facts.teammateDeparture} 繼續替小隊飛。`;
    case 'early_landing':
      return `${name} 比你更早降落在 ${candidate.facts.arrivalLocation}。`;
    case 'late_landing':
      return `${name} 在你之後也降落在 ${candidate.facts.arrivalLocation}。`;
    case 'solo':
    default:
      return '今晚你獨自享受這片天空。同組雷達上暫時只有你一人。';
  }
}

const TAKEOFF_SOCIAL_RULES = `
- 這是「起飛前」提示：只寫隊友已發生的事（已起飛、已飛多久、已降落在哪）
- 禁止：即將、將要、X 分鐘內、快抵達、下降、預計到達、即將降落
- 禁止把隊友所在城市／空域寫成「快要降落的地方」
- 如果 teammateStatus 是「飛行中」，禁止寫成已降落
- 如果只提供一位 teammateName，禁止寫成「隊友們」或「大家都」
- 禁止把本班乘客姓名寫成已起飛／正在飛的隊友
- first_of_night 或 solo：寫獨享天空，不要複誦乘客本人已經起飛`;

export async function generateSocialCueText(
  candidate: SocialCueCandidate,
  phase: 'takeoff' | 'landing' = 'landing'
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackSocialCueText(candidate);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const isTakeoff = phase === 'takeoff';

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `你是「甦醒航班 Sleep Airline」的社交提示撰寫者。
- 繁體中文，1 句為主，最多 2 句，30–55 字
- 夜航、溫柔、像機長低聲補一句同組動態
- 句子要像使用者可以拿去跟朋友接話，不要只像系統描述
- 只能使用提供的事實，不得編造地名、時間、人名
- 嚴格保留 teammateStatus：飛行中就只能說仍在飛／已飛多久；已降落才可說降落
- 嚴格保留數量：inFlightCount / landedCount 是 0 時，不得改寫成有人飛行或有人降落
- 不要把單一隊友擴寫成全體隊友；不要把部分隊友狀態擴寫成「隊友們都」
- 直接輸出提示正文，不加引號或標題${isTakeoff ? TAKEOFF_SOCIAL_RULES : ''}`,
        },
        {
          role: 'user',
          content: `類型：${candidate.cueType}
${factsToLines(candidate.facts)}

請改寫成一句社交提示。`,
        },
      ],
      max_tokens: 120,
      temperature: 0.9,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : fallbackSocialCueText(candidate);
  } catch {
    return fallbackSocialCueText(candidate);
  }
}
