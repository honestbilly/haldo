/**
 * Weather types for Haldo — simplified port from boldSQUID.
 * No external schema dependencies.
 */

// ─── Hourly Forecast Data ───────────────────────────────────

export interface HourlyForecast {
  hour: string;              // "YYYY-MM-DDTHH:MM"
  wind_speed_kts: number;
  wind_gust_kts: number;
  wind_direction_deg: number;
  wind_direction_cardinal: string;
  temperature_f: number;
  cloud_cover_pct: number;
  precip_probability_pct: number;
  conditions: string;
}

// ─── Tide Data ──────────────────────────────────────────────

export interface TideEvent {
  type: 'H' | 'L';
  time: string;
  height_ft: number;
}

export interface HourlyTideHeight {
  time: string;
  height_ft: number;
}

// ─── NWS Alerts ─────────────────────────────────────────────

export interface NwsAlert {
  event: string;
  headline: string;
  description: string;
  severity: string;
  urgency: string;
  onset: string;
  expires: string;
}

// ─── Provider Interface ─────────────────────────────────────

export interface WeatherProviderAdapter {
  readonly name: string;
  fetchHourlyForecast(lat: number, lon: number, date: string): Promise<HourlyForecast[]>;
}

export interface NwsGridPoint {
  gridId: string;
  gridX: number;
  gridY: number;
}

export interface TideFetchResult {
  highLow: TideEvent[];
  hourlyHeights: HourlyTideHeight[];
}

// ─── Wind Direction Cardinals ───────────────────────────────

export const CARDINAL_DIRECTIONS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
] as const;
export type CardinalDirection = typeof CARDINAL_DIRECTIONS[number];

export function degreesToCardinal(deg: number): CardinalDirection {
  if (!Number.isFinite(deg)) return 'N';
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return CARDINAL_DIRECTIONS[index];
}

export const CARDINAL_TO_DEGREES: Record<CardinalDirection, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

// ─── Conversion Factors ─────────────────────────────────────

/** Meters per second to knots (for Open-Meteo). */
export const MS_TO_KTS = 1.944;

/** Miles per hour to knots (for NWS). */
export const MPH_TO_KTS = 0.868976;

// ─── Date Validation ──────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateFormat(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date format: "${date}" (expected YYYY-MM-DD)`);
  }
}

// ─── Fetch Utility ─────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 1000;

/**
 * Fetch with timeout and single retry on failure.
 */
export async function fetchWithRetry(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Response> {
  const { headers, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        try { await response.body?.cancel(); } catch { /* ignore drain error */ }
        const err = Object.assign(
          new Error(`HTTP ${response.status}: ${response.statusText}`),
          { statusCode: response.status },
        );
        if (response.status >= 400 && response.status < 500 && response.status !== 429) throw err;
        throw err;
      }

      return response;
    } catch (err) {
      const statusCode = (err as any)?.statusCode;
      const isNonRetryableClientError = statusCode >= 400 && statusCode < 500 && statusCode !== 429;
      if (attempt === 0 && !isNonRetryableClientError) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('fetchWithRetry: unexpected fall-through');
}

// ─── Cached Weather Summary (what the widget card uses) ─────

export interface WeatherSummary {
  fetchedAt: Date;
  date: string;                     // YYYY-MM-DD
  currentTemp: number | null;       // °F
  highTemp: number | null;          // °F
  conditions: string;               // e.g. "Partly Cloudy"
  windSpeed: number;                // knots (current hour)
  windGust: number;                 // knots (current hour)
  windDirection: string;            // cardinal
  precipChance: number;             // % (current hour)
  tideEvents: TideEvent[];          // high/low events for the day
  alerts: NwsAlert[];               // active NWS alerts
  hourlyForecast: HourlyForecast[]; // for detail page later
}
