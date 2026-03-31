/**
 * In-memory weather cache for Haldo.
 * Fetches from NWS (primary) with Open-Meteo fallback.
 * Tides from NOAA. Alerts from NWS.
 * All APIs are free, no keys needed.
 *
 * Hardcoded for Honest Eco, Key West FL:
 *   Lat: 24.5551, Lon: -81.7800
 *   NOAA Tide Station: 8724580 (Key West)
 */
import { nwsProvider } from './nws-provider.js';
import { openMeteoProvider } from './open-meteo-provider.js';
import { fetchTidePredictions } from './noaa-tide-provider.js';
import { fetchActiveAlerts } from './nws-alerts-provider.js';
import type { WeatherSummary, HourlyForecast, TideEvent, NwsAlert } from './types.js';

// ─── Honest Eco Location ────────────────────────────────────

const LAT = 24.5551;
const LON = -81.7800;
const NOAA_STATION = '8724580'; // Key West

// ─── Cache Configuration ────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cachedSummary: WeatherSummary | null = null;
let fetchInProgress = false;

// ─── Public API ─────────────────────────────────────────────

/**
 * Get the current weather summary. Returns cached data if fresh,
 * otherwise triggers a background fetch and returns stale/null.
 */
export function getWeatherSummary(): WeatherSummary | null {
  if (cachedSummary && isStale()) {
    // Trigger background refresh but return stale data
    refreshWeather().catch(err => console.error('[weather] background refresh failed:', err));
  } else if (!cachedSummary) {
    // First request — trigger fetch and return null
    refreshWeather().catch(err => console.error('[weather] initial fetch failed:', err));
  }
  return cachedSummary;
}

/**
 * Force a fresh weather fetch. Used on startup.
 */
export async function refreshWeather(): Promise<void> {
  if (fetchInProgress) return;
  fetchInProgress = true;

  try {
    const today = getLocalDateString();
    const now = new Date();
    const currentHour = now.getHours();

    // Fetch weather, tides, and alerts in parallel
    const [hourlyForecast, tideResult, alerts] = await Promise.all([
      fetchForecast(today),
      fetchTides(today),
      fetchAlerts(),
    ]);

    // Find current hour's data
    const currentHourData = findCurrentHour(hourlyForecast, currentHour);

    // Calculate high temp
    const temps = hourlyForecast.map(h => h.temperature_f).filter(t => t > 0);
    const highTemp = temps.length > 0 ? Math.max(...temps) : null;

    cachedSummary = {
      fetchedAt: now,
      date: today,
      currentTemp: currentHourData?.temperature_f ?? null,
      highTemp,
      conditions: currentHourData?.conditions ?? 'Unknown',
      windSpeed: currentHourData?.wind_speed_kts ?? 0,
      windGust: currentHourData?.wind_gust_kts ?? 0,
      windDirection: currentHourData?.wind_direction_cardinal ?? 'N',
      precipChance: currentHourData?.precip_probability_pct ?? 0,
      tideEvents: tideResult,
      alerts,
      hourlyForecast,
    };

    console.log(`[weather] Cache refreshed: ${cachedSummary.conditions}, ${cachedSummary.currentTemp}°F, wind ${cachedSummary.windSpeed}kts ${cachedSummary.windDirection}`);
  } catch (err) {
    console.error('[weather] Failed to refresh weather cache:', err);
  } finally {
    fetchInProgress = false;
  }
}

// ─── Internal Helpers ───────────────────────────────────────

function isStale(): boolean {
  if (!cachedSummary) return true;
  return Date.now() - cachedSummary.fetchedAt.getTime() > CACHE_TTL_MS;
}

/** Get today's date in YYYY-MM-DD format, local time. */
function getLocalDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Fetch hourly forecast — try NWS first, fall back to Open-Meteo. */
async function fetchForecast(date: string): Promise<HourlyForecast[]> {
  try {
    const hours = await nwsProvider.fetchHourlyForecast(LAT, LON, date);
    if (hours.length > 0) return hours;
  } catch (err) {
    console.warn('[weather] NWS failed, trying Open-Meteo:', err);
  }

  try {
    return await openMeteoProvider.fetchHourlyForecast(LAT, LON, date);
  } catch (err) {
    console.error('[weather] Open-Meteo also failed:', err);
    return [];
  }
}

/** Fetch tide high/low events from NOAA. */
async function fetchTides(date: string): Promise<TideEvent[]> {
  try {
    const result = await fetchTidePredictions(NOAA_STATION, date);
    return result.highLow;
  } catch (err) {
    console.error('[weather] NOAA tides failed (non-fatal):', err);
    return [];
  }
}

/** Fetch active alerts from NWS. */
async function fetchAlerts(): Promise<NwsAlert[]> {
  try {
    return await fetchActiveAlerts(LAT, LON);
  } catch (err) {
    console.error('[weather] NWS alerts failed (non-fatal):', err);
    return [];
  }
}

/** Find the forecast entry closest to the current hour. */
function findCurrentHour(forecast: HourlyForecast[], currentHour: number): HourlyForecast | null {
  if (forecast.length === 0) return null;

  // Try exact match first
  const exact = forecast.find(h => {
    const hourStr = h.hour.split('T')[1]?.substring(0, 2);
    return hourStr ? parseInt(hourStr, 10) === currentHour : false;
  });
  if (exact) return exact;

  // Fall back to the first entry (closest to start of day)
  return forecast[0];
}
