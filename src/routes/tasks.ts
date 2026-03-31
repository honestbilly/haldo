// Crew-facing task views: queue, detail, claim, status update
// Rebuilt from Stitch HTML patterns
import { Hono } from 'hono';
import pool from '../db.js';
import { getSession } from './session.js';
import { htmlHead, bottomNav } from '../ui.js';
import type { SessionData } from '../types.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PRIORITY_ICON: Record<string, string> = {
  urgent: '<span class="material-symbols-outlined" style="font-size:20px;color:#FF3B30;font-variation-settings:\'FILL\' 1">error</span>',
  high: '<span class="material-symbols-outlined" style="font-size:20px;color:#FF9500;font-variation-settings:\'FILL\' 1">warning</span>',
  medium: '',
  low: '',
};

const PRIORITY_BORDER: Record<string, string> = {
  urgent: '#FF3B30', high: '#FF9500', medium: '#70D0EB', low: '#c7c7cc',
};

// ─── Task Queue ─────────────────────────────────────────────

app.get('/queue', async (c) => {
  const session = c.get('session');
  const result = await pool.query(
    `SELECT t.* FROM assigned_tasks t
     WHERE (t.vessel = $1 OR t.vessel IS NULL)
       AND t.assigned_to IS NULL
       AND t.status NOT IN ('completed', 'cancelled', 'snoozed')
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       t.due_date ASC NULLS LAST`,
    [session.vessel]
  );
  const tasks = result.rows;

  const taskCards = tasks.map((t: any) => {
    const icon = PRIORITY_ICON[t.priority] || '';
    const borderColor = PRIORITY_BORDER[t.priority] || '#70D0EB';
    const dueStr = t.due_date ? `<div style="display:flex;align-items:center;gap:4px"><span class="material-symbols-outlined" style="font-size:14px">calendar_today</span> Due ${new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>` : '';
    const estStr = t.estimated_minutes ? `<div style="display:flex;align-items:center;gap:4px"><span class="material-symbols-outlined" style="font-size:14px">schedule</span> ~${t.estimated_minutes}min</div>` : '';

    return `
      <a href="/tasks/${t.id}" style="display:block;text-decoration:none;color:#1a1c1e;position:relative;background:white;border-radius:12px;box-shadow:0 8px 24px rgba(26,28,31,0.06);overflow:hidden;min-height:54px;border-left:4px solid ${borderColor};margin-bottom:12px;transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
        <div style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              ${icon}
              <h3 style="font-weight:700;font-size:0.9375rem;line-height:1.3">${esc(t.title)}</h3>
            </div>
            <span style="font-size:0.625rem;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93">${t.vessel ? t.vessel.toUpperCase() : 'ANY'}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:0.75rem;font-weight:500;color:#5b5f67;margin-bottom:12px">
            ${dueStr}${estStr}
          </div>
          <div style="display:flex;justify-content:flex-end">
            <span style="color:#1A6B8A;font-weight:700;font-size:0.875rem;display:flex;align-items:center;gap:4px">
              Claim <span class="material-symbols-outlined" style="font-size:18px">arrow_forward</span>
            </span>
          </div>
        </div>
      </a>`;
  }).join('');

  return c.html(`${htmlHead('Task Queue')}
<body style="background:#F2F2F7">
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:64px">
    <a href="/today" style="color:#1A6B8A;text-decoration:none;font-weight:600;font-size:0.875rem;display:flex;align-items:center;gap:4px">
      <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Home
    </a>
    <span style="font-weight:700;font-size:1rem;color:#1a1c1e">Available Tasks</span>
    <span style="font-size:0.6875rem;font-weight:700;color:#1A6B8A;background:rgba(26,107,138,0.08);padding:4px 10px;border-radius:10px;text-transform:uppercase;letter-spacing:0.05em">${session.vessel.toUpperCase()}</span>
  </header>

  <main style="padding:80px 24px 120px;max-width:480px;margin:0 auto">
    <p style="font-size:0.9375rem;color:#5b5f67;margin-bottom:24px;line-height:1.5">Tasks that need someone to pick them up. Tap to see details and claim.</p>

    ${tasks.length === 0
      ? '<div style="text-align:center;color:#8E8E93;padding:48px 0"><span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:12px;color:#c7c7cc">task_alt</span>No tasks available right now.</div>'
      : taskCards}
  </main>
  ${bottomNav('tasks')}
</body></html>`);
});

// ─── Task Detail ────────────────────────────────────────────

