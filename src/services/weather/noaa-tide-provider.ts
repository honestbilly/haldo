/**
 * NOAA Tides provider — ported from boldSQUID.
 * Free US government API, no API key needed.
 */
import type { TideEvent, HourlyTideHeight, TideFetchResult } from './types.js';
import { fetchWithRetry, assertDateFormat } from './types.js';

const BASE_URL = 'https://api.tidesandcurrents.noaa.gov';
const APP_ID = 'haldo_honesteco';

export async function fetchTidePredictions(
  stationId: string,
  date: string,
): Promise<TideFetchResult> {
  assertDateFormat(date);
  const yyyymmdd = date.replace(/-/g, '');
  const encodedStation = encodeURIComponent(stationId);
  const baseParams = `begin_date=${yyyymmdd}&end_date=${yyyymmdd}&station=${encodedStation}&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&format=json&application=${APP_ID}`;
  const hiloUrl = `${BASE_URL}/api/prod/datagetter?${baseParams}&interval=hilo`;
  const hourlyUrl = `${BASE_URL}/api/prod/datagetter?${baseParams}&interval=h`;

  try {
    const [hiloRes, hourlyRes] = await Promise.all([
      fetchWithRetry(hiloUrl),
      fetchWithRetry(hourlyUrl),
    ]);
    const [hiloRaw, hourlyRaw] = await Promise.all([hiloRes.json(), hourlyRes.json()]);

    if (hiloRaw?.error) {
      throw new Error(`NOAA hilo API error: ${JSON.stringify(hiloRaw.error)}`);
    }
    if (hourlyRaw?.error) {
      throw new Error(`NOAA hourly API error: ${JSON.stringify(hourlyRaw.error)}`);
    }

    const hiloData = hiloRaw as { predictions?: { t: string; v: string; type: string }[] };
    const hourlyData = hourlyRaw as { predictions?: { t: string; v: string }[] };

    const highLow: TideEvent[] = (hiloData.predictions ?? [])
      .filter((p) => (p.type === 'H' || p.type === 'L') && !Number.isNaN(parseFloat(p.v)))
      .map((p) => ({
        type: p.type as 'H' | 'L',
        time: p.t,
        height_ft: parseFloat(p.v),
      }));

    const hourlyHeights: HourlyTideHeight[] = (hourlyData.predictions ?? [])
      .filter((p) => !Number.isNaN(parseFloat(p.v)))
      .map((p) => ({
        time: p.t,
        height_ft: parseFloat(p.v),
      }));

    return { highLow, hourlyHeights };
  } catch (err) {
    console.error('[weather:noaa-tides] fetchTidePredictions failed:', { stationId, date }, err);
    throw err;
  }
}
