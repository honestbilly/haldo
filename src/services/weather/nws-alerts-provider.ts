/**
 * NWS Alerts Provider — ported from boldSQUID.
 * Fetches active weather alerts relevant to marine operations.
 */
import type { NwsAlert } from './types.js';

const NWS_USER_AGENT = '(haldo, billy@honesteco.com)';
const NWS_HEADERS: Record<string, string> = { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geo+json' };
const TIMEOUT_MS = 5000;

// Only surface alert types relevant to fishing charters and marine operations
const RELEVANT_ALERT_EVENTS = new Set([
  'Severe Thunderstorm Warning',
  'Marine Weather Statement',
  'Small Craft Advisory',
  'Special Marine Warning',
  'Tornado Warning',
  'Tropical Storm Warning',
  'Hurricane Warning',
  'Gale Warning',
  'Storm Warning',
  'Coastal Flood Advisory',
  'Coastal Flood Warning',
  'Rip Current Statement',
]);

export async function fetchActiveAlerts(lat: number, lon: number): Promise<NwsAlert[]> {
  const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: NWS_HEADERS,
    });

    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* drain */ }
      console.error('[weather:nws-alerts] NWS API non-OK (non-fatal):', { lat, lon, status: response.status });
      return [];
    }

    const data = await response.json();
    const features = data?.features;
    if (!Array.isArray(features)) return [];

    const alerts: NwsAlert[] = [];
    for (const feature of features) {
      const props = feature?.properties;
      if (!props?.event) continue;
      if (!RELEVANT_ALERT_EVENTS.has(props.event)) continue;

      alerts.push({
        event: props.event,
        headline: props.headline ?? props.event,
        description: props.description ?? '',
        severity: props.severity ?? 'Unknown',
        urgency: props.urgency ?? 'Unknown',
        onset: props.onset ?? '',
        expires: props.expires ?? props.ends ?? '',
      });
    }

    return alerts;
  } catch (err) {
    // Alerts are supplementary — never block primary weather data
    console.error('[weather:nws-alerts] fetchActiveAlerts failed (non-fatal):', { lat, lon }, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
