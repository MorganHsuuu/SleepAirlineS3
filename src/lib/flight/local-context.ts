/** 抵達／出發地的當地文化與即時天氣，供機長廣播 prompt 使用 */

import { CITIES } from '../../data/cities';
import { haversineDistance } from '../utils/haversine';

export interface LocalContext {
  countryIso: string;
  countryName: string;
  cityName: string;
  culture: string;
  /** 抵達地當地語言的「早安」，供降落廣播開頭 */
  morningGreeting: string;
  /** 例：氣溫 28°C，晴朗 */
  weatherSummary: string | null;
  /** 例：當地清晨 */
  localTimeLabel: string | null;
}

const DEFAULT_CULTURE =
  '走出艙門，帶著好奇心向當地人微笑問好——旅行最美的風景，往往是人與人的相遇。';

/** ISO2 → 當地文化／社交特色（供機長改寫融入廣播，勿整段照搬） */
const CULTURE_BY_ISO: Record<string, { name: string; culture: string }> = {
  JP: { name: '日本', culture: '日本人見面會輕輕鞠躬；居酒屋乾杯時說「乾杯」，別忘了說「いただきます」。' },
  KR: { name: '南韓', culture: '韓國人乾杯時晚輩要側身、雙手接杯；一句「안녕하세요」就能拉近距离。' },
  CN: { name: '中國', culture: '喝茶時被斟茶，用手指輕敲桌面是說謝謝；飯桌上「慢慢吃」是關心。' },
  TW: { name: '臺灣', culture: '台灣的夜市與便利商店是深夜社交核心，一句「呷飽沒？」就是最溫暖的問候。' },
  HK: { name: '香港', culture: '茶餐廳搭枱是日常，點杯凍鴛鴦配菠蘿油，感受快節奏裡的人情味。' },
  TH: { name: '泰國', culture: '雙手合十微微低頭說「Sawadee」；路邊攤的冬陰功是深夜社交的靈魂。' },
  VN: { name: '越南', culture: '街邊小塑膠椅配滴漏咖啡是經典；「Xin chào」配上微笑就足夠。' },
  SG: { name: '新加坡', culture: '熟食中心用面紙包佔位是默契；多元文化在這裡用美食對話。' },
  MY: { name: '馬來西亞', culture: '入夜後到 mamak 檔喝拉茶，是當地人的宵夜社交儀式。' },
  ID: { name: '印尼', culture: '「Apa kabar?」是日常問候；分享一盤 nasi goreng 就是朋友。' },
  PH: { name: '菲律賓', culture: 'Filipino 的「Po/Opo」是對長輩的禮貌；karaoke 是全民社交語言。' },
  IN: { name: '印度', culture: '雙手合十說「Namaste」；用右手遞物、左手留給個人衛生是基本禮儀。' },
  AE: { name: '阿聯', culture: '阿拉伯咖啡（qahwa）配椰棗是待客之道；用右手接物是尊重。' },
  TR: { name: '土耳其', culture: '一杯土耳其紅茶配 baklava 是街坊談天的日常；「Merhaba」配上微笑就夠了。' },
  RU: { name: '俄羅斯', culture: '進門脫鞋、作客帶小禮物是禮貌；伏特加乾杯要眼神對視。' },
  GB: { name: '英國', culture: 'pub 裡和鄰座聊聊天氣是國民技能；排隊是神聖的。' },
  FR: { name: '法國', culture: '進店先說「Bonjour」；麵包配紅酒，晚餐要慢慢享用。' },
  DE: { name: '德國', culture: '乾杯時眼神對視是基本；週末啤酒花園（Biergarten）是社交重地。' },
  IT: { name: '義大利', culture: 'Espresso 站著快喝是道地；飯後才點甜點，別在餐前點卡布奇諾。' },
  ES: { name: '西班牙', culture: 'tapas 配 sangria 聊到深夜是日常；siesta 後的傍晚才是社交高峰。' },
  PT: { name: '葡萄牙', culture: 'fado 音樂配 port 酒；「Obrigado/a」是每日必備。' },
  NL: { name: '荷蘭', culture: '腳踏車是國民語言；直率坦誠的聊天方式，別誤會為無禮。' },
  CH: { name: '瑞士', culture: '準時是美德；多語言共存，用對語言問候會加分。' },
  SE: { name: '瑞典', culture: 'fika（咖啡配甜點）是每日社交儀式；lagom（剛剛好）是生活哲學。' },
  NO: { name: '挪威', culture: '戶外 friluftsliv（親近自然）是國民精神；簡約直接的交流方式。' },
  FI: { name: '芬蘭', culture: '桑拿後跳進冰湖是社交儀式；沉默不是冷漠，是芬蘭式的舒適。' },
  DK: { name: '丹麥', culture: 'hygge（溫馨）是生活核心；自行車道上的「Hej」是日常問候。' },
  GR: { name: '希臘', culture: '「Yassas」配上手勢；海邊 taverna 的 meze 是分享的起點。' },
  PL: { name: '波蘭', culture: '進門脫鞋是禮貌；pierogi 配 vodka 是作客的经典組合。' },
  CZ: { name: '捷克', culture: '啤酒比水還便宜；舉杯時眼神對視說「Na zdraví」。' },
  AT: { name: '奧地利', culture: '咖啡館文化深厚；維也納华尔滋是見面與告別的優雅。' },
  IE: { name: '愛爾蘭', culture: 'pub 現場音樂配健力士；「craic」（歡樂閒聊）是靈魂。' },
  IS: { name: '冰島', culture: '地熱溫泉閒話家常；追極光是與朋友相聚的日常浪漫。' },
  US: { name: '美國', culture: '微笑與 small talk 破冰；週末 BBQ 是鄰里社交經典。' },
  CA: { name: '加拿大', culture: '「sorry」不離口是國民習慣；冰球與楓糖漿是驕傲。' },
  MX: { name: '墨西哥', culture: '街頭 taco 是深夜社交場；亡靈節以繽紛色彩紀念摯愛。' },
  BR: { name: '巴西', culture: '貼臉頰擁抱問候；churrasco 配森巴是生活節奏。' },
  AR: { name: '阿根廷', culture: '共用 mate 吸管是深厚友誼；晚餐與探戈都很晚才開始。' },
  CL: { name: '智利', culture: '貼臉頰問候；週末聚餐配本地紅酒是家庭傳統。' },
  PE: { name: '秘魯', culture: 'ceviche 是國民美食；分享食物是拉近彼此的方式。' },
  CO: { name: '哥倫比亞', culture: '一杯 tinto 配閒聊；廣場音樂與舞蹈是週末日常。' },
  AU: { name: '澳洲', culture: '「no worries」回應一切；海灘 BBQ 是社交日常。' },
  NZ: { name: '紐西蘭', culture: '毛利碰鼻禮 hongi 交換氣息；戶外健行是 Kiwi 精神。' },
  ZA: { name: '南非', culture: 'braai 炭烤跨越族群；「彩虹之國」多元共融。' },
  EG: { name: '埃及', culture: '作客會被熱情勸食；薄荷紅茶配水煙是街坊談天日常。' },
  MA: { name: '摩洛哥', culture: '薄荷茶高高沖倒起泡是待客之道；souk 討價還價也是交流。' },
  KE: { name: '肯亞', culture: '「Jambo!」是問候；Ubuntu 精神強調彼此連結。' },
  PG: { name: '巴布亞新幾內亞', culture: '島嶼部落的歡迎儀式熱情而隆重；分享 betel nut 是傳統社交。' },
  RE: { name: '留尼旺', culture: '見面先說「Bonjour」；克里奧料理與火山景觀是當地特色。' },
};

