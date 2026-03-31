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
    return c.html(`
      ${htmlHead('Weather')}
      <body>
        <div class="today-page">
          ${pageHeader('Weather', session.vessel)}
          <div style="padding:40px 16px;text-align:center;color:var(--text-muted)">
            <p style="font-size:1.5rem;margin-bottom:8px">Loading weather data...</p>
            <p style="font-size:0.8125rem">First fetch in progress. Refresh in a moment.</p>
          </div>
        </div>
        ${bottomNav('weather')}
        <script src="/public/app.js"></script>
      </body></html>
    `);
  }

  // Build hourly forecast rows
  const now = new Date();
  const currentHour = now.getHours();
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
        <div style="display:grid;grid-template-columns:55px 50px 1fr 60px 50px;gap:8px;align-items:center;padding:10px 12px;${isCurrent ? 'background:rgba(0,105,80,0.06);border-radius:8px;font-weight:600' : ''}">
          <span style="font-size:0.8125rem;color:${isCurrent ? 'var(--primary)' : 'var(--text-muted)'}">${displayHour}${ampm}</span>
          <span style="font-size:0.875rem">${Math.round(h.temperature_f)}°</span>
          <span style="font-size:0.8125rem;color:var(--text-muted)">${h.conditions}</span>
          <span style="font-size:0.8125rem">
            ${Math.round(h.wind_speed_kts)}${h.wind_gust_kts > h.wind_speed_kts + 3 ? `g${Math.round(h.wind_gust_kts)}` : ''} kts
          </span>
          <span style="font-size:0.8125rem;color:var(--text-muted)">${h.wind_direction_cardinal}</span>
        </div>`;
    }).join('');

  // Tide events
  const tideRows = summary.tideEvents.map(t => {
    const timeStr = t.time.split(' ')[1] ?? t.time;
    const label = t.type === 'H' ? 'High' : 'Low';
    const icon = t.type === 'H' ? '🔵' : '⚪';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px">
        <span>${icon}</span>
        <span style="font-weight:500;font-size:0.875rem">${label}</span>
        <span style="font-size:0.8125rem;color:var(--text-muted)">${timeStr}</span>
        <span style="margin-left:auto;font-size:0.875rem">${t.height_ft.toFixed(1)} ft</span>
      </div>`;
  }).join('');

  // Alerts
  const alertsHtml = summary.alerts.length > 0 ? `
    <div style="margin-bottom:16px">
      ${summary.alerts.map(a => `
        <div style="padding:10px 14px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;margin-bottom:6px">
          <div style="font-weight:600;font-size:0.875rem;color:#92400E">${a.event}</div>
          <div style="font-size:0.75rem;color:#78350F;margin-top:4px">${a.headline}</div>
        </div>
      `).join('')}
    </div>` : '';

  const staleMinutes = Math.round((Date.now() - summary.fetchedAt.getTime()) / 60000);
  const staleNote = staleMinutes > 30 ? `<span style="font-size:0.6875rem;color:#F59E0B">⚠ ${staleMinutes}m old</span>` : '';

  return c.html(`
    ${htmlHead('Weather')}
    <body>
      <div class="today-page">
        ${pageHeader('Weather & Tides', session.vessel)}

        ${alertsHtml}

        <!-- Current conditions -->
        <div style="background:var(--surface);border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div style="font-size:2rem;font-weight:700;color:var(--text)">${summary.currentTemp ? Math.round(summary.currentTemp) + '°F' : '--'}</div>
              <div style="font-size:0.875rem;color:var(--text-muted)">${summary.conditions}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:0.8125rem;color:var(--text-muted)">High ${summary.highTemp ? Math.round(summary.highTemp) + '°' : '--'}</div>
              ${staleNote}
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="background:rgba(0,105,80,0.04);padding:10px;border-radius:8px">
              <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Wind</div>
              <div style="font-size:1rem;font-weight:600">${Math.round(summary.windSpeed)} kts ${summary.windDirection}</div>
              ${summary.windGust > summary.windSpeed + 3 ? `<div style="font-size:0.75rem;color:var(--text-muted)">Gusts ${Math.round(summary.windGust)} kts</div>` : ''}
            </div>
            <div style="background:rgba(0,105,80,0.04);padding:10px;border-radius:8px">
              <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Rain</div>
              <div style="font-size:1rem;font-weight:600">${summary.precipChance}%</div>
            </div>
          </div>
        </div>

        <!-- Tides -->
        ${summary.tideEvents.length > 0 ? `
        <div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid var(--border)">
          <h3 style="font-size:0.8125rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Tides — Key West</h3>
          ${tideRows}
        </div>` : ''}

        <!-- Hourly forecast -->
        <div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid var(--border)">
          <h3 style="font-size:0.8125rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Hourly Forecast</h3>
          <div style="font-size:0.6875rem;color:var(--text-muted);display:grid;grid-template-columns:55px 50px 1fr 60px 50px;gap:8px;padding:4px 12px;border-bottom:1px solid var(--border);margin-bottom:4px">
            <span>Time</span><span>Temp</span><span>Conditions</span><span>Wind</span><span>Dir</span>
          </div>
          ${hourlyRows || '<p style="padding:12px;color:var(--text-muted);font-size:0.8125rem">No forecast data available</p>'}
        </div>

        <div style="text-align:center;padding:8px;font-size:0.6875rem;color:var(--text-muted)">
          Data: NWS + NOAA | Updated ${staleMinutes}m ago
        </div>
      </div>
      ${bottomNav('weather')}
      <script src="/public/app.js"></script>
    </body></html>
  `);
});

export default app;
