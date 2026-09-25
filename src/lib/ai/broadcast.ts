import OpenAI from 'openai';
import type { BroadcastStyle, NarrativeRegion } from '../../types';
import type { SocialCue } from '../../types';
import type { LocalContext } from '../flight/local-context';

export type UiLocale = 'zh' | 'en';

const STYLE_DESCRIPTIONS: Record<UiLocale, Record<BroadcastStyle, string>> = {
  zh: {
    formal_captain: '語氣沉穩、簡潔，像深夜航班的真正機長，不說套話。',
    poetic: '語氣詩意、意象清楚，一兩個畫面即可，不堆砌形容。',
    playful: '語氣輕鬆、帶一點幽默，但仍像機長在廣播，不過度玩笑。',
    flight_attendant: '語氣溫柔、簡短，像夜航廣播，不是客服稿。',
    radio_host: '語氣像深夜電台，但你是機長，不是主持人本人。',
    custom: '語氣由你拿捏，仍須符合甦醒航班夜航機長身分。',
  },
  en: {
    formal_captain: 'Calm, concise tone — a real night-flight captain, no filler.',
    poetic: 'Poetic but clear; one or two images, no purple prose.',
    playful: 'Light humor, still a captain PA, not a comedy bit.',
    flight_attendant: 'Gentle and brief, night-flight PA, not customer service copy.',
    radio_host: 'Late-night radio warmth, but you remain the captain.',
    custom: 'Choose tone freely while staying Sleep Airline’s night captain.',
  },
};

const DIRECTION_LABEL: Record<UiLocale, Record<string, string>> = {
  zh: {
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
  },
  en: {
    auto: 'auto routing',
    eastbound: 'eastbound',
    westbound: 'westbound',
    northbound: 'northbound',
    southbound: 'southbound',
    northeast: 'northeast',
    northwest: 'northwest',
    southeast: 'southeast',
    southwest: 'southwest',
    circular: 'circular',
    unknown: 'undetermined',
  },
};

export type BroadcastPhase = 'takeoff' | 'landing';

interface BroadcastInput {
  phase: BroadcastPhase;
  passengerName: string;
  departureLocation: string;
  arrivalLocation: string | null;
  narrativeRegion: NarrativeRegion;
  flightDurationMinutes: number | null;
  flightProgress: number;
  estimatedDistanceKm: number | null;
  routeDirection: string;
  socialCue: SocialCue;
  style: BroadcastStyle;
  /** 抵達地或出發地的當地文化／天氣（降落必帶，起飛可帶出發地） */
  localContext?: LocalContext | null;
  /** UI language for broadcast text; not stored in Notion */
  locale?: UiLocale | string;
}

function normalizeLocale(locale?: string | null): UiLocale {
  return locale === 'en' ? 'en' : 'zh';
}

function passengerLabel(name: string, locale: UiLocale): string {
  const trimmed = name.trim();
  if (!trimmed) return locale === 'en' ? 'passenger' : '這位乘客';
  return trimmed.replace(/(?:先生|女士|小姐)$/u, '').trim() || (locale === 'en' ? 'passenger' : '這位乘客');
}

function formatDuration(minutes: number | null, locale: UiLocale): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (locale === 'en') {
    if (h > 0 && m > 0) return `${h} h ${m} min`;
    if (h > 0) return `${h} h`;
    return `${m} min`;
  }
  if (h > 0 && m > 0) return `${h} 小時 ${m} 分鐘`;
  if (h > 0) return `${h} 小時`;
  return `${m} 分鐘`;
}

function hasChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function broadcastLocationLabel(
  location: string | null,
  locale: UiLocale,
  localContext?: LocalContext | null
): string {
  const raw = (location ?? '').trim();
  if (!raw) return locale === 'en' ? 'the current station' : '目前航站';
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const city = parts[0] ?? raw;
  const country = parts[parts.length - 1] ?? '';
  if (locale === 'en') {
    if (!hasChinese(city)) return raw;
    if (localContext?.cityName && !hasChinese(localContext.cityName)) {
      return localContext.countryName && !hasChinese(localContext.countryName)
        ? `${localContext.cityName}, ${localContext.countryName}`
        : localContext.cityName;
    }
    return 'your local station';
  }
  if (hasChinese(city)) return raw;
  if (localContext?.countryName && hasChinese(localContext.countryName)) return `${localContext.countryName}一帶`;
  if (hasChinese(country)) return `${country}一帶`;
  return '當地航站';
}

