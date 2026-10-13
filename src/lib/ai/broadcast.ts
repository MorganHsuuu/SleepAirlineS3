import OpenAI from 'openai';
import { openAiApiKey } from './openai-env';
import type { BroadcastStyle, NarrativeRegion } from '../../types';
import type { SocialCue } from '../../types';
import type { LocalContext } from '../flight/local-context';
import { arrivalHello, timeAdjustedGreeting } from './morning-content';
import { placeOrientationLine } from '../flight/local-context';

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

type SleepBand = 'unknown' | 'late-night' | 'morning' | 'midday' | 'afternoon' | 'dusk' | 'night';

function sleepBandFromLabel(label?: string | null): SleepBand {
  const t = (label || '').trim().toLocaleLowerCase();
  if (!t) return 'unknown';
  if (/深夜|凌晨|midnight|deep night/.test(t)) return 'late-night';
  if (/清晨|黎明|dawn|sunrise/.test(t)) return 'morning';
  if (/上午|早上|早晨|morning|\bam\b/.test(t)) return 'morning';
  if (/中午|正午|midday|noon/.test(t)) return 'midday';
  if (/下午|午後|afternoon/.test(t)) return 'afternoon';
  if (/傍晚|黃昏|日落|sunset|dusk/.test(t)) return 'dusk';
  if (/入夜|晚上|夜間|夜晚|night|evening|\bpm\b/.test(t)) return 'night';
  return 'unknown';
}