/** 各國／地區「早安」問候（供降落廣播開頭） */
const MORNING_GREETING_BY_ISO: Record<string, string> = {
  JP: 'おはようございます',
  KR: '안녕하세요',
  CN: '早上好',
  TW: '早安',
  HK: '早晨',
  TH: 'สวัสดีตอนเช้า',
  VN: 'Xin chào buổi sáng',
  SG: 'Good morning',
  MY: 'Selamat pagi',
  ID: 'Selamat pagi',
  PH: 'Magandang umaga',
  IN: 'Namaste',
  AE: 'صباح الخير',
  TR: 'Günaydın',
  RU: 'Доброе утро',
  GB: 'Good morning',
  FR: 'Bonjour',
  RE: 'Bonjour',
  GP: 'Bonjour',
  MQ: 'Bonjour',
  GF: 'Bonjour',
  DE: 'Guten Morgen',
  IT: 'Buongiorno',
  ES: 'Buenos días',
  PT: 'Bom dia',
  NL: 'Goedemorgen',
  CH: 'Guten Morgen',
  SE: 'God morgon',
  NO: 'God morgen',
  FI: 'Hyvää huomenta',
  DK: 'God morgen',
  GR: 'Καλημέρα',
  PL: 'Dzień dobry',
  CZ: 'Dobré ráno',
  AT: 'Guten Morgen',
  IE: 'Good morning',
  IS: 'Góðan daginn',
  US: 'Good morning',
  CA: 'Good morning',
  MX: 'Buenos días',
  BR: 'Bom dia',
  AR: 'Buenos días',
  CL: 'Buenos días',
  PE: 'Buenos días',
  CO: 'Buenos días',
  AU: 'Good morning',
  NZ: 'Good morning',
  ZA: 'Good morning',
  EG: 'صباح الخير',
  MA: 'Bonjour',
  KE: 'Habari za asubuhi',
  PG: 'Good morning',
};