function buildSocialBlock(cue: SocialCue, locale: UiLocale): string {
  if (locale === 'en') {
    const lines = [`type: ${cue.cueType}`, `system cue: ${cue.cueText}`];
    if (cue.relatedPassenger) lines.push(`related passenger: ${cue.relatedPassenger}`);
    return lines.join('\n');
  }
  const lines = [`類型：${cue.cueType}`, `系統提示：${cue.cueText}`];
  if (cue.relatedPassenger) lines.push(`相關乘客：${cue.relatedPassenger}`);
  return lines.join('\n');
}

function buildLocalBlock(ctx: LocalContext, phase: BroadcastPhase, locale: UiLocale): string {
  if (locale === 'en') {
    const lines = [
      `city: ${ctx.cityName}`,
      `country: ${ctx.countryName}`,
      `local culture / social note: ${ctx.culture}`,
    ];
    if (phase === 'landing' && ctx.morningGreeting) {
      lines.push(`local-language good morning (must be first sentence): ${ctx.morningGreeting}`);
    }
    if (ctx.weatherSummary) lines.push(`local weather: ${ctx.weatherSummary}`);
    if (ctx.localTimeLabel) lines.push(`time of day: ${ctx.localTimeLabel}`);
    lines.push(
      phase === 'landing'
        ? 'Rewrite into one or two natural local tips for the passenger (greeting, food, etiquette). Do not copy verbatim.'
        : 'At most one weather or atmosphere beat about departure. Do not hint at the destination.'
    );
    return lines.join('\n');
  }
  const lines = [
    `城市：${ctx.cityName}`,
    `國家：${ctx.countryName}`,
    `當地文化／社交特色：${ctx.culture}`,
  ];
  if (phase === 'landing' && ctx.morningGreeting) {
    lines.push(`當地語言早安（廣播第一句必須使用）：${ctx.morningGreeting}`);
  }
  if (ctx.weatherSummary) lines.push(`當地天氣：${ctx.weatherSummary}`);
  if (ctx.localTimeLabel) lines.push(`時段：${ctx.localTimeLabel}`);
  lines.push(
    phase === 'landing'
      ? '請改寫成抵達後給乘客的一兩句在地提示（問候、飲食、社交禮儀等），勿整段照搬。'
      : '僅可改寫出發地的一筆天氣或在地氛圍，勿暗示目的地。'
  );
  return lines.join('\n');
}