/** 起飛時旅客可能在任何時段睡覺；回傳塞進 prompt 的時段／狀態說明。 */
function takeoffSleepGuidance(label?: string | null, locale: UiLocale = 'zh'): {
  band: SleepBand;
  system: string;
  user: string;
  cue: string;
} {
  const band = sleepBandFromLabel(label);
  const shown = (label || '').trim();
  const cues: Record<SleepBand, { zh: string; en: string }> = {
    unknown: { zh: '請輕輕閉上眼睛。', en: 'Close your eyes for a moment.' },
    'late-night': { zh: '把今天留在地面。', en: 'Leave today on the ground.' },
    morning: { zh: '讓眼睛先休息一下。', en: 'Let your eyes rest for a while.' },
    midday: { zh: '讓身體先歇一會兒。', en: 'Let the body rest for a while.' },
    afternoon: { zh: '把肩膀放下就好。', en: 'Let your shoulders drop.' },
    dusk: { zh: '請輕輕閉上眼睛。', en: 'Close your eyes for a moment.' },
    night: { zh: '把肩膀放下就好。', en: 'Let your shoulders drop.' },
  };
  const cue = locale === 'en' ? cues[band].en : cues[band].zh;

  if (locale === 'en') {
    const byBand: Record<SleepBand, string> = {
      unknown: 'Sleep time is unknown. Do not assume night. Use neutral natural light; no stars, cabin night-lights, or “leave the day on the ground”.',
      'late-night': 'This is a late-night / predawn sleep. Dim night imagery is fine; keep it quiet, not theatrical.',
      morning: 'This is a morning sleep or nap. Window light should be dawn or morning. Forbidden: night sky, stars, good night, “leave today on the ground”, end-of-day tone.',
      midday: 'This is a midday nap. Use daylight. Forbidden: night imagery or good night.',
      afternoon: 'This is an afternoon rest. Soft daylight is right. Forbidden: night sky or treating this as the end of the day.',
      dusk: 'This is dusk / early evening. Twilight is fine; it is not yet deep night. Do not write a starfield or midnight cabin.',
      night: 'This is a night sleep. Night window light is fine. Still do not reuse “the night will keep our destination”.',
    };
    return {
      band,
      system: `Takeoff sleep state: the passenger is going to sleep NOW. That may be morning, a nap, evening or overnight — never default to a night flight. Window imagery and the sleep cue must match the local time of day. Do not say good night in daylight. Do not talk as if they have finished a whole day unless the time of day is actually night.`,
      user: `[sleep period]\nlocal time of day: ${shown || 'unknown'}\n${byBand[band]}\nSleep cue should fit this period (one short action).`,
      cue,
    };
  }

  const byBand: Record<SleepBand, string> = {
    unknown: '時段不明。不要預設夜航。窗外用中性自然光，禁止星空、夜燈、「把今天留在地面」、晚安。',
    'late-night': '這是深夜或凌晨入睡。可以輕寫夜色與艙內燈光，但保持安靜，不要戲劇化。',
    morning: '這是晨間入睡（補眠或早上睡覺）。窗外應是晨光或上午街景。禁止夜色、星空、晚安、夜燈、「把今天留在地面」或把這班寫成一天的結束。',
    midday: '這是正午午睡。用白日光。禁止夜色、晚安。',
    afternoon: '這是午後小睡。柔和日光即可。禁止夜空，也不要寫成像下班後的過夜航班。',
    dusk: '這是傍晚入睡。黃昏光線可以，但還不是深夜。不要寫滿天星或午夜機艙。',
    night: '這是夜間入睡。可以寫夜色與艙內燈光。仍禁止每次都說「夜色保管目的地」。',
  };
  return {
    band,
    system: '起飛時旅客的狀態是「現在要睡一覺」，不一定是晚上才睡。可能是清晨補眠、上午睡覺、午睡或過夜。窗外畫面與睡眠引導必須符合出發地當地時段；白天禁止說晚安、禁止夜色；不要預設對方剛熬完一整天。',
    user: `【睡眠時段】\n當地時段：${shown || '未知'}\n${byBand[band]}\n睡眠引導只給一個短動作，且要符合這個時段。`,
    cue,
  };
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
      lines.push(`local-language hello, not good morning (must be first sentence): ${ctx.morningGreeting}`);
    }
    if (ctx.weatherSummary) lines.push(`local weather: ${ctx.weatherSummary}`);
    if (ctx.localTimeLabel) lines.push(`time of day: ${ctx.localTimeLabel}`);
    lines.push(
      phase === 'landing'
        ? 'Rewrite into one or two natural local tips for the passenger (greeting, food, etiquette). Do not copy verbatim.'
        : 'At most one weather or atmosphere beat about departure. Match the local time of day. Do not hint at the destination.'
    );
    return lines.join('\n');
  }
  const lines = [
    `城市：${ctx.cityName}`,
    `國家：${ctx.countryName}`,
    `當地文化／社交特色：${ctx.culture}`,
  ];
  if (phase === 'landing' && ctx.morningGreeting) {
    lines.push(`當地語言「你好」（廣播第一句必須使用，不要用早安）：${ctx.morningGreeting}`);
  }
  if (ctx.weatherSummary) lines.push(`當地天氣：${ctx.weatherSummary}`);
  if (ctx.localTimeLabel) lines.push(`時段：${ctx.localTimeLabel}`);
  lines.push(
      phase === 'landing'
      ? '請改寫成抵達後給乘客的一兩句在地提示（問候、飲食、社交禮儀等），勿整段照搬。'
      : '僅可改寫出發地的一筆天氣或在地氛圍，且須符合當地時段，勿暗示目的地。'
  );
  return lines.join('\n');
}

