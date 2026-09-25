import OpenAI from 'openai';

export interface SceneryGenerationResult {
  imageBuffer: Buffer;
  imagePrompt: string;
  contentType: string;
  filename: string;
}

export const DEFAULT_SCENERY_IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_SCENERY_IMAGE_QUALITY = 'low';

export interface SceneryPromptContext {
  landingTime?: string | null;
  timezone?: string | null;
}

export interface SceneryLocalMoment {
  hour: number;
  label: string;
  localDate: string;
  localTime: string;
}

export function describeSceneryLocalMoment(
  landingTime?: string | null,
  timezone?: string | null
): SceneryLocalMoment | null {
  if (!landingTime || !timezone) return null;
  const instant = new Date(landingTime);
  if (Number.isNaN(instant.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';
    const hour = Number(value('hour'));
    if (!Number.isFinite(hour)) return null;

    const label =
      hour < 5 ? 'local deep night' :
      hour < 8 ? 'local dawn' :
      hour < 11 ? 'local morning' :
      hour < 16 ? 'local midday' :
      hour < 18 ? 'local afternoon' :
      hour < 20 ? 'local sunset' :
      'local night';

    return {
      hour,
      label,
      localDate: `${value('year')}-${value('month')}-${value('day')}`,
      localTime: `${value('hour')}:${value('minute')}`,
    };
  } catch {
    return null;
  }
}

function iconicSubjectHint(city: string, country: string, displayName: string): string | null {
  const place = `${city} ${country} ${displayName}`.toLocaleLowerCase();
  const hints: Array<[string[], string]> = [
    [
      ['rio de janeiro', '里約熱內盧'],
      'Make Christ the Redeemer, Corcovado Mountain and Rio’s dramatic bay-and-mountain geography the unmistakable subject.',
    ],
    [
      ['cairo', 'giza', '開羅', '吉薩'],
      'Make the Giza pyramids and the desert plateau the unmistakable subject, with the Nile landscape only where compositionally accurate.',
    ],
    [
      ['egypt', '埃及'],
      'Use the destination’s geographically correct Egyptian icon: pyramids only for the Cairo–Giza area; otherwise prioritize its own Nile, desert, temple, oasis or Red Sea identity.',
    ],
    [
      ['antarctica', 'south pole', '南極'],
      'Make Antarctic ice, glaciers and penguins in a believable colony habitat the main subject; show no town or generic houses.',
    ],
    [
      ['arctic', 'north pole', 'svalbard', 'longyearbyen', '北極', '斯瓦爾巴', '朗伊爾城'],
      'Make Arctic sea ice, polar landscape and a polar bear in a believable habitat the main subject; include aurora only when the stated local time is dark.',
    ],
    [
      ['netherlands', 'holland', 'amsterdam', '荷蘭', '阿姆斯特丹'],
      'Prioritize iconic Dutch windmills, canals and seasonally plausible tulip fields over ordinary houses.',
    ],
    [['tokyo', '東京'], 'Make Tokyo Tower or the Shibuya crossing skyline the unmistakable subject, with dense neon towers behind it.'],
    [['kyoto', '京都'], 'Make a vermilion torii gate, Kinkaku-ji, or Fushimi Inari the unmistakable subject among temple roofs.'],
    [['osaka', '大阪'], 'Make Osaka Castle or the Tsutenkaku / Dotonbori canal lights the unmistakable subject.'],
    [['paris', '巴黎'], 'Make the Eiffel Tower the unmistakable subject, with the Seine and Haussmann rooftops around it.'],
    [['london', '倫敦'], 'Make Tower Bridge or the Elizabeth Tower and the Thames the unmistakable subject.'],
    [['rome', '羅馬'], 'Make the Colosseum the unmistakable subject.'],
    [['barcelona', '巴塞隆納'], 'Make the Sagrada Família the unmistakable subject.'],
    [['sydney', '雪梨'], 'Make the Sydney Opera House and harbour the unmistakable subject.'],
    [['new york', '紐約'], 'Make the Statue of Liberty or the Empire State Building skyline the unmistakable subject.'],
    [['taipei', '台北', '臺北'], 'Make Taipei 101 the unmistakable subject above the city basin and surrounding mountains.'],
    [['singapore', '新加坡'], 'Make Marina Bay Sands and the waterfront skyline the unmistakable subject.'],
    [['hong kong', '香港'], 'Make the Victoria Harbour skyline and Peak ridgeline the unmistakable subject.'],
    [['beijing', '北京'], 'Make the Forbidden City or the Temple of Heaven the unmistakable subject.'],
    [['shanghai', '上海'], 'Make the Oriental Pearl Tower and Pudong skyline across the river the unmistakable subject.'],
    [['seoul', '首爾'], 'Make N Seoul Tower on Namsan or Gyeongbokgung the unmistakable subject.'],
    [['bangkok', '曼谷'], 'Make Wat Arun or the Grand Palace spires along the river the unmistakable subject.'],
    [['agra', '阿格拉'], 'Make the Taj Mahal the unmistakable subject.'],
    [['dubai', '杜拜'], 'Make the Burj Khalifa the unmistakable subject above the desert-city skyline.'],
    [['istanbul', '伊斯坦堡'], 'Make the Hagia Sophia and Bosphorus the unmistakable subject.'],
    [['venice', '威尼斯'], 'Make the Grand Canal, gondolas and St Mark’s campanile the unmistakable subject.'],
    [['santorini', '聖托里尼'], 'Make the white cliffside houses and blue domes above the caldera the unmistakable subject.'],
  ];
  return hints.find(([aliases]) => aliases.some((alias) => place.includes(alias)))?.[1] ?? null;
}

export function buildSceneryPrompt(
  city: string,
  country: string,
  displayName: string,
  context: SceneryPromptContext = {}
): string {
  const place = displayName || `${city}, ${country}`;
  const localMoment = describeSceneryLocalMoment(context.landingTime, context.timezone);
  const timeDirection = localMoment
    ? `Depict the actual ${localMoment.label} at ${localMoment.localTime} on ${localMoment.localDate} in ${context.timezone}. The sun angle, sky brightness, artificial lights and shadows must match that local time exactly; never turn a night arrival into morning.`
    : `Use lighting that is geographically and seasonally plausible for ${place}; do not default every arrival to sunrise.`;
  const iconicHint = iconicSubjectHint(city, country, displayName);

  return [
    `Create a premium dimensional travel postcard of ${place}, seen during a gentle airplane descent.`,
    `The destination must be instantly recognizable without relying on text.`,
    timeDirection,
    `Use a polished handcrafted 3D relief / miniature-diorama aesthetic: tactile depth, refined forms,`,
    `cinematic composition and believable materials, but not photorealistic and not a generic toy scene.`,
    `Build the image from the real visual DNA of ${city}, ${country}:`,
    `accurate terrain and coastline or river pattern, authentic local architecture,`,
    `street or roof materials, native vegetation and region-appropriate weather.`,
    `The dominant subject must be one famous landmark, monument, skyline icon, or signature landform of this exact place, shown large and unmistakable.`,
    `A plain coastline, empty field, or ordinary street cannot be the whole picture.`,
    `Choose that hero using this priority: an iconic landmark, dramatic natural landform,`,
    `signature wildlife in its real habitat, or characteristic native flora. Generic houses must never be the main subject.`,
    `Architecture should dominate only when the building itself is a genuine destination icon.`,
    iconicHint,
    `Use a destination-specific color palette derived from the local landscape, craft traditions,`,
    `building materials and natural light. Do not impose a universal orange-and-blue travel palette.`,
    `Let the local colors dominate: preserve the characteristic mineral, botanical, coastal, desert,`,
    `tropical, polar or urban hues that distinguish this place from every other destination.`,
    `The place name may be provided in another language, but geography and culture must follow the actual location.`,
    `Never substitute East-Asian motifs unless ${city}, ${country} genuinely calls for them.`,
    `For nature-led destinations, prioritize the true landforms and ecosystem and do not invent a city.`,
    `Keep wildlife, flora, season and habitat scientifically plausible. Do not mix animals or plants from another region.`,
    `A very subtle airplane-window reflection may appear at the outer edge; keep the scenery large and unobstructed.`,
    `Absolutely no text of any kind anywhere in the image: no signs, billboards, banners,`,
    `storefront lettering, street markings, no letters, numbers or writing in any language.`,
    `No invented landmarks, no close-up people, no watermark, no logos.`,
  ].filter(Boolean).join(' ');
}

/** 1024x1024 生成明顯快於 1536x1024；舷窗以 object-fit: cover 裁切，方圖即可。 */
export const SCENERY_IMAGE_SIZE = '1024x1024';

/**
 * gpt-image 系列的生圖品質，可用 OPENAI_IMAGE_QUALITY 環境變數調整（low / medium / high）。
 * gpt-image-2 的 low 適合即時降落圖：速度快，首張品質也優於 mini 草稿模型。
 */
type GptImageQuality = 'low' | 'medium' | 'high';
function resolveImageQuality(): GptImageQuality {
  const q = process.env.OPENAI_IMAGE_QUALITY?.toLowerCase();
  return q === 'low' || q === 'medium' || q === 'high' ? q : DEFAULT_SCENERY_IMAGE_QUALITY;
}

function safeFilename(city: string, flightId: string): string {
  const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'landing';
  return `landing-${slug}-${flightId.slice(-8)}.jpg`;
}

function isGptImageModel(model: string): boolean {
  return model.startsWith('gpt-image') || model.startsWith('chatgpt-image');
}

export async function generateLandingScenery(
  city: string,
  country: string,
  displayName: string,
  flightId: string,
  context: SceneryPromptContext = {}
): Promise<SceneryGenerationResult | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const imagePrompt = buildSceneryPrompt(city, country, displayName, context);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_SCENERY_IMAGE_MODEL;
  const useGptImage = isGptImageModel(model);

  try {
    const response = await client.images.generate(
      useGptImage
        ? {
            model,
            prompt: imagePrompt,
            size: SCENERY_IMAGE_SIZE,
            quality: resolveImageQuality(),
            // jpeg 比 png 小很多，Notion 上傳更快
            output_format: 'jpeg',
            n: 1,
          }
        : {
            model,
            prompt: imagePrompt,
            size: SCENERY_IMAGE_SIZE,
            quality: 'standard',
            n: 1,
          }
    );

    const b64 = response.data?.[0]?.b64_json;
    if (b64) {
      return {
        imageBuffer: Buffer.from(b64, 'base64'),
        imagePrompt,
        contentType: useGptImage ? 'image/jpeg' : 'image/png',
        filename: safeFilename(city, flightId),
      };
    }

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      console.error(`[scenery] ${flightId} OpenAI 回傳沒有圖片資料`);
      return null;
    }

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      console.error(`[scenery] ${flightId} 下載 OpenAI 圖失敗：${imageRes.status}`);
      return null;
    }
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    return {
      imageBuffer,
      imagePrompt,
      contentType: imageRes.headers.get('content-type') ?? 'image/jpeg',
      filename: safeFilename(city, flightId),
    };
  } catch (err) {
    console.error(`[scenery] ${flightId} OpenAI 生圖例外：`, err);
    return null;
  }
}
