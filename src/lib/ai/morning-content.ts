import OpenAI from 'openai';
import { openAiApiKey } from './openai-env';
import { withTimeout } from '../with-timeout';
import { findReliableDestinationSubject } from './destination-subjects';
import { countryLabelZh, placeOrientationLine, spokenPlaceZh } from '../flight/local-context';

export interface MorningContent {
  destination: { country: string; city: string };
  localGreeting: string;
  voiceText: string;
  localFeature: string;
  imagePrompt: string;
  imageKeywords: string[];
  safetyCheck: {
    containsNegativeEmotionalLanguage: boolean;
    containsPressureLanguage: boolean;
    containsLonelinessLanguage: boolean;
    containsUnverifiedCulturalClaim: boolean;
  };
}

export interface MorningContentInput {
  country: string;
  city: string;
  countryIso?: string | null;
  /** 已知的當地語言「你好」；模型沒給時用這個 */
  localGreeting?: string | null;
  /** 例如「氣溫 18°C，大致晴朗」 */
  weatherSummary?: string | null;
  localTimeLabel?: string | null;
  /** 審查台過往評分，讓新生成對齊高分、避開低分 */
  reviewCalibration?: string | null;
  /** 出發地，讓降落詞能說從哪裡飛來 */
  departureLocation?: string | null;
  flightDurationMinutes?: number | null;
  /** 上一站降落的城市 */
  previousArrival?: string | null;
  /** 是否再次降落在同一座城市 */
  returnVisit?: boolean | null;
  /** 含本班，今晚降落在這座城市的次數 */
  visitCount?: number | null;
  /** 當地文化／生活提示，供改寫，勿整段照搬 */
  cultureNote?: string | null;
  /** 廣播用地名，例如「塔拉瓦, 吉里巴斯」；有中文時優先口說這個 */
  placeLabel?: string | null;
}

export type ArrivalSceneThemeId =
  | 'landmark'
  | 'nature'
  | 'food'
  | 'street-market'
  | 'culture-life';

export interface ArrivalSceneTheme {
  id: ArrivalSceneThemeId;
  label: string;
  weight: number;
  instruction: string;
}

export const ARRIVAL_SCENE_THEMES: readonly ArrivalSceneTheme[] = [
  {
    id: 'landmark',
    label: '著名景點',
    weight: 30,
    instruction: '選一個確實位於目的地、可辨識的著名景點或地標作為唯一主題。',
  },
  {
    id: 'nature',
    label: '自然風景',
    weight: 25,
    instruction: '選一個目的地真實、有名字的自然主題：河、岸、山、林、港、島、公園或海岸，禁止空泛地貌套句。',
  },
  {
    id: 'food',
    label: '當地美食',
    weight: 20,
    instruction: '選一道可可靠確認屬於目的地的地方料理或飲食場景作為唯一主題。',
  },
  {
    id: 'street-market',
    label: '特色街景／市場',
    weight: 15,
    instruction: '選一處目的地真實且具地方辨識度的街區或市場作為唯一主題。',
  },
  {
    id: 'culture-life',
    label: '文化／交通／生活',
    weight: 10,
    instruction: '選一個目的地真實的文化、表演、體驗、手工、交通或日常生活場景作為唯一主題，優先看得見或聽得到的現場，例如劇場、祭典、工房、車站或街頭演出。',
  },
];

/** 以 0（含）到 1（不含）的值選擇主題，方便呼叫端注入可重現的亂數。 */
export function selectArrivalSceneTheme(randomValue: number = Math.random()): ArrivalSceneTheme {
  const bounded = Number.isFinite(randomValue)
    ? Math.min(Math.max(randomValue, 0), 1 - Number.EPSILON)
    : 0;
  const target = bounded * 100;
  let cumulative = 0;
  for (const theme of ARRIVAL_SCENE_THEMES) {
    cumulative += theme.weight;
    if (target < cumulative) return theme;
  }
  return ARRIVAL_SCENE_THEMES[ARRIVAL_SCENE_THEMES.length - 1];
}

interface SceneSubject {
  zh: string;
  en: string;
  detailZh: string;
  keywords: string[];
  isGeneric?: boolean;
}

