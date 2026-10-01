export interface ReliableDestinationSubject {
  aliases: string[];
  zh: string;
  en: string;
  detailZh: string;
  keywords: string[];
  sceneryHint: string;
  /** false 表示提示只適合生圖判斷，不能當成具體 fallback 主題。 */
  usableAsFallback?: boolean;
}

export const RELIABLE_DESTINATION_SUBJECTS: readonly ReliableDestinationSubject[] = [
  {
    aliases: ['rio de janeiro', '里約熱內盧'],
    zh: '救世基督像與科爾科瓦杜山',
    en: 'Christ the Redeemer on Corcovado Mountain',
    detailZh: '山峰、雕像與海灣地形構成里約熱內盧的城市輪廓',
    keywords: ['Christ the Redeemer', 'Corcovado Mountain'],
    sceneryHint:
      'Make Christ the Redeemer, Corcovado Mountain and Rio’s dramatic bay-and-mountain geography the unmistakable subject.',
  },
  {
    aliases: ['cairo', 'giza', '開羅', '吉薩'],
    zh: '吉薩金字塔',
    en: 'the Giza pyramids',
    detailZh: '石灰岩金字塔與吉薩高原構成清楚的沙漠地景',
    keywords: ['Giza pyramids', 'Giza plateau'],
    sceneryHint:
      'Make the Giza pyramids and the desert plateau the unmistakable subject, with the Nile landscape only where compositionally accurate.',
  },
  {
    aliases: ['egypt', '埃及'],
    zh: '目的地所在的真實埃及地貌',
    en: 'the destination’s geographically correct Egyptian landscape',
    detailZh: '依目的地選擇尼羅河、沙漠、神殿、綠洲或紅海景觀',
    keywords: ['authentic Egyptian geography'],
    sceneryHint:
      'Use the destination’s geographically correct Egyptian icon: pyramids only for the Cairo–Giza area; otherwise prioritize its own Nile, desert, temple, oasis or Red Sea identity.',
    usableAsFallback: false,
  },
  {
    aliases: ['antarctica', 'south pole', '南極'],
    zh: '南極冰川與企鵝棲地',
    en: 'Antarctic glaciers and a believable penguin habitat',
    detailZh: '冰原、冰川與真實棲地呈現南極生態',
    keywords: ['Antarctic glaciers', 'penguin habitat'],
    sceneryHint:
      'Make Antarctic ice, glaciers and penguins in a believable colony habitat the main subject; show no town or generic houses.',
  },
  {
    aliases: ['arctic', 'north pole', 'svalbard', 'longyearbyen', '北極', '斯瓦爾巴', '朗伊爾城'],
    zh: '北極海冰與極地地貌',
    en: 'Arctic sea ice and polar landscape',
    detailZh: '海冰與極地環境構成符合當地棲地的自然景色',
    keywords: ['Arctic sea ice', 'polar landscape'],
    sceneryHint:
      'Make Arctic sea ice, polar landscape and a polar bear in a believable habitat the main subject; include aurora only when the stated local time is dark.',
  },
  {
    aliases: ['netherlands', 'holland', 'amsterdam', '荷蘭', '阿姆斯特丹'],
    zh: '荷蘭運河與風車',
    en: 'Dutch canals and windmills',
    detailZh: '運河水道、風車與低地景觀呈現當地地理特色',
    keywords: ['Dutch canals', 'windmills'],
    sceneryHint:
      'Prioritize iconic Dutch windmills, canals and seasonally plausible tulip fields over ordinary houses.',
  },
  {
    aliases: ['tokyo', '東京'],
    zh: '東京鐵塔',
    en: 'Tokyo Tower',
    detailZh: '紅白塔身立在密集的東京城市天際線之中',
    keywords: ['Tokyo Tower', 'Tokyo skyline'],
    sceneryHint:
      'Make Tokyo Tower or the Shibuya crossing skyline the unmistakable subject, with dense neon towers behind it.',
  },
  {
    aliases: ['kyoto', '京都'],
    zh: '伏見稻荷大社的朱紅鳥居',
    en: 'the vermilion torii gates of Fushimi Inari',
    detailZh: '連續鳥居與山坡林地呈現京都可辨識的文化景觀',
    keywords: ['Fushimi Inari', 'vermilion torii gates'],
    sceneryHint:
      'Make a vermilion torii gate, Kinkaku-ji, or Fushimi Inari the unmistakable subject among temple roofs.',
  },
  {
    aliases: ['osaka', '大阪'],
    zh: '大阪城',
    en: 'Osaka Castle',
    detailZh: '城郭屋頂與石垣構成大阪具代表性的城市景觀',
    keywords: ['Osaka Castle', 'Osaka'],
    sceneryHint:
      'Make Osaka Castle or the Tsutenkaku / Dotonbori canal lights the unmistakable subject.',
  },
  {
    aliases: ['paris', '巴黎'],
    zh: '艾菲爾鐵塔',
    en: 'the Eiffel Tower',
    detailZh: '鐵塔、塞納河與奧斯曼式屋頂構成巴黎天際線',
    keywords: ['Eiffel Tower', 'Paris skyline'],
    sceneryHint:
      'Make the Eiffel Tower the unmistakable subject, with the Seine and Haussmann rooftops around it.',
  },
  {
    aliases: ['london', '倫敦'],
    zh: '倫敦塔橋',
    en: 'Tower Bridge',
    detailZh: '橋塔與泰晤士河構成倫敦可辨識的河岸景觀',
    keywords: ['Tower Bridge', 'Thames'],
    sceneryHint:
      'Make Tower Bridge or the Elizabeth Tower and the Thames the unmistakable subject.',
  },
  {
    aliases: ['rome', '羅馬'],
    zh: '羅馬競技場',
    en: 'the Colosseum',
    detailZh: '古老拱券與石造外牆呈現羅馬城市歷史層次',
    keywords: ['Colosseum', 'Rome'],
    sceneryHint: 'Make the Colosseum the unmistakable subject.',
  },
  {
    aliases: ['barcelona', '巴塞隆納'],
    zh: '聖家堂',
    en: 'the Sagrada Família',
    detailZh: '高聳尖塔與雕塑立面構成巴塞隆納代表性景觀',
    keywords: ['Sagrada Família', 'Barcelona'],
    sceneryHint: 'Make the Sagrada Família the unmistakable subject.',
  },
  {
    aliases: ['sydney', '雪梨'],
    zh: '雪梨歌劇院',
    en: 'the Sydney Opera House',
    detailZh: '白色帆形屋頂與港灣水面構成雪梨海港景色',
    keywords: ['Sydney Opera House', 'Sydney Harbour'],
    sceneryHint: 'Make the Sydney Opera House and harbour the unmistakable subject.',
  },
  {
    aliases: ['new york', '紐約'],
    zh: '自由女神像',
    en: 'the Statue of Liberty',
    detailZh: '雕像、港灣與曼哈頓天際線呈現紐約城市輪廓',
    keywords: ['Statue of Liberty', 'New York skyline'],
    sceneryHint:
      'Make the Statue of Liberty or the Empire State Building skyline the unmistakable subject.',
  },
  {
    aliases: ['taipei', '台北', '臺北'],
    zh: 'Taipei 101',
    en: 'Taipei 101',
    detailZh: '高聳的塔身映著城市天際線',
    keywords: ['Taipei 101', 'Taipei skyline'],
    sceneryHint:
      'Make Taipei 101 the unmistakable subject above the city basin and surrounding mountains.',
  },
  {
    aliases: ['singapore', '新加坡'],
    zh: '濱海灣金沙',
    en: 'Marina Bay Sands',
    detailZh: '三座高樓與空中花園構成新加坡濱海灣天際線',
    keywords: ['Marina Bay Sands', 'Singapore waterfront'],
    sceneryHint: 'Make Marina Bay Sands and the waterfront skyline the unmistakable subject.',
  },
  {
    aliases: ['hong kong', '香港'],
    zh: '維多利亞港',
    en: 'Victoria Harbour',
    detailZh: '海港、高樓與太平山稜線構成香港城市景觀',
    keywords: ['Victoria Harbour', 'Hong Kong skyline'],
    sceneryHint:
      'Make the Victoria Harbour skyline and Peak ridgeline the unmistakable subject.',
  },
  {
    aliases: ['beijing', '北京'],
    zh: '紫禁城',
    en: 'the Forbidden City',
    detailZh: '宮殿屋頂與中軸院落構成北京代表性建築景觀',
    keywords: ['Forbidden City', 'Beijing'],
    sceneryHint: 'Make the Forbidden City or the Temple of Heaven the unmistakable subject.',
  },
  {
    aliases: ['shanghai', '上海'],
    zh: '東方明珠塔與浦東天際線',
    en: 'the Oriental Pearl Tower and Pudong skyline',
    detailZh: '高塔與沿江摩天樓構成上海可辨識的城市輪廓',
    keywords: ['Oriental Pearl Tower', 'Pudong skyline'],
    sceneryHint:
      'Make the Oriental Pearl Tower and Pudong skyline across the river the unmistakable subject.',
  },
  {
    aliases: ['seoul', '首爾'],
    zh: '南山首爾塔',
    en: 'N Seoul Tower on Namsan',
    detailZh: '山丘高塔與密集城市天際線構成首爾景色',
    keywords: ['N Seoul Tower', 'Namsan'],
    sceneryHint:
      'Make N Seoul Tower on Namsan or Gyeongbokgung the unmistakable subject.',
  },
  {
    aliases: ['bangkok', '曼谷'],
    zh: '鄭王廟',
    en: 'Wat Arun',
    detailZh: '河畔高塔與昭披耶河構成曼谷代表性水岸景觀',
    keywords: ['Wat Arun', 'Chao Phraya River'],
    sceneryHint:
      'Make Wat Arun or the Grand Palace spires along the river the unmistakable subject.',
  },
  {
    aliases: ['agra', '阿格拉'],
    zh: '泰姬瑪哈陵',
    en: 'the Taj Mahal',
    detailZh: '白色大理石圓頂與庭園水道構成阿格拉代表景觀',
    keywords: ['Taj Mahal', 'Agra'],
    sceneryHint: 'Make the Taj Mahal the unmistakable subject.',
  },
  {
    aliases: ['dubai', '杜拜'],
    zh: '哈里發塔',
    en: 'the Burj Khalifa',
    detailZh: '尖塔高樓從沙漠城市天際線中升起',
    keywords: ['Burj Khalifa', 'Dubai skyline'],
    sceneryHint: 'Make the Burj Khalifa the unmistakable subject above the desert-city skyline.',
  },
  {
    aliases: ['istanbul', '伊斯坦堡'],
    zh: '聖索菲亞大教堂與博斯普魯斯海峽',
    en: 'Hagia Sophia and the Bosphorus',
    detailZh: '圓頂、尖塔與海峽水面構成伊斯坦堡景觀',
    keywords: ['Hagia Sophia', 'Bosphorus'],
    sceneryHint: 'Make the Hagia Sophia and Bosphorus the unmistakable subject.',
  },
  {
    aliases: ['venice', '威尼斯'],
    zh: '威尼斯大運河',
    en: 'the Grand Canal of Venice',
    detailZh: '運河、貢多拉與歷史建築構成威尼斯水城景色',
    keywords: ['Grand Canal', 'Venice gondolas'],
    sceneryHint:
      'Make the Grand Canal, gondolas and St Mark’s campanile the unmistakable subject.',
  },
  {
    aliases: ['santorini', '聖托里尼'],
    zh: '聖托里尼火山口崖壁聚落',
    en: 'Santorini’s white cliffside houses above the caldera',
    detailZh: '白色房屋、藍色圓頂與火山口海灣形成島嶼景觀',
    keywords: ['Santorini caldera', 'white cliffside houses'],
    sceneryHint:
      'Make the white cliffside houses and blue domes above the caldera the unmistakable subject.',
  },
];

export function findReliableDestinationSubject(
  city: string,
  country: string,
  displayName = ''
): ReliableDestinationSubject | null {
  const normalizeSegment = (value: string) =>
    value
      .normalize('NFKD')
      .toLocaleLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  const segments = [city, country, ...displayName.split(',')]
    .map(normalizeSegment)
    .filter(Boolean);
  return (
    RELIABLE_DESTINATION_SUBJECTS.find(({ aliases }) =>
      aliases.some((alias) => segments.includes(normalizeSegment(alias)))
    ) ?? null
  );
}
