import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import pool from '../db.js';

const app = new Hono();

// Basic auth for all report routes
const authMiddleware = async (c: any, next: any) => {
  const user = process.env.REPORT_USER || 'billy';
  const pass = process.env.REPORT_PASS;
  if (!pass) return next(); // Dev mode — no auth
  const auth = basicAuth({ username: user, password: pass });
  return auth(c, next);
};

app.use('/report/*', authMiddleware);
app.use('/report', authMiddleware);

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

// Render a condensed completion card — shows key values inline
function renderCompletionCard(co: any): string {
  const values = co.values_json || {};
  const hasAlerts = co.alerts_json && (co.alerts_json as any[]).length > 0;

  // Detect incidents
  const incidentValue = values['incident-occurred'];
  const hasIncident = incidentValue && incidentValue !== 'No incidents';
  const incidentDetails = values['incident-details'] || '';

  // Build condensed summary of key values (skip empty, skip checkbox "true" clutter)
  const summaryParts: string[] = [];
  for (const [key, val] of Object.entries(values)) {
    if (!val || val === '' || val === 'true' || val === 'false') continue;
    if (key === 'incident-occurred' || key === 'incident-details') continue;
    const label = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const strVal = Array.isArray(val) ? (val as string[]).join(', ') : String(val);
    if (strVal.length > 100) {
      summaryParts.push(`<span style="display:inline"><strong style="color:#1a1c1c;font-weight:500">${escapeHtml(label)}:</strong> ${escapeHtml(strVal.substring(0, 100))}&hellip;</span>`);
    } else {
      summaryParts.push(`<span style="display:inline"><strong style="color:#1a1c1c;font-weight:500">${escapeHtml(label)}:</strong> ${escapeHtml(strVal)}</span>`);
    }
  }
  // Join with dot separators via CSS-like approach
  const valuesHtml = summaryParts.length > 0
    ? summaryParts.join('<span style="color:#bdc9c2"> &middot; </span>')
    : '<span style="color:#6e7a74;font-style:italic">No values recorded</span>';

  const notes = co.notes
    ? `<div style="margin-top:6px;font-size:0.8125rem;color:#1a1c1c;font-style:italic;padding:6px 10px;background:#d9f5ed;border-radius:8px"><strong>Notes:</strong> ${escapeHtml(co.notes)}</div>`
    : '';

  const incidentBadge = hasIncident
    ? `<div style="background:#ba1a1a;color:white;font-weight:600;font-size:0.8125rem;padding:8px 12px;border-radius:8px;margin:6px 0">&#x1F6A8; INCIDENT: ${escapeHtml(String(incidentValue))}${incidentDetails ? ` &mdash; ${escapeHtml(String(incidentDetails)).substring(0, 200)}` : ''}</div>`
    : '';

  const alertBadge = hasAlerts
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(243,109,79,0.1);color:#F36D4F">&#9888; ${(co.alerts_json as any[]).length} flagged</span>`
    : '';

  const time = co.completed_at
    ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '&mdash;';

  const typeBadgeBg = co.template_type === 'checklist'
    ? 'background:rgba(22,142,110,0.1);color:#006950'
    : 'background:rgba(112,208,235,0.15);color:#0891b2';

  // Card border + background for incidents
  let cardStyle = 'background:#FFFFFF;border-radius:8px;padding:12px 16px;margin-bottom:8px;border-left:4px solid #006950';
  if (hasIncident) {
    cardStyle = 'background:#FFF5F5;border-radius:8px;padding:12px 16px;margin-bottom:8px;border-left:4px solid #ba1a1a;border:2px solid #F36D4F;border-left:4px solid #ba1a1a';
  } else if (hasAlerts) {
    cardStyle = 'background:#FFFFFF;border-radius:8px;padding:12px 16px;margin-bottom:8px;border-left:4px solid #F36D4F';
  }

  const searchableData = `${JSON.stringify(values).toLowerCase()} ${co.template_id} ${co.crew_name?.toLowerCase() || ''} ${co.notes?.toLowerCase() || ''} ${co.vessel || ''}`;

  return `
    <div class="completion-card" data-searchable="${escapeHtml(searchableData)}" data-vessel="${co.vessel || ''}" style="${cardStyle}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${hasIncident ? '<span style="font-size:1.1rem" title="Incident reported">&#x26A0;&#xFE0F;</span>' : ''}
          <span style="font-weight:600;font-size:0.875rem;color:#1a1c1c">${co.template_id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
          <span style="font-size:0.6875rem;font-weight:500;padding:1px 6px;border-radius:4px;text-transform:uppercase;letter-spacing:0.03em;${typeBadgeBg}">${co.template_type}</span>
          ${alertBadge}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <span style="font-size:0.8125rem;font-weight:500">${co.crew_name || '&mdash;'}</span>
          <span style="font-size:0.75rem;color:#6e7a74">${time}</span>
          ${co.trip_slot ? `<span style="font-size:0.6875rem;background:#d9f5ed;padding:1px 6px;border-radius:4px">${co.trip_slot}</span>` : ''}
        </div>
      </div>
      ${incidentBadge}
      <div style="font-size:0.8125rem;color:#6e7a74;line-height:1.5">${valuesHtml}</div>
      ${notes}
    </div>`;
}

