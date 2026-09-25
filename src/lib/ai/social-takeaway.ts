import OpenAI from 'openai';
import type { SocialCue } from '../../types';

/**
 * Social Takeaway：可以拿去跟隊友接話的社交短句。
 * primary cue 一句；人數多時可再加一句 rule-based group summary，最多兩句。
 * 第二句固定用規則文案，不交給 AI 改寫，避免「已降落」又說「都在翱翔」。
 */
export interface SocialTakeawayInput {
  phase: 'takeoff' | 'landing';
  passengerName: string;
  socialCue: SocialCue;
  routeDirection: string;
  departureLocation: string;
  arrivalLocation?: string | null;
  flightDurationMinutes?: number | null;
  estimatedDistanceKm?: number | null;
  groupSummary?: string | null;
}

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

function endSentence(text: string): string {
  const trimmed = text.trim().replace(/[。．.！!？?]+$/u, '');
  return trimmed ? `${trimmed}。` : '';
}

/** primary + optional group summary，最多兩句 */
export function composeSocialTakeaway(primary: string, groupSummary?: string | null): string {
  const first = endSentence(primary);
  const second = endSentence(groupSummary ?? '');
  if (!first) return second;
  if (!second) return first;
  return `${first}${second}`;
}

/**
 * 起飛階段若把「本班乘客」寫成已降落，屬於身分錯置（常把【乘客】誤當隊友）。
 * 落地階段不擋，因為本班本來就在講自己抵達。
 */
export function isSelfLandingTakeaway(
  text: string,
  passengerName: string,
  phase: 'takeoff' | 'landing'
): boolean {
  if (phase !== 'takeoff') return false;
  const name = passengerName.trim();
  if (!name || !text.trim()) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selfLanding = new RegExp(
    `${escaped}\\s*(已經|已|剛|剛剛)?\\s*(安全)?\\s*(降落|著陸|抵達|落地)`,
    'u'
  );
  return selfLanding.test(text);
}

/**
 * 起飛回聲是說給「你」聽的；若出現本班姓名＋第三人稱飛行敘事（翱翔／祝他），
 * 代表模型把乘客誤寫成被觀察的隊友。
 */
export function isMisaddressedSelfTakeaway(
  text: string,
  passengerName: string,
  phase: 'takeoff' | 'landing'
): boolean {
  if (phase !== 'takeoff') return false;
  const name = passengerName.trim();
  const body = text.trim();
  if (!name || !body) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe = new RegExp(escaped, 'iu');
  if (!nameRe.test(body)) return false;
  // 出現自己的名字，又用第三人稱描述飛行／祝福，就是錯置
  return /(翱翔|夜空|一路平安|祝他|祝她|還在飛|正在飛|已經起飛|現在在)/u.test(body);
}

function relatedTeammateName(input: SocialTakeawayInput): string {
  const related = input.socialCue.relatedPassenger?.trim() || '';
  const self = input.passengerName.trim();
  if (!related) return '一位隊友';
  if (self && related.toLowerCase() === self.toLowerCase()) return '一位隊友';
  return related;
}

/** AI 不可用時的規則式短句：依 cueType 給一句可接話的話 */
export function fallbackSocialTakeaway(input: SocialTakeawayInput): string {
  const name = relatedTeammateName(input);
  let primary = '';
  switch (input.socialCue.cueType) {
    case 'solo':
      primary = input.phase === 'takeoff'
        ? '今晚這片天空先交給你獨享。'
        : '今晚你完成了一趟安靜的個人航班。';
      break;
    case 'teammate_departure':
      primary = `${name} 已經起飛，小隊夜航開始了。`;
      break;
    case 'teammate_in_sky':
      primary = `${name} 還在飛，你不是唯一醒著的人。`;
      break;
    case 'teammate_arrival':
      primary = `${name} 已經降落，先替小隊探了路。`;
      break;
    case 'fresh_arrival':
      primary = `${name} 剛剛降落，小隊雷達亮了一下。`;
      break;
    case 'parallel_heading':
      primary = `你和 ${name} 昨晚真的往同個方向飛了。`;
      break;
    case 'same_departure':
      primary = `你和 ${name} 從同一座城市起飛。`;
      break;
    case 'heading_contrast':
      primary = `你和 ${name} 分頭飛，夜空剛好被拉開。`;
      break;
    case 'squad_in_sky':
      primary = '今晚小隊雷達很熱鬧。';
      break;
    case 'first_of_night':
      primary = '你是今晚小隊第一班起飛的航班。';
      break;
    case 'relay_flight':
      primary = `你降落後，${name} 繼續替小隊夜航。`;
      break;
    case 'early_landing':
      primary = `${name} 比你早降落，先抵達清晨。`;
      break;
    case 'late_landing':
      primary = `${name} 在你之後也完成降落。`;
      break;
    case 'route_convergence':
      primary = `你和 ${name} 的航線比想像中更靠近。`;
      break;
    default:
      primary = '小隊雷達記下了今晚的一段航程。';
  }

  const groupSummary = input.groupSummary ?? input.socialCue.groupSummary ?? null;
  return composeSocialTakeaway(primary, groupSummary);
}

