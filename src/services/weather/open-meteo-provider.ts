/**
 * Open-Meteo provider — ported from boldSQUID.
 * Free open API, no API key needed.
 */
import type { HourlyForecast, WeatherProviderAdapter } from './types.js';
import { fetchWithRetry, assertDateFormat, degreesToCardinal, MS_TO_KTS } from './types.js';

// WMO Weather Interpretation Codes (WW)
const WMO_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  56: 'Freezing Drizzle',
  57: 'Freezing Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',
  66: 'Freezing Rain',
  67: 'Freezing Rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  77: 'Snow Grains',
  80: 'Rain Showers',
  81: 'Rain Showers',
  82: 'Rain Showers',
  85: 'Snow Showers',
  86: 'Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with Hail',
  99: 'Thunderstorm with Hail',
};

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export const openMeteoProvider: WeatherProviderAdapter = {
  name: 'open_meteo',

  async fetchHourlyForecast(lat: number, lon: number, date: string): Promise<HourlyForecast[]> {
    assertDateFormat(date);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation_probability,weather_code` +
      `&temperature_unit=fahrenheit&wind_speed_unit=ms&timezone=auto` +
      `&start_date=${date}&end_date=${date}`;

    try {
      const response = await fetchWithRetry(url);
      const data = await response.json();
      const h = data?.hourly;

      if (!h || !Array.isArray(h.time)) {
        throw new Error(`[weather:open-meteo] unexpected API response shape for ${lat},${lon},${date}`);
      }

      const hours: HourlyForecast[] = (h.time as string[]).map((time: string, i: number) => {
        const windSpeedMs = (h.wind_speed_10m?.[i] as number | null) ?? 0;
        const windGustMs = (h.wind_gusts_10m?.[i] as number | null) ?? 0;
        const dirDeg = (h.wind_direction_10m?.[i] as number | null) ?? 0;
        const weatherCode = (h.weather_code?.[i] as number | null) ?? 0;

        return {
          hour: time.slice(0, 16),
          wind_speed_kts: round1(windSpeedMs * MS_TO_KTS),
          wind_gust_kts: round1(windGustMs * MS_TO_KTS),
          wind_direction_deg: dirDeg,
          wind_direction_cardinal: degreesToCardinal(dirDeg),
          temperature_f: (h.temperature_2m?.[i] as number | null) ?? 0,
          cloud_cover_pct: (h.cloud_cover?.[i] as number | null) ?? 0,
          precip_probability_pct: (h.precipitation_probability?.[i] as number | null) ?? 0,
          conditions: WMO_CODES[weatherCode] ?? 'Unknown',
        };
      });

      return hours;
    } catch (err) {
      console.error('[weather:open-meteo] fetchHourlyForecast failed:', { lat, lon, date }, err);
      throw err;
    }
  },
};