function buildSystemPrompt(locale: UiLocale, style: BroadcastStyle, isTakeoff: boolean, pax: string, hasLocal: boolean): string {
  if (locale === 'en') {
    return `You are the captain of Sleep Airline, giving a night-flight PA to passengers.
${STYLE_DESCRIPTIONS.en[style]}

Identity (critical):
- You are the captain speaking to the passenger; the passenger name is the addressee, never your name
- The first sentence must naturally include “Welcome aboard Sleep Airline” and “this is your captain” (do not drop “Welcome”)${isTakeoff ? '' : '; if a local-language good morning is provided, that is sentence one, and “Welcome aboard Sleep Airline, this is your captain” must open sentence two'}
- Never say “I am Captain {passenger name}”
- Never speak as the passenger
- Address them as “passengers” or “${pax}”; never call yourself by the passenger name
- Use the given name directly; do not add Mr/Ms/Mrs
- Squad lines are about FRIENDS only — never say the addressee has already taken off
- If squad social is solo / first of night: one line that they get the sky to themselves; do not restate their own takeoff

Geography (critical):
- Use the broadcast place labels; do not recite hard romanization
- At takeoff the destination is unknown: only departure + heading; “wake to find where we are” at most once
- Takeoff PA must not mention flight duration, ETA, km, or minutes/hours for this flight
- Places in [squad social] belong to teammates, not this flight’s route; attach them to teammate names
- Teammates only in past/progress: already departed, already flying, already landed at Y; never “about to land”
- If [squad social] shows anyone still flying, do not claim everyone has landed
- Do not turn teammate airspace into a landing countdown
- Geography must stay consistent with this flight’s heading

${hasLocal ? `Local context (${isTakeoff ? 'departure' : 'arrival'}):
- Culture/weather in [local context] are for rewriting only — never copy lists
- Landing: weave one natural culture tip and a light weather beat
- Landing: sentence one must be the local-language morning greeting; continue in English afterward without translating the greeting
- Takeoff: at most one departure weather beat
` : ''}
Writing:
- English, ${isTakeoff ? '75–95' : '90–130'} words, hard cap ${isTakeoff ? '105' : '160'}
- ${isTakeoff ? 'Takeoff: 3–4 sentences — ① welcome + captain + departure + heading ② one poetic sleep/wake beat ③ at most one squad beat ④ soft goodnight' : 'One idea per sentence'}
- Cut stock phrases like “thank you for flying with us”
- Never output a blunt slogan; write as a captain PA with imagery
- Social info: one rewritten sentence max; never paste [squad social] verbatim
- Do not invent places, times, or names
- Output PA text only — no titles, quotes, or notes`;
  }

  return `你是「甦醒航班 Sleep Airline」的機長，正在對機上乘客做夜間廣播。
${STYLE_DESCRIPTIONS.zh[style]}

身分（非常重要）：
- 你是機長，在對「乘客」說話；乘客姓名只是對象，不是你的名字
- 第一句必須自然包含「歡迎搭乘 Sleep Airline」與「這裡是機長」（「歡迎」二字不可省略，禁止只寫「搭乘 Sleep Airline」）${isTakeoff ? '' : '；若有當地語言早安，早安為第一句，「歡迎搭乘 Sleep Airline，這裡是機長」必須完整出現在第二句開頭'}
- 禁止寫「我是機長〇〇」若〇〇是乘客姓名
- 禁止冒充乘客、禁止用第一人稱代替乘客說話
- 用「各位乘客」或「${pax}」稱呼對方；不要稱自己為乘客姓名
- 稱呼乘客時直接使用名字，禁止附加「先生」「女士」「小姐」或「先生／女士」
- 社交句只講隊友，禁止說正在聽廣播的乘客「已經起飛」
- 若【同組社交】是獨自／今晚第一班：改說獨自享受這片天空，不要複誦本班乘客姓名＋已起飛

地理（非常重要）：
- 使用【廣播用地名】；不要照念難懂的羅馬字、音標、撇號地名
- 起飛時本班目的地未知：只講出發地與航向；「醒來才知道目的地」類意思最多自然帶過一次
- 起飛廣播禁止提本班：飛行時長、預計抵達、公里數、ETA、約 X 分鐘／小時
- 【同組社交】的地名都是隊友的，不是本班航線；必須掛在隊友名字後面
- 隊友只能寫已發生：已起飛、已飛 X、已降落在 Y；禁止隊友「即將／X 分鐘內／快」降落、下降、抵達
- 若【同組社交】顯示有人仍在飛或只有部分人降落，禁止改寫成「隊友們都已成功降落」
- 禁止把隊友的空域或距離換算成降落倒數
- 所有地理描述須與本班航向一致，不得自相矛盾

${hasLocal ? `當地資訊（${isTakeoff ? '出發地' : '抵達地'}）：
- 【當地資訊】中的文化、天氣僅供改寫融入，禁止整段照搬或列點
- 降落廣播：必須用一兩句自然帶出當地文化特色或社交習俗，並點一下當地天氣（溫度、晴雨），
  像機長提醒乘客下機前的心理準備，不要像氣象報告或旅遊手冊
- 降落廣播：第一句必須以【當地語言早安】開頭（使用 morningGreeting，如 Bonjour、おはようございます），
  緊接繁體中文繼續廣播，不要翻譯或解釋那句問候
- 起飛廣播：若提供出發地天氣，最多一句帶過，勿喧賓奪主
` : ''}
寫作：
- 繁體中文，${isTakeoff ? '75–95' : '90–130'} 字，最多不超過 ${isTakeoff ? '105' : '160'} 字
- ${isTakeoff ? '起飛廣播固定 3–4 句：①歡迎搭乘 Sleep Airline＋機長身分＋出發地＋航向 ②一句夜航入睡/醒來抵達的詩意提醒 ③同組社交最多一句 ④輕聲祝眠' : '一句一重點'}
- 刪掉「有任何需求」「感謝選搭本航空」「祝您旅途愉快」「期待美好瞬間」等套話
- 禁止輸出「這是一個甦醒航班，睡著飛行，醒來抵達」這種直白標語；要改成有畫面的機長廣播
- 社交資訊改寫後嵌入一句即可，禁止照搬【同組社交】原文
- 不得編造未提供的地名、時間、人名；相關乘客只能用系統提供的名字
- 直接輸出廣播正文，不加標題、引號或說明`;
}

