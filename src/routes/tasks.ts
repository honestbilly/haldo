// Crew-facing task views: queue, detail, claim, status update
// Rebuilt from Stitch HTML patterns (stitch-taskdetail.html, stitch-taskqueue.html)
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

const CATEGORY_ICON: Record<string, { icon: string; color: string }> = {
  maintenance: { icon: 'build', color: '#1A6B8A' },
  repair: { icon: 'handyman', color: '#F36D4F' },
  inspection: { icon: 'search', color: '#70D0EB' },
  cleaning: { icon: 'cleaning_services', color: '#34C759' },
  safety: { icon: 'shield', color: '#FF3B30' },
  regulatory: { icon: 'gavel', color: '#8E8E93' },
  upgrade: { icon: 'upgrade', color: '#5856D6' },
  cosmetic: { icon: 'palette', color: '#FF9500' },
  general: { icon: 'task_alt', color: '#1A6B8A' },
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
    const cat = CATEGORY_ICON[t.category] || CATEGORY_ICON.general;
    const tagsHtml = (t.tags && t.tags.length > 0) ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${t.tags.map((tag: string) => `<span style="font-size:0.625rem;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(26,107,138,0.08);color:#1A6B8A">${esc(tag)}</span>`).join('')}</div>` : '';

    return `
      <a href="/tasks/${t.id}" style="display:block;text-decoration:none;color:#1a1c1e;position:relative;background:white;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.05);overflow:hidden;border-left:4px solid ${borderColor};margin-bottom:12px;transition:transform 0.15s;-webkit-tap-highlight-color:transparent" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
        <div style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:8px;flex:1">
              ${icon}
              <h3 style="font-weight:700;font-size:0.9375rem;line-height:1.3">${esc(t.title)}</h3>
            </div>
            <span style="font-size:0.625rem;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93;white-space:nowrap;margin-left:8px">${t.vessel ? t.vessel.toUpperCase() : 'ANY'}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:0.75rem;font-weight:500;color:#5b5f67;margin-bottom:8px">
            ${dueStr}${estStr}
          </div>
          ${tagsHtml}
          <div style="display:flex;justify-content:flex-end;margin-top:8px">
            <span style="color:#1A6B8A;font-weight:700;font-size:0.875rem;display:flex;align-items:center;gap:4px">
              Claim <span class="material-symbols-outlined" style="font-size:18px">arrow_forward</span>
            </span>
          </div>
        </div>
      </a>`;
  }).join('');

  return c.html(`${htmlHead('Task Queue')}
<body style="background:#F2F2F7">
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;justify-content:space-between;align-items:center;padding:0 16px;height:44px">
    <a href="/today" style="color:#1A6B8A;text-decoration:none;font-weight:600;font-size:0.9375rem;display:flex;align-items:center;gap:2px">
      <span class="material-symbols-outlined" style="font-size:20px">arrow_back_ios</span> Home
    </a>
    <span style="font-family:'Inter',sans-serif;font-weight:600;font-size:1.0625rem;color:#1a1c1e;letter-spacing:-0.01em">Available Tasks</span>
    <span style="font-size:0.6875rem;font-weight:700;color:#1A6B8A;background:rgba(26,107,138,0.08);padding:3px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.1em">${session.vessel.toUpperCase()}</span>
  </header>

  <main style="padding:60px 16px 120px;max-width:480px;margin:0 auto">
    <p style="font-size:0.9375rem;color:#5b5f67;margin-bottom:20px;line-height:1.5">Tasks that need someone to pick them up. Tap to see details and claim.</p>

    ${tasks.length === 0
      ? '<div style="text-align:center;color:#8E8E93;padding:48px 0"><span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:12px;color:#c7c7cc">task_alt</span>No tasks available right now.</div>'
      : taskCards}
  </main>
  ${bottomNav('tasks')}
</body></html>`);
});

// ─── Task Detail (Stitch rebuild) ──────────────────────────

app.get('/:id', async (c) => {
  const session = c.get('session');
  const taskId = c.req.param('id');

  // Fetch task with assignee, creator, parent task, subtask count, and comments
  const result = await pool.query(
    `SELECT t.*,
            ca.name as assignee_name,
            parent.title as parent_title,
            (SELECT COUNT(*) FROM assigned_tasks sub WHERE sub.parent_task_id = t.id AND sub.status != 'cancelled') as subtask_count,
            (SELECT COUNT(*) FROM assigned_tasks sub WHERE sub.parent_task_id = t.id AND sub.status = 'completed') as subtask_done
     FROM assigned_tasks t
     LEFT JOIN crew ca ON t.assigned_to = ca.id
     LEFT JOIN assigned_tasks parent ON t.parent_task_id = parent.id
     WHERE t.id = $1`,
    [taskId]
  );
  const task = result.rows[0];
  if (!task) {
    return c.html(`${htmlHead('Not Found')}<body style="background:#F2F2F7"><div style="max-width:480px;margin:0 auto;padding:80px 24px;text-align:center"><span class="material-symbols-outlined" style="font-size:48px;color:#c7c7cc">search_off</span><p style="margin-top:12px;color:#8E8E93">Task not found.</p><a href="/today" style="color:#1A6B8A;font-weight:600;display:block;margin-top:16px"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle">arrow_back</span> Home</a></div>${bottomNav('tasks')}</body></html>`);
  }

  // Fetch comments
  const commentsResult = await pool.query(
    `SELECT tc.*, c.name as crew_name FROM task_comments tc
     LEFT JOIN crew c ON tc.crew_id = c.id
     WHERE tc.task_id = $1 ORDER BY tc.created_at ASC`,
    [taskId]
  );
  const comments = commentsResult.rows;

  // Fetch subtasks if this is a parent
  const subtasksResult = parseInt(task.subtask_count) > 0
    ? await pool.query(
        `SELECT id, title, status, priority FROM assigned_tasks
         WHERE parent_task_id = $1 AND status != 'cancelled'
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
        [taskId]
      )
    : { rows: [] };
  const subtasks = subtasksResult.rows;

  const isMyTask = task.assigned_to === session.crew_id;
  const isUnassigned = !task.assigned_to;
  const vesselMatch = !task.vessel || task.vessel === session.vessel;
  const saved = c.req.query('saved') === '1';

  // Priority styling
  const priorityStyles: Record<string, { color: string; label: string }> = {
    urgent: { color: '#FF3B30', label: 'Urgent' },
    high: { color: '#FF9500', label: 'High' },
    medium: { color: '#5b5f67', label: 'Medium' },
    low: { color: '#8E8E93', label: 'Low' },
  };
  const ps = priorityStyles[task.priority] || priorityStyles.medium;
  const dueStr = task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null;

  // Status badge (Stitch pattern: colored pill, rounded-full)
  const statusMap: Record<string, { label: string; color: string; bg: string }> = {
    'pending': { label: isUnassigned ? 'UNCLAIMED' : 'TO DO', color: '#8E8E93', bg: 'rgba(142,142,147,0.12)' },
    'in-progress': { label: 'IN PROGRESS', color: '#1A6B8A', bg: 'rgba(26,107,138,0.12)' },
    'blocked': { label: 'BLOCKED', color: '#FF3B30', bg: 'rgba(255,59,48,0.12)' },
    'completed': { label: 'DONE', color: '#34C759', bg: 'rgba(52,199,89,0.12)' },
    'snoozed': { label: 'SNOOZED', color: '#FF9500', bg: 'rgba(255,149,0,0.12)' },
    'cancelled': { label: 'CANCELLED', color: '#8E8E93', bg: 'rgba(142,142,147,0.08)' },
  };
  const st = statusMap[task.status] || statusMap.pending;

  // Category icon
  const cat = CATEGORY_ICON[task.category] || CATEGORY_ICON.general;

  // Tags
  const tags: string[] = task.tags || [];

  // Action buttons (Stitch: full-width rounded-full gradient button)
  let actionHtml = '';
  if (isUnassigned && vesselMatch && task.status === 'pending') {
    actionHtml = `
      <form action="/tasks/${task.id}/claim" method="POST">
        <button type="submit" style="width:100%;height:54px;background:linear-gradient(to bottom, #1A6B8A, #0D5470);color:white;border:none;border-radius:999px;font-family:'Manrope',sans-serif;font-size:1.0625rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px rgba(26,107,138,0.25);transition:transform 0.15s;-webkit-tap-highlight-color:transparent" ontouchstart="this.style.transform='scale(0.95)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:20px;font-variation-settings:'FILL' 1">person_add</span> I'll Take This
        </button>
      </form>`;
  } else if (isMyTask && task.status === 'pending') {
    actionHtml = `
      <form action="/tasks/${task.id}/status" method="POST">
        <input type="hidden" name="status" value="in-progress">
        <button type="submit" style="width:100%;height:54px;background:linear-gradient(to bottom, #1A6B8A, #0D5470);color:white;border:none;border-radius:999px;font-family:'Manrope',sans-serif;font-size:1.0625rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px rgba(26,107,138,0.25);transition:transform 0.15s;-webkit-tap-highlight-color:transparent" ontouchstart="this.style.transform='scale(0.95)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:20px">play_arrow</span> Start Working
        </button>
      </form>`;
  } else if (isMyTask && task.status === 'in-progress') {
    actionHtml = `
      <form action="/tasks/${task.id}/status" method="POST">
        <input type="hidden" name="status" value="completed">
        <button type="submit" style="width:100%;height:54px;background:linear-gradient(to bottom, #F36D4F, #D85940);color:white;border:none;border-radius:999px;font-family:'Manrope',sans-serif;font-size:1.0625rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px rgba(243,109,79,0.3);transition:transform 0.15s;-webkit-tap-highlight-color:transparent" ontouchstart="this.style.transform='scale(0.95)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:20px;font-variation-settings:'FILL' 1">check_circle</span> Mark Complete
        </button>
      </form>`;
  }

  // Parent task breadcrumb
  const parentBreadcrumb = task.parent_task_id && task.parent_title
    ? `<a href="/tasks/${task.parent_task_id}" style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#1A6B8A;text-decoration:none;font-weight:600;margin-bottom:12px">
        <span class="material-symbols-outlined" style="font-size:16px">subdirectory_arrow_right</span>
        Subtask of: ${esc(task.parent_title)}
       </a>` : '';

  // Tags pills
  const tagsPills = tags.length > 0
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">${tags.map(t => `<span style="font-size:0.6875rem;font-weight:600;padding:4px 12px;border-radius:999px;background:rgba(26,107,138,0.08);color:#1A6B8A">${esc(t)}</span>`).join('')}</div>`
    : '';

  // Subtasks section
  const subtasksHtml = subtasks.length > 0 ? `
    <section style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.04);margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="material-symbols-outlined" style="font-size:20px;color:#1A6B8A">account_tree</span>
          <h3 style="font-size:0.9375rem;font-weight:700;color:#111">Subtasks</h3>
        </div>
        <span style="font-size:0.6875rem;font-weight:700;color:#1A6B8A">${task.subtask_done}/${task.subtask_count}</span>
      </div>
      <!-- Progress bar -->
      <div style="width:100%;height:4px;background:#E5E5EA;border-radius:999px;overflow:hidden;margin-bottom:12px">
        <div style="height:100%;background:#1A6B8A;border-radius:999px;width:${parseInt(task.subtask_count) > 0 ? Math.round((parseInt(task.subtask_done) / parseInt(task.subtask_count)) * 100) : 0}%;transition:width 0.3s"></div>
      </div>
      ${subtasks.map((s: any) => {
        const isDone = s.status === 'completed';
        const isBlocked = s.status === 'blocked';
        return `
          <a href="/tasks/${s.id}" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #F2F2F7;text-decoration:none;color:#1a1c1e">
            <span class="material-symbols-outlined" style="font-size:20px;color:${isDone ? '#34C759' : isBlocked ? '#FF3B30' : '#c7c7cc'};${isDone ? "font-variation-settings:'FILL' 1" : ''}">${isDone ? 'check_circle' : isBlocked ? 'cancel' : 'radio_button_unchecked'}</span>
            <span style="font-size:0.875rem;font-weight:${isDone ? '500' : '600'};${isDone ? 'text-decoration:line-through;color:#8E8E93' : ''}">${esc(s.title)}</span>
          </a>`;
      }).join('')}
    </section>` : '';

  // Comments section
  const commentsHtml = `
    <section style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.04);margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span class="material-symbols-outlined" style="font-size:20px;color:#1A6B8A">chat_bubble</span>
        <h3 style="font-size:0.9375rem;font-weight:700;color:#111">Comments</h3>
        ${comments.length > 0 ? `<span style="font-size:0.6875rem;font-weight:600;background:rgba(26,107,138,0.08);color:#1A6B8A;padding:2px 8px;border-radius:999px">${comments.length}</span>` : ''}
      </div>
      ${comments.length > 0 ? comments.map((cm: any) => {
        const initial = (cm.crew_name || cm.author_name || '?').charAt(0).toUpperCase();
        const name = cm.crew_name || cm.author_name;
        const timeAgo = formatTimeAgo(new Date(cm.created_at));
        return `
          <div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid #F2F2F7">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(26,107,138,0.1);color:#1A6B8A;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.6875rem;flex-shrink:0">${initial}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
                <span style="font-size:0.8125rem;font-weight:700;color:#1a1c1e">${esc(name)}</span>
                <span style="font-size:0.6875rem;color:#8E8E93">${timeAgo}</span>
              </div>
              <p style="font-size:0.8125rem;line-height:1.5;color:#555;margin:0">${esc(cm.comment)}</p>
            </div>
          </div>`;
      }).join('') : '<p style="font-size:0.8125rem;color:#8E8E93;text-align:center;padding:8px 0">No comments yet.</p>'}
      <!-- Add comment form -->
      <form action="/tasks/${task.id}/comment" method="POST" style="margin-top:12px;display:flex;gap:8px;border-top:1px solid #F2F2F7;padding-top:12px">
        <input type="text" name="comment" required placeholder="Add a note..."
          style="flex:1;height:40px;padding:0 14px;background:#F2F2F7;border:none;border-radius:20px;font-size:0.8125rem;font-family:'Inter',sans-serif;color:#1a1c1e;outline:none"
          onfocus="this.style.background='white';this.style.boxShadow='0 0 0 2px rgba(26,107,138,0.3)'"
          onblur="this.style.background='#F2F2F7';this.style.boxShadow='none'">
        <button type="submit" style="width:40px;height:40px;border-radius:50%;background:#1A6B8A;color:white;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform 0.15s;-webkit-tap-highlight-color:transparent" ontouchstart="this.style.transform='scale(0.9)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:18px">send</span>
        </button>
      </form>
    </section>`;

  return c.html(`${htmlHead('Task Detail')}
<body style="background:#F2F2F7">
  <!-- TopAppBar — Stitch pattern: compact, blur, iOS-style back arrow -->
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;justify-content:space-between;align-items:center;padding:0 16px;height:44px">
    <a href="/today" style="color:#1A6B8A;text-decoration:none;font-weight:600;font-size:0.9375rem;display:flex;align-items:center;gap:2px">
      <span class="material-symbols-outlined" style="font-size:20px">arrow_back_ios</span> Home
    </a>
    <span style="font-family:'Inter',sans-serif;font-weight:600;font-size:1.0625rem;color:#1a1c1e;letter-spacing:-0.01em">Task</span>
    <span style="font-size:0.6875rem;font-weight:700;color:#1A6B8A;background:rgba(26,107,138,0.08);padding:3px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.1em">${task.vessel ? task.vessel.toUpperCase() : 'ANY'}</span>
  </header>

  <main style="padding:60px 16px 140px;max-width:480px;margin:0 auto">
    ${saved ? '<div style="padding:10px;background:rgba(52,199,89,0.1);border-radius:12px;margin-bottom:12px;font-size:0.875rem;color:#34C759;text-align:center;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px"><span class="material-symbols-outlined" style="font-size:18px;font-variation-settings:\'FILL\' 1">check_circle</span> Updated</div>' : ''}

    ${parentBreadcrumb}

    <!-- Main Content Card — Stitch pattern: white, rounded-[12px], shadow-sm, border -->
    <section style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.04);margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <h2 style="font-family:'Manrope',sans-serif;font-size:1.375rem;font-weight:800;color:#111;line-height:1.25;letter-spacing:-0.02em;max-width:70%">${esc(task.title)}</h2>
        <span style="font-size:0.6875rem;font-weight:700;padding:4px 12px;border-radius:999px;background:${st.bg};color:${st.color};text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap">${st.label}</span>
      </div>

      ${task.description ? `<p style="font-size:0.9375rem;line-height:1.6;color:#555;margin-bottom:16px">${esc(task.description)}</p>` : ''}

      <!-- Info Grid — Stitch pattern: tinted cells (#F0F9F7), 12px radius -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:rgba(26,107,138,0.06);padding:12px;border-radius:12px;display:flex;flex-direction:column">
          <span style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(26,107,138,0.5);margin-bottom:4px">Priority</span>
          <span style="font-size:0.875rem;font-weight:700;color:${ps.color}">${ps.label}</span>
        </div>
        <div style="background:rgba(26,107,138,0.06);padding:12px;border-radius:12px;display:flex;flex-direction:column">
          <span style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(26,107,138,0.5);margin-bottom:4px">Vessel</span>
          <span style="font-size:0.875rem;font-weight:700;color:#1A6B8A">${task.vessel ? task.vessel.toUpperCase() : 'Any'}</span>
        </div>
        ${task.estimated_minutes ? `<div style="background:rgba(26,107,138,0.06);padding:12px;border-radius:12px;display:flex;flex-direction:column">
          <span style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(26,107,138,0.5);margin-bottom:4px">Est. Time</span>
          <span style="font-size:0.875rem;font-weight:700;color:#1a1c1e">~${task.estimated_minutes} min</span>
        </div>` : ''}
        ${dueStr ? `<div style="background:rgba(26,107,138,0.06);padding:12px;border-radius:12px;display:flex;flex-direction:column">
          <span style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(26,107,138,0.5);margin-bottom:4px">Due Date</span>
          <span style="font-size:0.875rem;font-weight:700;color:#1a1c1e">${dueStr}</span>
        </div>` : ''}
      </div>

      ${tagsPills}
    </section>

    <!-- Personnel Card — Stitch pattern: avatar circle, role labels -->
    <section style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.04);margin-bottom:16px">
      <h3 style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8E8E93;margin-bottom:14px">Personnel</h3>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:50%;background:${isUnassigned ? '#E5E5EA' : 'rgba(26,107,138,0.12)'};color:${isUnassigned ? '#8E8E93' : '#1A6B8A'};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9375rem">${isUnassigned ? '?' : (task.assignee_name || 'U').charAt(0).toUpperCase()}</div>
          <div>
            <p style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8E8E93;margin-bottom:2px">Assigned To</p>
            <p style="font-size:0.9375rem;font-weight:700;color:#1a1c1e">${task.assignee_name || (isUnassigned ? 'Unclaimed' : 'Unknown')}</p>
          </div>
        </div>
        ${task.category ? `<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:rgba(26,107,138,0.06)">
          <span class="material-symbols-outlined" style="font-size:18px;color:${cat.color}">${cat.icon}</span>
          <span style="font-size:0.75rem;font-weight:600;color:#5b5f67;text-transform:capitalize">${task.category}</span>
        </div>` : ''}
      </div>
    </section>

    <!-- Notes Card — Stitch pattern: icon + heading, relaxed text -->
    ${task.notes ? `
    <section style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.04);margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span class="material-symbols-outlined" style="font-size:20px;color:#1A6B8A">sticky_note_2</span>
        <h3 style="font-size:0.9375rem;font-weight:700;color:#111">Notes</h3>
      </div>
      <p style="font-size:0.875rem;line-height:1.6;color:#555;white-space:pre-wrap;margin:0">${esc(task.notes)}</p>
    </section>` : ''}

    ${subtasksHtml}

    ${commentsHtml}

    <!-- Actions — Stitch pattern: full-width gradient rounded-full button -->
    <div style="padding:8px 0 0">
      ${actionHtml}
      <div style="text-align:center;margin-top:16px">
        <a href="/today" style="color:#1A6B8A;font-weight:500;font-size:0.9375rem;text-decoration:none;display:inline-flex;align-items:center;gap:4px">
          <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Back to Home
        </a>
      </div>
    </div>
  </main>
  ${bottomNav('tasks')}
</body></html>`);
});

// ─── Add Comment ───────────────────────────────────────────

app.post('/:id/comment', async (c) => {
  const session = c.get('session');
  const taskId = c.req.param('id');
  const body = await c.req.parseBody();
  const comment = String(body.comment || '').trim();

  if (comment) {
    const { nanoid } = await import('nanoid');
    await pool.query(
      `INSERT INTO task_comments (id, task_id, crew_id, author_name, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [nanoid(), taskId, session.crew_id, session.crew_name, comment]
    );
  }

  return c.redirect(`/tasks/${taskId}?saved=1`);
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
  } else if (newStatus === 'in-progress') {
    await pool.query(
      `UPDATE assigned_tasks SET status = $1, started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE id = $2`,
      [newStatus, taskId]
    );
  } else {
    await pool.query(
      `UPDATE assigned_tasks SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, taskId]
    );
  }

  return c.redirect(`/tasks/${taskId}?saved=1`);
});

// ─── Helpers ────────────────────────────────────────────────

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default app;
