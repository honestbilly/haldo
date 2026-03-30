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
    // Clean up key name for display
    const label = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const strVal = Array.isArray(val) ? (val as string[]).join(', ') : String(val);
    if (strVal.length > 100) {
      summaryParts.push(`<span class="cv-item"><strong>${label}:</strong> ${escapeHtml(strVal.substring(0, 100))}…</span>`);
    } else {
      summaryParts.push(`<span class="cv-item"><strong>${label}:</strong> ${escapeHtml(strVal)}</span>`);
    }
  }

  const notes = co.notes ? `<div class="cv-notes"><strong>Notes:</strong> ${escapeHtml(co.notes)}</div>` : '';

  const incidentBadge = hasIncident
    ? `<div class="incident-banner">🚨 INCIDENT: ${escapeHtml(String(incidentValue))}${incidentDetails ? ` — ${escapeHtml(String(incidentDetails)).substring(0, 200)}` : ''}</div>`
    : '';

  const alertBadge = hasAlerts
    ? `<span class="badge badge-warning">⚠ ${(co.alerts_json as any[]).length} flagged</span>`
    : '';

  const time = co.completed_at
    ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '—';

  return `
    <div class="completion-card ${hasIncident ? 'has-incident' : ''} ${hasAlerts ? 'has-alerts' : ''}" data-searchable="${escapeHtml(JSON.stringify(values).toLowerCase())} ${co.template_id} ${co.crew_name?.toLowerCase() || ''} ${co.notes?.toLowerCase() || ''}">
      <div class="cc-header">
        <div class="cc-meta">
          <span class="cc-template">${co.template_id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
          <span class="cc-type-badge cc-type-${co.template_type}">${co.template_type}</span>
          ${alertBadge}
        </div>
        <div class="cc-right">
          <span class="cc-crew">${co.crew_name || '—'}</span>
          <span class="cc-time">${time}</span>
          ${co.trip_slot ? `<span class="cc-trip">${co.trip_slot}</span>` : ''}
        </div>
      </div>
      ${incidentBadge}
      <div class="cc-values">${summaryParts.join(' ')}</div>
      ${notes}
    </div>`;
}

// Dashboard — today's activity + alerts, grouped by vessel
app.get('/report', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  const search = c.req.query('q') || '';

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

  // Group completions by vessel
  const byVessel = new Map<string, any[]>();
  for (const co of completions.rows) {
    const v = co.vessel || 'unknown';
    if (!byVessel.has(v)) byVessel.set(v, []);
    byVessel.get(v)!.push(co);
  }

  const alertsHtml = alerts.rows.length > 0
    ? alerts.rows.map(a => `
        <div class="alert-card">
          <div class="alert-card-info">
            <div class="alert-card-item">${a.item_label}: ${a.current_value} / ${a.threshold_value} minimum</div>
            <div class="alert-card-meta">${a.vessel?.toUpperCase()} · ${a.crew_name} · ${a.template_id} · ${new Date(a.created_at).toLocaleTimeString()}</div>
          </div>
          <form action="/report/alerts/${a.id}/acknowledge" method="POST" style="display:inline">
            <button type="submit" class="ack-btn">Acknowledge</button>
          </form>
        </div>`).join('')
    : '<p class="no-alerts">All clear — no alerts.</p>';

  // Render vessel groups
  const vesselSections = VESSELS
    .filter(v => byVessel.has(v))
    .map(v => {
      const cards = byVessel.get(v)!.map(renderCompletionCard).join('');
      return `
        <div class="vessel-group">
          <h3 class="vessel-name">${v.toUpperCase()} <span class="vessel-count">${byVessel.get(v)!.length}</span></h3>
          ${cards}
        </div>`;
    }).join('');

  const emptyState = completions.rows.length === 0
    ? '<p class="empty-state" style="text-align:center;color:#6B7280;padding:24px">No completions today yet.</p>'
    : '';

  return c.html(reportLayout('Today', `
    <div class="search-bar">
      <input type="text" id="report-search" placeholder="Search logs... (e.g., oil, engine hours, incident)" value="${escapeHtml(search)}" class="search-input">
    </div>

    <h2 class="section-title">Needs Attention ${alerts.rows.length > 0 ? `<span class="badge badge-warning">${alerts.rows.length}</span>` : ''}</h2>
    ${alertsHtml}

    <h2 class="section-title">Today's Logs</h2>
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
            <div class="date-group">
              <div class="date-label">${dateStr}</div>
              ${cos.map(renderCompletionCard).join('')}
            </div>`;
        }).join('');

      return `
        <div class="vessel-group">
          <h3 class="vessel-name">${v.toUpperCase()} <span class="vessel-count">${byVessel.get(v)!.length}</span></h3>
          ${dateSections}
        </div>`;
    }).join('');

  const emptyState = completions.rows.length === 0
    ? '<p class="empty-state" style="text-align:center;color:#6B7280;padding:24px">No completions found.</p>'
    : '';

  return c.html(reportLayout('History', `
    <div class="filter-bar">
      <form method="GET" action="/report/history" class="filter-form">
        <input type="text" name="q" value="${escapeHtml(search)}" placeholder="Search all logs..." class="search-input">
        <select name="vessel">
          <option value="">All vessels</option>
          ${VESSELS.map(v => `<option value="${v}" ${vessel === v ? 'selected' : ''}>${v.toUpperCase()}</option>`).join('')}
        </select>
        <select name="crew_id">
          <option value="">All crew</option>
          ${crewList.rows.map(cr => `<option value="${cr.id}" ${crewId === cr.id ? 'selected' : ''}>${cr.name} (${cr.role})</option>`).join('')}
        </select>
        <select name="type">
          <option value="">All types</option>
          <option value="checklist" ${type === 'checklist' ? 'selected' : ''}>Checklists</option>
          <option value="logbook" ${type === 'logbook' ? 'selected' : ''}>Logbooks</option>
        </select>
        <input type="date" name="from" value="${from}">
        <input type="date" name="to" value="${to}">
        <button type="submit" class="ack-btn">Filter</button>
        ${activeFilters > 0 ? `<a href="/report/history" class="filter-clear">Clear (${activeFilters})</a>` : ''}
      </form>
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

// Shared layout
function reportLayout(activeTab: string, content: string): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${activeTab} — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="report-page">
    <div class="report-header">
      <h1>Haldo</h1>
      <span>${today}</span>
    </div>
    <nav class="report-nav">
      <a href="/report" ${activeTab === 'Today' ? 'class="active"' : ''}>Today</a>
      <a href="/report/history" ${activeTab === 'History' ? 'class="active"' : ''}>History</a>
    </nav>
    ${content}
  </div>
  <script>
    // Client-side search for today view (instant filter)
    const searchInput = document.getElementById('report-search');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        const q = this.value.toLowerCase().trim();
        document.querySelectorAll('.completion-card').forEach(card => {
          const searchable = card.getAttribute('data-searchable') || '';
          card.style.display = (!q || searchable.includes(q)) ? '' : 'none';
        });
        // Hide empty vessel groups
        document.querySelectorAll('.vessel-group').forEach(group => {
          const visible = group.querySelectorAll('.completion-card:not([style*="display: none"])').length;
          group.style.display = visible > 0 ? '' : 'none';
        });
      });
    }
  </script>
</body>
</html>`;
}

export default app;
