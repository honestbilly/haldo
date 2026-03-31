// Crew-facing task views: detail, claim, status update
import { Hono } from 'hono';
import pool from '../db.js';
import { getSession } from './session.js';
import { htmlHead, bottomNav, pageHeader } from '../ui.js';
import type { SessionData } from '../types.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

// Middleware: require session
app.use('*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

const PRIORITY_COLORS: Record<string, string> = {
  low: '#6e7a74', medium: '#1a1c1c', high: '#F36D4F', urgent: '#ba1a1a',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  'pending': { label: 'In Queue', color: '#6e7a74' },
  'in-progress': { label: 'In Progress', color: '#006950' },
  'blocked': { label: 'Blocked', color: '#F36D4F' },
  'completed': { label: 'Done', color: '#006950' },
};

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
    return c.html(`${htmlHead('Task Not Found')}<body><div style="max-width:480px;margin:0 auto;padding:16px"><p>Task not found.</p><a href="/today" style="color:#006950">← Home</a></div>${bottomNav('home')}</body></html>`);
  }

  const isMyTask = task.assigned_to === session.crew_id;
  const isUnassigned = !task.assigned_to;
  const vesselMatch = !task.vessel || task.vessel === session.vessel;
  const saved = c.req.query('saved') === '1';

  const status = STATUS_LABELS[task.status] || STATUS_LABELS['pending'];
  const priorityColor = PRIORITY_COLORS[task.priority] || '#1a1c1c';
  const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
  const dueStr = task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null;

  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Action buttons
  let actionHtml = '';
  if (isUnassigned && vesselMatch && task.status === 'pending') {
    actionHtml = `
      <form action="/tasks/${task.id}/claim" method="POST" style="margin-top:16px">
        <button type="submit" style="width:100%;padding:14px;background:#006950;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">I'll Take This</button>
      </form>`;
  } else if (isMyTask && task.status === 'pending') {
    actionHtml = `
      <form action="/tasks/${task.id}/status" method="POST" style="margin-top:16px">
        <input type="hidden" name="status" value="in-progress">
        <button type="submit" style="width:100%;padding:14px;background:#006950;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">Start Working</button>
      </form>`;
  } else if (isMyTask && task.status === 'in-progress') {
    actionHtml = `
      <form action="/tasks/${task.id}/status" method="POST" style="margin-top:16px">
        <input type="hidden" name="status" value="completed">
        <button type="submit" style="width:100%;padding:14px;background:#006950;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">✓ Mark Complete</button>
      </form>`;
  }

  return c.html(`${htmlHead('Task Detail')}
<body>
  <div style="max-width:480px;margin:0 auto;padding:16px;padding-bottom:80px">
    ${pageHeader('Task', session.vessel)}

    ${saved ? '<div style="padding:10px;background:rgba(0,105,80,0.08);border-radius:8px;margin-bottom:12px;font-size:0.875rem;color:#006950;text-align:center">✓ Updated</div>' : ''}

    <!-- Task card -->
    <div style="background:var(--surface);border-radius:12px;padding:16px;border:1px solid var(--border);margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <h2 style="font-family:var(--font-heading);font-size:1.125rem;font-weight:700;flex:1">${escHtml(task.title)}</h2>
        <span style="font-size:0.6875rem;padding:3px 10px;border-radius:12px;background:${status.color === '#006950' ? 'rgba(0,105,80,0.1)' : status.color === '#F36D4F' ? 'rgba(243,109,79,0.12)' : 'rgba(110,122,116,0.1)'};color:${status.color};font-weight:500;white-space:nowrap;margin-left:8px">${status.label}</span>
      </div>

      ${task.description ? `<div style="font-size:0.9375rem;line-height:1.6;margin-bottom:12px;color:var(--text)">${escHtml(task.description)}</div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:rgba(0,105,80,0.03);padding:8px 10px;border-radius:6px">
          <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Priority</div>
          <div style="font-size:0.875rem;font-weight:500;color:${priorityColor}">${priorityLabel}</div>
        </div>
        <div style="background:rgba(0,105,80,0.03);padding:8px 10px;border-radius:6px">
          <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Vessel</div>
          <div style="font-size:0.875rem;font-weight:500">${task.vessel ? task.vessel.toUpperCase() : 'Any'}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:rgba(0,105,80,0.03);padding:8px 10px;border-radius:6px">
          <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Assigned To</div>
          <div style="font-size:0.875rem;font-weight:500">${task.assignee_name || (isUnassigned ? '<span style="color:var(--text-muted);font-style:italic">Unclaimed</span>' : 'Unknown')}</div>
        </div>
        ${dueStr ? `<div style="background:rgba(0,105,80,0.03);padding:8px 10px;border-radius:6px">
          <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Due</div>
          <div style="font-size:0.875rem;font-weight:500">${dueStr}</div>
        </div>` : ''}
      </div>
    </div>

    <!-- Notes -->
    ${task.notes ? `
    <div style="background:var(--surface);border-radius:12px;padding:16px;border:1px solid var(--border);margin-bottom:12px">
      <h3 style="font-size:0.8125rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Notes</h3>
      <div style="font-size:0.9375rem;line-height:1.6;white-space:pre-wrap">${escHtml(task.notes)}</div>
    </div>` : ''}

    ${actionHtml}

    <a href="/today" style="display:block;text-align:center;padding:14px;margin-top:12px;color:var(--primary);text-decoration:none;font-size:0.875rem;font-weight:500">← Back to Home</a>
  </div>
  ${bottomNav('home')}
  <script src="/public/app.js"></script>
</body></html>`);
});

// ─── Claim Task ─────────────────────────────────────────────

app.post('/:id/claim', async (c) => {
  const session = c.get('session');
  const taskId = c.req.param('id');

  // Only claim if currently unassigned
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