/** 去掉模型偶爾加上的引號、標題；只留第一句（第二句改由規則組裝） */
function cleanPrimaryTakeaway(raw: string): string {
  const cleaned = raw
    .replace(/^["'「『”]+|["'」『』”]+$/g, '')
    .replace(/^(小隊回聲|Social Takeaway)[：:]\s*/i, '')
    .trim();
  const first = cleaned
    .split(/(?<=[。！？])/)
    .map((part) => part.trim())
    .find(Boolean);
  return first || cleaned;
}

const SYSTEM_PROMPT = `你是「甦醒航班 Sleep Airline」的社交語音短句撰寫者。
你的任務不是寫完整機長廣播，而是根據「一則主要雷達訊號」生成一句可拿去跟同組朋友接話的短句。

設計目標：
- 像「小隊雷達掃到一則訊號」，不是完整監控報告
- 只改寫這一則主要個人／事件訊號
- 不要自行補小隊人數、不要自行發明「大家都在飛／都已降落」

語氣：
- 繁體中文
- 口語、短、清楚、有一點可愛或玩笑
- 不要過度詩意

長度：
- 12–32 字
- 只輸出一句
- 不要列點、不要加標題、引號或說明

禁止：
- 禁止編造未提供的人名、地名、時間、人數
- 禁止說「大家都在翱翔」「全員起飛」「四位降落」這類未提供的全體狀態
- 禁止把飛行中的隊友說成已降落
- 禁止把已降落的隊友說成還在飛
- 【乘客】是本班說話對象，不是相關隊友；對本班只用「你」，禁止寫出【乘客】的名字
- 起飛階段禁止說【乘客】已降落／已著陸／已抵達
- 起飛階段禁止寫「【乘客】在翱翔／祝他一路平安」這類第三人稱旁觀句
- 若有【相關乘客】，只能用那個名字談隊友動態；禁止把【乘客】名字套到隊友事件上`;

export async function generateSocialTakeaway(input: SocialTakeawayInput): Promise<string> {
  const groupSummary = input.groupSummary ?? input.socialCue.groupSummary ?? null;
  if (!process.env.OPENAI_API_KEY) {
    return fallbackSocialTakeaway({ ...input, groupSummary });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const direction = DIRECTION_LABEL[input.routeDirection] ?? input.routeDirection;
  const related = relatedTeammateName(input);
  const relatedLabel = related === '一位隊友' && !input.socialCue.relatedPassenger?.trim()
    ? '無'
    : related;
  const phaseGuard = input.phase === 'takeoff'
    ? `\n注意：現在是起飛／飛行中。對本班只用「你」，禁止出現名字「${input.passengerName}」。禁止寫「${input.passengerName} 在翱翔／祝他一路平安／已降落」。若要提隊友，只能用相關乘客（${relatedLabel}）。`
    : '';

  const userPrompt = `【階段】
${input.phase}

【乘客】（本班對象＝「你」，不要寫出這個名字）
${input.passengerName}

【本班資料】
出發地：${input.departureLocation}
抵達地：${input.arrivalLocation ?? '未知'}
航向：${direction}
飛行時長：${input.flightDurationMinutes ?? '未知'}
航程公里：${input.estimatedDistanceKm ? Math.round(input.estimatedDistanceKm) : '未知'}

【主要雷達訊號】
類型：${input.socialCue.cueType}
提示：${input.socialCue.cueText}
相關乘客：${relatedLabel}
${phaseGuard}
請只生成一句 Social Takeaway（不要寫小隊總人數或第二句氛圍）。`;

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 80,
      temperature: 0.8,
    });

    const primary = cleanPrimaryTakeaway(completion.choices[0]?.message?.content ?? '');
    if (
      primary.length < 6
      || isSelfLandingTakeaway(primary, input.passengerName, input.phase)
      || isMisaddressedSelfTakeaway(primary, input.passengerName, input.phase)
    ) {
      return fallbackSocialTakeaway({ ...input, groupSummary });
    }
    // 第二句固定用規則組裝，避免 AI 把「已降落」改寫成「都在翱翔」
    return composeSocialTakeaway(primary, groupSummary);
  } catch {
    return fallbackSocialTakeaway({ ...input, groupSummary });
  }
}