const KNOWN_SCENE_SUBJECTS: Array<{
  aliases: string[];
  subjects: Partial<Record<ArrivalSceneThemeId, SceneSubject>>;
}> = [
  {
    aliases: ['taipei', '台北', '臺北'],
    subjects: {
      nature: {
        zh: '陽明山的火山地貌',
        en: 'the volcanic landscape of Yangmingshan',
        detailZh: '山坡、硫磺谷與城市盆地形成清楚層次',
        keywords: ['Yangmingshan', 'volcanic landscape'],
      },
      food: {
        zh: '台北牛肉麵',
        en: 'Taipei beef noodles',
        detailZh: '熱湯、麵條與街坊小吃店呈現城市飲食日常',
        keywords: ['Taipei beef noodles', 'local food'],
      },
      'street-market': {
        zh: '大稻埕迪化街',
        en: 'Dihua Street in Dadaocheng',
        detailZh: '連棟街屋與乾貨店面保留老城街廓尺度',
        keywords: ['Dihua Street', 'Dadaocheng'],
      },
      'culture-life': {
        zh: '台北捷運',
        en: 'the Taipei Metro',
        detailZh: '列車與高架軌道穿過盆地城市的日常通勤景色',
        keywords: ['Taipei Metro', 'urban daily life'],
      },
    },
  },
  {
    aliases: ['cairo', '開羅', 'giza', '吉薩'],
    subjects: {
      nature: {
        zh: '尼羅河岸',
        en: 'the Nile riverfront',
        detailZh: '河面與乾燥城市地貌形成清楚的水岸層次',
        keywords: ['Nile riverfront', 'Cairo'],
      },
      food: {
        zh: '開羅庫莎麗',
        en: 'Cairo koshari',
        detailZh: '米飯、扁豆、麵食與番茄醬呈現常見的城市料理',
        keywords: ['Cairo koshari', 'local food'],
      },
      'street-market': {
        zh: '汗哈利利市集',
        en: 'Khan el-Khalili market',
        detailZh: '狹窄街巷與傳統店舖形成開羅老城景色',
        keywords: ['Khan el-Khalili', 'Cairo market'],
      },
      'culture-life': {
        zh: '尼羅河三角帆船',
        en: 'feluccas on the Nile',
        detailZh: '三角帆船沿河面移動，呈現城市水岸日常',
        keywords: ['Nile felucca', 'Cairo daily life'],
      },
    },
  },
  {
    aliases: ['alexandria', '亞歷山大'],
    subjects: {
      landmark: {
        zh: '蓋特貝城堡',
        en: 'the Citadel of Qaitbay',
        detailZh: '石造城堡立在地中海港口邊',
        keywords: ['Qaitbay Citadel', 'Alexandria'],
      },
      nature: {
        zh: '亞歷山大港的地中海海岸',
        en: 'Alexandria’s Mediterranean shoreline',
        detailZh: '海浪、港灣與沿岸城市形成開闊水岸景色',
        keywords: ['Alexandria Mediterranean coast', 'harbour'],
      },
      food: {
        zh: '亞歷山大港海鮮',
        en: 'Alexandrian seafood',
        detailZh: '地中海漁獲與港邊餐桌呈現當地飲食特色',
        keywords: ['Alexandrian seafood', 'Mediterranean food'],
      },
      'street-market': {
        zh: '曼希亞街區',
        en: 'Mansheya district',
        detailZh: '市場街道與地中海城市建築形成港城日常',
        keywords: ['Mansheya Alexandria', 'market street'],
      },
      'culture-life': {
        zh: '亞歷山大電車',
        en: 'the Alexandria tram',
        detailZh: '電車沿著港城街道穿行，是當地通勤日常的一部分',
        keywords: ['Alexandria tram', 'daily life'],
      },
    },
  },
  {
    aliases: ['kasama', '笠間', '笠間市'],
    subjects: {
      landmark: {
        zh: '笠間稲荷神社',
        en: 'Kasama Inari Shrine',
        detailZh: '朱紅鳥居與神社建築立在陶器之鄉的山邊',
        keywords: ['Kasama Inari Shrine', 'vermilion torii'],
      },
      nature: {
        zh: '佐白山與神社山林',
        en: 'Mount Sashiro and the wooded shrine hills',
        detailZh: '山坡樹林環抱著笠間的神社與陶鄉',
        keywords: ['Mount Sashiro', 'Kasama hills'],
      },
      food: {
        zh: '笠間栗子',
        en: 'Kasama chestnuts',
        detailZh: '秋季栗子與陶鄉餐桌是笠間常見的飲食風景',
        keywords: ['Kasama chestnuts', 'local food'],
      },
      'street-market': {
        zh: '笠間藝術之森與陶窯街道',
        en: 'Kasama Craft Hills and kiln streets',
        detailZh: '陶窯、工房與散步道構成笠間的工藝街景',
        keywords: ['Kasama Craft Hills', 'kiln street'],
      },
      'culture-life': {
        zh: '笠間燒',
        en: 'Kasama ware pottery',
        detailZh: '陶輪、釉色與工房日常呈現當地的燒物文化',
        keywords: ['Kasama ware', 'pottery studio'],
      },
    },
  },
];

function genericSceneSubject(
  city: string,
  theme: ArrivalSceneTheme,
  spokenPlace = city
): SceneSubject {
  const enCity = /[A-Za-z]/.test(city) ? city : spokenPlace;
  const table: Record<ArrivalSceneThemeId, Omit<SceneSubject, 'isGeneric'>> = {
    landmark: {
      zh: '街上的屋子與招牌',
      en: `street buildings and signs in ${enCity}`,
      detailZh: '屋檐和顏色一看就是這裡',
      keywords: [`${enCity} street buildings`, `${enCity} local signs`],
    },
    nature: {
      zh: '土地與天色',
      en: `the local land, weather and sky over ${enCity}`,
      detailZh: '光跟著這裡的天氣走',
      keywords: [`${enCity} local land and sky`, `${enCity} weather light`],
    },
    food: {
      zh: '熱氣騰騰的街頭飲食攤',
      en: `a steaming street-food stall in ${enCity}`,
      detailZh: '熱氣和餐盤就在眼前',
      keywords: [`${enCity} food stall`, 'plated food foreground'],
    },
    'street-market': {
      zh: '街道與攤位',
      en: `streets and market stalls in ${enCity}`,
      detailZh: '店面和人行很日常',
      keywords: [`${enCity} street`, 'market street'],
    },
    'culture-life': {
      zh: '街上的屋子和行人',
      en: `everyday street life in ${enCity}`,
      detailZh: '招牌和人行道很日常',
      keywords: [`${enCity} daily life`, 'local street'],
    },
  };
  return { ...table[theme.id], isGeneric: true };
}

function knownSceneSubjects(
  input: MorningContentInput
): Partial<Record<ArrivalSceneThemeId, SceneSubject>> | null {
  const segments = [input.city, input.country].map(normalizeDestinationName);
  return (
    KNOWN_SCENE_SUBJECTS.find(({ aliases }) =>
      aliases.some((alias) => segments.includes(normalizeDestinationName(alias)))
    )?.subjects ?? null
  );
}

function trustedLandmarkSubject(input: MorningContentInput): SceneSubject | null {
  const knownLandmark = knownSceneSubjects(input)?.landmark;
  if (knownLandmark) return knownLandmark;

  const reliable = findReliableDestinationSubject(input.city, input.country);
  if (!reliable || reliable.usableAsFallback === false) return null;
  return {
    zh: reliable.zh,
    en: reliable.en,
    detailZh: reliable.detailZh,
    keywords: reliable.keywords,
  };
}

function resolveSceneSubject(
  input: MorningContentInput,
  theme: ArrivalSceneTheme
): SceneSubject {
  const knownSubject = knownSceneSubjects(input)?.[theme.id];
  if (knownSubject) return knownSubject;
  const landmark = trustedLandmarkSubject(input);
  if (landmark) return landmark;
  return genericSceneSubject(input.city.trim(), theme, spokenCity(input));
}

function arrivalThemeForDestination(
  _input: MorningContentInput,
  randomValue: number
): ArrivalSceneTheme {
  return selectArrivalSceneTheme(randomValue);
}

function shortPlaceName(value?: string | null): string {
  return String(value || '').split(/[,，]/)[0].trim();
}

