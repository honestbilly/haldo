/**
 * Weather route — serves weather data as JSON for the /today card.
 * Also provides a detail page at /weather for hourly breakdown.
 */
import { Hono } from 'hono';
import { getWeatherSummary } from '../services/weather/weather-cache.js';
import { getSession } from './session.js';
import { bottomNav, htmlHead, pageHeader } from '../ui.js';
import type { SessionData } from '../types.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

// Middleware: require session
app.use('/weather', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});
app.use('/weather/*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

// ─── JSON endpoint (for AJAX polling) ───────────────────────

app.get('/weather/api', (c) => {
  const summary = getWeatherSummary();
  if (!summary) {
    return c.json({ loading: true });
  }
  return c.json({
    loading: false,
    currentTemp: summary.currentTemp,
    highTemp: summary.highTemp,
    conditions: summary.conditions,
    windSpeed: summary.windSpeed,
    windGust: summary.windGust,
    windDirection: summary.windDirection,
    precipChance: summary.precipChance,
    tideEvents: summary.tideEvents,
    alerts: summary.alerts,
    fetchedAt: summary.fetchedAt.toISOString(),
  });
});

// ─── Weather detail page ────────────────────────────────────

app.get('/weather', (c) => {
  const session = c.get('session');
  const summary = getWeatherSummary();

  if (!summary) {
    return c.html(`${htmlHead('Weather')}
<body style="background:#F2F2F7">
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;justify-content:center;align-items:center;height:64px">
    <span style="font-weight:700;font-size:1rem;color:#1a1c1e">Weather</span>
  </header>
  <main style="max-width:480px;margin:0 auto;padding:80px 20px 120px;text-align:center">
    <span class="material-symbols-outlined" style="font-size:48px;color:#c7c7cc;display:block;margin-bottom:12px">cloud_sync</span>
    <p style="font-size:1.25rem;font-weight:600;color:#1a1c1e;margin-bottom:8px">Loading weather data...</p>
    <p style="font-size:0.8125rem;color:#8E8E93">First fetch in progress. Refresh in a moment.</p>
  </main>
  ${bottomNav('weather')}
</body></html>`);
  }

  const now = new Date();
  const currentHour = now.getHours();
  const staleMinutes = Math.round((Date.now() - summary.fetchedAt.getTime()) / 60000);

  // Hourly rows (Stitch pattern)
  const hourlyRows = summary.hourlyForecast
    .filter(h => {
      const hourStr = h.hour.split('T')[1]?.substring(0, 2);
      return hourStr ? parseInt(hourStr, 10) >= currentHour - 1 : true;
    })
    .slice(0, 12)
    .map(h => {
      const hourStr = h.hour.split('T')[1]?.substring(0, 5) ?? '';
      const hourNum = parseInt(hourStr.split(':')[0], 10);
      const ampm = hourNum >= 12 ? 'PM' : 'AM';
      const displayHour = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
      const isCurrent = hourNum === currentHour;
      return `
        <div style="display:grid;grid-template-columns:55px 50px 1fr 65px 45px;gap:8px;align-items:center;padding:12px 16px;${isCurrent ? 'background:rgba(26,107,138,0.06);border-radius:10px;font-weight:600' : ''}">
          <span style="font-size:0.8125rem;font-weight:${isCurrent ? '700' : '500'};color:${isCurrent ? '#1A6B8A' : '#8E8E93'}">${displayHour}${ampm}</span>
          <span style="font-size:0.9375rem;font-weight:600">${Math.round(h.temperature_f)}°</span>
          <span style="font-size:0.8125rem;color:#5b5f67">${h.conditions}</span>
          <span style="font-size:0.8125rem;font-weight:500">${Math.round(h.wind_speed_kts)}${h.wind_gust_kts > h.wind_speed_kts + 3 ? `g${Math.round(h.wind_gust_kts)}` : ''} kts</span>
          <span style="font-size:0.8125rem;color:#8E8E93">${h.wind_direction_cardinal}</span>
        </div>`;
    }).join('');

  // Tide rows (Material icons instead of emoji)
  const tideRows = summary.tideEvents.map(t => {
    const timeStr = t.time.split(' ')[1] ?? t.time;
    const isHigh = t.type === 'H';
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px">
        <div style="width:36px;height:36px;border-radius:50%;background:${isHigh ? 'rgba(90,200,250,0.12)' : 'rgba(142,142,147,0.08)'};display:flex;align-items:center;justify-content:center">
          <span class="material-symbols-outlined" style="font-size:20px;color:${isHigh ? '#5AC8FA' : '#8E8E93'}">${isHigh ? 'arrow_upward' : 'arrow_downward'}</span>
        </div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:0.9375rem">${isHigh ? 'High' : 'Low'}</div>
          <div style="font-size:0.8125rem;color:#8E8E93">${timeStr}</div>
        </div>
        <span style="font-family:'Manrope',sans-serif;font-weight:700;font-size:1rem">${t.height_ft.toFixed(1)} ft</span>
      </div>`;
  }).join('');

  // Alerts (Material icons)
  const alertsHtml = summary.alerts.length > 0 ? `
    <section style="margin-bottom:16px">
      ${summary.alerts.map(a => `
        <div style="padding:16px 20px;background:#FEF3C7;border-radius:12px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px">
          <span class="material-symbols-outlined" style="font-size:22px;color:#FF9500;font-variation-settings:'FILL' 1;flex-shrink:0">warning</span>
          <div>
            <div style="font-weight:700;font-size:0.875rem;color:#92400E">${a.event}</div>
            <div style="font-size:0.75rem;color:#78350F;margin-top:4px;line-height:1.4">${a.headline}</div>
          </div>
        </div>
      `).join('')}
    </section>` : '';

  return c.html(`${htmlHead('Weather')}
<body style="background:#F2F2F7">
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:64px">
    <a href="/today" style="color:#1A6B8A;text-decoration:none;font-weight:600;font-size:0.875rem;display:flex;align-items:center;gap:4px">
      <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Home
    </a>
    <span style="font-weight:700;font-size:1rem;color:#1a1c1e">Weather & Tides</span>
    <span style="font-size:0.6875rem;font-weight:700;color:#1A6B8A;background:rgba(26,107,138,0.08);padding:4px 10px;border-radius:10px">${session.vessel.toUpperCase()}</span>
  </header>

  <main style="max-width:480px;margin:0 auto;padding:80px 20px 120px">
    ${alertsHtml}

    <!-- Current Conditions (Stitch pattern: giant temp, circular icon containers) -->
    <section style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin-bottom:16px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;right:0;width:128px;height:128px;opacity:0.08;pointer-events:none">
        <span class="material-symbols-outlined" style="font-size:120px;color:#FF9500;font-variation-settings:'FILL' 1">wb_sunny</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
        <div>
          <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:4rem;line-height:1;color:#1a1c1e;letter-spacing:-0.03em">${summary.currentTemp ? Math.round(summary.currentTemp) + '°F' : '--'}</div>
          <div style="font-size:1.25rem;font-weight:600;color:#8E8E93;margin-top:4px">${summary.conditions}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:1.0625rem;font-weight:500;color:#8E8E93">High ${summary.highTemp ? Math.round(summary.highTemp) + '°' : '--'}</div>
          ${staleMinutes > 30 ? `<div style="font-size:0.6875rem;color:#FF9500;margin-top:4px"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle">schedule</span> ${staleMinutes}m old</div>` : ''}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-top:16px;border-top:1px solid #F2F2F7">
        <div style="display:flex;align-items:center;gap:12px;min-height:54px">
          <div style="width:48px;height:48px;border-radius:50%;background:rgba(90,200,250,0.1);display:flex;align-items:center;justify-content:center">
            <span class="material-symbols-outlined" style="font-size:28px;color:#5AC8FA">air</span>
          </div>
          <div>
            <div style="font-family:'Manrope',sans-serif;font-weight:700;font-size:0.9375rem">${Math.round(summary.windSpeed)} kts ${summary.windDirection}</div>
            ${summary.windGust > summary.windSpeed + 3 ? `<div style="font-size:0.8125rem;color:#8E8E93">Gusts ${Math.round(summary.windGust)} kts</div>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;min-height:54px">
          <div style="width:48px;height:48px;border-radius:50%;background:rgba(90,200,250,0.1);display:flex;align-items:center;justify-content:center">
            <span class="material-symbols-outlined" style="font-size:28px;color:#5AC8FA">rainy</span>
          </div>
          <div>
            <div style="font-family:'Manrope',sans-serif;font-weight:700;font-size:0.9375rem">${summary.precipChance}%</div>
            <div style="font-size:0.8125rem;color:#8E8E93">Precipitation</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Tides -->
    ${summary.tideEvents.length > 0 ? `
    <section style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin-bottom:16px">
      <h3 style="font-size:0.6875rem;font-weight:700;letter-spacing:0.15em;color:#8E8E93;text-transform:uppercase;margin-bottom:8px;padding:0 16px">Tides — Key West</h3>
      ${tideRows}
    </section>` : ''}

    <!-- Hourly Forecast -->
    <section style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin-bottom:16px">
      <h3 style="font-size:0.6875rem;font-weight:700;letter-spacing:0.15em;color:#8E8E93;text-transform:uppercase;margin-bottom:8px;padding:0 16px">Hourly Forecast</h3>
      <div style="font-size:0.625rem;font-weight:600;color:#c7c7cc;display:grid;grid-template-columns:55px 50px 1fr 65px 45px;gap:8px;padding:8px 16px;text-transform:uppercase;letter-spacing:0.1em">
        <span>Time</span><span>Temp</span><span>Conditions</span><span>Wind</span><span>Dir</span>
      </div>
      ${hourlyRows || '<p style="padding:16px;color:#8E8E93;font-size:0.8125rem">No forecast data available</p>'}
    </section>

    <footer style="text-align:center;padding:16px;font-size:0.6875rem;color:#8E8E93">
      Data: NWS + NOAA | Updated ${staleMinutes}m ago
    </footer>
  </main>
  ${bottomNav('weather')}
</body></html>
  `);
});

export default app;
