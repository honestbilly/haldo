// Manager dashboard: today view, history view, alert acknowledge
import { Hono } from 'hono';
import pool from '../db.js';
import {
  VESSELS, VESSEL_LABELS, escapeHtml, formatDateDisplay, shiftDate,
  buildReportUrl, renderCompletionCard, renderChecklistSymbols, reportLayout,
} from '../lib/report-shared.js';

const app = new Hono();

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

  // -- Day Navigation --
  const dayNavHtml = `
    <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin:16px 0">
      <a href="${buildReportUrl({ date: prevDate }, baseParams)}" style="text-decoration:none;font-size:1.25rem;color:#1A6B8A;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid #bdc9c2;background:#FFFFFF">&larr;</a>
      <input type="date" value="${currentDate}" onchange="var p=new URLSearchParams(window.location.search);p.set('date',this.value);p.delete('from');p.delete('to');window.location='/report?'+p.toString()" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.9375rem;background:#FFFFFF;color:#1a1c1c">
      <a href="${buildReportUrl({ date: nextDate }, baseParams)}" style="text-decoration:none;font-size:1.25rem;color:#1A6B8A;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid #bdc9c2;background:#FFFFFF">&rarr;</a>
    </div>
    <div style="text-align:center;font-size:0.8125rem;color:#6e7a74;margin-bottom:8px">${formatDateDisplay(currentDate)}</div>`;

  // -- Filter Bar — compact dropdowns for mobile --
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
        ${crewList.rows.map((cr: any) => `<option value="${cr.id}" ${qCrew === cr.id ? 'selected' : ''}>${escapeHtml(cr.name)} (${cr.role})</option>`).join('')}
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

  // -- Alerts --
  const alertsHtml = alerts.rows.length > 0
    ? alerts.rows.map((a: any) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px;background:#FFFFFF;border-left:4px solid #F36D4F;border-radius:8px;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-weight:600;color:#F36D4F">${escapeHtml(a.item_label)}: ${escapeHtml(String(a.current_value))} / ${escapeHtml(String(a.threshold_value))} minimum</div>
            <div style="font-size:0.8125rem;color:#6e7a74;margin-top:4px">${(a.vessel || '').toUpperCase()} &middot; ${escapeHtml(a.crew_name || '')} &middot; ${escapeHtml(a.template_id)} &middot; ${new Date(a.created_at).toLocaleTimeString()}</div>
          </div>
          <form action="/report/alerts/${a.id}/acknowledge" method="POST" style="display:inline">
            <button type="submit" style="padding:8px 16px;background:#1A6B8A;color:white;border:none;border-radius:8px;font-size:0.8125rem;cursor:pointer">Acknowledge</button>
          </form>
        </div>`).join('')
    : '<p style="text-align:center;padding:24px;color:#1A6B8A;font-weight:500">All clear &mdash; no alerts.</p>';

  // -- Vessel-Grouped Timeline --
  const vesselSections = VESSELS
    .filter(v => byVessel.has(v))
    .map(v => {
      const items = byVessel.get(v)!;
      const checklists = items.filter(co => co.template_type === 'checklist');
      const logbooks = items.filter(co => co.template_type === 'logbook');
      const freeFormLogs = items.filter(co => co.template_type === 'log');

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

      // Free-form log entries — inline in timeline
      const freeFormHtml = freeFormLogs.map(co => {
        const vals = co.values_json || {};
        const title = vals.title || 'Log Entry';
        const category = vals.category || 'general';
        const details = vals.details || co.notes || '';
        const logTime = co.completed_at
          ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          : '';
        const catIcons: Record<string, string> = { maintenance: '🔧', safety: '⚠️', equipment: '⚙️', operational: '🚢', general: '📝' };
        const icon = catIcons[category] || '📝';
        return `
          <div class="completion-card" data-searchable="${escapeHtml(JSON.stringify(vals).toLowerCase() + ' ' + (co.crew_name || ''))}" data-vessel="${co.vessel || ''}"
            style="background:#FFFFFF;border-radius:10px;padding:12px 16px;margin-bottom:8px;border-left:4px solid #70D0EB">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div style="font-weight:600;font-size:0.875rem">${icon} ${escapeHtml(String(title))}</div>
              <div style="font-size:0.75rem;color:#6e7a74;flex-shrink:0">${logTime} · ${escapeHtml(co.crew_name || '')}</div>
            </div>
            ${details ? `<p style="font-size:0.8125rem;color:#1a1c1c;margin-top:4px;line-height:1.5">${escapeHtml(String(details))}</p>` : ''}
          </div>`;
      }).join('');
      const count = items.length;

      return `
        <div class="vessel-group" data-vessel-group="${v}">
          <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1rem;font-weight:700;color:#1A6B8A;padding:8px 0;border-bottom:2px solid #1A6B8A;margin-bottom:8px;display:flex;align-items:center;gap:8px">${VESSEL_LABELS[v] || v.toUpperCase()} <span style="font-size:0.75rem;font-weight:500;background:rgba(22,142,110,0.1);color:#1A6B8A;padding:2px 8px;border-radius:12px">${count}</span></h3>
          ${symbolRow}
          ${logbookCards}
          ${freeFormHtml}
          ${detailCards}
        </div>`;
    }).join('');

  const emptyState = completions.rows.length === 0
    ? `<p style="text-align:center;color:#6e7a74;padding:24px">No completions${isRange ? ' in this range' : ' for this day'} yet.</p>`
    : '';

  const incidentSummary = incidentCount > 0
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(186,26,26,0.1);color:#ba1a1a;margin-left:8px">&#x26A0;&#xFE0F; ${incidentCount} incident${incidentCount > 1 ? 's' : ''}</span>`
    : '';

  return c.html(reportLayout('Today', `
    ${dayNavHtml}

    <div style="margin-bottom:16px">
      <input type="text" id="report-search" placeholder="Search logs... (e.g., oil, engine hours, incident)" style="width:100%;padding:10px 16px;border:2px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.9375rem;background:#FFFFFF;box-sizing:border-box" onfocus="this.style.borderColor='#1A6B8A'" onblur="this.style.borderColor='#bdc9c2'">
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
          <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1rem;font-weight:700;color:#1A6B8A;padding:8px 0;border-bottom:2px solid #1A6B8A;margin-bottom:8px;display:flex;align-items:center;gap:8px">${VESSEL_LABELS[v] || v.toUpperCase()} <span style="font-size:0.75rem;font-weight:500;background:rgba(22,142,110,0.1);color:#1A6B8A;padding:2px 8px;border-radius:12px">${byVessel.get(v)!.length}</span></h3>
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
      ? 'border:2px solid #1A6B8A;background:#1A6B8A;color:white'
      : 'border:2px solid #bdc9c2;background:#FFFFFF;color:#1a1c1c';
    const linkParams = new URLSearchParams();
    if (!isActive) linkParams.set('vessel', v);
    if (crewId) linkParams.set('crew_id', crewId);
    if (from) linkParams.set('from', from);
    if (to) linkParams.set('to', to);
    if (type) linkParams.set('type', type);
    if (search) linkParams.set('q', search);
    const qs = linkParams.toString();
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
    ? 'border:2px solid #1A6B8A;background:#1A6B8A;color:white'
    : 'border:2px solid #bdc9c2;background:#FFFFFF;color:#1a1c1c';

  return c.html(reportLayout('History', `
    <div style="margin-bottom:16px">
      <form method="GET" action="/report/history" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" name="q" value="${escapeHtml(search)}" placeholder="Search all logs..." style="flex:1;min-width:200px;padding:8px 12px;border:2px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem;background:#FFFFFF" onfocus="this.style.borderColor='#1A6B8A'" onblur="this.style.borderColor='#bdc9c2'">
        <select name="crew_id" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem">
          <option value="">All crew</option>
          ${crewList.rows.map((cr: any) => `<option value="${cr.id}" ${crewId === cr.id ? 'selected' : ''}>${escapeHtml(cr.name)} (${cr.role})</option>`).join('')}
        </select>
        <select name="type" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem">
          <option value="">All types</option>
          <option value="checklist" ${type === 'checklist' ? 'selected' : ''}>Checklists</option>
          <option value="logbook" ${type === 'logbook' ? 'selected' : ''}>Logbooks</option>
        </select>
        <input type="date" name="from" value="${from}" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem">
        <input type="date" name="to" value="${to}" style="padding:8px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem">
        <button type="submit" style="padding:8px 16px;background:#1A6B8A;color:white;border:none;border-radius:8px;font-size:0.8125rem;cursor:pointer">Filter</button>
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

export default app;
