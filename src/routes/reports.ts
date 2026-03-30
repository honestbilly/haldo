import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import pool from '../db.js';

const app = new Hono();

// Auth disabled temporarily — PIN login coming in v1
// const authMiddleware = async (c: any, next: any) => {
//   const user = process.env.REPORT_USER || 'billy';
//   const pass = process.env.REPORT_PASS;
//   if (!pass) return next();
//   const auth = basicAuth({ username: user, password: pass });
//   return auth(c, next);
// };
// app.use('/report/*', authMiddleware);
// app.use('/report', authMiddleware);

const VESSELS = ['squid', 'blu-q', 'cowfish', 'scout', 'java-cat'];

const VESSEL_LABELS: Record<string, string> = {
  'squid': 'SQUID',
  'blu-q': 'Blu Q',
  'cowfish': 'Cowfish',
  'scout': 'Scout',
  'java-cat': 'Java Cat',
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Render a completion card — logbooks get structured layout, checklists get condensed
function renderCompletionCard(co: any): string {
  const values = co.values_json || {};
  const hasAlerts = co.alerts_json && (co.alerts_json as any[]).length > 0;
  const isLogbook = co.template_type === 'logbook';

  // Detect incidents
  const incidentValue = values['incident-occurred'];
  const hasIncident = incidentValue && incidentValue !== 'No incidents';
  const incidentDetails = values['incident-details'] || '';

  // Detect inline notes from (+) buttons
  const inlineNotes: string[] = [];
  for (const [key, val] of Object.entries(values)) {
    if (key.startsWith('note_') && val && String(val).trim()) {
      inlineNotes.push(String(val));
    }
  }
  const hasNotes = inlineNotes.length > 0 || (co.notes && co.notes.trim());

  // Count checked items for ratio
  let checkedCount = 0;
  let totalItems = 0;
  for (const [key, val] of Object.entries(values)) {
    if (key.startsWith('note_') || key.startsWith('fail_note_') || key === 'notes' || key === 'sign_off') continue;
    totalItems++;
    if (val && val !== '' && val !== 'false') checkedCount++;
  }

  const time = co.completed_at
    ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '—';

  // Card border + background
  let cardStyle = 'background:#FFFFFF;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:4px solid #006950';
  if (hasIncident) {
    cardStyle = 'background:#FFF5F5;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:4px solid #ba1a1a;border:2px solid #F36D4F;border-left:4px solid #ba1a1a';
  } else if (hasAlerts) {
    cardStyle = 'background:#FFFFFF;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:4px solid #F36D4F';
  }

  const searchableData = `${JSON.stringify(values).toLowerCase()} ${co.template_id} ${co.crew_name?.toLowerCase() || ''} ${co.notes?.toLowerCase() || ''} ${co.vessel || ''}`;

  if (isLogbook) {
    return renderLogbookCard(co, values, hasIncident, incidentDetails, hasNotes, inlineNotes, checkedCount, totalItems, time, cardStyle, searchableData);
  } else {
    return renderChecklistCard(co, values, hasAlerts, hasNotes, inlineNotes, checkedCount, totalItems, time, cardStyle, searchableData);
  }
}

// ── Logbook card: structured readable layout ──
function renderLogbookCard(
  co: any, values: any, hasIncident: boolean, incidentDetails: string,
  hasNotes: boolean, inlineNotes: string[], checkedCount: number, totalItems: number,
  time: string, cardStyle: string, searchableData: string
): string {
  const v = (key: string) => {
    const val = values[key];
    if (!val || val === '' || val === 'false') return '';
    return Array.isArray(val) ? val.join(', ') : String(val);
  };

  const vessel = VESSEL_LABELS[co.vessel] || co.vessel?.toUpperCase() || '';
  const slot = co.trip_slot || v('trip-slot') || '';
  const title = `${slot} Trip — ${vessel}`;

  // Crew line: captain first, then mate — no role labels
  const crewParts: string[] = [];
  if (co.crew_name) crewParts.push(escapeHtml(co.crew_name));
  const mateName = v('mate-name');
  if (mateName && mateName !== co.crew_name) crewParts.push(escapeHtml(mateName));
  const crewOnBoard = v('crew-on-board');
  if (crewOnBoard) {
    const names = crewOnBoard.split(',').map((n: string) => n.trim()).filter((n: string) => n && n !== co.crew_name && n !== mateName);
    crewParts.push(...names.map((n: string) => escapeHtml(n)));
  }
  const crewStr = crewParts.join(', ');

  const pax = v('guests-attended') || v('total-guests') || v('guest-count') || '';

  // Locations
  const snorkel = v('snorkel-location') || v('snorkel-site') || '';
  const dolphins = v('dolphin-location') || v('dolphin-sighting-location') || '';
  const otherLoc = v('other-location') || '';
  const locParts: string[] = [];
  if (snorkel) locParts.push(`Snorkel: ${escapeHtml(snorkel)}`);
  if (dolphins) locParts.push(`Dolphins: ${escapeHtml(dolphins)}`);
  if (otherLoc) locParts.push(`Other: ${escapeHtml(otherLoc)}`);
  const locStr = locParts.length > 0 ? locParts.join(' · ') : '';

  const weather = v('weather-conditions') || v('weather') || '';

  // Engine hours
  const ehPortStart = v('engine-hours-port-start') || v('engine-hours-start');
  const ehPortEnd = v('engine-hours-end') || v('engine-hours-port-end');
  const ehStbdStart = v('engine-hours-stbd-start');
  const ehStbdEnd = v('engine-hours-stbd-end');
  let engineStr = '';
  if (ehPortStart || ehPortEnd) {
    engineStr = `Engine Hours: ${ehPortStart || '?'} → ${ehPortEnd || '?'} (Port)`;
    if (ehStbdStart || ehStbdEnd) engineStr += ` · ${ehStbdStart || '?'} → ${ehStbdEnd || '?'} (Stbd)`;
  }

  // Merch
  const merchParts: string[] = [];
  const hat = v('merch-hat'); if (hat && hat !== '0') merchParts.push(`${hat} hat${hat === '1' ? '' : 's'}`);
  const tshirt = v('merch-tshirt'); if (tshirt && tshirt !== '0') merchParts.push(`${tshirt} t-shirt${tshirt === '1' ? '' : 's'}`);
  const sunshirt = v('merch-sunshirt'); if (sunshirt && sunshirt !== '0') merchParts.push(`${sunshirt} sun shirt${sunshirt === '1' ? '' : 's'}`);
  const sweatshirt = v('merch-sweatshirt'); if (sweatshirt && sweatshirt !== '0') merchParts.push(`${sweatshirt} sweatshirt${sweatshirt === '1' ? '' : 's'}`);
  const payment = v('merch-payment');
  let merchStr = '';
  if (merchParts.length > 0) {
    merchStr = `Merch: ${merchParts.join(', ')}${payment ? ` — ${escapeHtml(payment)}` : ''}`;
  } else if (payment === 'No sales today') {
    merchStr = 'Merch: No sales today';
  }

  // Notes
  const notes = co.notes ? escapeHtml(co.notes) : '';
  const merchNotes = v('merch-notes');

  // Notes icon for upper right
  const notesIcon = hasNotes
    ? `<span title="${escapeHtml(inlineNotes.join(' | '))}" style="cursor:help;font-size:1rem">📎</span>`
    : '';

  // Line styles
  const lineStyle = 'font-size:0.8125rem;color:#1a1c1c;line-height:1.6;margin:0;';
  const mutedStyle = 'font-size:0.8125rem;color:#6e7a74;line-height:1.6;margin:0;';

  return `
    <div class="completion-card" data-searchable="${escapeHtml(searchableData)}" data-vessel="${co.vessel || ''}" style="${cardStyle}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          ${hasIncident ? '<div style="font-size:0.6875rem;font-weight:700;color:#ba1a1a;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px">⚠️ INCIDENT REPORTED</div>' : ''}
          <div style="font-weight:700;font-size:1rem;color:#1a1c1c">${escapeHtml(title)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:0.75rem;color:#6e7a74">${time} · ${escapeHtml(co.crew_name || '')} ${notesIcon}</div>
          <div style="font-size:0.6875rem;color:#006950;font-weight:500">${checkedCount}/${totalItems} items ✓</div>
        </div>
      </div>

      ${crewStr || pax ? `<p style="${lineStyle}">Crew: ${crewStr}${pax ? ` · Pax: ${escapeHtml(pax)}` : ''}</p>` : ''}
      ${locStr ? `<p style="${lineStyle}">${locStr}</p>` : ''}
      ${weather ? `<p style="${mutedStyle}">Weather: ${escapeHtml(weather)}</p>` : ''}
      ${notes ? `<p style="${lineStyle};margin-top:4px">Notes: ${notes}</p>` : ''}
      ${engineStr ? `<p style="${mutedStyle};margin-top:4px">${engineStr}</p>` : ''}
      ${merchStr ? `<p style="${mutedStyle}">${merchStr}</p>` : ''}
      ${merchNotes ? `<p style="${mutedStyle}">Merch note: ${escapeHtml(merchNotes)}</p>` : ''}

      ${hasIncident ? `
        <div style="margin-top:8px;padding:8px 12px;background:#ba1a1a;color:white;font-weight:600;font-size:0.8125rem;border-radius:8px">
          ⚠️ ${escapeHtml(String(values['incident-occurred'] || ''))}${incidentDetails ? ` — ${escapeHtml(String(incidentDetails)).substring(0, 200)}` : ''}
        </div>` : ''}
    </div>`;
}

// ── Checklist card: condensed with item count ──
function renderChecklistCard(
  co: any, values: any, hasAlerts: boolean, hasNotes: boolean, inlineNotes: string[],
  checkedCount: number, totalItems: number, time: string, cardStyle: string, searchableData: string
): string {
  // Build condensed non-checkbox values
  const summaryParts: string[] = [];
  for (const [key, val] of Object.entries(values)) {
    if (!val || val === '' || val === 'true' || val === 'false') continue;
    if (key.startsWith('note_') || key.startsWith('fail_note_')) continue;
    const label = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const strVal = Array.isArray(val) ? (val as string[]).join(', ') : String(val);
    summaryParts.push(`<strong style="color:#1a1c1c;font-weight:500">${escapeHtml(label)}:</strong> ${escapeHtml(strVal.substring(0, 80))}`);
  }
  const valuesHtml = summaryParts.length > 0
    ? summaryParts.join('<span style="color:#bdc9c2"> · </span>')
    : '';

  const templateName = co.template_id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

  const notesIcon = hasNotes
    ? `<span title="${escapeHtml(inlineNotes.join(' | '))}" style="cursor:help;font-size:1rem">📎</span>`
    : '';

  const alertBadge = hasAlerts
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.6875rem;font-weight:600;background:rgba(243,109,79,0.1);color:#F36D4F">⚠ ${(co.alerts_json as any[]).length} flagged</span>`
    : '';

  return `
    <div class="completion-card" data-searchable="${escapeHtml(searchableData)}" data-vessel="${co.vessel || ''}" style="${cardStyle}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <span style="font-weight:600;font-size:0.875rem;color:#1a1c1c">${escapeHtml(templateName)}</span>
          ${alertBadge}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:0.75rem;color:#6e7a74">${time} · ${escapeHtml(co.crew_name || '')} ${notesIcon}</div>
          <div style="font-size:0.6875rem;color:#006950;font-weight:500">${checkedCount}/${totalItems} ✓</div>
        </div>
      </div>
      ${valuesHtml ? `<div style="font-size:0.8125rem;color:#6e7a74;line-height:1.5;margin-top:4px">${valuesHtml}</div>` : ''}
      ${co.notes ? `<div style="font-size:0.8125rem;color:#1a1c1c;margin-top:4px">Notes: ${escapeHtml(co.notes)}</div>` : ''}
    </div>`;
}

// Helper: format a date string (YYYY-MM-DD) for display
function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// Helper: shift a YYYY-MM-DD string by N days
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().split('T')[0];
}