app.get('/:id', async (c) => {
  const session = c.get('session');
  const taskId = c.req.param('id');
  const result = await pool.query(
    `SELECT t.*, ca.name as assignee_name
     FROM assigned_tasks t
     LEFT JOIN crew ca ON t.assigned_to = ca.id
     WHERE t.id = $1`,
    [taskId]
  );
  const task = result.rows[0];
  if (!task) {
    return c.html(`${htmlHead('Not Found')}<body style="background:#F2F2F7"><div style="max-width:480px;margin:0 auto;padding:80px 24px;text-align:center"><span class="material-symbols-outlined" style="font-size:48px;color:#c7c7cc">search_off</span><p style="margin-top:12px;color:#8E8E93">Task not found.</p><a href="/today" style="color:#1A6B8A;font-weight:600;display:block;margin-top:16px">← Home</a></div>${bottomNav('tasks')}</body></html>`);
  }

  const isMyTask = task.assigned_to === session.crew_id;
  const isUnassigned = !task.assigned_to;
  const vesselMatch = !task.vessel || task.vessel === session.vessel;
  const saved = c.req.query('saved') === '1';

  const priorityColors: Record<string, { color: string; bg: string }> = {
    urgent: { color: '#FF3B30', bg: 'rgba(255,59,48,0.1)' },
    high: { color: '#FF9500', bg: 'rgba(255,149,0,0.1)' },
    medium: { color: '#5b5f67', bg: 'rgba(91,95,103,0.08)' },
    low: { color: '#8E8E93', bg: 'rgba(142,142,147,0.08)' },
  };
  const pc = priorityColors[task.priority] || priorityColors.medium;
  const dueStr = task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null;

  // Status badge
  const statusMap: Record<string, { label: string; color: string; bg: string }> = {
    'pending': { label: isUnassigned ? 'UNCLAIMED' : 'TO DO', color: '#8E8E93', bg: 'rgba(142,142,147,0.1)' },
    'in-progress': { label: 'IN PROGRESS', color: '#1A6B8A', bg: 'rgba(26,107,138,0.1)' },
    'blocked': { label: 'BLOCKED', color: '#FF3B30', bg: 'rgba(255,59,48,0.1)' },
    'completed': { label: 'DONE', color: '#34C759', bg: 'rgba(52,199,89,0.1)' },
  };
  const st = statusMap[task.status] || statusMap.pending;

  // Action button
  let actionHtml = '';
  if (isUnassigned && vesselMatch && task.status === 'pending') {
    actionHtml = `
      <form action="/tasks/${task.id}/claim" method="POST" style="margin-top:24px">
        <button type="submit" style="width:100%;height:54px;background:#1A6B8A;color:white;border:none;border-radius:12px;font-family:'Manrope',sans-serif;font-size:1.0625rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px rgba(26,107,138,0.25);transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:20px">person_add</span> I'll Take This
        </button>
      </form>`;
  } else if (isMyTask && task.status === 'pending') {
    actionHtml = `
      <form action="/tasks/${task.id}/status" method="POST" style="margin-top:24px">
        <input type="hidden" name="status" value="in-progress">
        <button type="submit" style="width:100%;height:54px;background:#1A6B8A;color:white;border:none;border-radius:12px;font-family:'Manrope',sans-serif;font-size:1.0625rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px rgba(26,107,138,0.25);transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:20px">play_arrow</span> Start Working
        </button>
      </form>`;
  } else if (isMyTask && task.status === 'in-progress') {
    actionHtml = `
      <form action="/tasks/${task.id}/status" method="POST" style="margin-top:24px">
        <input type="hidden" name="status" value="completed">
        <button type="submit" style="width:100%;height:54px;background:#F36D4F;color:white;border:none;border-radius:12px;font-family:'Manrope',sans-serif;font-size:1.0625rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px rgba(243,109,79,0.3);transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:20px;font-variation-settings:'FILL' 1">check_circle</span> Mark Complete
        </button>
      </form>`;
  }

  return c.html(`${htmlHead('Task Detail')}
<body style="background:#F2F2F7">
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:64px">
    <a href="/today" style="color:#1A6B8A;text-decoration:none;font-weight:600;font-size:0.875rem;display:flex;align-items:center;gap:4px">
      <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Home
    </a>
    <span style="font-weight:700;font-size:1rem;color:#1a1c1e">Task</span>
    <span style="font-size:0.6875rem;font-weight:700;color:#1A6B8A;background:rgba(26,107,138,0.08);padding:4px 10px;border-radius:10px;text-transform:uppercase;letter-spacing:0.05em">${task.vessel ? task.vessel.toUpperCase() : 'ANY'}</span>
  </header>

  <main style="padding:80px 24px 120px;max-width:480px;margin:0 auto">
    ${saved ? '<div style="padding:12px;background:rgba(52,199,89,0.1);border-radius:12px;margin-bottom:16px;font-size:0.875rem;color:#34C759;text-align:center;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px"><span class="material-symbols-outlined" style="font-size:18px;font-variation-settings:\'FILL\' 1">check_circle</span> Updated</div>' : ''}

    <!-- Main Card -->
    <section style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <h1 style="font-family:'Manrope',sans-serif;font-size:1.375rem;font-weight:800;color:#1a1c1e;flex:1;line-height:1.3">${esc(task.title)}</h1>
        <span style="font-size:0.5625rem;font-weight:800;padding:4px 10px;border-radius:999px;background:${st.bg};color:${st.color};text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;margin-left:12px">${st.label}</span>
      </div>

      ${task.description ? `<p style="font-size:0.9375rem;line-height:1.6;color:#1a1c1e;margin-bottom:16px">${esc(task.description)}</p>` : ''}

      <!-- Info Grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr${task.estimated_minutes ? ' 1fr' : ''};gap:8px;margin-bottom:${task.assigned_to || dueStr ? '12px' : '0'}">
        <div style="background:#F2F2F7;padding:12px;border-radius:10px">
          <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93;margin-bottom:4px">Priority</div>
          <div style="font-size:0.9375rem;font-weight:600;color:${pc.color}">${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</div>
        </div>
        <div style="background:#F2F2F7;padding:12px;border-radius:10px">
          <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93;margin-bottom:4px">Vessel</div>
          <div style="font-size:0.9375rem;font-weight:600">${task.vessel ? task.vessel.toUpperCase() : 'Any'}</div>
        </div>
        ${task.estimated_minutes ? `<div style="background:#F2F2F7;padding:12px;border-radius:10px">
          <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93;margin-bottom:4px">Est. Time</div>
          <div style="font-size:0.9375rem;font-weight:600">~${task.estimated_minutes} min</div>
        </div>` : ''}
      </div>

      ${task.assigned_to || dueStr ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:#F2F2F7;padding:12px;border-radius:10px">
          <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93;margin-bottom:4px">Assigned To</div>
          <div style="font-size:0.9375rem;font-weight:600">${task.assignee_name || (isUnassigned ? '<span style="color:#8E8E93;font-style:italic;font-weight:400">Unclaimed</span>' : 'Unknown')}</div>
        </div>
        ${dueStr ? `<div style="background:#F2F2F7;padding:12px;border-radius:10px">
          <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93;margin-bottom:4px">Due</div>
          <div style="font-size:0.9375rem;font-weight:600">${dueStr}</div>
        </div>` : ''}
      </div>` : ''}
    </section>

    <!-- Notes -->
    ${task.notes ? `
    <section style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin-bottom:16px">
      <h3 style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93;margin-bottom:8px">
        <span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px">note</span> Notes
      </h3>
      <div style="font-size:0.9375rem;line-height:1.6;white-space:pre-wrap;color:#1a1c1e">${esc(task.notes)}</div>
    </section>` : ''}

    ${actionHtml}
  </main>
  ${bottomNav('tasks')}
</body></html>`);
});

// ─── Claim Task ─────────────────────────────────────────────

app.post('/:id/claim', async (c) => {
  const session = c.get('session');
  const taskId = c.req.param('id');
  await pool.query(
    `UPDATE assigned_tasks SET assigned_to = $1, updated_at = NOW()
     WHERE id = $2 AND assigned_to IS NULL`,
    [session.crew_id, taskId]
  );
  return c.redirect(`/tasks/${taskId}?saved=1`);
});

// ─── Update Status ──────────────────────────────────────────

app.post('/:id/status', async (c) => {
  const session = c.get('session');
  const taskId = c.req.param('id');
  const body = await c.req.parseBody();
  const newStatus = String(body.status || 'pending');

  if (newStatus === 'completed') {
    await pool.query(
      `UPDATE assigned_tasks SET status = $1, completed_at = NOW(), completed_by = $2, updated_at = NOW()
       WHERE id = $3`,
      [newStatus, session.crew_id, taskId]
    );
  } else {
    await pool.query(
      `UPDATE assigned_tasks SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, taskId]
    );
  }

  return c.redirect(`/tasks/${taskId}?saved=1`);
});

export default app;