function foldPlace(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenCity(input: MorningContentInput): string {
  const labelled = shortPlaceName(input.placeLabel);
  if (/[\u4e00-\u9fff]/.test(labelled)) return labelled;
  return spokenPlaceZh(input.city, input.country, input.countryIso);
}

function placeNameCandidates(input: MorningContentInput): string[] {
  return [input.city, input.country, input.placeLabel]
    .flatMap((value) => String(value || '').split(/[,，]/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);
}

function voiceMentionsPlace(voiceText: string, input: MorningContentInput): boolean {
  const folded = foldPlace(voiceText);
  const extras = [spokenCity(input), countryLabelZh(input.countryIso)].filter(Boolean);
  return [...placeNameCandidates(input), ...extras].some((name) => {
    if (voiceText.includes(name)) return true;
    const foldedName = foldPlace(name);
    return foldedName.length >= 2 && folded.includes(foldedName);
  });
}

function destinationAgrees(
  modelValue: string,
  inputValue: string,
  input: MorningContentInput
): boolean {
  if (!modelValue) return true;
  if (normalizeDestinationName(modelValue) === normalizeDestinationName(inputValue)) return true;
  const extras = [spokenCity(input), countryLabelZh(input.countryIso, input.country)].filter(Boolean);
  return [...placeNameCandidates(input), ...extras].some((name) => {
    const left = normalizeDestinationName(modelValue);
    const right = normalizeDestinationName(name);
    return left === right || name.includes(modelValue) || modelValue.includes(shortPlaceName(name));
  });
}

function formatFlightDurationZh(minutes?: number | null): string {
  const n = Math.max(0, Math.round(Number(minutes) || 0));
  if (!n) return '';
  const hours = Math.floor(n / 60);
  const rest = n % 60;
  if (hours && rest === 30) return `${hours} 個半小時`;
  if (hours && rest) return `${hours} 小時 ${rest} 分`;
  if (hours) return `${hours} 小時`;
  return `${rest} 分鐘`;
}

const UNSAFE_VOICE = /獨自|孤單|寂寞|孤獨|一個人|沒有人|被丟下|失敗|浪費|掙扎|撐過|逃避|黑暗|迷失|你應該|你必須|振作|正向一點|一定會很棒|別難過|做得很好|又撐過一夜|alone|lonely|by yourself|isolated|abandoned|cheer up|you should|you must/i;

function chineseCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/^["「]|["」]$/g, '').trim() : '';
}

function normalizeDestinationName(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeSubjectName(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part !== 'the')
    .join(' ');
}

function fallbackTimeContext(localTimeLabel?: string | null): {
  voiceLine: string;
  imageTime: string;
} {
  const label = (localTimeLabel || '').trim();
  if (!label) {
    return {
      voiceLine: '此刻，柔和自然光照著城市。',
      imageTime: 'Time is unspecified; use soft natural light without forcing a specific time of day.',
    };
  }

  const stamp = label.replace(/^當地/, '').trim() || label;
  const when = stamp ? `現在是當地${stamp}` : '現在';
  const normalized = label.toLocaleLowerCase();
  if (/晚上|夜間|夜晚|入夜|午夜|深夜|凌晨|night|evening|midnight|\bpm\b/.test(normalized)) {
    return {
      voiceLine: `${when}，街上的光很安靜。`,
      imageTime: 'Local night. Use realistic night lighting, sky brightness and city lights.',
    };
  }
  if (/清晨|黎明|日出|dawn|sunrise/.test(normalized)) {
    return {
      voiceLine: `${when}，天光才剛亮。`,
      imageTime: 'Local dawn. Use realistic dawn light.',
    };
  }
  if (/早上|上午|早晨|morning|\bam\b/.test(normalized)) {
    return {
      voiceLine: `${when}，白天的光照著街道。`,
      imageTime: 'Local morning. Use realistic morning daylight.',
    };
  }
  if (/黃昏|傍晚|日落|sunset|dusk/.test(normalized)) {
    return {
      voiceLine: `${when}，光已經偏暖。`,
      imageTime: 'Local dusk. Use realistic sunset or dusk light.',
    };
  }
  if (/午後|下午|中午|afternoon|noon/.test(normalized)) {
    return {
      voiceLine: `${when}。`,
      imageTime: 'Local afternoon. Use realistic daytime light and shadows.',
    };
  }
  return {
    voiceLine: `${when}，光線跟這個時段相符。`,
    imageTime: 'Match sky brightness, shadows and lights to the given local time; do not default to sunrise.',
  };
}

function englishWeatherDirection(weatherSummary?: string | null): string {
  const summary = (weatherSummary || '').trim();
  if (!summary) return 'Weather is unspecified; do not invent extreme conditions.';
  const temperature = summary.match(/(-?\d+(?:\.\d+)?)\s*°?\s*C/i)?.[1];
  const sky =
    /大雷雨|雷雨/.test(summary) ? 'thunderstorms' :
    /大雨/.test(summary) ? 'heavy rain' :
    /陣雨|中雨|小雨|雨/.test(summary) ? 'rain' :
    /毛毛雨/.test(summary) ? 'drizzle' :
    /雪/.test(summary) ? 'snow' :
    /霧/.test(summary) ? 'fog' :
    /陰/.test(summary) ? 'overcast' :
    /多雲/.test(summary) ? 'cloudy' :
    /晴/.test(summary) ? 'mostly clear' :
    'unspecified';
  const tempBit = temperature ? `about ${temperature}°C` : '';
  return `Weather: ${[tempBit, sky].filter(Boolean).join(', ')}. Sky, light and ground must match this weather.`;
}

function environmentImageDirections(input: MorningContentInput): string {
  const time = fallbackTimeContext(input.localTimeLabel);
  return `${time.imageTime} ${englishWeatherDirection(input.weatherSummary)}`;
}