// Helper: build URL preserving current filter params
function buildReportUrl(overrides: Record<string, string>, base: Record<string, string>): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return `/report${qs ? '?' + qs : ''}`;
}

// Helper: render checklist summary symbol row for a vessel
function renderChecklistSymbols(checklists: any[]): string {
  const CHECKLIST_ORDER = ['wake-up', 'between', 'put-to-bed', 'dmt'];
  const CHECKLIST_LABELS: Record<string, string> = {
    'wake-up': 'Wake Up',
    'between': 'Between',
    'put-to-bed': 'Put to Bed',
    'dmt': 'DMT',
  };

  const completedIds = new Set(checklists.map(co => co.template_id));

  const symbols = CHECKLIST_ORDER.map(id => {
    const match = checklists.find(co => co.template_id === id);
    if (match) {
      const time = match.completed_at
        ? new Date(match.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : '';
      return `<span style="color:#006950;font-size:0.8125rem" title="${escapeHtml(CHECKLIST_LABELS[id] || id)} completed${time ? ' at ' + time : ''}">&#9745; ${escapeHtml(CHECKLIST_LABELS[id] || id)}${time ? ' (' + time + ')' : ''}</span>`;
    } else {
      return `<span style="color:#ba1a1a;font-size:0.8125rem;opacity:0.6" title="${escapeHtml(CHECKLIST_LABELS[id] || id)} not completed">&#10007; ${escapeHtml(CHECKLIST_LABELS[id] || id)}</span>`;
    }
  });

  // Also include any checklists not in the standard order
  for (const co of checklists) {
    if (!CHECKLIST_ORDER.includes(co.template_id)) {
      const label = co.template_id.replace(/-/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
      const time = co.completed_at
        ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : '';
      symbols.push(`<span style="color:#006950;font-size:0.8125rem">&#9745; ${escapeHtml(label)}${time ? ' (' + time + ')' : ''}</span>`);
    }
  }

  return `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;padding:6px 0;font-family:'Inter',-apple-system,sans-serif">${symbols.join('<span style="color:#bdc9c2"> &middot; </span>')}</div>`;
}

// Dashboard — daily activity + alerts, grouped by vessel
app.get('/report', async (c) => {
  const todayStr = new Date().toISOString().split('T')[0];

  // Read query params
  const qDate = c.req.query('date') || '';
  const qFrom = c.req.query('from') || '';
  const qTo = c.req.query('to') || '';
  const qVessel = c.req.query('vessel') || '';
  const qCrew = c.req.query('crew') || '';

  // Determine if range mode or single-day mode
  const isRange = !!(qFrom || qTo);
  const currentDate = qDate || todayStr;
  const prevDate = shiftDate(currentDate, -1);
  const nextDate = shiftDate(currentDate, 1);

  // Build base filter params (for link generation)
  const baseParams: Record<string, string> = {};
  if (qVessel) baseParams.vessel = qVessel;
  if (qCrew) baseParams.crew = qCrew;

  // Fetch crew list for the filter dropdown
  const crewList = await pool.query('SELECT id, name, role FROM crew WHERE active = TRUE ORDER BY name');

  // Build completions query
  let compQuery = `
    SELECT co.*, cr.name as crew_name
    FROM completions co
    JOIN crew cr ON co.crew_id = cr.id
    WHERE 1=1`;
  const compParams: string[] = [];
  let pIdx = 1;

  if (isRange) {
    if (qFrom) { compQuery += ` AND co.trip_date >= $${pIdx++}`; compParams.push(qFrom); }
    if (qTo) { compQuery += ` AND co.trip_date <= $${pIdx++}`; compParams.push(qTo); }
  } else {
    compQuery += ` AND co.trip_date = $${pIdx++}`;
    compParams.push(currentDate);
  }
  if (qVessel) { compQuery += ` AND co.vessel = $${pIdx++}`; compParams.push(qVessel); }
  if (qCrew) { compQuery += ` AND co.crew_id = $${pIdx++}`; compParams.push(qCrew); }
  compQuery += ' ORDER BY co.completed_at DESC';

  const [alertsResult, completions] = await Promise.all([
    pool.query(
      `SELECT a.*, c.vessel, cr.name as crew_name
       FROM alerts a
       JOIN completions c ON a.completion_id = c.id
       JOIN crew cr ON c.crew_id = cr.id
       WHERE a.acknowledged_at IS NULL
       ORDER BY a.created_at DESC`
    ),
    pool.query(compQuery, compParams),
  ]);
  const alerts = alertsResult;

  // Attach alerts to completions for badge display
  const alertsByCompletion = new Map<string, any[]>();
  for (const a of alerts.rows) {
    if (!alertsByCompletion.has(a.completion_id)) alertsByCompletion.set(a.completion_id, []);
    alertsByCompletion.get(a.completion_id)!.push(a);
  }

  // Group completions by vessel
  const byVessel = new Map<string, any[]>();
  for (const co of completions.rows) {
    const v = co.vessel || 'unknown';
    if (!byVessel.has(v)) byVessel.set(v, []);
    byVessel.get(v)!.push(co);
  }

  // Count incidents
  let incidentCount = 0;
  for (const co of completions.rows) {
    const vals = co.values_json || {};
    if (vals['incident-occurred'] && vals['incident-occurred'] !== 'No incidents') incidentCount++;
  }

  // ── Day Navigation ──
  const dayNavHtml = `
    <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin:16px 0">
      <a href="${buildReportUrl({ date: prevDate }, baseParams)}" style="text-decoration:none;font-size:1.25rem;color:#006950;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid #bdc9c2;background:#FFFFFF">&larr;</a>
      <input type="date" value="${currentDate}" onchange="var p=new URLSearchParams(window.location.search);p.set('date',this.value);p.delete('from');p.delete('to');window.location='/report?'+p.toString()" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.9375rem;background:#FFFFFF;color:#1a1c1c">
      <a href="${buildReportUrl({ date: nextDate }, baseParams)}" style="text-decoration:none;font-size:1.25rem;color:#006950;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid #bdc9c2;background:#FFFFFF">&rarr;</a>
    </div>
    <div style="text-align:center;font-size:0.8125rem;color:#6e7a74;margin-bottom:8px">${formatDateDisplay(currentDate)}</div>`;

  // ── Filter Bar — compact dropdowns for mobile ──
  const vesselOptions = VESSELS.map(v => {
    const count = byVessel.get(v)?.length || 0;
    return `<option value="${v}" ${qVessel === v ? 'selected' : ''}>${VESSEL_LABELS[v] || v.toUpperCase()} (${count})</option>`;
  }).join('');

  const dropdownStyle = 'padding:10px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:"Inter",-apple-system,sans-serif;font-size:16px;background:#FFFFFF;color:#1a1c1c;width:100%;min-height:44px;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%236e7a74\' stroke-width=\'1.5\' fill=\'none\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center';
  const dateStyle = 'padding:10px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:"Inter",-apple-system,sans-serif;font-size:16px;background:#FFFFFF;color:#1a1c1c;width:100%;min-height:44px';

  const filterBarHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <select id="vessel-filter" onchange="applyFilters()" style="${dropdownStyle}">
        <option value="">All vessels (${completions.rows.length})</option>
        ${vesselOptions}
      </select>
      <select id="crew-filter" onchange="applyFilters()" style="${dropdownStyle}">
        <option value="">All crew</option>
        ${crewList.rows.map(cr => `<option value="${cr.id}" ${qCrew === cr.id ? 'selected' : ''}>${escapeHtml(cr.name)} (${cr.role})</option>`).join('')}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div>
        <label style="font-size:0.6875rem;color:#6e7a74;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;display:block">From</label>
        <input type="date" id="range-from" value="${escapeHtml(qFrom)}" onchange="applyFilters()" style="${dateStyle}">
      </div>
      <div>
        <label style="font-size:0.6875rem;color:#6e7a74;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;display:block">To</label>
        <input type="date" id="range-to" value="${escapeHtml(qTo)}" onchange="applyFilters()" style="${dateStyle}">
      </div>
    </div>
    ${(qVessel || qCrew || qFrom || qTo) ? `<div style="text-align:right;margin-bottom:12px"><a href="/report${qDate ? '?date=' + encodeURIComponent(qDate) : ''}" style="color:#F36D4F;font-size:0.8125rem;text-decoration:none;font-weight:500">✕ Clear filters</a></div>` : ''}`;

  // ── Alerts ──
  const alertsHtml = alerts.rows.length > 0
    ? alerts.rows.map(a => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px;background:#FFFFFF;border-left:4px solid #F36D4F;border-radius:8px;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-weight:600;color:#F36D4F">${escapeHtml(a.item_label)}: ${escapeHtml(String(a.current_value))} / ${escapeHtml(String(a.threshold_value))} minimum</div>
            <div style="font-size:0.8125rem;color:#6e7a74;margin-top:4px">${(a.vessel || '').toUpperCase()} &middot; ${escapeHtml(a.crew_name || '')} &middot; ${escapeHtml(a.template_id)} &middot; ${new Date(a.created_at).toLocaleTimeString()}</div>
          </div>
          <form action="/report/alerts/${a.id}/acknowledge" method="POST" style="display:inline">
            <button type="submit" style="padding:8px 16px;background:#006950;color:white;border:none;border-radius:8px;font-size:0.8125rem;cursor:pointer">Acknowledge</button>
          </form>
        </div>`).join('')
    : '<p style="text-align:center;padding:24px;color:#006950;font-weight:500">All clear &mdash; no alerts.</p>';

  // ── Vessel-Grouped Timeline ──
  const vesselSections = VESSELS
    .filter(v => byVessel.has(v))
    .map(v => {
      const items = byVessel.get(v)!;
      const checklists = items.filter(co => co.template_type === 'checklist');
      const logbooks = items.filter(co => co.template_type === 'logbook');

      // Checklists with alerts or notes get full cards
      const checklistsWithDetail = checklists.filter(co => {
        const hasAlerts = co.alerts_json && (co.alerts_json as any[]).length > 0;
        const hasNotes = co.notes && co.notes.trim();
        const vals = co.values_json || {};
        let hasInlineNotes = false;
        for (const [key, val] of Object.entries(vals)) {
          if (key.startsWith('note_') && val && String(val).trim()) { hasInlineNotes = true; break; }
        }
        return hasAlerts || hasNotes || hasInlineNotes;
      });

      const symbolRow = renderChecklistSymbols(checklists);
      const logbookCards = logbooks.map(renderCompletionCard).join('');
      const detailCards = checklistsWithDetail.map(renderCompletionCard).join('');
      const count = items.length;

      return `
        <div class="vessel-group" data-vessel-group="${v}">
          <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1rem;font-weight:700;color:#006950;padding:8px 0;border-bottom:2px solid #006950;margin-bottom:8px;display:flex;align-items:center;gap:8px">${VESSEL_LABELS[v] || v.toUpperCase()} <span style="font-size:0.75rem;font-weight:500;background:rgba(22,142,110,0.1);color:#006950;padding:2px 8px;border-radius:12px">${count}</span></h3>
          ${symbolRow}
          ${logbookCards}
          ${detailCards}
        </div>`;
    }).join('');

  const emptyState = completions.rows.length === 0
    ? `<p style="text-align:center;color:#6e7a74;padding:24px">No completions${isRange ? ' in this range' : ' for this day'} yet.</p>`
    : '';

  const incidentSummary = incidentCount > 0
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(186,26,26,0.1);color:#ba1a1a;margin-left:8px">&#x26A0;&#xFE0F; ${incidentCount} incident${incidentCount > 1 ? 's' : ''}</span>`
    : '';

  const dateLabel = isRange
    ? `${qFrom ? formatDateDisplay(qFrom) : 'Start'} &mdash; ${qTo ? formatDateDisplay(qTo) : 'Now'}`
    : formatDateDisplay(currentDate);

  return c.html(reportLayout('Today', `
    ${dayNavHtml}

    <div style="margin-bottom:16px">
      <input type="text" id="report-search" placeholder="Search logs... (e.g., oil, engine hours, incident)" style="width:100%;padding:10px 16px;border:2px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.9375rem;background:#FFFFFF;box-sizing:border-box" onfocus="this.style.borderColor='#006950'" onblur="this.style.borderColor='#bdc9c2'">
    </div>

    ${filterBarHtml}

    <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:600;margin:24px 0 12px">Needs Attention ${alerts.rows.length > 0 ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(243,109,79,0.1);color:#F36D4F">${alerts.rows.length}</span>` : ''}</h2>
    <div id="alerts-section">
      ${alertsHtml}
    </div>

    <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:600;margin:24px 0 12px">${isRange ? 'Logs' : "Today's Logs"} ${incidentSummary}</h2>
    <div id="completion-list">
      ${vesselSections}
      ${emptyState}
    </div>
  `));
});

// History — filterable completions with search
app.get('/report/history', async (c) => {
  const vessel = c.req.query('vessel') || '';
  const crewId = c.req.query('crew_id') || '';
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const type = c.req.query('type') || '';
  const search = c.req.query('q') || '';

  let query = `
    SELECT co.*, cr.name as crew_name
    FROM completions co
    JOIN crew cr ON co.crew_id = cr.id
    WHERE 1=1`;
  const params: string[] = [];
  let paramIdx = 1;

  if (vessel) { query += ` AND co.vessel = $${paramIdx++}`; params.push(vessel); }
  if (crewId) { query += ` AND co.crew_id = $${paramIdx++}`; params.push(crewId); }
  if (from) { query += ` AND co.trip_date >= $${paramIdx++}`; params.push(from); }
  if (to) { query += ` AND co.trip_date <= $${paramIdx++}`; params.push(to); }
  if (type) { query += ` AND co.template_type = $${paramIdx++}`; params.push(type); }
  if (search) {
    query += ` AND (co.values_json::text ILIKE $${paramIdx} OR co.notes ILIKE $${paramIdx} OR co.template_id ILIKE $${paramIdx} OR cr.name ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  query += ' ORDER BY co.completed_at DESC LIMIT 100';

  const completions = await pool.query(query, params);
  const crewList = await pool.query('SELECT id, name, role FROM crew WHERE active = TRUE ORDER BY name');

  const activeFilters = [vessel, crewId, from, to, type, search].filter(Boolean).length;

  // Group by vessel
  const byVessel = new Map<string, any[]>();
  for (const co of completions.rows) {
    const v = co.vessel || 'unknown';
    if (!byVessel.has(v)) byVessel.set(v, []);
    byVessel.get(v)!.push(co);
  }

  const vesselSections = VESSELS
    .filter(v => byVessel.has(v))
    .map(v => {
      // Sub-group by date within vessel
      const byDate = new Map<string, any[]>();
      for (const co of byVessel.get(v)!) {
        const d = co.trip_date || 'unknown';
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d)!.push(co);
      }

      const dateSections = Array.from(byDate.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, cos]) => {
          const [y, m, d] = date.split('-').map(Number);
          const dateStr = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          return `
            <div style="margin-bottom:16px">
              <div style="font-size:0.8125rem;font-weight:600;color:#6e7a74;text-transform:uppercase;letter-spacing:0.05em;padding:6px 0">${dateStr}</div>
              ${cos.map(renderCompletionCard).join('')}
            </div>`;
        }).join('');

      return `
        <div class="vessel-group" data-vessel-group="${v}">
          <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1rem;font-weight:700;color:#006950;padding:8px 0;border-bottom:2px solid #006950;margin-bottom:8px;display:flex;align-items:center;gap:8px">${VESSEL_LABELS[v] || v.toUpperCase()} <span style="font-size:0.75rem;font-weight:500;background:rgba(22,142,110,0.1);color:#006950;padding:2px 8px;border-radius:12px">${byVessel.get(v)!.length}</span></h3>
          ${dateSections}
        </div>`;
    }).join('');

  const emptyState = completions.rows.length === 0
    ? '<p style="text-align:center;color:#6e7a74;padding:24px">No completions found.</p>'
    : '';

  // Vessel filter buttons for history (link-based, server-side)
  const vesselFilterBtns = VESSELS.map(v => {
    const isActive = vessel === v;
    const activeStyle = isActive
      ? 'border:2px solid #006950;background:#006950;color:white'
      : 'border:2px solid #bdc9c2;background:#FFFFFF;color:#1a1c1c';
    const params = new URLSearchParams();
    if (!isActive) params.set('vessel', v);
    if (crewId) params.set('crew_id', crewId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (type) params.set('type', type);
    if (search) params.set('q', search);
    const qs = params.toString();
    return `<a href="/report/history${qs ? '?' + qs : ''}" style="padding:8px 14px;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.8125rem;font-weight:600;cursor:pointer;text-decoration:none;${activeStyle}">${VESSEL_LABELS[v] || v.toUpperCase()}</a>`;
  }).join('');

  // Build "All" button URL (preserves other filters, removes vessel)
  const allBtnParams = new URLSearchParams();
  if (crewId) allBtnParams.set('crew_id', crewId);
  if (from) allBtnParams.set('from', from);
  if (to) allBtnParams.set('to', to);
  if (type) allBtnParams.set('type', type);
  if (search) allBtnParams.set('q', search);
  const allBtnQs = allBtnParams.toString();
  const allBtnHref = `/report/history${allBtnQs ? '?' + allBtnQs : ''}`;
  const allBtnStyle = !vessel
    ? 'border:2px solid #006950;background:#006950;color:white'
    : 'border:2px solid #bdc9c2;background:#FFFFFF;color:#1a1c1c';

  return c.html(reportLayout('History', `
    <div style="margin-bottom:16px">
      <form method="GET" action="/report/history" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" name="q" value="${escapeHtml(search)}" placeholder="Search all logs..." style="flex:1;min-width:200px;padding:8px 12px;border:2px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem;background:#FFFFFF" onfocus="this.style.borderColor='#006950'" onblur="this.style.borderColor='#bdc9c2'">
        <select name="crew_id" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem">
          <option value="">All crew</option>
          ${crewList.rows.map(cr => `<option value="${cr.id}" ${crewId === cr.id ? 'selected' : ''}>${escapeHtml(cr.name)} (${cr.role})</option>`).join('')}
        </select>
        <select name="type" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem">
          <option value="">All types</option>
          <option value="checklist" ${type === 'checklist' ? 'selected' : ''}>Checklists</option>
          <option value="logbook" ${type === 'logbook' ? 'selected' : ''}>Logbooks</option>
        </select>
        <input type="date" name="from" value="${from}" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem">
        <input type="date" name="to" value="${to}" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem">
        <button type="submit" style="padding:8px 16px;background:#006950;color:white;border:none;border-radius:8px;font-size:0.8125rem;cursor:pointer">Filter</button>
        ${activeFilters > 0 ? `<a href="/report/history" style="color:#F36D4F;font-size:0.8125rem;text-decoration:none">Clear (${activeFilters})</a>` : ''}
      </form>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
      <a href="${allBtnHref}" style="padding:8px 14px;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.8125rem;font-weight:600;text-decoration:none;${allBtnStyle}">All</a>
      ${vesselFilterBtns}
    </div>

    <div id="completion-list">
      ${vesselSections}
      ${emptyState}
    </div>
  `));
});

// Acknowledge alert
app.post('/report/alerts/:alertId/acknowledge', async (c) => {
  const alertId = c.req.param('alertId');
  await pool.query(
    'UPDATE alerts SET acknowledged_at = NOW() WHERE id = $1',
    [alertId]
  );
  return c.redirect('/report');
});

// Shared layout — all CSS inline, no external stylesheet dependency for reports
function reportLayout(activeTab: string, content: string): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${activeTab} &mdash; Haldo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: #e5fff8;
      color: #1a1c1c;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; }
    .report-page { max-width: 960px; margin: 0 auto; padding: 24px; }
    @media (max-width: 640px) { .report-page { padding: 16px; } }
  </style>
</head>
<body>
  <div class="report-page">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h1 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.5rem;color:#006950">Haldo</h1>
      <span style="font-size:0.875rem;color:#6e7a74">${today}</span>
    </div>
    <nav style="display:flex;gap:16px;margin-bottom:24px;border-bottom:2px solid #bdc9c2">
      <a href="/report" style="padding:8px 0;text-decoration:none;font-weight:500;margin-bottom:-2px;${activeTab === 'Today' ? 'color:#006950;border-bottom:2px solid #006950' : 'color:#6e7a74;border-bottom:2px solid transparent'}">Today</a>
      <a href="/report/history" style="padding:8px 0;text-decoration:none;font-weight:500;margin-bottom:-2px;${activeTab === 'History' ? 'color:#006950;border-bottom:2px solid #006950' : 'color:#6e7a74;border-bottom:2px solid transparent'}">History</a>
    </nav>
    ${content}
  </div>
  <script>
    // Client-side search (instant filter across all fields)
    var searchInput = document.getElementById('report-search');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var q = this.value.toLowerCase().trim();
        document.querySelectorAll('.completion-card').forEach(function(card) {
          var searchable = card.getAttribute('data-searchable') || '';
          card.style.display = (!q || searchable.indexOf(q) !== -1) ? '' : 'none';
        });
        // Hide empty vessel groups
        document.querySelectorAll('.vessel-group').forEach(function(group) {
          var visible = group.querySelectorAll('.completion-card').length;
          var hidden = 0;
          group.querySelectorAll('.completion-card').forEach(function(c) {
            if (c.style.display === 'none') hidden++;
          });
          group.style.display = (visible - hidden) > 0 ? '' : 'none';
        });
      });
    }

    // Apply crew/date-range filters (navigates server-side)
    function applyFilters() {
      var params = new URLSearchParams(window.location.search);
      var vessel = document.getElementById('vessel-filter');
      var crew = document.getElementById('crew-filter');
      var rangeFrom = document.getElementById('range-from');
      var rangeTo = document.getElementById('range-to');

      if (vessel && vessel.value) { params.set('vessel', vessel.value); } else { params.delete('vessel'); }
      if (crew && crew.value) { params.set('crew', crew.value); } else { params.delete('crew'); }
      if (rangeFrom && rangeFrom.value) { params.set('from', rangeFrom.value); params.delete('date'); } else { params.delete('from'); }
      if (rangeTo && rangeTo.value) { params.set('to', rangeTo.value); params.delete('date'); } else { params.delete('to'); }

      var qs = params.toString();
      window.location = '/report' + (qs ? '?' + qs : '');
    }
  </script>
</body>
</html>`;
}

export default app;
