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
  const zhCity = spokenPlace || city;
  const table: Record<ArrivalSceneThemeId, Omit<SceneSubject, 'isGeneric'>> = {
    landmark: {
      zh: `${zhCity}街上的屋子與招牌`,
      en: `street buildings and signs in ${enCity}`,
      detailZh: '屋檐和顏色一看就是這裡',
      keywords: [`${enCity} street buildings`, `${enCity} local signs`],
    },
    nature: {
      zh: `${zhCity}此刻的土地、風向與天色`,
      en: `the local land, weather and sky over ${enCity}`,
      detailZh: '光跟著這裡的天氣走',
      keywords: [`${enCity} local land and sky`, `${enCity} weather light`],
    },
    food: {
      zh: `${zhCity}熱氣騰騰的街頭飲食攤`,
      en: `a steaming street-food stall in ${enCity}`,
      detailZh: '熱氣和餐盤就在眼前',
      keywords: [`${enCity} food stall`, 'plated food foreground'],
    },
    'street-market': {
      zh: `${zhCity}的街道與市集`,
      en: `streets and market stalls in ${enCity}`,
      detailZh: '店面和人行很日常',
      keywords: [`${enCity} street`, 'market street'],
    },
    'culture-life': {
      zh: `${zhCity}日常的街景`,
      en: `everyday street life in ${enCity}`,
      detailZh: '車流和生活步調都在眼前',
      keywords: [`${enCity} daily life`, 'local culture'],
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
    /晴/.test(summary) ? '天空大致晴朗' :
    '';
  const bits = [
    stamp || '',
    temperature ? `氣溫 ${temperature} 度` : '',
    sky,
  ].filter(Boolean);
  return bits.length ? `${bits.join('，')}。` : fallbackTimeContext(input.localTimeLabel).voiceLine;
}

function spokenCultureLine(note?: string | null): string {
  const raw = (note || '').trim();
  if (!raw || /旅行最美的風景/.test(raw)) return '';
  const first = raw.split(/[；;。]/)[0]?.trim() || '';
  if (!first) return '';
  const latin = (first.match(/[A-Za-z]/g) || []).length;
  const zh = chineseCount(first);
  if (zh < 4 || latin > zh) return '';
  return `${first}。`;
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
    fromSpoken && fromSpoken !== place ? `這一班從${fromSpoken}飛來` : '',
    duration ? `在空中待了${duration}` : '',
  ].filter(Boolean).join('，');
  const visitCount = Math.max(0, Math.round(Number(input.visitCount) || 0));
  const previousPlace = shortPlaceName(input.previousArrival);
  const returnLine = visitCount >= 2
    ? `這是今晚第${visitCount}次降落在${place}。`
    : input.returnVisit
      ? `這不是第一次降落在${place}。`
      : previousPlace && previousPlace !== place && previousPlace !== city
        ? `上一站是${previousPlace}。`
        : '';
  const windowLine = `窗外是${subject.zh}，${subject.detailZh}。`;
  const voiceText = [
    `${greeting}。${hello}，Sleep Airline 已抵達今天的目的地——${place}。`,
    whereLine,
    weatherLine,
    journeyLine ? `${journeyLine}。` : '',
    returnLine,
    windowLine,
    spokenCultureLine(input.cultureNote),
    `歡迎抵達${place}，今天的旅程從這裡開始。`,
  ].filter(Boolean).join('');
  const subjectSafety = subject.isGeneric
    ? `Show a believable, destination-specific view of ${subject.en}; never invent a fake named attraction or recipe.`
    : `Keep this verified destination subject unchanged; do not replace it with a generic scene.`;
  return {
    destination: { country, city },
    localGreeting: greeting,
    voiceText,
    localFeature: subject.zh,
    imagePrompt: `Beautiful scenery of ${city}, ${country}, with no airplane, window frame, wing or cabin. ${environmentImageDirections(input)} The one dominant subject is ${subject.en}, matching the narration exactly. Keep geography, architecture, ingredients, transport and cultural details authentic to this exact destination. ${subjectSafety} Never substitute another city. Calm realistic scene, welcoming, no crowds, no text`,
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

const SYSTEM_PROMPT = `你是 Sleep Airline 的抵達內容系統。對象是剛醒來、看著窗外照片的旅客。這不是醫療、治療或勵志教練。
禁止診斷、解讀情緒，或告訴對方該有什麼感覺。

語氣：溫和、平靜、中性、輕、自然、不評判、不要求。像機長帶著旅客看窗外那張照片，輕聲介紹眼前的當地特色。
禁止：「你應該」「你必須」「振作」「正向」「今天一定會很棒」「別難過」「你做得很好」「你又撐過一夜」。
禁止孤獨、遺棄、失敗、壓力、罪惡、比較：獨自、孤單、寂寞、一個人、沒有人、失敗、浪費、掙扎、逃避、黑暗、迷失。
禁止空話與契約用語，絕對不要寫：真實城市風貌、地理環境、街道尺度、建築材料、可查證、widely documented、urban character。

voiceText 主體必須是人會講出口的繁體中文口語，約 90–140 個中文字，念出來大約 30–45 秒。短句、自然，像機長在說話。
禁止翻譯腔與英文夾中文：不要把 Tarawa、Jolo、small talk、Po/Opo、karaoke 原封不動塞進中文句；城市若沒有常用中文譯名，改說 user 給的 spokenCity（通常是中文國名）。
禁止把提示詞或 cultureNote 整段貼上。禁止：彷彿、為您、編織、鋪展畫面、點亮希望、內心的喧囂、隨風而去、當地航站、本班自。
結構：
A. 抵達：第一句用當地語言的「你好」（localGreeting，例如 Halló、こんにちは、Hola），不要用早安／Good morning／Góðan daginn 這類綁時段的問候。第二句再用中文時段問候（早安／午安／傍晚好／晚安，必須符合 localTimeLabel），然後「Sleep Airline 已抵達今天的目的地——{城市}。」禁止出現「當地白天問候 + 中文晚安」這種互相打架的開頭。
A2. 定位：緊接著用一句話告訴剛醒來、可能沒聽過這地名的人「這個地方在世界哪裡」。必須說出洲或海洋，不要用東北亞、西歐這種細分區。東京可說「這裡是亞洲，日本的首都」；太平洋小島可說「這裡是南太平洋，屬於新喀里多尼亞」；冰島可說「這裡是北大西洋，冰島的首都」。只用地圖常識：洲或海洋、國家、首都／島國／海外領地／某國城市。禁止人口數字、冷門歷史、百科條列、導遊腔。若 user 提供 placeOrientation，改寫融入即可。
A3. 這次旅程：若 user 提供 flightDurationMinutes 或 departureLocation，用一句話說從哪裡飛來、在空中待了多久。若 visitCount >= 2，說這是今晚第幾次降落在這座城市；否則若 returnVisit 為 true，輕輕提一句又回到這裡；若提供 previousArrival 且不是本城，可提上一站發生過什麼（只講地名，不要編情節）。不要算命、不要講情緒。
若 user 提供 reviewCalibration，那是審查台對過往降落廣播的分數與評語。高分範例請靠近其語氣、節奏與具體程度；低分與「評：／近期評語」裡點名的空話、夜色套句、自然地貌套句、不像這個城市的內容不要再犯。不要複製校正區的原文。
B. 嚴格採用 user message 的 sceneTheme，只選一個確實屬於這座城市、有名字的具體主題：著名景點、河岸山林、地方料理、街區市集、表演、工藝或日常文化場景。像在介紹窗外那張照片，或聽得到的當地生活。禁止任何城市都能套的空話，尤其禁止「自然地貌與天光」「山、水或開闊地貌」「地理樣子」「代表性建築與城市輪廓」。
C. 同一個主題再補一個具體、看得見或聽得到的細節（顏色、材料、氣味、聲音、地形、市集、表演或活動），不要發明地標、料理、傳統、節慶或歷史。自然主題也要講出河、岸、山、林、港的名字或明確特徵。
D. 若 user 提供 cultureNote，改寫成一句當地生活（飲食、禮儀、市場、交通或表演），勿整段照搬。
E. 輕柔收尾，不下指令。例如「歡迎抵達{城市}，今天的旅程從這裡開始。」
開頭可以先放當地語言問候，後面全部用繁體中文，不要翻譯那句問候，也不要改成英文廣播。
若有提供天氣，voiceText 必須用一句話自然說出溫度與晴雨，例如「現在氣溫 18 度，天空大致晴朗」。
若有提供 localTimeLabel，語音與 imagePrompt 的光線、天空和城市活動必須符合該當地時間，不可一律改成日出，也不可在深夜仍說早安。中文問候與當地語言問候都不可互相矛盾。
內容必須能對上這個城市，不能是任何城市都適用的空話。每次降落都要讓人聽得出「就是這裡」，不要重複同一套風景句。
voiceText、localFeature、imagePrompt 必須描述 sceneTheme 下的同一個具體主題，只能抽選一次，不可各自換題。
回傳 sceneTheme.themeId 必須逐字等於 user message 的 sceneTheme.id。sceneTheme.subject.zh 與 sceneTheme.subject.en 是同一主題的中英文名稱；voiceText 與 localFeature 必須逐字包含 subject.zh，imagePrompt 必須逐字包含 subject.en，供程式驗證同步。
若 user message 提供 reliableFallbackSubject，優先使用它。若沒有，請自行選一個廣泛記載、確實位於這座城市的具名主題，例如神社、城堡、山、港、市場或地方名物。
imagePrompt 必須全英文，一個中文字都不能出現。必須是 voiceText 裡同一個地點、同一個主題、同一種天氣與氣氛。天空、光線、地面要和語音說的天氣一致。這個主題要成為畫面主體，讓人看得出是這個城市，不要畫成任何地方都適用的郊區住宅。可以出現屬於這個城市的代表性建築或地貌，但必須就是語音講到的那一個，禁止換成別的城市或該國另一個更有名的地標。
若抽中的類型沒有可靠題材，改用該地真實的著名景點、自然地貌或文化場景；禁止捏造。Taipei 的可靠地標可用 Taipei 101；Cairo／Giza 可用吉薩金字塔，但埃及其他城市不可一律使用金字塔。
非 landmark 題材也只能使用廣泛記載、可查證的當地主題；只要有任何文化或地理聲明無法確認，safetyCheck.containsUnverifiedCulturalClaim 必須據實回傳 true，不得為了通過驗證而填 false。
imagePrompt 只描述這個地方本身的美麗風景：禁止飛機、飛機窗戶、窗框、舷窗、機翼、機艙，也不要從窗內往外看的構圖；畫面中不得有任何文字。
依 localTimeLabel 使用合理光線，維持平靜、寫實、低刺激。不要陰鬱、空蕩到令人不安、危險或擁擠。

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
          ],
          sceneRules: [
            'voiceText、localFeature、imagePrompt 必須使用同一個具體主題，不得各自改選。',
            '圖片與語音必須同步描述同一地點、天氣、時間與主體。',
            '先確認主題確實屬於這座城市；不得挪用同國其他城市的地標或文化。',
            '只使用 widely documented canonical local subject；無法確認時必須把 containsUnverifiedCulturalClaim 設為 true。',
            '若此類型沒有可靠題材，改用該地真實、有名字的著名景點、河岸山林、市場或文化場景，絕不捏造，也絕不改寫成空泛地貌套句。',
            '金字塔只可用於 Cairo／Giza；埃及其他城市不可自動使用金字塔。',
            '禁止 bannedPhrases 裡的任何套句。',
            'voiceText 用人口語繁體中文：短句、自然；地名用 spokenCity，不要把英文城名硬塞進中文句，不要把 cultureNote 整段貼上。',
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