function spokenWeatherLine(input: MorningContentInput): string {
  const summary = (input.weatherSummary || '').trim();
  const stamp = (input.localTimeLabel || '').replace(/^當地/, '').trim();
  if (!summary) return fallbackTimeContext(input.localTimeLabel).voiceLine;
  const temperature = summary.match(/(-?\d+(?:\.\d+)?)\s*°?\s*C/i)?.[1];
  const sky =
    /大雷雨|雷雨/.test(summary) ? '有雷雨' :
    /大雨/.test(summary) ? '在下大雨' :
    /陣雨|中雨|小雨|雨/.test(summary) ? '在下雨' :
    /毛毛雨/.test(summary) ? '有點毛毛雨' :
    /雪/.test(summary) ? '在下雪' :
    /霧/.test(summary) ? '有霧' :
    /陰/.test(summary) ? '天空陰著' :
    /多雲/.test(summary) ? '雲比較多' :
    /晴/.test(summary) ? '天還算晴' :
    '';
  const bits = [
    stamp ? `現在${stamp}` : '',
    temperature ? `大概 ${temperature} 度` : '',
    sky,
  ].filter(Boolean);
  return bits.length ? `${bits.join('，')}。` : fallbackTimeContext(input.localTimeLabel).voiceLine;
}

function arrivalVoiceShape(input: MorningContentInput, theme: ArrivalSceneTheme): 1 | 2 | 3 | 4 | 5 {
  const seed = `${input.city}|${input.country}|${theme.id}|${input.localTimeLabel || ''}|${input.departureLocation || ''}`;
  let n = 0;
  for (const ch of seed) n = (n + ch.charCodeAt(0) * 17) % 997;
  return ((n % 5) + 1) as 1 | 2 | 3 | 4 | 5;
}

