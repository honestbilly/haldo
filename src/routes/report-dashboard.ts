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
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:white;border-left:4px solid #F36D4F;border-radius:0 8px 8px 0;box-shadow:0 4px 12px rgba(0,0,0,0.03);transition:background 0.15s;cursor:pointer" onmouseenter="this.style.background='#FAFBFC'" onmouseleave="this.style.background='white'">
          <div style="display:flex;align-items:center;gap:16px;flex:1">
            <span class="material-symbols-outlined" style="font-size:22px;color:#F36D4F;font-variation-settings:'FILL' 1;flex-shrink:0">warning</span>
            <div>
              <div style="display:flex;align-items:center;gap:8px;font-size:0.875rem">
                <span style="font-weight:700">${(a.vessel || '').toUpperCase()}</span>
                <span style="color:#c7c7cc">|</span>
                <span style="font-weight:500;color:#1A6B8A">${escapeHtml(a.crew_name || '')}</span>
                <span style="color:#c7c7cc">|</span>
                <span style="font-weight:500">${escapeHtml(a.template_id)}</span>
              </div>
              <p style="font-size:0.8125rem;color:#5b5f67;margin-top:4px">${escapeHtml(a.item_label)}: ${escapeHtml(String(a.current_value))} / ${escapeHtml(String(a.threshold_value))} minimum</p>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;flex-shrink:0">
            <span style="font-size:0.75rem;font-weight:500;color:#8E8E93">${new Date(a.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <form action="/report/alerts/${a.id}/acknowledge" method="POST" style="display:inline">
              <button type="submit" style="padding:8px 16px;background:#E5E8F0;color:#1a1c1e;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;transition:background 0.15s" onmouseenter="this.style.background='#D5D8E0'" onmouseleave="this.style.background='#E5E8F0'">Acknowledge</button>
            </form>
          </div>
        </div>`).join('')
    : `<div style="text-align:center;padding:32px;color:#1A6B8A;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px">
        <span class="material-symbols-outlined" style="font-size:20px;color:#34C759;font-variation-settings:'FILL' 1">check_circle</span>
        All clear — no alerts.
      </div>`;

  // -- Activity Table (Stitch pattern: Time | Vessel | Crew | Type | Template | Status) --
  const allRows = completions.rows.sort((a: any, b: any) =>
    new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime()
  );

  const typeLabels: Record<string, { label: string; bg: string; color: string }> = {
    'checklist': { label: 'Checklist', bg: '#E5E8F0', color: '#5b5f67' },
    'logbook': { label: 'Logbook', bg: 'rgba(26,107,138,0.1)', color: '#1A6B8A' },
    'log': { label: 'Log Entry', bg: 'rgba(112,208,235,0.15)', color: '#0C7DA0' },
  };

  const tableRows = allRows.map((co: any) => {
    const time = co.completed_at
      ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      : '';
    const vessel = (co.vessel || '').toUpperCase();
    const crew = co.crew_name || '';
    const typeInfo = typeLabels[co.template_type] || typeLabels['checklist'];
    const templateName = co.template_id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const hasAlerts = co.alerts_json && (co.alerts_json as any[]).length > 0;
    const vals = co.values_json || {};
    const itemCount = Object.keys(vals).filter(k => !k.startsWith('note_')).length;
    const totalItems = co.template_type === 'checklist' ? (vals._total || itemCount) : itemCount;
    const checkedCount = Object.values(vals).filter(v => v === true || v === 'on').length;

    // Extract key details for preview
    const pax = vals['t1-pax'] || vals['guest-count'] || '';
    const notes = vals['t1-notes'] || vals['trip-highlights'] || co.notes || '';
    const previewText = pax ? `Pax: ${pax}` : (notes ? String(notes).substring(0, 50) : '');

    return `
      <tr class="log-row completion-card" data-searchable="${escapeHtml(JSON.stringify(vals).toLowerCase() + ' ' + crew)}" data-vessel="${co.vessel || ''}" style="cursor:pointer;border-bottom:1px solid #F0F0F0">
        <td style="padding:16px 20px;font-size:0.8125rem;font-weight:500;color:#8E8E93;white-space:nowrap;vertical-align:top">${time}</td>
        <td style="padding:16px 12px;font-weight:700;font-size:0.875rem;vertical-align:top">${vessel}</td>
        <td style="padding:16px 12px;font-size:0.875rem;font-weight:500;vertical-align:top">${escapeHtml(crew)}</td>
        <td style="padding:16px 12px;vertical-align:top">
          <span style="font-size:0.6875rem;font-weight:700;background:${typeInfo.bg};color:${typeInfo.color};padding:3px 8px;border-radius:999px">${typeInfo.label}</span>
        </td>
        <td style="padding:16px 12px;font-size:0.875rem;vertical-align:top">
          <div>${escapeHtml(templateName.replace(/\s+Captain|\s+Deckhand|\s+Mate/i, ''))}</div>
          ${previewText ? `<div style="font-size:0.75rem;color:#8E8E93;margin-top:2px">${escapeHtml(previewText)}</div>` : ''}
        </td>
        <td style="padding:16px 12px;vertical-align:top">
          <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;font-weight:700;color:${hasAlerts ? '#F36D4F' : '#34C759'}">
            <span class="material-symbols-outlined" style="font-size:16px;font-variation-settings:'FILL' 1">${hasAlerts ? 'warning' : 'check_circle'}</span>
            ${hasAlerts ? 'Flagged' : 'Complete'}
          </div>
        </td>
      </tr>`;
  }).join('');

  const vesselSections = allRows.length > 0 ? `
    <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#F3F4F3">
            <th style="padding:12px 20px;text-align:left;font-size:0.625rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#8E8E93">Time</th>
            <th style="padding:12px;text-align:left;font-size:0.625rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#8E8E93">Vessel</th>
            <th style="padding:12px;text-align:left;font-size:0.625rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#8E8E93">Crew</th>
            <th style="padding:12px;text-align:left;font-size:0.625rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#8E8E93">Type</th>
            <th style="padding:12px;text-align:left;font-size:0.625rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#8E8E93">Template</th>
            <th style="padding:12px;text-align:left;font-size:0.625rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#8E8E93">Status</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>` : '';

  const emptyState = completions.rows.length === 0
    ? `<p style="text-align:center;color:#6e7a74;padding:24px">No completions${isRange ? ' in this range' : ' for this day'} yet.</p>`
    : '';

  const incidentSummary = incidentCount > 0
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(186,26,26,0.1);color:#ba1a1a;margin-left:8px">&#x26A0;&#xFE0F; ${incidentCount} incident${incidentCount > 1 ? 's' : ''}</span>`
    : '';

  return c.html(reportLayout('Today', `
    ${dayNavHtml}

    <!-- Search (Stitch pattern: clean input with icon) -->
    <div style="position:relative;margin-bottom:20px">
      <span class="material-symbols-outlined" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);font-size:20px;color:#8E8E93">search</span>
      <input type="text" id="report-search" placeholder="Search logs... (e.g., oil, engine hours, incident)" style="width:100%;padding:12px 16px 12px 44px;border:none;border-radius:12px;font-family:'Inter',-apple-system,sans-serif;font-size:0.875rem;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;outline:none" onfocus="this.style.boxShadow='0 0 0 2px #1A6B8A'" onblur="this.style.boxShadow='0 1px 3px rgba(0,0,0,0.04)'">
    </div>

    ${filterBarHtml}

    <!-- Alerts Section (Stitch pattern: left border rows) -->
    <section style="margin-bottom:32px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.0625rem;font-weight:700;letter-spacing:-0.01em">Alerts</h3>
        ${alerts.rows.length > 0 ? `<span style="background:#F36D4F;color:white;font-size:0.625rem;font-weight:700;padding:2px 8px;border-radius:999px">${alerts.rows.length}</span>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${alertsHtml}
      </div>
    </section>

    <!-- Activity Log (Stitch pattern: clean table-like rows) -->
    <section>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.0625rem;font-weight:700;letter-spacing:-0.01em">${isRange ? 'Logs' : "Today's Logs"}</h3>
        ${incidentSummary}
      </div>
      <div id="completion-list">
        ${vesselSections}
        ${emptyState}
      </div>
    </section>
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
