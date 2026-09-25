import { getFlightByFlightId } from './flight-lookup';
import { getLandscapeByFlightId, saveLandingScenery } from './landscape-images';
import { generateLandingScenery } from '../ai/scenery';
import { CITIES } from '../../data/cities';

function parseCityCountry(arrivalLocation: string): { city: string; country: string } {
  const parts = arrivalLocation.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts[0], country: parts[parts.length - 1] };
  }
  return { city: arrivalLocation, country: arrivalLocation };
}

export interface SceneryBackfillResult {
  flightId: string;
  skipped?: boolean;
  error?: string;
  imageUrl?: string;
  arrivalLocation?: string;
}

export interface SceneryFlightInfo {
  flightId: string;
  passengerId: string;
  passengerName: string;
  groupId: string;
  arrivalLocation: string;
  landingTime?: string | null;
  timezone?: string | null;
}

/** 同一航班進行中的生圖工作：降落背景生圖與前端補生撞在一起時共用同一個 Promise */
const inflightJobs = new Map<string, Promise<SceneryBackfillResult>>();

function dedupe(
  flightId: string,
  force: boolean,
  run: () => Promise<SceneryBackfillResult>
): Promise<SceneryBackfillResult> {
  const running = inflightJobs.get(flightId);
  if (running && !force) return running;

  const job = run().finally(() => {
    if (inflightJobs.get(flightId) === job) inflightJobs.delete(flightId);
  });
  inflightJobs.set(flightId, job);
  return job;
}

/**
 * 降落當下由伺服器直接生圖：航班資料由 land handler 傳入，
 * 不需回查資料庫（記憶體模式下也能生圖）。
 */
export function generateSceneryForLanding(info: SceneryFlightInfo): Promise<SceneryBackfillResult> {
  return dedupe(info.flightId, false, () => generateAndSaveScenery(info, { force: false }));
}

export function backfillSceneryForFlight(
  flightId: string,
  options?: { force?: boolean }
): Promise<SceneryBackfillResult> {
  return dedupe(flightId, !!options?.force, () => runSceneryBackfill(flightId, options));
}

async function runSceneryBackfill(
  flightId: string,
  options?: { force?: boolean }
): Promise<SceneryBackfillResult> {
  const flight = await getFlightByFlightId(flightId);
  if (!flight) return { flightId, error: '找不到航班' };
  if (!flight.arrivalLocation) return { flightId, error: '沒有抵達地點' };

  return generateAndSaveScenery(
    {
      flightId: flight.flightId,
      passengerId: flight.passengerId,
      passengerName: flight.passengerName,
      groupId: flight.groupId,
      arrivalLocation: flight.arrivalLocation,
      landingTime: flight.landingTime,
    },
    { force: !!options?.force }
  );
}

async function generateAndSaveScenery(
  info: SceneryFlightInfo,
  options: { force: boolean }
): Promise<SceneryBackfillResult> {
  const { flightId } = info;
  const existing = await getLandscapeByFlightId(flightId);
  if (!options.force && existing?.imageUrl) {
    return { flightId, skipped: true, imageUrl: existing.imageUrl, arrivalLocation: existing.arrivalLocation };
  }
  if (!info.arrivalLocation) return { flightId, error: '沒有抵達地點' };

  const { city, country } = parseCityCountry(info.arrivalLocation);
  const destination = CITIES.find((item) => item.displayName === info.arrivalLocation);
  const startedAt = Date.now();
  const sceneryGen = await generateLandingScenery(city, country, info.arrivalLocation, flightId, {
    landingTime: info.landingTime,
    timezone: info.timezone ?? destination?.timezone,
  });
  if (!sceneryGen) {
    console.error(`[scenery] ${flightId} 生圖失敗（${Date.now() - startedAt}ms）— 檢查 OPENAI_API_KEY / OPENAI_IMAGE_MODEL`);
    return { flightId, error: '生圖失敗（OPENAI_API_KEY）' };
  }
  console.log(`[scenery] ${flightId} 生圖完成 ${Date.now() - startedAt}ms → 存入 Notion`);

  const saved = await saveLandingScenery({
    flightId,
    passengerId: info.passengerId,
    passengerName: info.passengerName,
    groupId: info.groupId,
    arrivalLocation: info.arrivalLocation,
    country,
    imageBuffer: sceneryGen.imageBuffer,
    filename: sceneryGen.filename,
    contentType: sceneryGen.contentType,
    imagePrompt: sceneryGen.imagePrompt,
    landingTime: info.landingTime ?? new Date().toISOString(),
  });

  if (!saved?.imageUrl) {
    console.error(`[scenery] ${flightId} 存入 Notion 失敗`);
    return { flightId, error: '存入 Notion 失敗' };
  }
  return { flightId, imageUrl: saved.imageUrl, arrivalLocation: saved.arrivalLocation };
}

export async function backfillSceneryForFlights(flightIds: string[], options?: { force?: boolean }) {
  const results = [];
  for (const flightId of flightIds) {
    try {
      results.push(await backfillSceneryForFlight(flightId, options));
    } catch (err) {
      console.error(`[scenery] ${flightId} backfill 例外：`, err);
      results.push({ flightId, error: err instanceof Error ? err.message : '未知錯誤' });
    }
  }
  return results;
}