export async function generateCaptainBroadcast(input: BroadcastInput): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY 尚未設定。');
  }

  const locale = normalizeLocale(input.locale);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const isTakeoff = input.phase === 'takeoff';
  const pax = passengerLabel(input.passengerName, locale);
  const direction = DIRECTION_LABEL[locale][input.routeDirection] ?? input.routeDirection;
  const hasLocal = !!input.localContext;
  const departureLabel = broadcastLocationLabel(input.departureLocation, locale, isTakeoff ? input.localContext : null);
  const arrivalLabel = broadcastLocationLabel(input.arrivalLocation, locale, !isTakeoff ? input.localContext : null);

  const systemPrompt = buildSystemPrompt(locale, input.style, isTakeoff, pax, hasLocal);

  const socialLine = input.socialCue.cueType === 'solo'
    ? (locale === 'en'
      ? '(No other squad flights — one line that they have the sky to themselves tonight; do not say this passenger already took off.)'
      : '（同組暫無其他航班：一句「今晚這片天空先交給你獨享」，禁止說乘客本人已經起飛）')
    : buildSocialBlock(input.socialCue, locale);

  const takeoffUser = locale === 'en'
    ? `[TAKEOFF PA]
passenger: ${pax}
raw departure: ${input.departureLocation}
broadcast place: ${departureLabel}
heading: ${direction}
${input.localContext ? `\n[local context · departure]\n${buildLocalBlock(input.localContext, 'takeoff', locale)}\n` : ''}
[squad social]
${socialLine}

Write a fluent 3–4 sentence PA. Sentence one must begin with “Welcome aboard Sleep Airline, this is your captain”.
If squad social exists: one past/progress sentence only — no teammate landing countdown.`
    : `【起飛廣播】
乘客：${pax}
出發地原始資料：${input.departureLocation}
廣播用地名：${departureLabel}
航線方向：${direction}
${input.localContext ? `\n【當地資訊 · 出發地】\n${buildLocalBlock(input.localContext, 'takeoff', locale)}\n` : ''}
【同組社交】
${socialLine}

請依「3–4 句」結構寫一段流暢口語廣播，第一句必須以「歡迎搭乘 Sleep Airline，這裡是機長」開頭（完整八字「歡迎搭乘」，不可省略「歡迎」）。
同組社交若有：用一句過去式／進行式帶過，禁止隊友降落倒數。`;

  const duration = formatDuration(input.flightDurationMinutes, locale);
  const landingUser = locale === 'en'
    ? `[LANDING PA]
passenger: ${pax}
raw departure: ${input.departureLocation}
departure broadcast place: ${broadcastLocationLabel(input.departureLocation, locale)}
raw arrival: ${input.arrivalLocation ?? 'unknown'}
arrival broadcast place: ${arrivalLabel}
flight time: ${duration || 'unknown'}
distance: ${input.estimatedDistanceKm ? `${Math.round(input.estimatedDistanceKm)} km` : 'unknown'}
heading: ${direction}
${input.localContext ? `\n[local context · arrival]\n${buildLocalBlock(input.localContext, 'landing', locale)}\n` : ''}
[squad social]
${buildSocialBlock(input.socialCue, locale)}

Announce waking up at arrival, how long you flew, and from/to. Sentence one = local-language good morning; sentence two must begin with “Welcome aboard Sleep Airline, this is your captain”.
Weave one culture/weather beat; one social beat; fluent paragraph, no bullets.
If [squad social] is not solo: within the first two sentences after the greeting, say what happened with which teammate/squad.`
    : `【降落廣播】
乘客：${pax}
出發地原始資料：${input.departureLocation}
出發地廣播用地名：${broadcastLocationLabel(input.departureLocation, locale)}
抵達地原始資料：${input.arrivalLocation ?? '未知'}
抵達地廣播用地名：${arrivalLabel}
飛行時長：${duration || '未知'}
航程：${input.estimatedDistanceKm ? `${Math.round(input.estimatedDistanceKm)} 公里` : '未知'}
航線方向：${direction}
${input.localContext ? `\n【當地資訊 · 抵達地】\n${buildLocalBlock(input.localContext, 'landing', locale)}\n` : ''}
【同組社交】
${buildSocialBlock(input.socialCue, locale)}

請宣布：醒來抵達、飛了多久、從哪到哪；第一句以當地語言早安開頭，第二句必須以「歡迎搭乘 Sleep Airline，這裡是機長」完整開頭（「歡迎」不可省略、禁止只寫「搭乘 Sleep Airline」），
必須融入一筆當地文化或天氣（改寫）；用一句話點出社交情境，合併成一段流暢廣播，勿列點、勿照搬。
若【同組社交】不是 solo：必須在開場問候後的前兩句內明確說出「你與哪位隊友或小隊發生了什麼關係」
（例如共享夜空、接力、靠近、同向、分頭飛、先後降落），不要只把社交資訊放在結尾。`;

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: isTakeoff ? takeoffUser : landingUser },
    ],
    max_tokens: isTakeoff ? 220 : 280,
    temperature: isTakeoff ? 0.42 : 0.55,
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? (locale === 'en' ? 'Broadcast failed. Please try again.' : '廣播生成失敗，請重試。');
  return ensureWelcomeAboardPhrase(raw, locale);
}

