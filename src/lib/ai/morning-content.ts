import OpenAI from 'openai';
import { openAiApiKey } from './openai-env';
import { withTimeout } from '../with-timeout';

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

const UNSAFE_VOICE = /獨自|孤單|寂寞|孤獨|一個人|沒有人|被丟下|失敗|浪費|掙扎|撐過|逃避|黑暗|迷失|你應該|你必須|振作|正向一點|一定會很棒|別難過|做得很好|又撐過一夜|alone|lonely|by yourself|isolated|abandoned|cheer up|you should|you must/i;

function chineseCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/^["「]|["」]$/g, '').trim() : '';
}

function fallbackMorning(input: MorningContentInput): MorningContent {
  const city = input.city.trim() || input.country.trim() || '今天的目的地';
  const country = input.country.trim() || city;
  const greeting = (input.localGreeting || '早安').replace(/[。！!]+$/g, '');
  const weather = (input.weatherSummary || '').trim();
  const weatherLine = weather ? `${input.localTimeLabel || '現在'}，這裡${weather}。` : '清晨的街道正慢慢亮起來。';
  const voiceText = `${greeting}。早安，Sleep Airline 已抵達今天的目的地——${city}。${weatherLine}晨光落在${city}有地方特色的建築與街道上。歡迎抵達${city}，今天的旅程從這裡開始。`;
  const sky = weather || 'soft morning light';
  return {
    destination: { country, city },
    localGreeting: greeting,
    voiceText,
    localFeature: `${city}有地方特色的建築與街道`,
    imagePrompt: `Beautiful scenery of ${city}, ${country}, with no airplane, window frame, wing or cabin. ${sky}. The sky, light and ground must match this weather. The dominant subject is the recognizable local cultural character of ${city}: distinctive architecture, materials, street scale, and everyday cultural details that belong to this exact place. Calm realistic morning, welcoming, no crowds, no text`,
    imageKeywords: [`${city} morning`, `${city} local architecture`, 'cultural street', 'soft morning light'],
    safetyCheck: {
      containsNegativeEmotionalLanguage: false,
      containsPressureLanguage: false,
      containsLonelinessLanguage: false,
      containsUnverifiedCulturalClaim: false,
    },
  };
}

function parseMorning(raw: string, input: MorningContentInput): MorningContent | null {
  const jsonText = raw.replace(/^```(?:json)?/i, '').replace(/```$/g, '').trim();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
  const destination = (data.destination ?? {}) as Record<string, unknown>;
  const city = clean(destination.city) || input.city.trim();
  const country = clean(destination.country) || input.country.trim();
  const localGreeting = clean(data.localGreeting) || (input.localGreeting || '早安').replace(/[。！!]+$/g, '');
  let voiceText = clean(data.voiceText);
  if (!voiceText) return null;
  if (localGreeting && !voiceText.startsWith(localGreeting)) {
    voiceText = `${localGreeting}。${voiceText}`;
  }
  const zh = chineseCount(voiceText);
  if (zh < 24 || zh > 180 || !city || !voiceText.includes(city) || UNSAFE_VOICE.test(voiceText)) return null;
  const localFeature = clean(data.localFeature);
  let imagePrompt = clean(data.imagePrompt);
  if (/airplane|aircraft|plane window|window frame|porthole|cabin|\bwings?\b|舷窗|機艙|機翼|窗/i.test(imagePrompt)) {
    imagePrompt = localFeature;
  }
  if (!imagePrompt || !/morning|清晨|早晨|dawn/i.test(imagePrompt)) {
    imagePrompt = `Early morning in ${city}, ${country}. ${imagePrompt || localFeature}. Distinctive local cultural architecture and street character, soft natural light, realistic, no text`;
  }
  const keywords = Array.isArray(data.imageKeywords)
    ? data.imageKeywords.map((item) => clean(item)).filter(Boolean).slice(0, 6)
    : [];
  return {
    destination: { country, city },
    localGreeting,
    voiceText,
    localFeature: localFeature || `${city}的清晨風景`,
    imagePrompt,
    imageKeywords: keywords.length ? keywords : [`${city} morning`, 'local cultural architecture', 'soft light'],
    safetyCheck: {
      containsNegativeEmotionalLanguage: false,
      containsPressureLanguage: false,
      containsLonelinessLanguage: false,
      containsUnverifiedCulturalClaim: false,
    },
  };
}

