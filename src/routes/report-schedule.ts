// Crew schedule: 7-day forward view + CSV upload
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { VESSEL_LABELS, escapeHtml, reportLayout } from '../lib/report-shared.js';

const app = new Hono();

// 7-day forward crew schedule view
app.get('/report/crew-schedule', async (c) => {
  const today = new Date();
  const days: string[] = [];
  const dayLabels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
    dayLabels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
  }

  // Get all active crew
  const crewResult = await pool.query('SELECT id, name, role FROM crew WHERE active = TRUE ORDER BY role, name');
  const crew = crewResult.rows;

  // Get schedule for the 7-day window
  const schedResult = await pool.query(
    `SELECT cs.*, cr.name as crew_name, cr.role as crew_role
     FROM crew_schedule cs
     JOIN crew cr ON cs.crew_id = cr.id
     WHERE cs.schedule_date >= $1 AND cs.schedule_date <= $2
     ORDER BY cr.role, cr.name, cs.schedule_date`,
    [days[0], days[6]]
  );

  // Build schedule map: crew_id → date → schedule entry
  const schedMap = new Map<string, Map<string, any>>();
  for (const row of schedResult.rows) {
    if (!schedMap.has(row.crew_id)) schedMap.set(row.crew_id, new Map());
    // schedule_date can be a Date object or string — normalize to YYYY-MM-DD
    const dateKey = row.schedule_date instanceof Date
      ? row.schedule_date.toISOString().split('T')[0]
      : String(row.schedule_date).split('T')[0];
    schedMap.get(row.crew_id)!.set(dateKey, row);
  }

  // Get task counts per crew (open tasks assigned)
  const taskCounts = await pool.query(
    `SELECT assigned_to, COUNT(*) as count FROM assigned_tasks WHERE status NOT IN ('completed','cancelled','snoozed') AND assigned_to IS NOT NULL GROUP BY assigned_to`
  );
  const taskMap = Object.fromEntries(taskCounts.rows.map((r: any) => [r.assigned_to, parseInt(r.count)]));

  // Render the grid
  const headerCells = days.map((d, i) => {
    const isToday = i === 0;
    return `<th style="padding:8px 6px;font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${isToday ? '#1A6B8A' : '#8E8E93'};text-align:center;min-width:80px">${dayLabels[i]}</th>`;
  }).join('');

  const crewRows = crew.map((cr: any) => {
    const openTasks = taskMap[cr.id] || 0;
    const cells = days.map((d, i) => {
      const sched = schedMap.get(cr.id)?.get(d);
      const isToday = i === 0;

      if (!sched) {
        return `<td style="padding:8px 6px;text-align:center;font-size:0.75rem;color:#c7c7cc;${isToday ? 'background:rgba(26,107,138,0.03)' : ''}">—</td>`;
      }

      if (sched.shift === 'off') {
        return `<td style="padding:8px 6px;text-align:center;font-size:0.6875rem;font-weight:600;color:#8E8E93;${isToday ? 'background:rgba(26,107,138,0.03)' : ''}">OFF</td>`;
      }

      const vesselLabel = sched.vessel_slug ? (VESSEL_LABELS[sched.vessel_slug] || sched.vessel_slug) : null;
      const shiftLabel = sched.shift === 'full' ? '' : sched.shift === 'am' ? ' AM' : ' PM';

      if (vesselLabel) {
        // Vessel assigned — show vessel pill
        return `<td style="padding:4px 2px;text-align:center;${isToday ? 'background:rgba(26,107,138,0.03)' : ''}">
          <div style="background:#1A6B8A;color:white;border-radius:6px;padding:4px 6px;font-size:0.5625rem;font-weight:700;line-height:1.3">${vesselLabel}${shiftLabel}</div>
        </td>`;
      }
      // No vessel yet — just show they're working (green dot)
      return `<td style="padding:4px 2px;text-align:center;${isToday ? 'background:rgba(26,107,138,0.03)' : ''}">
        <div style="display:flex;align-items:center;justify-content:center;gap:4px">
          <span style="width:8px;height:8px;border-radius:50%;background:#34C759;display:inline-block"></span>
          <span style="font-size:0.5625rem;font-weight:600;color:#34C759">${shiftLabel || 'ON'}</span>
        </div>
      </td>`;
    }).join('');

    const roleLabel = cr.role === 'captain' ? 'Capt.' : 'DH';
    return `
      <tr style="border-bottom:1px solid #F0F0F0">
        <td style="padding:10px 12px;white-space:nowrap;position:sticky;left:0;background:white;z-index:1">
          <div style="font-weight:600;font-size:0.8125rem">${escapeHtml(cr.name)}</div>
          <div style="font-size:0.625rem;color:#8E8E93">${roleLabel}${openTasks > 0 ? ` · ${openTasks} task${openTasks > 1 ? 's' : ''}` : ''}</div>
        </td>
        ${cells}
      </tr>`;
  }).join('');

  const uploaded = c.req.query('uploaded') === '1';
  const uploadCount = c.req.query('count') || '0';

  return c.html(reportLayout('Schedule', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <h2 style="font-family:'Manrope',sans-serif;font-size:1.25rem;font-weight:800">Crew Schedule</h2>
        <p style="font-size:0.8125rem;color:#8E8E93;margin-top:4px">7-day forward view · ${dayLabels[0]} — ${dayLabels[6]}</p>
      </div>
    </div>

    ${uploaded ? `<div style="padding:12px;background:rgba(52,199,89,0.1);border-radius:12px;margin-bottom:16px;font-size:0.875rem;color:#34C759;text-align:center;font-weight:600">✓ Uploaded ${uploadCount} schedule entries</div>` : ''}

    <!-- Schedule Grid -->
    <div style="background:white;border-radius:12px;overflow-x:auto;box-shadow:0 1px 3px rgba(0,0,0,0.04);margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse;min-width:700px">
        <thead>
          <tr style="border-bottom:2px solid #E5E5EA">
            <th style="padding:12px;text-align:left;font-size:0.75rem;font-weight:700;color:#1a1c1e;position:sticky;left:0;background:white;z-index:2;min-width:120px">Crew</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${crewRows || '<tr><td colspan="8" style="padding:32px;text-align:center;color:#8E8E93">No crew found. Add crew members first.</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- CSV Upload -->
    <details style="background:white;border-radius:12px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <summary style="font-weight:700;font-size:0.875rem;cursor:pointer;color:#1A6B8A;display:flex;align-items:center;gap:8px">
        <span class="material-symbols-outlined" style="font-size:20px">upload_file</span> Upload Monthly Schedule (CSV)
      </summary>
      <div style="margin-top:16px">
        <p style="font-size:0.8125rem;color:#5b5f67;line-height:1.5;margin-bottom:12px">
          Upload a CSV with columns: <strong>crew_name, date, shift</strong> (vessel optional)<br>
          Example: <code>Jess, 2026-04-01, full</code><br>
          With vessel: <code>Jess, 2026-04-01, squid, full</code><br>
          Shift options: <code>am</code>, <code>pm</code>, <code>full</code>, <code>off</code><br>
          Vessel is optional — crew are usually assigned to a boat the day before.
        </p>
        <form action="/report/crew-schedule/upload" method="POST" enctype="multipart/form-data">
          <input type="file" name="csv" accept=".csv" required style="margin-bottom:12px;font-size:0.875rem">
          <button type="submit" style="width:100%;height:48px;background:#1A6B8A;color:white;border:none;border-radius:12px;font-weight:700;font-size:0.875rem;cursor:pointer">Upload Schedule</button>
        </form>
      </div>
    </details>
  `));
});

// CSV Upload handler
app.post('/report/crew-schedule/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body.csv;

  if (!file || typeof file === 'string') {
    return c.redirect('/report/crew-schedule');
  }

  const text = await (file as File).text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('crew_name'));

  // Get crew name → ID map
  const crewResult = await pool.query('SELECT id, name FROM crew WHERE active = TRUE');
  const crewByName = new Map<string, string>();
  for (const cr of crewResult.rows) {
    crewByName.set(cr.name.toLowerCase(), cr.id);
  }

  let count = 0;
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 2) continue;

    const crewName = parts[0];
    const dateStr = parts[1];
    const crewId = crewByName.get(crewName.toLowerCase());
    if (!crewId) continue;

    // Validate date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    // Detect format: 3 cols = name,date,shift | 4 cols = name,date,vessel,shift
    const validShifts = ['am', 'pm', 'full', 'off'];
    let vesselSlug: string | null = null;
    let shift = 'full';

    if (parts.length === 3) {
      // Could be name,date,shift OR name,date,vessel
      if (validShifts.includes(parts[2].toLowerCase())) {
        shift = parts[2].toLowerCase();
      } else {
        vesselSlug = parts[2].toLowerCase() || null;
      }
    } else if (parts.length >= 4) {
      vesselSlug = parts[2].toLowerCase() || null;
      shift = validShifts.includes(parts[3].toLowerCase()) ? parts[3].toLowerCase() : 'full';
    }

    await pool.query(
      `INSERT INTO crew_schedule (id, crew_id, schedule_date, vessel_slug, shift)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (crew_id, schedule_date) DO UPDATE SET vessel_slug = $4, shift = $5`,
      [nanoid(), crewId, dateStr, vesselSlug, shift]
    );
    count++;
  }

  return c.redirect(`/report/crew-schedule?uploaded=1&count=${count}`);
});

export default app;