function pickCultureClause(note: string): string {
  const clauses = note
    .split(/[；;。]/)
    .map((item) => item.trim())
    .filter((item) => item && !/旅行最美的風景/.test(item));
  if (!clauses.length) return '';
  const ranked = clauses
    .map((clause) => {
      const zh = chineseCount(clause);
      const latin = (clause.match(/[A-Za-z]/g) || []).length;
      let score = zh * 3 - Math.min(latin, 10);
      if (/人|見面|吃|喝|喜歡|朋友|招呼|問候|分享|鞠躬|吃飯|喝茶|攤|市|taco|sorry/i.test(clause)) score += 10;
      if (/節|紀念|亡靈|歷史|傳統節日|繽紛色彩/.test(clause)) score -= 12;
      return { clause, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.clause || clauses[0];
}

function softenCultureClause(clause: string): string {
  return clause
    .replace(/[「"']([^」"']+)[」"']不離口[\s\S]*/u, '很愛把「$1」掛在嘴上')
    .replace(/^(?:街頭)?\s*(.+?)是深夜社交場/u, (_, noun) => {
      const item = String(noun || '').trim();
      return /[A-Za-z]/.test(item) ? `很喜歡吃 ${item}，晚上常聚在一起` : `很喜歡去${item}，晚上常聚在一起`;
    })
    .replace(/^(.+?)是驕傲$/u, '很以$1為傲')
    .replace(/是社交核心/g, '是大家愛去晃的地方')
    .replace(/是國民習慣/g, '幾乎人人都會')
    .replace(/是日常問候/g, '是很日常的打招呼')
    .replace(/是待客之道/g, '是招待朋友的方式')
    .replace(/是社交重地/g, '是大家愛去的地方')
    .replace(/是生活哲學|是生活核心|是國民精神/g, '是這裡很看重的小事')
    .replace(/別忘了說/g, '也常說')
    .replace(/是基本禮儀/g, '')
    .replace(/是經典/g, '很常見')
    .replace(/\s+/g, ' ')
    .replace(/[，,、\s]+$/u, '')
    .trim();
}

function frameCultureHabit(habit: string, shape: 1 | 2 | 3 | 4 | 5): string {
  const body = habit.replace(/[。！？]$/u, '').trim();
  if (!body) return '';
  const people = /^(當地人|這裡的人|日本人|韓國人|台灣)/.test(body);
  const complete = people || /就是|是朋友|掛在嘴上|很喜歡|很愛/.test(body);
  const rest = people ? body.replace(/^(當地人|這裡的人|日本人|韓國人)/, '') : body;
  const frames = {
    1: complete ? `${body}。` : `當地人${body}。`,
    2: `這裡的人啊，${rest}。`,
    3: `有個可愛的小事：${body}。`,
    4: `跟當地人相處，常會發現${rest}。`,
    5: complete ? `${body}。` : `${body}，挺有人味的。`,
  } as const;
  return frames[shape].replace(/。。+/g, '。');
}

function spokenCultureAside(
  note: string | null | undefined,
  theme: ArrivalSceneTheme,
  _localTimeLabel?: string | null,
  shape: 1 | 2 | 3 | 4 | 5 = 1
): string {
  const raw = (note || '').trim();
  if (!raw || /旅行最美的風景/.test(raw)) return '';
  const clause = pickCultureClause(raw);
  if (!clause) return '';
  if (chineseCount(clause) < 2 && !/[A-Za-z]{3,}/.test(clause)) return '';
  const habit = softenCultureClause(clause);
  if (!habit) return '';
  const foodTheme = theme.id === 'food' || theme.id === 'street-market';
  const foodish = /餐|食|攤|麵|茶|酒|咖啡|烤|菜|料理|taco|夜市|炒|飯|糖/i.test(habit);
  if (foodTheme && foodish) {
    const photo = [
      '當地人很喜歡這個，眼前就能聞到。',
      '這就是當地人愛吃的東西，攤子就在眼前。',
      '當地人常把這個當日常，你看，現在就有。',
      '這裡的人超愛這個，眼前這攤就是。',
      '當地人很喜歡吃這個，剛好攤位就在面前。',
    ] as const;
    return photo[shape - 1];
  }
  return frameCultureHabit(habit, shape);
}

const WEATHER_TERMS = [
  '大雷雨伴冰雹',
  '雷雨伴冰雹',
  '大凍毛毛雨',
  '凍毛毛雨',
  '大致晴朗',
  '大毛毛雨',
  '中毛毛雨',
  '毛毛雨',
  '大凍雨',
  '凍雨',
  '大陣雨',
  '中陣雨',
  '陣雨',
  '大陣雪',
  '陣雪',
  '大雷雨',
  '雷雨',
  '晴朗',
  '多雲',
  '陰天',
  '有霧',
  '霧凇',
  '小雨',
  '中雨',
  '大雨',
  '小雪',
  '中雪',
  '大雪',
  '雪粒',
] as const;

function voiceMatchesWeather(voiceText: string, weatherSummary?: string | null): boolean {
  const summary = (weatherSummary || '').trim();
  if (!summary) return true;
  const temperature = summary.match(/(-?\d+(?:\.\d+)?)\s*°?\s*C/i)?.[1];
  if (
    temperature &&
    !voiceText.includes(temperature) &&
    !voiceText.includes(`${temperature}度`) &&
    !voiceText.includes(`${temperature} 度`)
  ) {
    return false;
  }
  const weatherTerm = WEATHER_TERMS.find((term) => summary.includes(term));
  if (!weatherTerm) return true;
  if (voiceText.includes(weatherTerm)) return true;
  if (/晴/.test(weatherTerm)) return /晴|陽光|藍天/.test(voiceText);
  if (/陰/.test(weatherTerm)) return /陰|雲/.test(voiceText);
  if (/毛毛雨|雨/.test(weatherTerm)) return /雨/.test(voiceText);
  if (/雪/.test(weatherTerm)) return /雪/.test(voiceText);
  if (/霧/.test(weatherTerm)) return /霧/.test(voiceText);
  return false;
}

export function arrivalHello(localTimeLabel?: string | null): string {
  const label = (localTimeLabel || '').trim();
  if (/晚上|夜間|夜晚|入夜|午夜|深夜|凌晨|night|evening|midnight|\bpm\b/.test(label)) return '晚安';
  if (/黃昏|傍晚|日落|sunset|dusk/.test(label)) return '傍晚好';
  if (/午後|中午|下午|afternoon|noon/.test(label)) return '午安';
  return '早安';
}

const MORNING_LOCAL_GREETINGS = [
  'Góðan daginn',
  'Góðan morgun',
  'Good morning',
  'Bonjour',
  'Guten Morgen',
  'Buenos días',
  'Buongiorno',
  'Bom dia',
  'Goedemorgen',
  'God morgon',
  'God morgen',
  'Hyvää huomenta',
  'Καλημέρα',
  'Dobré ráno',
  'Günaydın',
  'Доброе утро',
  'Selamat pagi',
  'Magandang umaga',
  'Xin chào buổi sáng',
  'สวัสดีตอนเช้า',
  'صباح الخير',
  'Habari za asubuhi',
  'おはようございます',
  '早上好',
  '早安',
  '早晨',
];

export function timeAdjustedGreeting(localGreeting: string, localTimeLabel?: string | null): string {
  const hello = arrivalHello(localTimeLabel);
  const greeting = (localGreeting || '你好').replace(/[。！!]+$/g, '');
  if (hello === '晚安' || hello === '傍晚好') {
    if (/おはよう|こんにちは/.test(greeting)) return 'こんばんは';
    if (/^bonjour$/i.test(greeting)) return 'Bonsoir';
    if (/早安|早上好|早晨/.test(greeting)) return hello;
  }
  if ((hello === '午安' || hello === '傍晚好') && /おはよう/.test(greeting)) return 'こんにちは';
  if (MORNING_LOCAL_GREETINGS.some((item) => item.toLowerCase() === greeting.toLowerCase())) {
    if (/^bonjour$/i.test(greeting)) return 'Bonjour';
    if (/おはよう/.test(greeting)) return 'こんにちは';
    if (/早安|早上好|早晨/.test(greeting)) return '你好';
    if (/^good morning$/i.test(greeting)) return 'Hello';
    if (/^guten morgen$/i.test(greeting)) return 'Hallo';
    if (/^buenos días$/i.test(greeting)) return 'Hola';
    if (/^buongiorno$/i.test(greeting)) return 'Ciao';
    if (/^bom dia$/i.test(greeting)) return 'Olá';
    if (/^goedemorgen$/i.test(greeting)) return 'Hallo';
    if (/^góðan /i.test(greeting)) return 'Halló';
    if (/^günaydın$/i.test(greeting)) return 'Merhaba';
    if (/^доброе утро$/i.test(greeting)) return 'Здравствуйте';
    if (/^selamat pagi$/i.test(greeting)) return 'Halo';
    if (/^xin chào buổi sáng$/i.test(greeting)) return 'Xin chào';
    return 'Hello';
  }
  return greeting;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alignArrivalVoice(voiceText: string, localGreeting: string, hello: string): string {
  let text = voiceText.trim();
  const leading = MORNING_LOCAL_GREETINGS.concat([
    localGreeting,
    'Halló',
    'Hello',
    'こんにちは',
    'こんばんは',
    'Bonsoir',
    'Hallo',
    'Hola',
    'Ciao',
    'Olá',
    'Merhaba',
    '你好',
  ]).filter(Boolean);
  const unique = [...new Set(leading)].sort((a, b) => b.length - a.length);
  for (const item of unique) {
    text = text.replace(new RegExp(`^${escapeRegExp(item)}[。！!]?\\s*`, 'i'), '');
  }
  text = text.replace(/^(早安|午安|傍晚好|晚安)[，,。！!\s]*/, '');
  if (!text.startsWith('Sleep Airline') && !text.startsWith(hello)) {
    return `${localGreeting}。${hello}，${text}`;
  }
  if (text.startsWith('Sleep Airline')) {
    return `${localGreeting}。${hello}，${text}`;
  }
  return `${localGreeting}。${text}`;
}

const VOICE_BOILERPLATE =
  /真實城市風貌|街道尺度|建築材料|地理環境呈現|自然地貌與天光|山、水或開闊地貌|地理樣子|代表性建築與城市輪廓|一眼認出這座城市|widely documented|real urban character and geographic setting/i;

function fallbackMorning(
  input: MorningContentInput,
  theme: ArrivalSceneTheme
): MorningContent {
  const city = input.city.trim() || input.country.trim() || '今天的目的地';
  const country = input.country.trim() || city;
  const place = spokenCity({ ...input, city, country });
  const subject = resolveSceneSubject(input, theme);
  const greeting = timeAdjustedGreeting(input.localGreeting || '你好', input.localTimeLabel);
  const hello = arrivalHello(input.localTimeLabel);
  const weatherLine = spokenWeatherLine(input);
  const where = placeOrientationLine(place, country, input.countryIso);
  const whereLine = where ? `${where}。` : '';
  const fromCity = spokenPlaceZh(
    shortPlaceName(input.departureLocation),
    String(input.departureLocation || '').split(/[,，]/)[1]?.trim() || '',
    null
  );
  const fromSpoken = /[\u4e00-\u9fff]/.test(fromCity) && fromCity !== '這裡' ? fromCity : '';
  const duration = formatFlightDurationZh(input.flightDurationMinutes);
  const journeyLine = [
    fromSpoken && fromSpoken !== place ? `從${fromSpoken}飛過來` : '',
    duration ? `空中待了 ${duration}` : '',
  ].filter(Boolean).join('，');
  const visitCount = Math.max(0, Math.round(Number(input.visitCount) || 0));
  const previousPlace = shortPlaceName(input.previousArrival);
  const returnLine = visitCount >= 2
    ? `這是今晚第${visitCount}次降落在${place}。`
    : input.returnVisit
      ? `這不是第一次到${place}。`
      : previousPlace && previousPlace !== place && previousPlace !== city
        ? `上一站經過${previousPlace}。`
        : '';
  const shape = arrivalVoiceShape({ ...input, city, country }, theme);
  const lookYou = theme.id === 'food' ? `你看，眼前這攤是${subject.zh}。` : `你看，眼前是${subject.zh}。`;
  const lookPhoto = `眼前這張是${subject.zh}。`;
  const lookPlain = `${subject.zh}就在眼前。`;
  const lookNature = theme.id === 'nature' ? `先看到的是${subject.zh}。` : lookYou;
  const aside = spokenCultureAside(input.cultureNote, theme, input.localTimeLabel, shape);
  const arrive = `我們到了${place}。`;
  const arriveSoft = `這站是${place}。`;
  const journey = journeyLine ? `${journeyLine}。` : '';
  const packed = [
    '',
    `${greeting}。${hello}，${arrive}${lookYou}${weatherLine}${whereLine}${journey}${returnLine}${aside}`,
    `${greeting}。${hello}，${journey}${arrive}${whereLine}${lookPhoto}${returnLine}${aside}${weatherLine}`,
    `${greeting}。${hello}，${weatherLine}${arrive}${lookNature}${whereLine}${journey}${returnLine}${aside}`,
    `${greeting}。${hello}，${arrive}${aside}${lookYou}${whereLine}${journey}${returnLine}${weatherLine}`,
    `${greeting}。${hello}，${journeyLine ? `${journeyLine}，才到了${place}。` : arriveSoft}${weatherLine.replace(/。$/, '，')}${lookPhoto}${whereLine}${returnLine}${aside}`,
  ] as const;
  const voiceText = packed[shape].replace(/，。/g, '。').replace(/。。+/g, '。');
  const subjectSafety = subject.isGeneric
    ? `Show a believable, destination-specific view of ${subject.en}; never invent a fake named attraction or recipe.`
    : `Keep this verified destination subject unchanged; do not replace it with a generic scene.`;
  return {
    destination: { country, city },
    localGreeting: greeting,
    voiceText,
    localFeature: subject.zh,
    imagePrompt: `Beautiful scenery of ${city}, ${country}, with no airplane, window frame, wing or cabin. ${environmentImageDirections(input)} The one dominant subject is ${subject.en}. Show only this visual subject; do not add street-food asides unless that is the subject. Keep geography and architecture authentic to this exact destination. ${subjectSafety} Never substitute another city. Calm realistic scene, welcoming, no crowds, no text`,
    imageKeywords: subject.keywords,
    safetyCheck: {
      containsNegativeEmotionalLanguage: false,
      containsPressureLanguage: false,
      containsLonelinessLanguage: false,
      containsUnverifiedCulturalClaim: false,
    },
  };
}

/** 驗證模型輸出的主題與本次抽選一致，並確認三個內容欄位沿用同一 subject。 */
export function parseMorningResponse(
  raw: string,
  input: MorningContentInput,
  expectedThemeId: ArrivalSceneThemeId
): MorningContent | null {
  const jsonText = raw.replace(/^```(?:json)?/i, '').replace(/```$/g, '').trim();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
  const safetyCheck = data.safetyCheck;
  const safetyKeys = [
    'containsNegativeEmotionalLanguage',
    'containsPressureLanguage',
    'containsLonelinessLanguage',
    'containsUnverifiedCulturalClaim',
  ] as const;
  if (
    typeof safetyCheck !== 'object' ||
    safetyCheck === null ||
    Array.isArray(safetyCheck)
  ) {
    return null;
  }
  const flags = safetyCheck as Record<string, unknown>;
  if (
    flags.containsNegativeEmotionalLanguage !== false ||
    flags.containsPressureLanguage !== false ||
    flags.containsLonelinessLanguage !== false
  ) {
    return null;
  }
  const knownSubject = knownSceneSubjects(input)?.[expectedThemeId] || (
    expectedThemeId === 'landmark' ? trustedLandmarkSubject(input) : null
  );
  if (flags.containsUnverifiedCulturalClaim !== false) {
    if (knownSubject || expectedThemeId === 'food') return null;
  }

  const destination = (data.destination ?? {}) as Record<string, unknown>;
  const modelCity = clean(destination.city);
  const modelCountry = clean(destination.country);
  const inputCity = input.city.trim();
  const inputCountry = input.country.trim();
  if (
    !destinationAgrees(modelCity, inputCity, input) ||
    !destinationAgrees(modelCountry, inputCountry, input)
  ) {
    return null;
  }

  const sceneTheme = (data.sceneTheme ?? {}) as Record<string, unknown>;
  const themeId = clean(sceneTheme.themeId);
  const subject = (sceneTheme.subject ?? {}) as Record<string, unknown>;
  const subjectZh = clean(subject.zh);
  const subjectEn = clean(subject.en);
  if (themeId !== expectedThemeId || !subjectZh || !subjectEn) return null;
  if (expectedThemeId === 'landmark') {
    const trusted = trustedLandmarkSubject(input);
    if (trusted) {
      if (
        normalizeSubjectName(subjectZh) !== normalizeSubjectName(trusted.zh) ||
        normalizeSubjectName(subjectEn) !== normalizeSubjectName(trusted.en)
      ) {
        return null;
      }
    }
  }

  const city = inputCity;
  const country = inputCountry;
  const localGreeting = timeAdjustedGreeting(
    clean(data.localGreeting) || input.localGreeting || '你好',
    input.localTimeLabel
  );
  const hello = arrivalHello(input.localTimeLabel);
  let voiceText = clean(data.voiceText);
  if (!voiceText) return null;
  voiceText = alignArrivalVoice(voiceText, localGreeting, hello);
  const zh = chineseCount(voiceText);
  if (zh < 24 || zh > 220 || !city || !voiceMentionsPlace(voiceText, input) || UNSAFE_VOICE.test(voiceText)) return null;
  if (!voiceMatchesWeather(voiceText, input.weatherSummary)) return null;
  const localFeature = clean(data.localFeature);
  if (!voiceText.includes(subjectZh) || !localFeature.includes(subjectZh)) return null;
  if (VOICE_BOILERPLATE.test(`${voiceText} ${localFeature}`)) return null;
  let imagePrompt = clean(data.imagePrompt);
  if (VOICE_BOILERPLATE.test(imagePrompt)) return null;
  if (/airplane|aircraft|plane window|window frame|porthole|cabin|\bwings?\b|舷窗|機艙|機翼|窗/i.test(imagePrompt)) {
    imagePrompt = '';
  }
  if (!imagePrompt || /[\u4e00-\u9fff]/.test(imagePrompt)) {
    const time = fallbackTimeContext(input.localTimeLabel);
    imagePrompt = `${time.imageTime} ${subjectEn} in ${city}, ${country}. Authentic destination-specific scenery, realistic, no text`;
  }
  const environment = environmentImageDirections(input);
  if (
    /night lighting/i.test(environment) &&
    /sunrise|morning|dawn|晨光|清晨|早晨|日出/i.test(`${voiceText} ${imagePrompt}`)
  ) {
    return null;
  }
  if (!imagePrompt.toLocaleLowerCase().includes(subjectEn.toLocaleLowerCase())) return null;
  imagePrompt = `${imagePrompt} Server-controlled environment constraints: ${environment}`;
  const keywords = Array.isArray(data.imageKeywords)
    ? data.imageKeywords.map((item) => clean(item)).filter(Boolean).slice(0, 6)
    : [];
  return {
    destination: { country, city },
    localGreeting,
    voiceText,
    localFeature,
    imagePrompt,
    imageKeywords: keywords.length ? keywords : [`${city} scenery`, subjectEn, 'authentic local light'],
    safetyCheck: {
      containsNegativeEmotionalLanguage: false,
      containsPressureLanguage: false,
      containsLonelinessLanguage: false,
      containsUnverifiedCulturalClaim: false,
    },
  };
}

const VOICE_SHAPE_HINTS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '句構一「先看照片」：問候 → 到了哪 → 眼前這張是什麼 → 隨口帶天氣 → 這地方在地圖哪 → 從哪飛來 → 一句當地人趣事。',
  2: '句構二「先說旅程」：問候 → 從哪飛了多久才到 → 這地方在地圖哪 → 眼前這張照片 → 一句當地人趣事 → 最後才帶天氣。',
  3: '句構三「先聊天氣」：問候 → 現在幾點幾度的感覺 → 到了哪 → 眼前照片 → 地圖位置 → 旅程 → 一句當地人趣事。',
  4: '句構四「先講人」：問候 → 到了哪 → 先講一句當地人趣事 → 再看照片 → 地圖位置 → 旅程 → 天氣。',
  5: '句構五「揉在一起」：問候後用兩到三句把抵達、照片、天氣、旅程、趣事交錯，不要一句一個欄位。',
};

const SYSTEM_PROMPT = `你是 Sleep Airline 的抵達內容系統。對象是剛醒來、看著窗外照片的旅客。這不是醫療、治療或勵志教練。
禁止診斷、解讀情緒，或告訴對方該有什麼感覺。

語氣：像一位溫暖、好說話的機長朋友，剛把旅客叫醒。親切、輕、自然，帶一點笑意。不要中性播報，不要百科，不要客服腔，不要每班都用同一套句型。
禁止：「你應該」「你必須」「振作」「正向」「今天一定會很棒」「別難過」「你做得很好」「你又撐過一夜」。
禁止孤獨、遺棄、失敗、壓力、罪惡、比較：獨自、孤單、寂寞、一個人、沒有人、失敗、浪費、掙扎、逃避、黑暗、迷失。
禁止空話與契約用語，絕對不要寫：真實城市風貌、地理環境、街道尺度、建築材料、可查證、widely documented、urban character。

voiceText 必須是人會講出口的繁體中文口語，約 80–130 個中文字。寫成一段連貫的話。
本次必須嚴格使用 user.voiceShape 指定的那一種句構，五種如下：
1. 先看照片：到了哪 → 眼前這張是什麼 → 天氣 → 地圖位置 → 旅程 → 趣事
2. 先說旅程：從哪飛了多久才到 → 地圖位置 → 眼前照片 → 趣事 → 天氣
3. 先聊天氣：現在幾點幾度的感覺 → 到了哪 → 眼前照片 → 地圖位置 → 旅程 → 趣事
4. 先講人：到了哪 → 先講當地人趣事 → 再看照片 → 地圖位置 → 旅程 → 天氣
5. 揉在一起：兩到三句把抵達、照片、天氣、旅程、趣事交錯，不要一句一個欄位
開頭：當地語言「你好」（localGreeting），不要用早安／Good morning。接著中文時段問候（早安／午安／傍晚好／晚安，必須符合 localTimeLabel）。禁止「當地白天問候 + 中文晚安」。
禁止每次都用：「已抵達今天的目的地——」「窗外是」「歡迎抵達，今天的旅程從這裡開始」「晚上常有 X」「X 是深夜社交場」「X 是國民習慣」。
地圖定位一句即可：洲或海洋＋國家。不要東北亞、西歐，不要百科。
天氣用口語，例如「現在大概 18 度，天還算晴」。
眼前／這張照片只講 sceneTheme 那一個看得見的主題。禁止「自然地貌與天光」「山、水或開闊地貌」。

cultureNote 適用任何國家，一律改寫成「人會做的一件小事」，要有溫度、有點好玩。不要針對特定國家寫死句子，要依這則備註現場改寫。
好：當地人很喜歡吃 taco，晚上常拿來當宵夜。／見面會輕輕鞠躬，吃飯前還會說いただきます。／一盤 nasi goreng 就能變成朋友。／這裡的人很愛把「sorry」掛在嘴上。
壞：晚上常有 taco。／街頭 taco 是深夜社交場。／「sorry」不離口是國民習慣。／把 cultureNote 第一句整段貼上。
趣事講的是人，不是畫面。除非 sceneTheme 是 food 且 subject 就是那道料理，否則不要說窗外看得到它。
城市若沒有常用中文譯名，用 spokenCity。不要把 Tarawa、Jolo、small talk、Po/Opo 硬塞進中文句。
禁止：彷彿、為您、編織、鋪展畫面、點亮希望、內心的喧囂、隨風而去、當地航站、本班自、車流和生活步調。
若有 reviewCalibration，靠近高分語氣，避開評語點名的空話。不要複製校正區原文。
visitCount >= 2 時說今晚第幾次降落。後面全部繁體中文，不要翻譯那句當地問候。
voiceText、localFeature、imagePrompt 必須描述同一個看得見的主題；趣事旁白不必畫進圖片。
回傳 sceneTheme.themeId 必須逐字等於 user.sceneTheme.id。voiceText 與 localFeature 必須逐字包含 subject.zh，imagePrompt 必須逐字包含 subject.en。
imagePrompt 全英文，只畫看得見的主題與相符天氣，不要畫趣事旁白。禁止飛機、窗框、舷窗、機翼、機艙與畫面文字。光線符合 localTimeLabel。
金字塔只可用於 Cairo／Giza。無法確認的文化聲明必須把 containsUnverifiedCulturalClaim 設為 true。

只回 JSON：
{"destination":{"country":"","city":""},"localGreeting":"","sceneTheme":{"themeId":"","subject":{"zh":"","en":""}},"voiceText":"","localFeature":"","imagePrompt":"","imageKeywords":[],"safetyCheck":{"containsNegativeEmotionalLanguage":false,"containsPressureLanguage":false,"containsLonelinessLanguage":false,"containsUnverifiedCulturalClaim":false}}`;

async function requestMorning(
  input: MorningContentInput,
  theme: ArrivalSceneTheme
): Promise<MorningContent> {
  const apiKey = openAiApiKey();
  if (!apiKey) return fallbackMorning(input, theme);
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const city = input.city.trim();
  const country = input.country.trim();
  const greeting = timeAdjustedGreeting(input.localGreeting || '你好', input.localTimeLabel);
  const subject = resolveSceneSubject(input, theme);
  const voiceShape = arrivalVoiceShape(input, theme);
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          country,
          city,
          language: '繁體中文',
          voiceShape,
          voiceShapeHint: VOICE_SHAPE_HINTS[voiceShape],
          localGreeting: greeting || undefined,
          chineseTimeGreeting: arrivalHello(input.localTimeLabel),
          weatherSummary: (input.weatherSummary || '').trim() || undefined,
          localTimeLabel: (input.localTimeLabel || '').trim() || undefined,
          spokenCity: spokenCity(input),
          placeLabel: (input.placeLabel || '').trim() || undefined,
          placeOrientation: placeOrientationLine(spokenCity(input), country, input.countryIso) || undefined,
          reviewCalibration: (input.reviewCalibration || '').trim() || undefined,
          departureLocation: shortPlaceName(input.departureLocation) || undefined,
          flightDurationMinutes: input.flightDurationMinutes || undefined,
          previousArrival: shortPlaceName(input.previousArrival) || undefined,
          returnVisit: input.returnVisit || undefined,
          visitCount: input.visitCount && input.visitCount >= 2 ? input.visitCount : undefined,
          cultureNote: (input.cultureNote || '').trim() || undefined,
          sceneTheme: {
            id: theme.id,
            label: theme.label,
            instruction: theme.instruction,
            reliableFallbackSubject: subject.isGeneric
              ? undefined
              : {
                  zh: subject.zh,
                  en: subject.en,
                },
            subjectHint: subject.isGeneric
              ? undefined
              : {
                  zh: subject.zh,
                  en: subject.en,
                },
          },
          bannedPhrases: [
            '自然地貌與天光',
            '山、水或開闊地貌',
            '地理樣子',
            '代表性建築與城市輪廓',
            '一眼認出這座城市',
            '當地航站',
            '本班自',
            '彷彿',
            '為您編織',
            '車流和生活步調',
            '今天的旅程從這裡開始',
            '深夜社交場',
            '晚上常有 taco',
            '這裡常有',
          ],
          sceneRules: [
            '必須使用本次 voiceShape，不要改用其他句構，也不要每次都從抵達句開頭。',
            'cultureNote 無論哪一國都要改寫成有人味的趣事；不要整段貼上，不要「是國民習慣／是深夜社交場／晚上常有 X」。',
            '眼前／這張照片只講 sceneTheme 主題；趣事不要假裝畫面上有，除非 theme 是 food 且 subject 就是那道料理。',
            'localFeature 與 imagePrompt 只描述看得見的主題，不要畫旁白裡的飲食習慣。',
            '先確認主題確實屬於這座城市；不得挪用同國其他城市的地標或文化。',
            '只使用 widely documented canonical local subject；無法確認時必須把 containsUnverifiedCulturalClaim 設為 true。',
            '若此類型沒有可靠題材，改用該地真實、有名字的著名景點、河岸山林、市場或文化場景，絕不捏造，也絕不改寫成空泛地貌套句。',
            '金字塔只可用於 Cairo／Giza；埃及其他城市不可自動使用金字塔。',
            '禁止 bannedPhrases 裡的任何套句。',
            'voiceText 用人口語繁體中文；地名用 spokenCity，不要把 cultureNote 整段貼上。',
            'imagePrompt 全英文，不可夾中文時間或天氣原句。',
          ],
        }),
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 750,
    temperature: 0.72,
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  return parseMorningResponse(raw, input, theme.id) ?? fallbackMorning(input, theme);
}

/** 降落語音：繁體中文早晨抵達廣播，並給出同一場景的生圖描述。失敗時用安全模板。 */
export function generateMorningArrival(
  input: MorningContentInput,
  randomValue: number = Math.random()
): Promise<MorningContent> {
  const theme = arrivalThemeForDestination(input, randomValue);
  const safe = fallbackMorning(input, theme);
  return withTimeout(requestMorning(input, theme), 12_000, () => safe).catch(() => safe);
}