const SYSTEM_PROMPT = `你是 Sleep Airline 的早晨抵達內容系統。對象是剛醒來的旅客。這不是醫療、治療或勵志教練。
禁止診斷、解讀情緒，或告訴對方該有什麼感覺。

語氣：溫和、平靜、中性、輕、自然、不評判、不要求。像一段輕柔的航班抵達廣播，加上一點當地日常。
禁止：「你應該」「你必須」「振作」「正向」「今天一定會很棒」「別難過」「你做得很好」「你又撐過一夜」。
禁止孤獨、遺棄、失敗、壓力、罪惡、比較：獨自、孤單、寂寞、一個人、沒有人、失敗、浪費、掙扎、逃避、黑暗、迷失。

voiceText 主體必須是繁體中文口語，約 40–80 個中文字，念出來大約 15–30 秒。
結構：
A. 抵達：早安，Sleep Airline 已抵達今天的目的地——{城市}。
B. 一個看得到的當地文化特色：這個城市特有的建築、屋頂、材料、街道尺度、市場、飲食、交通或地貌，擇一具體說出。
C. 同一個特色再補一個廣泛成立的日常細節。不確定就寫建築與街道氣氛，不要發明傳統、節慶或歷史。
D. 輕柔收尾，不下指令。例如「歡迎抵達{城市}，今天的旅程從這裡開始。」
開頭可以先放當地語言的早安（localGreeting），後面全部用繁體中文，不要翻譯那句早安，也不要改成英文廣播。
若有提供天氣，voiceText 必須用一句話自然說出溫度與晴雨，例如「現在氣溫 18 度，天空大致晴朗」。
內容必須能對上這個城市，不能是任何城市都適用的空話。
imagePrompt 用英文，必須是 voiceText 裡同一個地點、同一個文化特色、同一種天氣與氣氛。天空、光線、地面要和語音說的天氣一致。這個文化特色要成為畫面主體，讓人看得出是這個城市，不要畫成任何地方都適用的郊區住宅。可以出現屬於這個城市的代表性建築或地貌，但必須就是語音講到的那一個，禁止換成別的城市或該國另一個更有名的地標。
imagePrompt 只描述這個地方本身的美麗風景：禁止飛機、飛機窗戶、窗框、舷窗、機翼、機艙，也不要從窗內往外看的構圖；畫面中不得有任何文字。
早晨、柔和自然光、平靜、寫實、低刺激。不要黑暗、空蕩到令人不安、危險或擁擠。

只回 JSON：
{"destination":{"country":"","city":""},"localGreeting":"","voiceText":"","localFeature":"","imagePrompt":"","imageKeywords":[],"safetyCheck":{"containsNegativeEmotionalLanguage":false,"containsPressureLanguage":false,"containsLonelinessLanguage":false,"containsUnverifiedCulturalClaim":false}}`;

async function requestMorning(input: MorningContentInput): Promise<MorningContent> {
  const apiKey = openAiApiKey();
  if (!apiKey) return fallbackMorning(input);
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const city = input.city.trim();
  const country = input.country.trim();
  const greeting = (input.localGreeting || '').trim();
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
        }),
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500,
    temperature: 0.5,
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  return parseMorning(raw, input) ?? fallbackMorning(input);
}

/** 降落語音：繁體中文早晨抵達廣播，並給出同一場景的生圖描述。失敗時用安全模板。 */
export function generateMorningArrival(input: MorningContentInput): Promise<MorningContent> {
  const safe = fallbackMorning(input);
  return withTimeout(requestMorning(input), 12_000, () => safe).catch(() => safe);
}