function buildSystemPrompt(
  locale: UiLocale,
  style: BroadcastStyle,
  isTakeoff: boolean,
  pax: string,
  hasLocal: boolean,
  sleepGuide?: string
): string {
  if (locale === 'en') {
    return `${isTakeoff
      ? 'You are the captain of Sleep Airline, giving a PA to passengers who are about to sleep. The local clock may be morning, afternoon, evening or night — never assume a night flight.'
      : 'You are the captain of Sleep Airline, giving a night-flight PA to passengers.'}
${STYLE_DESCRIPTIONS.en[style]}
${isTakeoff ? 'Even if the tone is calm, do not write this as a night-only flight.\n' : ''}

Identity (critical):
- You are the captain speaking to the passenger; the passenger name is the addressee, never your name
- The first sentence must naturally include “Welcome aboard Sleep Airline” and “this is your captain” (do not drop “Welcome”)${isTakeoff ? '' : '; if a local-language hello is provided, that is sentence one, and “Welcome aboard Sleep Airline, this is your captain” must open sentence two'}
- Never say “I am Captain {passenger name}”
- Never speak as the passenger
- Address them as “passengers” or “${pax}”; never call yourself by the passenger name
- Use the given name directly; do not add Mr/Ms/Mrs
- Squad lines are about FRIENDS only — never say the addressee has already taken off
${isTakeoff
    ? '- Takeoff: if squad social is solo / first of night, OMIT the squad sentence entirely. Never say alone, only you, the sky to yourself, or similar. Only real teammate facts (someone already departed / landed) may become one sentence'
    : '- If squad social is solo / first of night: one line that they get the sky to themselves; do not restate their own takeoff'}

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
- Landing: after naming the city, one locating sentence so nobody is left with a mystery place-name — continent or ocean + country + one obvious identity (capital / island / overseas territory). Example: Tokyo → “This is Asia, the capital of Japan.” Pacific islands → “This is the South Pacific, in New Caledonia.” Iceland → “This is the North Atlantic, the capital of Iceland.” Do not use subregions like Northeast Asia or Western Europe. No encyclopedia dump.
- Landing: weave one natural culture tip and a light weather beat
- Landing: sentence one must be the local-language hello (not “good morning”); continue in English afterward without translating the greeting. Do not mix a daytime local greeting with “good night”.
- Takeoff: at most one departure weather beat; window light must match local time of day
` : ''}
${isTakeoff && sleepGuide ? `${sleepGuide}\n` : ''}Writing:
- English, ${isTakeoff ? '80–110' : '90–130'} words, hard cap ${isTakeoff ? '130' : '160'}
- ${isTakeoff ? 'Takeoff: 4–5 sentences — ① welcome + captain + departure + heading ② one window image that matches the local time of day (dawn, daylight, dusk or night — never night sky in the morning) ③ exactly one short sleep cue: one action that fits this sleep period — never a meditation, breath count, step list, or an end-of-day line in daylight ④ at most one squad beat ⑤ the LAST sentence must be exactly: “We are about to take off. Sleep Airline thanks you for flying with us. Please rest well, and sleep well.”' : 'One idea per sentence'}
- Cut stock phrases like “thank you for flying with us”${isTakeoff ? ', except the required closing sentence' : ''}
- Never output a blunt slogan; write as a captain PA with imagery
- Social info: one rewritten sentence max; never paste [squad social] verbatim
- Do not invent places, times, or names
- Output PA text only — no titles, quotes, or notes`;
  }

  return `${isTakeoff
    ? '你是「甦醒航班 Sleep Airline」的機長，正在對即將入睡的乘客廣播。旅客可能在清晨、上午、午後或夜晚睡覺，禁止預設這是夜間航班。'
    : '你是「甦醒航班 Sleep Airline」的機長，正在對機上乘客做夜間廣播。'}
${STYLE_DESCRIPTIONS.zh[style]}
${isTakeoff ? '即使語氣沉穩，也不要寫成深夜專用；早上來睡覺一樣適合。\n' : ''}

身分（非常重要）：
- 你是機長，在對「乘客」說話；乘客姓名只是對象，不是你的名字
- 第一句必須自然包含「歡迎搭乘 Sleep Airline」與「這裡是機長」（「歡迎」二字不可省略，禁止只寫「搭乘 Sleep Airline」）${isTakeoff ? '' : '；若有當地語言「你好」，該問候為第一句，「歡迎搭乘 Sleep Airline，這裡是機長」必須完整出現在第二句開頭'}
- 禁止寫「我是機長〇〇」若〇〇是乘客姓名
- 禁止冒充乘客、禁止用第一人稱代替乘客說話
- 用「各位乘客」或「${pax}」稱呼對方；不要稱自己為乘客姓名
- 稱呼乘客時直接使用名字，禁止附加「先生」「女士」「小姐」或「先生／女士」
- 社交句只講隊友，禁止說正在聽廣播的乘客「已經起飛」
${isTakeoff
    ? '- 起飛廣播：若【同組社交】是獨自（solo）／本次首班（first_of_night），整句社交完全省略；禁止出現「獨享」「獨自」「只有你」「夜空交給你」「天空交給你」等說法。只有真實隊友動態（已起飛、已降落）才可寫一句'
    : '- 若【同組社交】是獨自／今晚第一班：改說獨自享受這片天空，不要複誦本班乘客姓名＋已起飛'}

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
- 降落廣播：說出城市名之後，必須用一句話幫旅客把這個地方放到地圖上——洲或海洋＋國家＋一個幾乎不會錯的身份（首都／島國／海外領地／某國城市）。例如東京：「這裡是亞洲，日本的首都」；太平洋小島：「這裡是南太平洋，屬於新喀里多尼亞」；冰島：「這裡是北大西洋，冰島的首都」。禁止東北亞、西歐這種細分區，禁止人口數字、冷門歷史、百科條列。
- 降落廣播：必須用一兩句自然帶出當地文化特色或社交習俗，並點一下當地天氣（溫度、晴雨），
  像機長提醒乘客下機前的心理準備，不要像氣象報告或旅遊手冊
- 降落廣播：第一句必須以【當地語言你好】開頭（使用 morningGreeting，如 Halló、こんにちは、Hola），
  不要用 Good morning、Góðan daginn、おはようございます 這類綁時段的早安。中文時段問候（早安／午安／晚安）必須符合【時段】，禁止「當地白天問候 + 中文晚安」
- 降落廣播：當地語言問候之後，緊接繁體中文繼續廣播，不要翻譯或解釋那句問候
- 起飛廣播：若提供出發地天氣，最多一句帶過，勿喧賓奪主；窗外光線必須符合當地時段
` : ''}
${isTakeoff && sleepGuide ? `${sleepGuide}\n` : ''}寫作：
- 繁體中文，${isTakeoff ? '80–110' : '90–130'} 字，最多不超過 ${isTakeoff ? '130' : '160'} 字
- ${isTakeoff ? '起飛廣播 4–5 句：①歡迎搭乘 Sleep Airline＋機長身分，緊接著必須原句說出「我們從{廣播用地名的城市}出發，航向{方向}」，城市名不可省略、不可改成「這裡」或「當地」 ②一句符合當地時段的窗外畫面（晨光、日光、黃昏或夜色擇一；白天禁止夜空／星空；禁止每次都說「夜色保管目的地」） ③剛好一句睡眠小引導，只給一個符合此時段的動作；白天不要「把今天留在地面」這種結束一天的說法；不要助眠課程、不要數息、不要列步驟 ④同組社交最多一句 ⑤最後一句必須原句說出「我們即將起飛。Sleep Airline 感謝您的搭乘，請好好休息，祝你有個好眠。」不可省略、不可改寫' : '一句一重點'}
- 刪掉「有任何需求」「祝您旅途愉快」「期待美好瞬間」等套話；起飛結尾固定句「Sleep Airline 感謝您的搭乘」除外
- 禁止輸出「這是一個甦醒航班，睡著飛行，醒來抵達」這種直白標語；要改成有畫面的機長廣播
- 社交資訊改寫後嵌入一句即可，禁止照搬【同組社交】原文
- 不得編造未提供的地名、時間、人名；相關乘客只能用系統提供的名字
- 直接輸出廣播正文，不加標題、引號或說明`;
}

