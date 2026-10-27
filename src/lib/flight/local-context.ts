/** 抵達／出發地的當地文化與即時天氣，供機長廣播 prompt 使用 */

import { CITIES } from '../../data/cities';
import { haversineDistance } from '../utils/haversine';

export interface LocalContext {
  countryIso: string;
  countryName: string;
  cityName: string;
  culture: string;
  /** 抵達地當地語言的「你好」（不限時段），供降落廣播開頭 */
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

/** 各國／地區「你好」問候（不綁早安，避免當地白天問候配上中文晚安） */
const LOCAL_HELLO_BY_ISO: Record<string, string> = {
  JP: 'こんにちは',
  KR: '안녕하세요',
  CN: '你好',
  TW: '你好',
  HK: '你好',
  TH: 'สวัสดี',
  VN: 'Xin chào',
  SG: 'Hello',
  MY: 'Helo',
  ID: 'Halo',
  PH: 'Kumusta',
  IN: 'Namaste',
  AE: 'مرحبا',
  TR: 'Merhaba',
  RU: 'Здравствуйте',
  GB: 'Hello',
  FR: 'Bonjour',
  RE: 'Bonjour',
  GP: 'Bonjour',
  MQ: 'Bonjour',
  GF: 'Bonjour',
  DE: 'Hallo',
  IT: 'Ciao',
  ES: 'Hola',
  PT: 'Olá',
  NL: 'Hallo',
  CH: 'Hallo',
  SE: 'Hej',
  NO: 'Hei',
  FI: 'Hei',
  DK: 'Hej',
  GR: 'Γεια σας',
  PL: 'Cześć',
  CZ: 'Ahoj',
  AT: 'Hallo',
  IE: 'Hello',
  IS: 'Halló',
  US: 'Hello',
  CA: 'Hello',
  MX: 'Hola',
  CU: 'Hola',
  DO: 'Hola',
  PR: 'Hola',
  GT: 'Hola',
  HN: 'Hola',
  SV: 'Hola',
  NI: 'Hola',
  CR: 'Hola',
  PA: 'Hola',
  VE: 'Hola',
  EC: 'Hola',
  BO: 'Hola',
  PY: 'Hola',
  UY: 'Hola',
  BR: 'Olá',
  AR: 'Hola',
  CL: 'Hola',
  PE: 'Hola',
  CO: 'Hola',
  AU: 'Hello',
  NZ: 'Hello',
  ZA: 'Hello',
  EG: 'مرحبا',
  MA: 'Salam',
  KE: 'Jambo',
  PG: 'Hello',
};

function morningGreetingForIso(iso: string): string {
  const key = iso.toUpperCase();
  if (LOCAL_HELLO_BY_ISO[key]) return LOCAL_HELLO_BY_ISO[key];
  if (['NC', 'PF', 'YT', 'PM', 'BL', 'MF', 'WF', 'TF'].includes(key)) return 'Bonjour';
  return 'Hello';
}

/** 洲或海洋：剛醒來的人聽得懂的地圖位置，不用東北亞／西歐這種細分區 */
const MACRO_REGION_BY_ISO: Record<string, string> = {
  JP: '亞洲', KR: '亞洲', CN: '亞洲', TW: '亞洲', HK: '亞洲', MN: '亞洲',
  TH: '亞洲', VN: '亞洲', SG: '亞洲', MY: '亞洲', ID: '亞洲', PH: '亞洲',
  IN: '亞洲', AE: '亞洲', TR: '亞洲',
  RU: '歐亞',
  GB: '歐洲', FR: '歐洲', DE: '歐洲', NL: '歐洲', CH: '歐洲', IE: '歐洲', BE: '歐洲',
  IT: '歐洲', ES: '歐洲', PT: '歐洲', GR: '歐洲',
  PL: '歐洲', CZ: '歐洲', AT: '歐洲',
  SE: '歐洲', NO: '歐洲', FI: '歐洲', DK: '歐洲',
  IS: '北大西洋',
  US: '北美洲', CA: '北美洲', MX: '北美洲',
  BR: '南美洲', AR: '南美洲', CL: '南美洲', PE: '南美洲', CO: '南美洲',
  AU: '大洋洲', NZ: '大洋洲',
  PG: '南太平洋',
  NC: '南太平洋', PF: '南太平洋', WS: '南太平洋', TO: '南太平洋', FJ: '南太平洋',
  VU: '南太平洋', SB: '南太平洋', CK: '南太平洋', NU: '南太平洋',
  PW: '太平洋', MH: '太平洋', KI: '太平洋', FM: '太平洋', NR: '太平洋', TV: '太平洋',
  EG: '非洲', MA: '非洲', KE: '非洲', ZA: '非洲', RE: '印度洋',
};

const MACRO_REGION_EN: Record<string, string> = {
  亞洲: 'Asia',
  歐洲: 'Europe',
  歐亞: 'Eurasia',
  北美洲: 'North America',
  南美洲: 'South America',
  非洲: 'Africa',
  大洋洲: 'Oceania',
  太平洋: 'the Pacific',
  南太平洋: 'the South Pacific',
  北大西洋: 'the North Atlantic',
  印度洋: 'the Indian Ocean',
  加勒比海: 'the Caribbean',
  中美洲: 'Central America',
};

/** 主表沒列到的國家：中文名、地圖區域、一句人味文化。 */
const EXTRA_GEO: Record<string, { name: string; region: string; culture: string }> = {
  CU: { name: '古巴', region: '加勒比海', culture: '古巴人傍晚常在街上聽音樂、跳salsa；一杯咖啡能聊很久。' },
  DO: { name: '多明尼加', region: '加勒比海', culture: '梅倫格是日常節奏，街上很容易就有人跟著拍子走。' },
  HT: { name: '海地', region: '加勒比海', culture: '當地人很愛分享一盤飯，見面常先問吃飽沒。' },
  JM: { name: '牙買加', region: '加勒比海', culture: '雷鬼從街上的喇叭流出來，當地人講話也帶著拍子。' },
  PR: { name: '波多黎各', region: '加勒比海', culture: '當地人很愛在街上跳bomba，晚餐常常拖到很晚。' },
  TT: { name: '千里達', region: '加勒比海', culture: '旋轉烤雞和卡利普索是週末社交的固定節目。' },
  BS: { name: '巴哈馬', region: '加勒比海', culture: '當地人講話慢、笑得開，遇人常先點頭打招呼。' },
  BB: { name: '巴貝多', region: '加勒比海', culture: '海邊攤位的飛魚是當地人很自豪的日常。' },
  GT: { name: '瓜地馬拉', region: '中美洲', culture: '市集裡織品顏色很亮，當地人很愛邊走邊聊。' },
  HN: { name: '宏都拉斯', region: '中美洲', culture: '當地人招待朋友常端出一盤香蕉葉包的飯。' },
  SV: { name: '薩爾瓦多', region: '中美洲', culture: 'pupusa 是當地人幾乎天天吃的餅，常配醃高麗菜。' },
  NI: { name: '尼加拉瓜', region: '中美洲', culture: '傍晚廣場會聚集聊天，當地人很喜歡慢慢坐著。' },
  CR: { name: '哥斯大黎加', region: '中美洲', culture: '當地人常把「Pura vida」掛在嘴上，遇到什麼都這樣回。' },
  PA: { name: '巴拿馬', region: '中美洲', culture: '當地人很愛在午後喝杯咖啡，再慢慢聊下去。' },
  BZ: { name: '貝里斯', region: '中美洲', culture: '英語、克里奧爾語混著講，當地人招呼很隨和。' },
  VE: { name: '委內瑞拉', region: '南美洲', culture: '當地人很愛喝熱巧克力，晚上廣場常有人聊天。' },
  EC: { name: '厄瓜多', region: '南美洲', culture: '當地人招待客人常端出一盤香蕉和魚。' },
  BO: { name: '玻利維亞', region: '南美洲', culture: '高原上的人走路慢、招呼熱，市集是社交中心。' },
  PY: { name: '巴拉圭', region: '南美洲', culture: '當地人很愛分享 mate，一根吸管傳著喝。' },
  UY: { name: '烏拉圭', region: '南美洲', culture: '傍晚海邊烤爐一開，當地人就會慢慢聚過來。' },
  NG: { name: '奈及利亞', region: '非洲', culture: '當地人招呼很響亮，一盤 jollof rice 就能變成朋友。' },
  GH: { name: '迦納', region: '非洲', culture: '當地人很愛用「Chale」叫朋友，路上遇到都會笑著點頭。' },
  TZ: { name: '坦尚尼亞', region: '非洲', culture: '當地人見面會說「Karibu」，請你像回到家一樣。' },
  ET: { name: '衣索比亞', region: '非洲', culture: '咖啡儀式能聊很久，當地人請喝咖啡就是把你當朋友。' },
  SN: { name: '塞內加爾', region: '非洲', culture: '一大盤飯大家圍著吃，當地人覺得分享比什麼都重要。' },
  UA: { name: '烏克蘭', region: '歐洲', culture: '進門常被請吃麵包配鹽，當地人用這一盤表示歡迎。' },
  RO: { name: '羅馬尼亞', region: '歐洲', culture: '當地人很愛在院子裡待客，晚餐常常拖得很長。' },
  HU: { name: '匈牙利', region: '歐洲', culture: '溫泉是社交場，當地人泡完常再去喝一杯。' },
  PK: { name: '巴基斯坦', region: '亞洲', culture: '當地人招待客人一定勸你再吃一口，拒絕會被笑。' },
  BD: { name: '孟加拉', region: '亞洲', culture: '甜點和茶是待客日常，當地人聊天都配著一杯。' },
  LK: { name: '斯里蘭卡', region: '亞洲', culture: '當地人很愛用咖哩配扁麵包當早餐，街上很早就有香氣。' },
  KH: { name: '柬埔寨', region: '亞洲', culture: '當地人打招呼會微微合掌，市集裡很愛邊走邊吃。' },
  MM: { name: '緬甸', region: '亞洲', culture: '綠茶葉沙拉是很日常的小吃，當地人很愛配茶聊。' },
  SA: { name: '沙烏地', region: '亞洲', culture: '椰棗配咖啡是待客起手式，當地人請你吃就是歡迎。' },
  IL: { name: '以色列', region: '亞洲', culture: '市場裡hummus 很常見，當地人很愛站著邊吃邊聊。' },
};

const COUNTRY_ZH_EXTRA: Record<string, string> = {
  NC: '新喀里多尼亞',
  PW: '帛琉',
  WS: '薩摩亞',
  FJ: '斐濟',
  TO: '東加',
  VU: '萬那杜',
  SB: '索羅門群島',
  MH: '馬紹爾群島',
  KI: '吉里巴斯',
  FM: '密克羅尼西亞',
  PF: '法屬玻里尼西亞',
};

const CAPITAL_ALIASES: Record<string, string[]> = {
  JP: ['tokyo', '東京'],
  KR: ['seoul', '首爾', '서울'],
  CN: ['beijing', '北京'],
  TW: ['taipei', '台北', '臺北'],
  FR: ['paris', '巴黎'],
  GB: ['london', '倫敦'],
  DE: ['berlin', '柏林'],
  IT: ['rome', 'roma', '羅馬'],
  ES: ['madrid', '馬德里'],
  TH: ['bangkok', '曼谷'],
  VN: ['hanoi', '河內'],
  ID: ['jakarta', '雅加達'],
  SG: ['singapore', '新加坡'],
  AU: ['canberra', '坎培拉'],
  NZ: ['wellington', '威靈頓'],
  IS: ['reykjavik', 'reykjavík', '雷克雅維克', '雷克亞維克'],
  US: ['washington', '華盛頓'],
  CA: ['ottawa', '渥太華'],
  RU: ['moscow', '莫斯科'],
  IN: ['new delhi', 'delhi', '新德里', '德里'],
  EG: ['cairo', '開羅'],
  TR: ['ankara', '安卡拉'],
  PL: ['warsaw', '華沙'],
  CZ: ['prague', 'praha', '布拉格'],
  AT: ['vienna', 'wien', '維也納'],
  GR: ['athens', '雅典'],
  NL: ['amsterdam', '阿姆斯特丹'],
  SE: ['stockholm', '斯德哥爾摩'],
  NO: ['oslo', '奧斯陸'],
  FI: ['helsinki', '赫爾辛基'],
  DK: ['copenhagen', 'københavn', '哥本哈根'],
  BR: ['brasília', 'brasilia', '巴西利亞'],
  AR: ['buenos aires', '布宜諾斯艾利斯'],
  MX: ['mexico city', 'ciudad de méxico', '墨西哥城'],
  PE: ['lima', '利馬'],
  CO: ['bogotá', 'bogota', '波哥大'],
  CL: ['santiago', '聖地牙哥'],
  KE: ['nairobi', '奈洛比'],
  ZA: ['pretoria', '開普敦', 'cape town'],
  AE: ['abu dhabi', '阿布達比'],
  MY: ['kuala lumpur', '吉隆坡'],
  PH: ['manila', '馬尼拉'],
  PT: ['lisbon', 'lisboa', '里斯本'],
  IE: ['dublin', '都柏林'],
  CH: ['bern', '伯恩'],
  NC: ['nouméa', 'noumea', '努美阿'],
};

function looksLikeCapital(city: string, iso: string): boolean {
  const aliases = CAPITAL_ALIASES[iso.toUpperCase()] || [];
  const n = city.toLowerCase();
  return aliases.some((alias) => n.includes(alias.toLowerCase()) || city.includes(alias));
}

const COUNTRY_EN_TO_ISO: Record<string, string> = {
  japan: 'JP',
  korea: 'KR',
  'south korea': 'KR',
  china: 'CN',
  taiwan: 'TW',
  'hong kong': 'HK',
  thailand: 'TH',
  vietnam: 'VN',
  singapore: 'SG',
  malaysia: 'MY',
  indonesia: 'ID',
  philippines: 'PH',
  india: 'IN',
  'united arab emirates': 'AE',
  uae: 'AE',
  turkey: 'TR',
  russia: 'RU',
  'united kingdom': 'GB',
  uk: 'GB',
  england: 'GB',
  britain: 'GB',
  france: 'FR',
  germany: 'DE',
  italy: 'IT',
  spain: 'ES',
  portugal: 'PT',
  netherlands: 'NL',
  switzerland: 'CH',
  sweden: 'SE',
  norway: 'NO',
  finland: 'FI',
  denmark: 'DK',
  greece: 'GR',
  poland: 'PL',
  'czech republic': 'CZ',
  czechia: 'CZ',
  austria: 'AT',
  ireland: 'IE',
  iceland: 'IS',
  'united states': 'US',
  usa: 'US',
  america: 'US',
  canada: 'CA',
  mexico: 'MX',
  brazil: 'BR',
  argentina: 'AR',
  chile: 'CL',
  peru: 'PE',
  colombia: 'CO',
  australia: 'AU',
  'new zealand': 'NZ',
  'south africa': 'ZA',
  egypt: 'EG',
  morocco: 'MA',
  kenya: 'KE',
  'papua new guinea': 'PG',
  reunion: 'RE',
  'new caledonia': 'NC',
  palau: 'PW',
  samoa: 'WS',
  fiji: 'FJ',
  tonga: 'TO',
  vanuatu: 'VU',
  'solomon islands': 'SB',
  'marshall islands': 'MH',
  kiribati: 'KI',
  micronesia: 'FM',
  'french polynesia': 'PF',
  cuba: 'CU',
  'dominican republic': 'DO',
  haiti: 'HT',
  jamaica: 'JM',
  'puerto rico': 'PR',
  'trinidad and tobago': 'TT',
  bahamas: 'BS',
  barbados: 'BB',
  guatemala: 'GT',
  honduras: 'HN',
  'el salvador': 'SV',
  nicaragua: 'NI',
  'costa rica': 'CR',
  panama: 'PA',
  belize: 'BZ',
  venezuela: 'VE',
  ecuador: 'EC',
  bolivia: 'BO',
  paraguay: 'PY',
  uruguay: 'UY',
  nigeria: 'NG',
  ghana: 'GH',
  tanzania: 'TZ',
  ethiopia: 'ET',
  senegal: 'SN',
  ukraine: 'UA',
  romania: 'RO',
  hungary: 'HU',
  pakistan: 'PK',
  bangladesh: 'BD',
  'sri lanka': 'LK',
  cambodia: 'KH',
  myanmar: 'MM',
  'saudi arabia': 'SA',
  israel: 'IL',
};

const CITY_ZH_EXTRA: Record<string, string> = {
  tarawa: '塔拉瓦',
  jolo: '霍洛',
  kasama: '笠間',
  'cabo san lucas': '卡布聖盧卡斯',
  'san lucas': '卡布聖盧卡斯',
  'santiago de cuba': '聖地亞哥德古巴',
  'new taipei city': '新北',
  'new taipei': '新北',
};

function foldLatin(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 廣播口語用的中文國名；沒有對照時回空字串。 */
export function countryLabelZh(iso?: string | null, countryName?: string | null): string {
  const key = (iso || '').toUpperCase();
  if (key) {
    const named = CULTURE_BY_ISO[key]?.name || COUNTRY_ZH_EXTRA[key] || EXTRA_GEO[key]?.name || '';
    if (named) return named;
  }
  const raw = (countryName || '').split(/[,，]/)[0].trim();
  if (!raw) return '';
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  const fromEn = COUNTRY_EN_TO_ISO[foldLatin(raw)];
  return fromEn
    ? (CULTURE_BY_ISO[fromEn]?.name || COUNTRY_ZH_EXTRA[fromEn] || EXTRA_GEO[fromEn]?.name || '')
    : '';
}

function cityNameZh(city?: string | null): string {
  const raw = (city || '').split(/[,，]/)[0].trim();
  if (!raw) return '';
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  const folded = foldLatin(raw);
  if (CITY_ZH_EXTRA[folded]) return CITY_ZH_EXTRA[folded];
  for (const aliases of Object.values(CAPITAL_ALIASES)) {
    const hasLatin = aliases.some((alias) => !/[\u4e00-\u9fff]/.test(alias) && folded === foldLatin(alias));
    const zh = aliases.find((alias) => /[\u4e00-\u9fff]/.test(alias));
    if (hasLatin && zh) return zh;
  }
  return '';
}

/** 中文廣播用地名：有譯名用譯名，否則用中文國名，避免念出 Jolo／Tarawa。 */
export function spokenPlaceZh(
  city?: string | null,
  country?: string | null,
  iso?: string | null
): string {
  return cityNameZh(city) || countryLabelZh(iso, country) || '這裡';
}

/** 降落廣播用：一句話幫旅客把陌生地名放到地圖上。 */
export function placeOrientationLine(
  city: string,
  country: string,
  iso?: string | null,
  locale: 'zh' | 'en' = 'zh'
): string {
  const key = (iso || '').toUpperCase();
  const region = key ? MACRO_REGION_BY_ISO[key] || EXTRA_GEO[key]?.region || '' : '';
  const cityShort = (city || '').split(/[,，]/)[0].trim();
  const rawCountry = (country || '').split(/[,，]/)[0].trim();
  const named = countryLabelZh(key, rawCountry);
  const countryShort = locale === 'zh'
    ? (named || (/[\u4e00-\u9fff]/.test(rawCountry) ? rawCountry : ''))
    : (named || rawCountry);
  const capital = key ? looksLikeCapital(cityShort, key) : false;
  if (locale === 'en') {
    const regionEn = MACRO_REGION_EN[region] || region;
    if (regionEn && capital && countryShort) return `This is ${regionEn} — the capital of ${countryShort}.`;
    if (regionEn && countryShort && countryShort !== cityShort) return `This is ${regionEn}, in ${countryShort}.`;
    if (regionEn) return `This is ${regionEn}.`;
    if (countryShort && countryShort !== cityShort) return `This is in ${countryShort}.`;
    return '';
  }
  if (region && capital && countryShort) return `這裡是${region}，${countryShort}的首都`;
  if (region && countryShort && countryShort !== cityShort) return `這裡是${region}，屬於${countryShort}`;
  if (region) return `這裡是${region}`;
  if (countryShort && countryShort !== cityShort) return `這裡位於${countryShort}`;
  return '';
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
  if (CULTURE_BY_ISO[key]) return CULTURE_BY_ISO[key];
  const extra = EXTRA_GEO[key];
  if (extra) return { name: extra.name, culture: extra.culture };
  return { name: countryLabelZh(key) || key, culture: DEFAULT_CULTURE };
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
  const timer = setTimeout(() => controller.abort(), 2500);
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

/** 從英文或中文國名回推 ISO2。 */
export function countryIsoFromName(country?: string | null): string {
  const raw = (country || '').split(/[,，]/).pop()?.trim() || '';
  if (!raw) return '';
  if (/[\u4e00-\u9fff]/.test(raw)) {
    for (const [iso, row] of Object.entries(CULTURE_BY_ISO)) {
      if (row.name === raw) return iso;
    }
    for (const [iso, row] of Object.entries(EXTRA_GEO)) {
      if (row.name === raw) return iso;
    }
    for (const [iso, name] of Object.entries(COUNTRY_ZH_EXTRA)) {
      if (name === raw) return iso;
    }
  }
  return COUNTRY_EN_TO_ISO[foldLatin(raw)] || '';
}

export function cultureNoteForIso(iso?: string | null): string {
  const { culture } = cultureForIso(iso || '');
  return !culture || /旅行最美的風景/.test(culture) ? '' : culture;
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
    const fromName = countryIsoFromName(displayName);
    if (fromName) return fromName;
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
