import OpenAI from 'openai';
import { openAiApiKey } from './openai-env';
import { findReliableDestinationSubject } from './destination-subjects';

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
  /** 與早晨語音同一場景。有值時不再改成地標明信片。 */
  alignedPrompt?: string | null;
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
  return findReliableDestinationSubject(city, country, displayName)?.sceneryHint ?? null;
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
    `Create a premium dimensional travel postcard of ${place}: pure beautiful scenery of the place itself.`,
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
    `Keep the scenery large and unobstructed. No airplane, no airplane window or window frame, no wing, no cabin interior, no reflections.`,
    `Absolutely no text of any kind anywhere in the image: no signs, billboards, banners,`,
    `storefront lettering, street markings, no letters, numbers or writing in any language.`,
    `No invented landmarks, no close-up people, no watermark, no logos.`,
  ].filter(Boolean).join(' ');
}

/** 1024x1024 生成明顯快於 1536x1024；前端以 object-fit: cover 裁切，方圖即可。 */
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
  const apiKey = openAiApiKey();
  if (!apiKey) return null;

  const aligned = context.alignedPrompt?.trim();
  const place = displayName || `${city}, ${country}`;
  const imagePrompt = aligned
    ? [
        aligned,
        `The scene is pure, beautiful scenery of ${place} itself.`,
        `No airplane, no airplane window or window frame, no wing, no cabin interior, no reflections.`,
        `Keep the same place, the same cultural detail, and the same weather as the narration.`,
        `Make that local cultural character the dominant subject: architecture, materials, street life, food, transport, or landscape that belongs to this exact place.`,
        `Do not replace it with a generic suburb or with a landmark from a different city.`,
        `Absolutely no text, letters, numbers, signs, logos, or watermarks.`,
        `No close-up faces. No dark, gloomy, empty, or threatening mood.`,
      ].join(' ')
    : buildSceneryPrompt(city, country, displayName, context);
  const client = new OpenAI({ apiKey });
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
