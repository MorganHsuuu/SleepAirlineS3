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
  const voiceText = `${greeting}。早安，Sleep Airline 已抵達今天的目的地——${city}。清晨的街道正慢慢亮起來，晨光落在這裡的日常風景上。歡迎抵達${city}，今天的旅程從這裡開始。`;
  return {
    destination: { country, city },
    localGreeting: greeting,
    voiceText,
    localFeature: `${city}清晨慢慢亮起來的街道`,
    imagePrompt: `Early morning everyday street in ${city}, ${country}, soft natural light, calm realistic view through an airplane window, ordinary local buildings and street, welcoming and unhurried, no crowds, no text`,
    imageKeywords: [`${city} morning`, 'everyday street', 'soft morning light', 'calm arrival'],
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
  if (zh < 24 || zh > 140 || !city || !voiceText.includes(city) || UNSAFE_VOICE.test(voiceText)) return null;
  const localFeature = clean(data.localFeature);
  let imagePrompt = clean(data.imagePrompt);
  if (!imagePrompt || !/morning|清晨|早晨|dawn/i.test(imagePrompt)) {
    imagePrompt = `Early morning in ${city}, ${country}. ${imagePrompt || localFeature}. Soft natural light, calm everyday scene, realistic, no text`;
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
    imageKeywords: keywords.length ? keywords : [`${city} morning`, 'soft light', 'everyday scene'],
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
B. 一個具體、溫和的當地清晨畫面（街道、光、建築、早餐、交通、市場、地貌擇一）。
C. 一個廣泛成立、不爭議的當地日常細節。不確定就改寫環境，不要發明傳統或歷史。
D. 輕柔收尾，不下指令。例如「歡迎抵達{城市}，今天的旅程從這裡開始。」
開頭可以先放當地語言的早安（localGreeting），後面全部用繁體中文，不要翻譯那句早安，也不要改成英文廣播。
內容必須能對上這個城市，不能是任何城市都適用的空話。
imagePrompt 用英文，必須是 voiceText 裡同一個地點、同一個清晨細節、同一種氣氛。寫日常風景，不要改成該國最有名的地標，除非語音正好在講它。
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
          language: 'Traditional Chinese',
          localGreeting: greeting || undefined,
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
