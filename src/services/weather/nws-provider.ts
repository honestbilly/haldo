/**
 * NWS (National Weather Service) provider — ported from boldSQUID.
 * Free US government API, no API key needed.
 */
import type { WeatherProviderAdapter, NwsGridPoint, HourlyForecast } from './types.js';
import { fetchWithRetry, assertDateFormat, CARDINAL_TO_DEGREES, MPH_TO_KTS, degreesToCardinal } from './types.js';

const NWS_USER_AGENT = '(haldo, billy@honesteco.com)';
const NWS_HEADERS = { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geo+json' };

// ─── Grid Point Resolution ──────────────────────────────────

export async function resolveGridPoint(lat: number, lon: number): Promise<NwsGridPoint> {
  const url = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
  const response = await fetchWithRetry(url, { headers: NWS_HEADERS });
  const data = await response.json();
  const props = data.properties;
  if (!props?.gridId || props.gridX == null || props.gridY == null) {
    throw new Error(`NWS grid resolution failed for ${lat},${lon}: no grid properties in response`);
  }
  return { gridId: props.gridId, gridX: props.gridX, gridY: props.gridY };
}

// ─── NWS Wind Parsing ───────────────────────────────────────

function parseWindRangeMph(windSpeed: string): [number, number] {
  const nums = windSpeed.match(/\d+/g);
  if (!nums || nums.length === 0) return [0, 0];
  const values = nums.map((n) => parseInt(n, 10));
  return values.length === 1 ? [values[0], values[0]] : [values[0], values[1]];
}

function cardinalToDegrees(cardinal: string): number {
  return CARDINAL_TO_DEGREES[cardinal as keyof typeof CARDINAL_TO_DEGREES] ?? 0;
}

function estimateCloudCover(shortForecast: string): number {
  const lower = shortForecast.toLowerCase();
  if (lower.includes('mostly sunny') || lower.includes('mostly clear')) return 20;
  if (lower.includes('partly sunny') || lower.includes('partly cloudy')) return 50;
  if (lower.includes('few clouds')) return 12;
  if (lower.includes('mostly cloudy')) return 75;
  if (lower.includes('overcast')) return 95;
  if (lower.includes('cloudy')) return 90;
  if (lower.includes('sunny') || lower.includes('clear')) return 5;
  if (lower.includes('thunder') || lower.includes('storm')) return 95;
  if (lower.includes('rain') || lower.includes('shower') || lower.includes('drizzle')) return 90;
  if (lower.includes('snow') || lower.includes('sleet') || lower.includes('ice')) return 95;
  if (lower.includes('fog')) return 90;
  return 50;
}

// ─── NWS Forecast Parsing ───────────────────────────────────

function parseNwsPeriods(rawPeriods: unknown[], date: string): HourlyForecast[] {
  return (rawPeriods as any[])
    .filter((p) => p.startTime?.startsWith(date))
    .map((p: any): HourlyForecast => {
      const [lowMph, highMph] = parseWindRangeMph(p.windSpeed ?? '0 mph');
      const windDeg = cardinalToDegrees(p.windDirection ?? 'N');
      const forecast = p.shortForecast ?? 'Unknown';

      const gustStr = p.windGust as string | null;
      let wind_gust_kts: number;
      if (gustStr != null) {
        const [gustMph] = parseWindRangeMph(gustStr);
        wind_gust_kts = Math.round(gustMph * MPH_TO_KTS * 10) / 10;
      } else {
        wind_gust_kts = Math.round(highMph * (lowMph === highMph ? 1.2 : 1.0) * MPH_TO_KTS * 10) / 10;
      }

      const avgMph = (lowMph + highMph) / 2;

      return {
        hour: p.startTime?.slice(0, 16) ?? '',
        wind_speed_kts: Math.round(avgMph * MPH_TO_KTS * 10) / 10,
        wind_gust_kts,
        wind_direction_deg: windDeg,
        wind_direction_cardinal: degreesToCardinal(windDeg),
        temperature_f: p.temperature ?? 0,
        cloud_cover_pct: estimateCloudCover(forecast),
        precip_probability_pct: p.probabilityOfPrecipitation?.value ?? 0,
        conditions: forecast,
      };
    });
}

// ─── Grid-Based Forecast Fetch ──────────────────────────────

export async function fetchNwsByGrid(grid: NwsGridPoint, date: string): Promise<HourlyForecast[]> {
  assertDateFormat(date);
  try {
    const url = `https://api.weather.gov/gridpoints/${encodeURIComponent(grid.gridId)}/${grid.gridX},${grid.gridY}/forecastHourly`;
    const response = await fetchWithRetry(url, { headers: NWS_HEADERS });
    const data = await response.json();
    const rawPeriods = data.properties?.periods;
    if (!Array.isArray(rawPeriods)) {
      throw new Error(`[weather:nws] unexpected API response shape for grid ${grid.gridId}/${grid.gridX},${grid.gridY} on ${date}`);
    }
    return parseNwsPeriods(rawPeriods, date);
  } catch (err) {
    console.error('[weather:nws] fetchNwsByGrid failed:', { grid, date }, err);
    throw err;
  }
}

// ─── Provider Implementation ────────────────────────────────

export const nwsProvider: WeatherProviderAdapter = {
  name: 'nws',

  async fetchHourlyForecast(lat: number, lon: number, date: string): Promise<HourlyForecast[]> {
    assertDateFormat(date);
    try {
      const grid = await resolveGridPoint(lat, lon);
      return await fetchNwsByGrid(grid, date);
    } catch (err) {
      console.error('[weather:nws] fetchHourlyForecast failed:', { lat, lon, date }, err);
      throw err;
    }
  },
};