/** 起飛／降落廣播必須含歡迎語；模型若省略則補上 */
function ensureWelcomeAboardPhrase(text: string, locale: UiLocale = 'zh'): string {
  const body = (text || '').trim();
  if (locale === 'en') {
    if (!body) return 'Welcome aboard Sleep Airline, this is your captain.';
    if (/welcome\s+aboard\s+Sleep\s+Airline/i.test(body)) return body;
    if (/aboard\s+Sleep\s+Airline/i.test(body)) {
      return body.replace(/aboard\s+Sleep\s+Airline/i, 'Welcome aboard Sleep Airline');
    }
    const greet = body.match(/^(.{1,48}[!！.。…]+)(\s*)/);
    if (greet && !/\b(welcome|captain)\b/i.test(greet[1])) {
      return `${greet[1]}${greet[2] || ' '}Welcome aboard Sleep Airline, this is your captain. ${body.slice(greet[0].length)}`;
    }
    return `Welcome aboard Sleep Airline, this is your captain. ${body}`;
  }
  if (!body) {
    return '歡迎搭乘 Sleep Airline，這裡是機長。';
  }
  if (/歡迎搭乘\s*Sleep\s*Airline/i.test(body)) return body;
  if (/搭乘\s*Sleep\s*Airline/i.test(body)) {
    return body.replace(/搭乘\s*Sleep\s*Airline/i, '歡迎搭乘 Sleep Airline');
  }
  const greet = body.match(/^(.{1,48}[!！.。…]+)(\s*)/);
  if (greet && !/[\u4e00-\u9fff]{4,}/.test(greet[1])) {
    return `${greet[1]}${greet[2] || ' '}歡迎搭乘 Sleep Airline，這裡是機長。${body.slice(greet[0].length)}`;
  }
  return `歡迎搭乘 Sleep Airline，這裡是機長。${body}`;
}