// Dashboard — today's activity + alerts, grouped by vessel
app.get('/report', async (c) => {
  const today = new Date().toISOString().split('T')[0];

  const alerts = await pool.query(
    `SELECT a.*, c.vessel, cr.name as crew_name
     FROM alerts a
     JOIN completions c ON a.completion_id = c.id
     JOIN crew cr ON c.crew_id = cr.id
     WHERE a.acknowledged_at IS NULL
     ORDER BY a.created_at DESC`
  );

  const completions = await pool.query(
    `SELECT co.*, cr.name as crew_name
     FROM completions co
     JOIN crew cr ON co.crew_id = cr.id
     WHERE co.trip_date = $1
     ORDER BY co.completed_at DESC`,
    [today]
  );

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

  // Vessel filter buttons
  const vesselButtons = VESSELS.map(v => {
    const count = byVessel.get(v)?.length || 0;
    return `<button type="button" class="vessel-filter-btn" data-vessel="${v}" style="padding:8px 14px;border:2px solid #bdc9c2;border-radius:8px;background:#FFFFFF;font-family:'Inter',-apple-system,sans-serif;font-size:0.8125rem;font-weight:600;color:#1a1c1c;cursor:pointer;transition:all 0.15s">${VESSEL_LABELS[v] || v.toUpperCase()} <span style="font-weight:400;color:#6e7a74;font-size:0.75rem">${count}</span></button>`;
  }).join('');

  // Render vessel groups
  const vesselSections = VESSELS
    .filter(v => byVessel.has(v))
    .map(v => {
      const cards = byVessel.get(v)!.map(renderCompletionCard).join('');
      const count = byVessel.get(v)!.length;
      return `
        <div class="vessel-group" data-vessel-group="${v}">
          <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1rem;font-weight:700;color:#006950;padding:8px 0;border-bottom:2px solid #006950;margin-bottom:8px;display:flex;align-items:center;gap:8px">${VESSEL_LABELS[v] || v.toUpperCase()} <span style="font-size:0.75rem;font-weight:500;background:rgba(22,142,110,0.1);color:#006950;padding:2px 8px;border-radius:12px">${count}</span></h3>
          ${cards}
        </div>`;
    }).join('');

  const emptyState = completions.rows.length === 0
    ? '<p style="text-align:center;color:#6e7a74;padding:24px">No completions today yet.</p>'
    : '';

  const incidentSummary = incidentCount > 0
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(186,26,26,0.1);color:#ba1a1a;margin-left:8px">&#x26A0;&#xFE0F; ${incidentCount} incident${incidentCount > 1 ? 's' : ''}</span>`
    : '';

  return c.html(reportLayout('Today', `
    <div style="margin-bottom:16px">
      <input type="text" id="report-search" placeholder="Search logs... (e.g., oil, engine hours, incident)" style="width:100%;padding:10px 16px;border:2px solid #bdc9c2;border-radius:8px;font-family:'Inter',-apple-system,sans-serif;font-size:0.9375rem;background:#FFFFFF;box-sizing:border-box" onfocus="this.style.borderColor='#006950'" onblur="this.style.borderColor='#bdc9c2'">
    </div>

    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
      <button type="button" class="vessel-filter-btn active" data-vessel="all" style="padding:8px 14px;border:2px solid #006950;border-radius:8px;background:#006950;font-family:'Inter',-apple-system,sans-serif;font-size:0.8125rem;font-weight:600;color:white;cursor:pointer;transition:all 0.15s">All <span style="font-weight:400;opacity:0.8;font-size:0.75rem">${completions.rows.length}</span></button>
      ${vesselButtons}
    </div>

    <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:600;margin:24px 0 12px">Needs Attention ${alerts.rows.length > 0 ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(243,109,79,0.1);color:#F36D4F">${alerts.rows.length}</span>` : ''}</h2>
    <div id="alerts-section">
      ${alertsHtml}
    </div>

    <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:600;margin:24px 0 12px">Today's Logs ${incidentSummary}</h2>
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

    // Vessel filter buttons (client-side, Today view)
    var activeVesselFilter = 'all';
    document.querySelectorAll('.vessel-filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var vessel = this.getAttribute('data-vessel');
        activeVesselFilter = vessel;

        // Update active state styling
        document.querySelectorAll('.vessel-filter-btn').forEach(function(b) {
          if (b.getAttribute('data-vessel') === vessel) {
            b.style.background = '#006950';
            b.style.borderColor = '#006950';
            b.style.color = 'white';
            b.classList.add('active');
          } else {
            b.style.background = '#FFFFFF';
            b.style.borderColor = '#bdc9c2';
            b.style.color = '#1a1c1c';
            b.classList.remove('active');
          }
        });

        // Filter vessel groups
        document.querySelectorAll('.vessel-group').forEach(function(group) {
          if (vessel === 'all') {
            group.style.display = '';
          } else {
            group.style.display = group.getAttribute('data-vessel-group') === vessel ? '' : 'none';
          }
        });

        // Re-apply search filter if active
        if (searchInput && searchInput.value.trim()) {
          searchInput.dispatchEvent(new Event('input'));
        }
      });
    });
  </script>
</body>
</html>`;
}

export default app;