export async function generateCaptainBroadcast(input: BroadcastInput): Promise<string> {
  const apiKey = openAiApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 尚未設定。');
  }

  const locale = normalizeLocale(input.locale);
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const isTakeoff = input.phase === 'takeoff';
  const pax = passengerLabel(input.passengerName, locale);
  const direction = DIRECTION_LABEL[locale][input.routeDirection] ?? input.routeDirection;
  const hasLocal = !!input.localContext;
  const departureLabel = broadcastLocationLabel(input.departureLocation, locale, isTakeoff ? input.localContext : null);
  const arrivalLabel = broadcastLocationLabel(input.arrivalLocation, locale, !isTakeoff ? input.localContext : null);
  const sleepGuide = isTakeoff
    ? takeoffSleepGuidance(input.localContext?.localTimeLabel, locale)
    : null;

  const systemPrompt = buildSystemPrompt(locale, input.style, isTakeoff, pax, hasLocal, sleepGuide?.system);

  const noTeammateFacts = input.socialCue.cueType === 'solo' || input.socialCue.cueType === 'first_of_night';
  const socialLine = noTeammateFacts
    ? (locale === 'en'
      ? '(No teammate facts this time — OMIT the squad sentence entirely. Do not mention being alone, only you, or having the sky to yourself.)'
      : '（這次沒有隊友動態：整句社交完全省略，不要寫「獨享」「獨自」「只有你」「夜空交給你」）')
    : buildSocialBlock(input.socialCue, locale);

  const takeoffUser = locale === 'en'
    ? `[TAKEOFF PA]
passenger: ${pax}
raw departure: ${input.departureLocation}
broadcast place: ${departureLabel}
heading: ${direction}
${input.localContext ? `\n[local context · departure]\n${buildLocalBlock(input.localContext, 'takeoff', locale)}\n` : ''}
${sleepGuide?.user ?? ''}
[squad social]
${socialLine}

Write a fluent 4–5 sentence PA. Sentence one must begin with “Welcome aboard Sleep Airline, this is your captain”.
The window image must match the sleep period above; do not reuse “the night will keep our destination”, and do not write night sky in daylight.
Include exactly one short sleep cue — one action that fits this period.
The LAST sentence must be exactly: “We are about to take off. Sleep Airline thanks you for flying with us. Please rest well, and sleep well.”
${noTeammateFacts
      ? 'No squad sentence at all this time.'
      : 'Squad: one past/progress sentence only about the teammate — no teammate landing countdown.'}`
    : `【起飛廣播】
乘客：${pax}
出發地原始資料：${input.departureLocation}
廣播用地名：${departureLabel}
航線方向：${direction}
${input.localContext ? `\n【當地資訊 · 出發地】\n${buildLocalBlock(input.localContext, 'takeoff', locale)}\n` : ''}
${sleepGuide?.user ?? ''}
【同組社交】
${socialLine}

請依「4–5 句」結構寫一段流暢口語廣播，第一句必須以「歡迎搭乘 Sleep Airline，這裡是機長」開頭（完整八字「歡迎搭乘」，不可省略「歡迎」）。
緊接著必須說「我們從${departureLabel.split(',')[0].trim()}出發，航向${direction}」，這兩個詞都要出現，不可省略出發地。
窗外畫面必須符合上面的睡眠時段，不要在白天寫夜色，也不要每次都說「夜色保管目的地」。
睡眠只給一個很短、符合此時段的動作，不要展開。
最後一句必須原句說「我們即將起飛。Sleep Airline 感謝您的搭乘，請好好休息，祝你有個好眠。」不可省略、不可改寫。
${noTeammateFacts
      ? '這次不寫任何同組社交句。'
      : '同組社交：用一句過去式／進行式帶過隊友動態，禁止隊友降落倒數。'}`;

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