function morningGreetingForIso(iso: string): string {
  const key = iso.toUpperCase();
  if (MORNING_GREETING_BY_ISO[key]) return MORNING_GREETING_BY_ISO[key];
  if (['NC', 'PF', 'YT', 'PM', 'BL', 'MF', 'WF', 'TF'].includes(key)) return 'Bonjour';
  return 'Good morning';
}

const WMO_LABELS: Record<number, string> = {
  0: '晴朗', 1: '大致晴朗', 2: '多雲', 3: '陰天',
  45: '有霧', 48: '霧凇',
  51: '毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨',
  56: '凍毛毛雨', 57: '大凍毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '凍雨', 67: '大凍雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  77: '雪粒',
  80: '陣雨', 81: '中陣雨', 82: '大陣雨',
  85: '陣雪', 86: '大陣雪',
  95: '雷雨', 96: '雷雨伴冰雹', 99: '大雷雨伴冰雹',
};

function cultureForIso(iso: string): { name: string; culture: string } {
  const key = iso.toUpperCase();
  return CULTURE_BY_ISO[key] ?? { name: key, culture: DEFAULT_CULTURE };
}

function localTimeLabelFromHour(hour: number, isDay: boolean): string {
  if (!isDay && (hour >= 21 || hour < 5)) return '當地深夜';
  if (hour < 5) return '當地凌晨';
  if (hour < 8) return '當地清晨';
  if (hour < 11) return '當地上午';
  if (hour < 14) return '當地中午';
  if (hour < 18) return '當地下午';
  if (hour < 21) return '當地傍晚';
  return '當地入夜';
}

function parseLocalHour(isoTime: string): number {
  const m = isoTime.match(/T(\d{2}):/);
  return m ? parseInt(m[1], 10) : 8;
}

async function fetchWeatherSummary(latitude: number, longitude: number): Promise<{
  weatherSummary: string;
  localTimeLabel: string;
} | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('current', 'temperature_2m,weather_code,is_day');
  url.searchParams.set('timezone', 'auto');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json() as {
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number; time?: string };
    };
    const cur = data.current;
    if (!cur || cur.temperature_2m == null) return null;

    const code = cur.weather_code ?? 0;
    const label = WMO_LABELS[code] ?? '多雲';
    const temp = Math.round(cur.temperature_2m);
    const hour = parseLocalHour(cur.time ?? '');
    const isDay = cur.is_day !== 0;
    const timeLabel = localTimeLabelFromHour(hour, isDay);

    return {
      weatherSummary: `氣溫 ${temp}°C，${label}`,
      localTimeLabel: timeLabel,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 依座標或 displayName 回推國家 ISO2 */
export function resolveCountryIso(
  latitude: number,
  longitude: number,
  displayName?: string
): string {
  if (displayName) {
    const exact = CITIES.find((c) => c.displayName === displayName);
    if (exact) return exact.countryIso;
  }
  let nearest = CITIES[0];
  let best = Infinity;
  for (const c of CITIES) {
    const d = haversineDistance(latitude, longitude, c.latitude, c.longitude);
    if (d < best) {
      best = d;
      nearest = c;
    }
  }
  return nearest?.countryIso ?? 'TW';
}

/** 依座標與國家 ISO 組裝當地脈絡（文化必備，天氣取 Open-Meteo，失敗則略過） */
export async function fetchLocalContext(input: {
  cityName: string;
  countryName: string;
  countryIso: string;
  latitude: number;
  longitude: number;
}): Promise<LocalContext> {
  const iso = input.countryIso.toUpperCase();
  const { name, culture } = cultureForIso(iso);
  const weather = await fetchWeatherSummary(input.latitude, input.longitude);

  return {
    countryIso: iso,
    countryName: input.countryName || name,
    cityName: input.cityName,
    culture,
    morningGreeting: morningGreetingForIso(iso),
    weatherSummary: weather?.weatherSummary ?? null,
    localTimeLabel: weather?.localTimeLabel ?? null,
  };
}

/** 供 fallback 廣播使用的精簡文化提示 */
export function cultureHintForIso(iso: string): string {
  const { culture } = cultureForIso(iso);
  // 取第一句或前 40 字
  const first = culture.split('；')[0]?.split('。')[0] ?? culture;
  return first.length > 48 ? first.slice(0, 45) + '…' : first;
}