/** OpenAI 不可用時的簡短 fallback */
export function fallbackCaptainBroadcast(
  phase: BroadcastPhase,
  passengerName: string,
  departureLocation: string,
  arrivalLocation: string | null,
  routeDirection: string,
  durationMinutes: number | null,
  socialCueText: string,
  localContext?: LocalContext | null,
  localeInput?: UiLocale | string
): string {
  const locale = normalizeLocale(localeInput);
  const pax = passengerLabel(passengerName, locale);
  const direction = DIRECTION_LABEL[locale][routeDirection] ?? routeDirection;
  const departureLabel = broadcastLocationLabel(departureLocation, locale, phase === 'takeoff' ? localContext : null);
  const arrivalLabel = broadcastLocationLabel(arrivalLocation, locale, phase === 'landing' ? localContext : null);
  if (locale === 'en') {
    if (phase === 'takeoff') {
      const wx = localContext?.weatherSummary
        ? `${localContext.localTimeLabel ?? 'Right now'} ${localContext.weatherSummary}. `
        : '';
      const social = socialCueText?.trim() && !/alone|only you/i.test(socialCueText)
        ? ` ${socialCueText.replace(/[.!?\s]+$/g, '')}.`
        : '';
      return `Welcome aboard Sleep Airline, this is your captain. We are departing ${departureLabel}, heading ${direction}. ${wx}Rest easy — the night will keep our destination until you wake.${social} Sleep well.`;
    }
    const dur = formatDuration(durationMinutes, locale);
    const greet = localContext?.morningGreeting ? `${localContext.morningGreeting}! ` : '';
    const timeBit = localContext?.localTimeLabel ? `${localContext.localTimeLabel}, ` : 'Local morning, ';
    const wxBit = localContext?.weatherSummary ? `outside it’s ${localContext.weatherSummary}. ` : '';
    const cultureBit = localContext?.culture
      ? `${localContext.culture.split(';')[0]?.split('.')[0]}. `
      : 'Step out with a smile for the locals. ';
    return `${greet}Welcome aboard Sleep Airline, this is your captain. We have arrived safely in ${arrivalLabel}. ${timeBit}${wxBit}${pax} flew from ${departureLabel} for ${dur || 'a stretch'}. ${cultureBit}${socialCueText}`;
  }
  if (phase === 'takeoff') {
    const wx = localContext?.weatherSummary
      ? `${localContext.localTimeLabel ?? '此刻'}${localContext.weatherSummary}，`
      : '';
    const social = socialCueText?.trim() && !/獨自飛行|只有你一人/.test(socialCueText)
      ? ` ${socialCueText.replace(/[。！？\s]+$/g, '')}。`
      : '';
    return `歡迎搭乘 Sleep Airline，這裡是機長，各位乘客，本班自 ${departureLabel} 起飛，航向${direction}。${wx ? wx : ''}請安心入睡，窗外的夜色會替我們保管目的地。${social}祝各位好眠。`;
  }
  const dur = formatDuration(durationMinutes, locale);
  const greet = localContext?.morningGreeting ? `${localContext.morningGreeting}！` : '';
  const timeBit = localContext?.localTimeLabel ? `${localContext.localTimeLabel}，` : '本地時間清晨，';
  const wxBit = localContext?.weatherSummary ? `窗外${localContext.weatherSummary}。` : '';
  const cultureBit = localContext?.culture
    ? localContext.culture.split('；')[0]?.split('。')[0] + '。'
    : '走出艙門，向當地人微笑問好吧。';
  return `${greet}歡迎搭乘 Sleep Airline，這裡是機長，各位乘客，本班已平安降落 ${arrivalLabel}，${timeBit}${wxBit}${pax} 自 ${departureLabel} 出發，共飛行 ${dur || '一段'}。${cultureBit} ${socialCueText}`;
}