Announce waking up at arrival, how long you flew, and from/to. Sentence one = local-language hello (not good morning); sentence two must begin with “Welcome aboard Sleep Airline, this is your captain”.
Right after naming the city, locate it in one sentence (continent or ocean + country + capital/island if true). Weave one culture/weather beat; one social beat; fluent paragraph, no bullets.
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

請宣布：醒來抵達、飛了多久、從哪到哪；第一句以當地語言「你好」開頭（不要用早安），第二句必須以「歡迎搭乘 Sleep Airline，這裡是機長」完整開頭（「歡迎」不可省略、禁止只寫「搭乘 Sleep Airline」），
說出抵達城市後立刻用一句話定位這個地方（洲或海洋、國家、首都或島國），讓沒聽過這地名的人也知道在哪；
必須融入一筆當地文化或天氣（改寫）；用一句話點出社交情境，合併成一段流暢廣播，勿列點、勿照搬。
若【同組社交】不是 solo：必須在開場問候後的前兩句內明確說出「你與哪位隊友或小隊發生了什麼關係」
（例如共享夜空、接力、靠近、同向、分頭飛、先後降落），不要只把社交資訊放在結尾。`;

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: isTakeoff ? takeoffUser : landingUser },
    ],
    max_tokens: isTakeoff ? 260 : 280,
    temperature: isTakeoff ? 0.7 : 0.55,
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? (locale === 'en' ? 'Broadcast failed. Please try again.' : '廣播生成失敗，請重試。');
  const spoken = ensureWelcomeAboardPhrase(isTakeoff ? stripSoloSkyLines(raw) : raw, locale);
  return isTakeoff
    ? ensureTakeoffClosing(ensureDepartureSpoken(spoken, departureLabel, direction, locale), locale)
    : spoken;
}

const SOLO_SKY_PATTERN = /獨享|獨自|只有你|(?:夜空|天空)[^。！？]{0,4}交給你|\balone\b|only you|(?:sky|night) to yourself/i;

/** 起飛不講「獨享夜空」：模型仍寫出時整句移除 */
function ensureDepartureSpoken(text: string, departureLabel: string, direction: string, locale: UiLocale): string {
  const city = departureLabel.split(',')[0].trim();
  if (!city || text.includes(city)) return text;
  if (locale === 'en') {
    return text.replace(
      /Welcome aboard Sleep Airline, this is your captain\.?\s*/i,
      `Welcome aboard Sleep Airline, this is your captain. We are departing from ${city}, heading ${direction}. `
    );
  }
  return text.replace(
    /歡迎搭乘\s*Sleep\s*Airline，這裡是機長[。，]?\s*/i,
    `歡迎搭乘 Sleep Airline，這裡是機長。我們從${city}出發，航向${direction}。`
  );
}

const TAKEOFF_CLOSING_ZH = '我們即將起飛。Sleep Airline 感謝您的搭乘，請好好休息，祝你有個好眠。';
const TAKEOFF_CLOSING_EN = 'We are about to take off. Sleep Airline thanks you for flying with us. Please rest well, and sleep well.';

/** 起飛廣播最後必須接到指定收尾 */
function ensureTakeoffClosing(text: string, locale: UiLocale): string {
  const body = (text || '').trim();
  if (locale === 'en') {
    if (/thanks you for flying with us/i.test(body) && /sleep well/i.test(body)) return body;
    const cleaned = body
      .replace(/\s*(please rest well\.?\s*)?good night\s*[—-]\s*we are taking off\.?\s*$/i, '')
      .replace(/\s*rest now\.?\s*good night\.?\s*$/i, '')
      .trim();
    const core = cleaned.replace(/[.!\s]+$/g, '');
    return core ? `${core}. ${TAKEOFF_CLOSING_EN}` : TAKEOFF_CLOSING_EN;
  }
  if (/感謝您的搭乘/.test(body) && /祝你有個好眠/.test(body)) return body;
  const cleaned = body
    .replace(/請好好休息。?\s*晚安，我們起飛了。?\s*$/u, '')
    .replace(/那就請休息，晚安。?\s*$/u, '')
    .replace(/我們起飛了。?\s*$/u, '')
    .trim();
  const core = cleaned.replace(/[。！？\s]+$/u, '');
  return core ? `${core}。${TAKEOFF_CLOSING_ZH}` : TAKEOFF_CLOSING_ZH;
}

function stripSoloSkyLines(text: string): string {
  const sentences = text.match(/[^。！？.!?]+[。！？.!?]*\s*/g);
  if (!sentences) return text;
  const kept = sentences.filter((s) => !SOLO_SKY_PATTERN.test(s));
  return kept.length ? kept.join('').trim() : text;
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
      const social = socialCueText?.trim() && !/alone|only you|to yourself|to themselves|獨享|獨自|只有你/i.test(socialCueText)
        ? ` ${socialCueText.replace(/[.!?\s]+$/g, '')}.`
        : '';
      const sleepCue = takeoffSleepGuidance(localContext?.localTimeLabel, 'en').cue;
      return `Welcome aboard Sleep Airline, this is your captain. We are departing ${departureLabel}, heading ${direction}. ${wx}${sleepCue}${social} ${TAKEOFF_CLOSING_EN}`;
    }
    const dur = formatDuration(durationMinutes, locale);
    const greet = localContext?.morningGreeting
      ? `${timeAdjustedGreeting(localContext.morningGreeting, localContext.localTimeLabel)}! `
      : '';
    const timeBit = localContext?.localTimeLabel ? `${localContext.localTimeLabel}, ` : 'Local morning, ';
    const wxBit = localContext?.weatherSummary ? `outside it’s ${localContext.weatherSummary}. ` : '';
    const cultureBit = localContext?.culture
      ? `${localContext.culture.split(';')[0]?.split('.')[0]}. `
      : 'Step out with a smile for the locals. ';
    const where = placeOrientationLine(
      localContext?.cityName || arrivalLocation || '',
      localContext?.countryName || '',
      localContext?.countryIso,
      'en'
    );
    const whereBit = where ? `${where} ` : '';
    return `${greet}Welcome aboard Sleep Airline, this is your captain. We have arrived safely in ${arrivalLabel}. ${whereBit}${timeBit}${wxBit}${pax} flew from ${departureLabel} for ${dur || 'a stretch'}. ${cultureBit}${socialCueText}`;
  }
  if (phase === 'takeoff') {
    const wx = localContext?.weatherSummary
      ? `${localContext.localTimeLabel ?? '此刻'}${localContext.weatherSummary}，`
      : '';
    const social = socialCueText?.trim() && !/獨享|獨自|只有你|天空先交給你|夜空交給你/.test(socialCueText)
      ? ` ${socialCueText.replace(/[。！？\s]+$/g, '')}。`
      : '';
    const sleepCue = takeoffSleepGuidance(localContext?.localTimeLabel, 'zh').cue;
    return `歡迎搭乘 Sleep Airline，這裡是機長，各位乘客，本班自 ${departureLabel} 起飛，航向${direction}。${wx ? wx : ''}${sleepCue}${social}${TAKEOFF_CLOSING_ZH}`;
  }
  const greet = timeAdjustedGreeting(localContext?.morningGreeting || '你好', localContext?.localTimeLabel);
  const hello = arrivalHello(localContext?.localTimeLabel);
  const timeBit = localContext?.localTimeLabel ? `${localContext.localTimeLabel}，` : '';
  const where = placeOrientationLine(
    localContext?.cityName || arrivalLocation || '',
    localContext?.countryName || '',
    localContext?.countryIso
  );
  const whereBit = where ? `${where}。` : '';
  return `${greet}。${hello}，Sleep Airline 已抵達今天的目的地——${arrivalLabel}。${whereBit}${timeBit}窗外的風景正慢慢展開。歡迎抵達${arrivalLabel}，今天的旅程從這裡開始。`;
}
