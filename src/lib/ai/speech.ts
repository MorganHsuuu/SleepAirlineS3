import OpenAI from 'openai';
import type { BroadcastStyle } from '../../types';
import { openAiApiKey } from './openai-env';

type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

const VOICE_BY_STYLE: Record<BroadcastStyle, OpenAIVoice> = {
  formal_captain: 'onyx',
  poetic: 'fable',
  playful: 'nova',
  flight_attendant: 'shimmer',
  radio_host: 'echo',
  custom: 'alloy',
};

/** 起飛廣播略慢，讓睡眠引導聽得清楚。 */
export const TAKEOFF_SPEECH_SPEED = 0.9;

export async function generateBroadcastSpeech(
  text: string,
  style?: BroadcastStyle,
  speed = 1
): Promise<Buffer> {
  const apiKey = openAiApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 尚未設定。');
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_TTS_MODEL ?? 'tts-1';
  const envVoice = process.env.OPENAI_TTS_VOICE as OpenAIVoice | undefined;
  const voice = (style && VOICE_BY_STYLE[style]) || envVoice || 'onyx';
  const pace = Math.min(4, Math.max(0.25, Number(speed) || 1));

  const response = await client.audio.speech.create({
    model,
    voice,
    input: text.slice(0, 4096),
    response_format: 'mp3',
    speed: pace,
  });

  return Buffer.from(await response.arrayBuffer());
}
