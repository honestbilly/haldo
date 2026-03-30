import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import pool from '../db.js';

const app = new Hono();

// Basic auth for all report routes
app.use('/report/*', async (c, next) => {
  const user = process.env.REPORT_USER || 'billy';
  const pass = process.env.REPORT_PASS;
  if (!pass) {
    // If no password set, allow access (dev mode)
    return next();
  }
  const auth = basicAuth({ username: user, password: pass });
  return auth(c, next);
});

app.use('/report', async (c, next) => {
  const user = process.env.REPORT_USER || 'billy';
  const pass = process.env.REPORT_PASS;
  if (!pass) return next();
  const auth = basicAuth({ username: user, password: pass });
  return auth(c, next);
});

// Dashboard — today's activity + alerts
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
    : '<p class="no-alerts">All clear — no alerts today.</p>';

  const completionsHtml = completions.rows.length > 0
    ? completions.rows.map(co => `
        <tr>
          <td>${co.completed_at ? new Date(co.completed_at).toLocaleTimeString() : '—'}</td>
          <td>${co.vessel?.toUpperCase()}</td>
          <td>${co.crew_name}</td>
          <td>${co.template_id}</td>
          <td>${co.trip_slot || '—'}</td>
          <td>${co.alerts_json ? `<span class="badge badge-warning">⚠ ${(co.alerts_json as any[]).length} flagged</span>` : '<span class="badge badge-success">✓ Complete</span>'}</td>
        </tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;color:#6B7280;padding:24px">No completions today yet.</td></tr>';

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Report — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="report-page">
    <div class="report-header">
      <h1>Haldo</h1>
      <span>${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
    </div>

    <nav class="report-nav">
      <a href="/report" class="active">Today</a>
      <a href="/report/history">History</a>
    </nav>

    <h2 class="section-title">Needs Attention ${alerts.rows.length > 0 ? `<span class="badge badge-warning">${alerts.rows.length}</span>` : ''}</h2>
    ${alertsHtml}

    <h2 class="section-title">Today's Activity</h2>
    <table class="completions-table">
      <thead>
        <tr><th>Time</th><th>Vessel</th><th>Crew</th><th>Template</th><th>Trip</th><th>Status</th></tr>
      </thead>
      <tbody>${completionsHtml}</tbody>
    </table>
  </div>
</body>
</html>`);
});

// History — filterable completions
app.get('/report/history', async (c) => {
  const vessel = c.req.query('vessel') || '';
  const crewId = c.req.query('crew_id') || '';
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const type = c.req.query('type') || '';

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

  query += ' ORDER BY co.completed_at DESC LIMIT 50';

  const completions = await pool.query(query, params);
  const crewList = await pool.query('SELECT id, name, role FROM crew WHERE active = TRUE ORDER BY name');

  const activeFilters = [vessel, crewId, from, to, type].filter(Boolean).length;

  const rowsHtml = completions.rows.map(co => `
    <tr>
      <td>${co.trip_date || '—'}</td>
      <td>${co.vessel?.toUpperCase()}</td>
      <td>${co.crew_name}</td>
      <td>${co.template_id}</td>
      <td>${co.template_type}</td>
      <td>${co.trip_slot || '—'}</td>
      <td>${co.alerts_json ? `<span class="badge badge-warning">⚠ ${(co.alerts_json as any[]).length}</span>` : '<span class="badge badge-success">✓</span>'}</td>
    </tr>`).join('');

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>History — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="report-page">
    <div class="report-header">
      <h1>Haldo</h1>
    </div>

    <nav class="report-nav">
      <a href="/report">Today</a>
      <a href="/report/history" class="active">History</a>
    </nav>

    <div class="filter-bar">
      <form method="GET" action="/report/history" style="display:contents">
        <select name="vessel">
          <option value="">All vessels</option>
          <option value="squid" ${vessel === 'squid' ? 'selected' : ''}>SQUID</option>
          <option value="blu-q" ${vessel === 'blu-q' ? 'selected' : ''}>Blu Q</option>
          <option value="cowfish" ${vessel === 'cowfish' ? 'selected' : ''}>Cowfish</option>
          <option value="scout" ${vessel === 'scout' ? 'selected' : ''}>Scout</option>
          <option value="java-cat" ${vessel === 'java-cat' ? 'selected' : ''}>Java Cat</option>
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
        <input type="date" name="from" value="${from}" placeholder="From">
        <input type="date" name="to" value="${to}" placeholder="To">
        <button type="submit" class="ack-btn">Filter</button>
        ${activeFilters > 0 ? `<a href="/report/history" class="filter-clear">Clear all (${activeFilters})</a>` : ''}
      </form>
    </div>

    <table class="completions-table">
      <thead>
        <tr><th>Date</th><th>Vessel</th><th>Crew</th><th>Template</th><th>Type</th><th>Trip</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#6B7280;padding:24px">No completions found.</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`);
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
