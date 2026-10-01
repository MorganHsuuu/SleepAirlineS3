import OpenAI from 'openai';
import { openAiApiKey } from './openai-env';
import { withTimeout } from '../with-timeout';
import { findReliableDestinationSubject } from './destination-subjects';

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
  /** 已知的當地語言早安；模型沒給時用這個 */
  localGreeting?: string | null;
  /** 例如「氣溫 18°C，大致晴朗」 */
  weatherSummary?: string | null;
  localTimeLabel?: string | null;
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
    instruction: '選一個目的地真實的自然地貌、水岸、植被或生態景觀作為唯一主題。',
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
    instruction: '選一個目的地真實的文化、交通工具或日常生活場景作為唯一主題。',
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
  theme: ArrivalSceneTheme
): SceneSubject {
  const table: Record<ArrivalSceneThemeId, Omit<SceneSubject, 'isGeneric'>> = {
    landmark: {
      zh: `${city}的代表性建築與城市輪廓`,
      en: `the distinctive architecture and skyline of ${city}`,
      detailZh: '建築層次與街道輪廓讓人一眼認出這座城市',
      keywords: [`${city} architecture`, `${city} skyline`],
    },
    nature: {
      zh: `${city}的自然地貌與天光`,
      en: `the natural landscape around ${city}`,
      detailZh: '山、水或開闊地貌構成當地的地理樣子',
      keywords: [`${city} landscape`, 'natural scenery'],
    },
    food: {
      zh: `${city}日常的餐桌風景`,
      en: `an everyday local food scene in ${city}`,
      detailZh: '街上常見的飲食攤與餐桌氣味',
      keywords: [`${city} food`, 'local table'],
    },
    'street-market': {
      zh: `${city}的街道與市集節奏`,
      en: `the streets and market rhythm of ${city}`,
      detailZh: '店面、行人與屋瓦構成當地日常街景',
      keywords: [`${city} street`, 'market street'],
    },
    'culture-life': {
      zh: `${city}日常的生活風景`,
      en: `everyday cultural life in ${city}`,
      detailZh: '交通、廟宇或生活場景呈現當地步調',
      keywords: [`${city} daily life`, 'local culture'],
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
  return genericSceneSubject(input.city.trim(), theme);
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

  const normalized = label.toLocaleLowerCase();
  if (/晚上|夜間|夜晚|入夜|午夜|深夜|凌晨|night|evening|midnight|\bpm\b/.test(normalized)) {
    return {
      voiceLine: `${label}，城市在平靜的夜間光線中展開。`,
      imageTime: `Local time: ${label}. Use realistic night lighting, sky brightness and city lights.`,
    };
  }
  if (/清晨|黎明|日出|dawn|sunrise/.test(normalized)) {
    return {
      voiceLine: `${label}，清晨自然光正落在城市。`,
      imageTime: `Local time: ${label}. Use realistic dawn light.`,
    };
  }
  if (/早上|上午|早晨|morning|\bam\b/.test(normalized)) {
    return {
      voiceLine: `${label}，白天的自然光正照著城市。`,
      imageTime: `Local time: ${label}. Use realistic morning daylight.`,
    };
  }
  if (/黃昏|傍晚|日落|sunset|dusk/.test(normalized)) {
    return {
      voiceLine: `${label}，城市映著符合當地時間的黃昏光線。`,
      imageTime: `Local time: ${label}. Use realistic sunset or dusk light.`,
    };
  }
  return {
    voiceLine: `${label}，城市呈現符合當地時間的自然光線。`,
    imageTime: `Local time: ${label}. Match sky brightness, shadows and artificial lights to this local time.`,
  };
}

function environmentImageDirections(input: MorningContentInput): string {
  const time = fallbackTimeContext(input.localTimeLabel);
  const weather = (input.weatherSummary || '').trim();
  const weatherDirection = weather
    ? `Weather: ${weather}. The sky, light and ground must match this weather.`
    : 'Weather is unspecified; do not invent extreme conditions.';
  return `${time.imageTime} ${weatherDirection}`;
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
  if (temperature && !voiceText.includes(temperature)) return false;
  const weatherTerm = WEATHER_TERMS.find((term) => summary.includes(term));
  return !weatherTerm || voiceText.includes(weatherTerm);
}

function arrivalHello(localTimeLabel?: string | null): string {
  const label = (localTimeLabel || '').trim();
  if (/晚上|夜間|夜晚|入夜|午夜|深夜|凌晨|night|evening|midnight|\bpm\b/.test(label)) return '晚安';
  if (/黃昏|傍晚|日落|sunset|dusk/.test(label)) return '傍晚好';
  if (/中午|下午|afternoon|noon/.test(label)) return '午安';
  return '早安';
}

function timeAdjustedGreeting(localGreeting: string, localTimeLabel?: string | null): string {
  const hello = arrivalHello(localTimeLabel);
  const greeting = (localGreeting || hello).replace(/[。！!]+$/g, '');
  if (hello === '晚安') {
    if (/おはよう/.test(greeting)) return 'こんばんは';
    if (/^bonjour$/i.test(greeting)) return 'Bonsoir';
    if (/早安/.test(greeting)) return '晚安';
  }
  if ((hello === '午安' || hello === '傍晚好') && /おはよう/.test(greeting)) return 'こんにちは';
  return greeting;
}

const VOICE_BOILERPLATE =
  /真實城市風貌|街道尺度|建築材料|地理環境呈現|widely documented|real urban character and geographic setting/i;

function fallbackMorning(
  input: MorningContentInput,
  theme: ArrivalSceneTheme
): MorningContent {
  const city = input.city.trim() || input.country.trim() || '今天的目的地';
  const country = input.country.trim() || city;
  const subject = resolveSceneSubject({ ...input, city, country }, theme);
  const greeting = timeAdjustedGreeting(input.localGreeting || arrivalHello(input.localTimeLabel), input.localTimeLabel);
  const hello = arrivalHello(input.localTimeLabel);
  const weather = (input.weatherSummary || '').trim();
  const time = fallbackTimeContext(input.localTimeLabel);
  const weatherLine = weather
    ? `${input.localTimeLabel || '現在'}，這裡${weather}。`
    : time.voiceLine;
  const voiceText = `${greeting}。${hello}，Sleep Airline 已抵達今天的目的地——${city}。${weatherLine}窗外看見的是${subject.zh}，${subject.detailZh}。歡迎抵達${city}，今天的旅程從這裡開始。`;
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
    Array.isArray(safetyCheck) ||
    !safetyKeys.every(
      (key) => (safetyCheck as Record<string, unknown>)[key] === false
    )
  ) {
    return null;
  }

  const destination = (data.destination ?? {}) as Record<string, unknown>;
  const modelCity = clean(destination.city);
  const modelCountry = clean(destination.country);
  const inputCity = input.city.trim();
  const inputCountry = input.country.trim();
  if (
    (modelCity &&
      normalizeDestinationName(modelCity) !== normalizeDestinationName(inputCity)) ||
    (modelCountry &&
      normalizeDestinationName(modelCountry) !== normalizeDestinationName(inputCountry))
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
  const localGreeting = clean(data.localGreeting) || (input.localGreeting || '早安').replace(/[。！!]+$/g, '');
  let voiceText = clean(data.voiceText);
  if (!voiceText) return null;
  if (localGreeting && !voiceText.startsWith(localGreeting)) {
    voiceText = `${localGreeting}。${voiceText}`;
  }
  const zh = chineseCount(voiceText);
  if (zh < 24 || zh > 180 || !city || !voiceText.includes(city) || UNSAFE_VOICE.test(voiceText)) return null;
  if (!voiceMatchesWeather(voiceText, input.weatherSummary)) return null;
  const localFeature = clean(data.localFeature);
  if (!voiceText.includes(subjectZh) || !localFeature.includes(subjectZh)) return null;
  if (VOICE_BOILERPLATE.test(`${voiceText} ${localFeature}`)) return null;
  let imagePrompt = clean(data.imagePrompt);
  if (VOICE_BOILERPLATE.test(imagePrompt)) return null;
  if (/airplane|aircraft|plane window|window frame|porthole|cabin|\bwings?\b|舷窗|機艙|機翼|窗/i.test(imagePrompt)) {
    imagePrompt = '';
  }
  if (!imagePrompt) {
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

voiceText 主體必須是繁體中文口語，約 40–80 個中文字，念出來大約 15–30 秒。
結構：
A. 抵達：先放當地語言問候（localGreeting，並依 localTimeLabel 改成對應時段，例如日文深夜用こんばんは、下午用こんにちは），再接中文時段問候（早安／午安／傍晚好／晚安），然後「Sleep Airline 已抵達今天的目的地——{城市}。」
B. 嚴格採用 user message 的 sceneTheme，只選一個確實屬於這座城市、有名字的具體主題：著名景點、自然地貌、地方料理、街區市集或日常文化場景。像在介紹窗外那張照片。
C. 同一個主題再補一個具體、看得見的細節（顏色、材料、氣味、地形或活動），不要發明地標、料理、傳統、節慶或歷史。
D. 輕柔收尾，不下指令。例如「歡迎抵達{城市}，今天的旅程從這裡開始。」
開頭可以先放當地語言問候，後面全部用繁體中文，不要翻譯那句問候，也不要改成英文廣播。
若有提供天氣，voiceText 必須用一句話自然說出溫度與晴雨，例如「現在氣溫 18 度，天空大致晴朗」。
若有提供 localTimeLabel，語音與 imagePrompt 的光線、天空和城市活動必須符合該當地時間，不可一律改成日出，也不可在深夜仍說早安。
內容必須能對上這個城市，不能是任何城市都適用的空話。
voiceText、localFeature、imagePrompt 必須描述 sceneTheme 下的同一個具體主題，只能抽選一次，不可各自換題。
回傳 sceneTheme.themeId 必須逐字等於 user message 的 sceneTheme.id。sceneTheme.subject.zh 與 sceneTheme.subject.en 是同一主題的中英文名稱；voiceText 與 localFeature 必須逐字包含 subject.zh，imagePrompt 必須逐字包含 subject.en，供程式驗證同步。
若 user message 提供 reliableFallbackSubject，優先使用它。若沒有，請自行選一個廣泛記載、確實位於這座城市的具名主題，例如神社、城堡、山、港、市場或地方名物。
imagePrompt 用英文，必須是 voiceText 裡同一個地點、同一個主題、同一種天氣與氣氛。天空、光線、地面要和語音說的天氣一致。這個主題要成為畫面主體，讓人看得出是這個城市，不要畫成任何地方都適用的郊區住宅。可以出現屬於這個城市的代表性建築或地貌，但必須就是語音講到的那一個，禁止換成別的城市或該國另一個更有名的地標。
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
  const greeting = (input.localGreeting || '').trim();
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
          weatherSummary: (input.weatherSummary || '').trim() || undefined,
          localTimeLabel: (input.localTimeLabel || '').trim() || undefined,
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
            subjectHint: {
              zh: subject.zh,
              en: subject.en,
            },
          },
          sceneRules: [
            'voiceText、localFeature、imagePrompt 必須使用同一個具體主題，不得各自改選。',
            '圖片與語音必須同步描述同一地點、天氣、時間與主體。',
            '先確認主題確實屬於這座城市；不得挪用同國其他城市的地標或文化。',
            '只使用 widely documented canonical local subject；無法確認時必須把 containsUnverifiedCulturalClaim 設為 true。',
            '若此類型沒有可靠題材，改用該地真實的著名景點、自然地貌或文化場景，絕不捏造。',
            '金字塔只可用於 Cairo／Giza；埃及其他城市不可自動使用金字塔。',
          ],
        }),
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500,
    temperature: 0.5,
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  return parseMorningResponse(raw, input, theme.id) ?? fallbackMorning(input, theme);
}

/** 降落語音：繁體中文早晨抵達廣播，並給出同一場景的生圖描述。失敗時用安全模板。 */
export function generateMorningArrival(
  input: MorningContentInput,
  randomValue: number = Math.random()
): Promise<MorningContent> {
  const theme = selectArrivalSceneTheme(randomValue);
  const safe = fallbackMorning(input, theme);
  return withTimeout(requestMorning(input, theme), 12_000, () => safe).catch(() => safe);
}
