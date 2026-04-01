// Manager task hub: Task List + Inbox (submissions) + DMT Schedule
// Sub-navigation within the Tasks tab: Task List | Inbox | Schedule
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { VESSELS, VESSEL_LABELS, escapeHtml, reportLayout } from '../lib/report-shared.js';
import { previewSchedule, getAllTemplates, saveTemplate, loadTemplates } from '../services/templates.js';

const app = new Hono();

// ─── Helpers ────────────────────────────────────────────────

const STATUS_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  'pending':     { label: 'In Queue',    bg: 'rgba(110,122,116,0.1)', color: '#6e7a74' },
  'assigned':    { label: 'Assigned',    bg: 'rgba(112,208,235,0.15)', color: '#0C7DA0' },
  'in-progress': { label: 'In Progress', bg: 'rgba(26,107,138,0.1)', color: '#1A6B8A' },
  'completed':   { label: 'Completed',   bg: 'rgba(26,107,138,0.15)', color: '#1A6B8A' },
  'blocked':     { label: 'Blocked',     bg: 'rgba(243,109,79,0.12)', color: '#F36D4F' },
  'snoozed':     { label: 'Snoozed',     bg: 'rgba(110,122,116,0.08)', color: '#9ca3af' },
  'cancelled':   { label: 'Cancelled',   bg: 'rgba(110,122,116,0.08)', color: '#9ca3af' },
};

const PRIORITY_BADGES: Record<string, { icon: string; color: string }> = {
  'low':    { icon: '',  color: '#6e7a74' },
  'medium': { icon: '',  color: '#1a1c1c' },
  'high':   { icon: '⚠', color: '#F36D4F' },
  'urgent': { icon: '🔴', color: '#ba1a1a' },
};

const CATEGORY_ICONS: Record<string, string> = {
  'maintenance': '🔧', 'suggestion': '💡', 'meeting-topic': '📅',
  'safety': '⚠️', 'sop-feedback': '📖', 'kudos': '⭐', 'general': '💬',
};

function statusBadge(status: string, hasAssignee: boolean = false): string {
  const key = status === 'pending' && hasAssignee ? 'assigned' : status;
  const s = STATUS_BADGES[key] || STATUS_BADGES['pending'];
  return `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:12px;background:${s.bg};color:${s.color};font-weight:500">${s.label}</span>`;
}

function priorityBadge(priority: string): string {
  const p = PRIORITY_BADGES[priority] || PRIORITY_BADGES['medium'];
  return p.icon ? `<span style="font-size:0.75rem;color:${p.color}">${p.icon}</span>` : '';
}

function subNav(active: string): string {
  const tabs = [
    { id: 'list', label: 'Task List', href: '/report/tasks' },
    { id: 'inbox', label: 'Inbox', href: '/report/inbox' },
    { id: 'schedule', label: 'Schedule', href: '/report/schedule' },
    { id: 'library', label: 'Library', href: '/report/library' },
  ];
  return `<div style="display:flex;align-items:center;gap:4px;padding:4px;background:#E5E8F0;border-radius:999px;width:fit-content;margin-bottom:24px">
    ${tabs.map(t => `<a href="${t.href}" style="padding:8px 20px;border-radius:999px;font-size:0.75rem;font-weight:${active === t.id ? '700' : '500'};text-decoration:none;transition:all 0.15s;${active === t.id ? 'background:#1A6B8A;color:white;box-shadow:0 2px 4px rgba(0,0,0,0.1)' : 'color:#5b5f67'}">${t.label}</a>`).join('')}
  </div>`;
}

const dropdownStyle = `padding:10px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:"Inter",-apple-system,sans-serif;font-size:14px;background:#FFFFFF;color:#1a1c1c;width:100%;min-height:44px`;
const inputStyle = `padding:10px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:"Inter",-apple-system,sans-serif;font-size:14px;background:#FFFFFF;color:#1a1c1c;width:100%;min-height:44px`;
const textareaStyle = `${inputStyle};min-height:80px;resize:vertical`;

// ─── TASK LIST ──────────────────────────────────────────────

app.get('/report/tasks', async (c) => {
  const statusFilter = c.req.query('status') || '';
  const vesselFilter = c.req.query('vessel') || '';
  const showSnoozed = c.req.query('show_snoozed') === '1';

  // ── Crew availability strip (7-day forward) ──
  const today = new Date();
  const days: string[] = [];
  const dayLabels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
    dayLabels.push(i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }));
  }

  const schedResult = await pool.query(
    `SELECT cs.schedule_date, cs.shift, cr.name, cr.role
     FROM crew_schedule cs JOIN crew cr ON cs.crew_id = cr.id
     WHERE cs.schedule_date >= $1 AND cs.schedule_date <= $2 AND cs.shift != 'off'
     ORDER BY cr.role, cr.name`,
    [days[0], days[6]]
  );

  // Group by date
  const schedByDate = new Map<string, Array<{ name: string; role: string }>>();
  for (const row of schedResult.rows) {
    const dk = row.schedule_date instanceof Date ? row.schedule_date.toISOString().split('T')[0] : String(row.schedule_date).split('T')[0];
    if (!schedByDate.has(dk)) schedByDate.set(dk, []);
    schedByDate.get(dk)!.push({ name: row.name, role: row.role });
  }

  // Stitch crew strip — pills with (C) for captains, horizontal scroll
  // Compact crew strip — plain text names, captains bold
  const crewStrip = `
    <div style="display:flex;border-bottom:1px solid #E5E5EA;overflow-x:auto;-webkit-overflow-scrolling:touch;background:#FAFBFC">
      ${days.map((d, i) => {
        const crew = schedByDate.get(d) || [];
        const isToday = i === 0;
        const names = crew.length > 0
          ? crew.map(c => `<div style="font-size:0.6875rem;font-weight:${c.role === 'captain' ? '700' : '400'};color:${c.role === 'captain' ? '#1a1c1e' : '#5b5f67'};line-height:1.5">${escapeHtml(c.name)}</div>`).join('')
          : '<div style="font-size:0.6875rem;color:#c7c7cc">—</div>';
        return `
          <div style="flex:0 0 auto;min-width:100px;padding:10px 12px;${isToday ? 'background:white;box-shadow:0 1px 3px rgba(0,0,0,0.06)' : ''}">
            <div style="font-size:0.5625rem;font-weight:700;color:${isToday ? '#1A6B8A' : '#8E8E93'};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">${dayLabels[i]}</div>
            ${names}
          </div>`;
      }).join('')}
    </div>`;

  let where = 'WHERE 1=1';
  const params: any[] = [];
  let paramIdx = 1;

  if (statusFilter) {
    where += ` AND t.status = $${paramIdx++}`;
    params.push(statusFilter);
  } else if (!showSnoozed) {
    where += ` AND t.status NOT IN ('snoozed', 'completed', 'cancelled')`;
  }
  if (vesselFilter) {
    where += ` AND t.vessel = $${paramIdx++}`;
    params.push(vesselFilter);
  }

  const result = await pool.query(
    `SELECT t.*, ca.name as assignee_name,
       (SELECT COUNT(*) FROM assigned_tasks c WHERE c.parent_task_id = t.id) as child_count
     FROM assigned_tasks t
     LEFT JOIN crew ca ON t.assigned_to = ca.id
     ${where}
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       CASE t.status WHEN 'blocked' THEN 0 WHEN 'in-progress' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
       t.due_date ASC NULLS LAST,
       t.created_at DESC`,
    params
  );

  const tasks = result.rows;

  // Group by vessel
  const byVessel = new Map<string, any[]>();
  const noVessel: any[] = [];
  for (const t of tasks) {
    if (t.vessel) {
      if (!byVessel.has(t.vessel)) byVessel.set(t.vessel, []);
      byVessel.get(t.vessel)!.push(t);
    } else {
      noVessel.push(t);
    }
  }

  const CATEGORY_ICONS: Record<string, string> = {
    'maintenance': 'build', 'repair': 'handyman', 'inspection': 'search', 'cleaning': 'cleaning_services',
    'safety': 'shield', 'regulatory': 'gavel', 'upgrade': 'upgrade', 'cosmetic': 'palette', 'general': 'task',
  };

  // Stitch bento card with HTMX inline editing
  const renderTaskRow = (t: any) => {
    const catIcon = CATEGORY_ICONS[t.category] || 'task';
    const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const assignee = t.assignee_name || '';
    const tags = (t.tags || []) as string[];
    const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed';
    const childCount = t.child_count ? parseInt(t.child_count) : 0;
    const notePreview = t.notes ? String(t.notes).substring(0, 80) + (t.notes.length > 80 ? '...' : '') : '';

    return `
      <div style="background:white;padding:20px;border-radius:12px;border:1px solid transparent;color:#1a1c1e;display:flex;flex-direction:column;position:relative;overflow:visible;transition:all 0.2s" onmouseenter="this.style.borderColor='rgba(26,107,138,0.15)';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.06)'" onmouseleave="this.style.borderColor='transparent';this.style.boxShadow='none'">
        ${t.status === 'blocked' ? '<div style="position:absolute;top:0;right:0;width:96px;height:96px;margin-right:-32px;margin-top:-32px;background:rgba(255,59,48,0.04);border-radius:50%;filter:blur(20px);pointer-events:none"></div>' : ''}

        <!-- Top row: status (clickable) + more menu -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div id="status-${t.id}" style="position:relative;cursor:pointer" onclick="event.stopPropagation();if(!this.querySelector('.htmx-dropdown')){htmx.ajax('GET','/report/tasks/${t.id}/status-dropdown',{target:'#status-${t.id}',swap:'beforeend'})}else{this.querySelector('.htmx-dropdown').remove()}">
            ${statusBadge(t.status, !!t.assigned_to)}
          </div>
          <a href="/report/tasks/${t.id}" style="color:#c7c7cc;text-decoration:none" title="Edit task">
            <span class="material-symbols-outlined" style="font-size:18px">more_horiz</span>
          </a>
        </div>

        <!-- Title (links to detail) -->
        <a href="/report/tasks/${t.id}" style="text-decoration:none;color:#1a1c1e">
          <h3 style="font-family:'Manrope',sans-serif;font-weight:700;font-size:0.9375rem;margin-bottom:4px">${escapeHtml(t.title)}</h3>
        </a>
        ${notePreview ? `<p style="font-size:0.8125rem;color:#8E8E93;line-height:1.4;margin-bottom:12px">${escapeHtml(notePreview)}</p>` : '<div style="margin-bottom:12px"></div>'}

        <!-- Bottom row: assignee (clickable) + due date -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto">
          <div id="assignee-${t.id}" style="position:relative;cursor:pointer;display:flex;align-items:center;gap:6px" onclick="event.stopPropagation();if(!this.querySelector('.htmx-dropdown')){htmx.ajax('GET','/report/tasks/${t.id}/assign-dropdown',{target:'#assignee-${t.id}',swap:'beforeend'})}else{this.querySelector('.htmx-dropdown').remove()}">
            ${assignee ? `<div style="width:24px;height:24px;border-radius:50%;background:#1A6B8A;color:white;display:flex;align-items:center;justify-content:center;font-size:0.5625rem;font-weight:700">${assignee.charAt(0)}</div>` : '<span style="font-size:0.6875rem;color:#c7c7cc">Unassigned</span>'}
            ${childCount > 0 ? `<span style="font-size:0.5625rem;color:#8E8E93">${childCount} subtasks</span>` : ''}
          </div>
          <span style="font-size:0.625rem;font-weight:700;color:${isOverdue ? '#FF3B30' : '#8E8E93'};display:flex;align-items:center;gap:4px">
            ${dueStr ? `<span class="material-symbols-outlined" style="font-size:12px">schedule</span> ${isOverdue ? 'Overdue' : dueStr}` : ''}
          </span>
        </div>
      </div>`;
  };

  // Keep old card renderer for backward compat (used nowhere now)
  const renderTaskCard = (t: any) => {
    const borderColor = t.status === 'blocked' ? '#FF3B30' : t.priority === 'urgent' ? '#FF3B30' : t.priority === 'high' ? '#FF9500' : '#1A6B8A';
    const catIcon = CATEGORY_ICONS[t.category] || 'task';
    const iconBg = t.status === 'blocked' ? 'rgba(255,59,48,0.08)' : t.priority === 'urgent' ? 'rgba(255,59,48,0.08)' : t.priority === 'high' ? 'rgba(255,149,0,0.08)' : 'rgba(26,107,138,0.05)';
    const iconColor = t.status === 'blocked' ? '#FF3B30' : t.priority === 'urgent' ? '#FF3B30' : t.priority === 'high' ? '#FF9500' : '#1A6B8A';
    const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const assigneeStr = t.assignee_name || (t.assigned_to ? 'Unknown' : '<span style="font-style:italic;opacity:0.6">Unassigned</span>');
    const tags = (t.tags || []) as string[];
    const tagPills = tags.slice(0, 3).map((tag: string) => `<span style="font-size:0.5625rem;font-weight:600;padding:1px 6px;border-radius:999px;background:rgba(26,107,138,0.08);color:#1A6B8A">${escapeHtml(tag)}</span>`).join('');
    const childCount = t.child_count ? parseInt(t.child_count) : 0;

    return `
      <a href="/report/tasks/${t.id}" class="task-card" style="display:flex;align-items:center;justify-content:space-between;text-decoration:none;color:#1a1c1e;background:white;border-radius:8px;padding:16px;margin-bottom:8px;border-left:4px solid ${borderColor};box-shadow:0 4px 12px rgba(0,0,0,0.02);cursor:pointer">
        <div style="display:flex;align-items:center;gap:16px;flex:1;min-width:0">
          <div style="width:40px;height:40px;border-radius:50%;background:${iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-symbols-outlined" style="font-size:20px;color:${iconColor}">${t.status === 'blocked' ? 'block' : catIcon}</span>
          </div>
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${priorityBadge(t.priority)}
              <h3 style="font-weight:700;font-size:0.875rem">${escapeHtml(t.title)}</h3>
              ${childCount > 0 ? `<span style="font-size:0.5625rem;color:#8E8E93;font-weight:600">${childCount} subtask${childCount > 1 ? 's' : ''}</span>` : ''}
            </div>
            <p style="font-size:0.6875rem;color:#5b5f67;margin-top:2px;font-weight:500">
              ${assigneeStr}${dueStr ? ` · <span style="color:${t.status === 'blocked' ? '#FF3B30' : '#5b5f67'}">Due ${dueStr}</span>` : ''}${t.notes ? ' · <span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">note</span>' : ''}
            </p>
            ${tagPills ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">${tagPills}${tags.length > 3 ? `<span style="font-size:0.5625rem;color:#8E8E93">+${tags.length - 3}</span>` : ''}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-shrink:0">
          ${statusBadge(t.status, !!t.assigned_to)}
          <span class="material-symbols-outlined" style="font-size:20px;color:#c7c7cc">chevron_right</span>
        </div>
      </a>`;
  };

  const vesselSections = VESSELS.filter(v => byVessel.has(v)).map(v => {
    const vTasks = byVessel.get(v)!;
    return `
      <section style="margin-bottom:32px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.0625rem;font-weight:800;color:#00526d;text-transform:uppercase;letter-spacing:0.05em">${VESSEL_LABELS[v] || v}</h2>
          <div style="flex:1;height:1px;background:linear-gradient(to right,#E5E5EA,transparent)"></div>
          <span style="font-size:0.625rem;font-weight:700;color:#8E8E93">${vTasks.length} ACTIVE TASK${vTasks.length !== 1 ? 'S' : ''}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
          ${vTasks.map(renderTaskRow).join('')}
        </div>
      </section>`;
  }).join('');

  const unassignedSection = noVessel.length > 0 ? `
    <section style="margin-bottom:32px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.0625rem;font-weight:800;color:#8E8E93;text-transform:uppercase;letter-spacing:0.05em">No Vessel</h2>
        <div style="flex:1;height:1px;background:linear-gradient(to right,#E5E5EA,transparent)"></div>
        <span style="font-size:0.625rem;font-weight:700;color:#8E8E93">${noVessel.length} TASK${noVessel.length !== 1 ? 'S' : ''}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${noVessel.map(renderTaskRow).join('')}
      </div>
    </section>` : '';

  const filterBtnStyle = `display:flex;align-items:center;gap:6px;padding:8px 16px;background:#E5E8F0;color:#1a1c1e;border-radius:8px;font-size:0.75rem;font-weight:500;border:none;text-decoration:none;cursor:pointer;transition:background 0.15s`;

  const filterHtml = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px">
      <div style="display:flex;align-items:center;gap:8px">
        <select onchange="window.location=this.value" style="${filterBtnStyle};appearance:none;padding-right:28px;background-image:url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27%238E8E93%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M8 11L3 6h10l-5 5z%27/%3E%3C/svg%3E');background-repeat:no-repeat;background-position:right 8px center">
          <option value="/report/tasks?${vesselFilter ? 'vessel=' + vesselFilter : ''}">All Status</option>
          ${['pending', 'in-progress', 'blocked', 'completed', 'snoozed'].map(s =>
            `<option value="/report/tasks?status=${s}${vesselFilter ? '&vessel=' + vesselFilter : ''}" ${statusFilter === s ? 'selected' : ''}>${STATUS_BADGES[s]?.label || s}</option>`
          ).join('')}
        </select>
        <select onchange="window.location=this.value" style="${filterBtnStyle};appearance:none;padding-right:28px;background-image:url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27%238E8E93%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M8 11L3 6h10l-5 5z%27/%3E%3C/svg%3E');background-repeat:no-repeat;background-position:right 8px center">
          <option value="/report/tasks?${statusFilter ? 'status=' + statusFilter : ''}">All Vessels</option>
          ${VESSELS.map(v =>
            `<option value="/report/tasks?vessel=${v}${statusFilter ? '&status=' + statusFilter : ''}" ${vesselFilter === v ? 'selected' : ''}>${VESSEL_LABELS[v]}</option>`
          ).join('')}
        </select>
      </div>
      <a href="/report/tasks/create" style="display:flex;align-items:center;gap:6px;padding:8px 24px;background:linear-gradient(135deg,#1A6B8A,#0D5470);color:white;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.75rem;box-shadow:0 2px 8px rgba(26,107,138,0.2);transition:opacity 0.15s">
        <span class="material-symbols-outlined" style="font-size:18px">add</span> New Task
      </a>
    </div>`;

  return c.html(reportLayout('Tasks', `
    ${crewStrip}
    ${subNav('list')}
    ${filterHtml}
    ${tasks.length === 0 ? '<p style="text-align:center;color:#6e7a74;padding:40px 0">No tasks found.</p>' : ''}
    ${vesselSections}
    ${unassignedSection}
    ${!showSnoozed && !statusFilter ? `<a href="/report/tasks?show_snoozed=1" style="display:block;text-align:center;font-size:0.75rem;color:#6e7a74;padding:8px">Show snoozed tasks</a>` : ''}

    <!-- CSV Import -->
    <details style="margin-top:24px;background:white;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <summary style="font-size:0.75rem;font-weight:600;color:#1A6B8A;cursor:pointer;display:flex;align-items:center;gap:6px">
        <span class="material-symbols-outlined" style="font-size:16px">upload_file</span> Import Tasks from CSV
      </summary>
      <div style="margin-top:12px">
        <p style="font-size:0.75rem;color:#5b5f67;margin-bottom:8px">CSV columns: <code>Boat, Issue, Status, Notes</code></p>
        <form action="/report/tasks/import-csv" method="POST" enctype="multipart/form-data" style="display:flex;gap:8px;align-items:center">
          <input type="file" name="csv" accept=".csv" required style="font-size:0.75rem">
          <button type="submit" style="padding:8px 16px;background:#1A6B8A;color:white;border:none;border-radius:8px;font-size:0.75rem;font-weight:600;cursor:pointer;white-space:nowrap">Import</button>
        </form>
      </div>
    </details>
  `));
});

// ─── CREATE TASK ────────────────────────────────────────────

app.get('/report/tasks/create', async (c) => {
  const fromSubmission = c.req.query('from_submission');
  let prefill: any = {};

  if (fromSubmission) {
    const sub = await pool.query('SELECT * FROM submissions WHERE id = $1', [fromSubmission]);
    if (sub.rows[0]) {
      const s = sub.rows[0];
      prefill = { title: s.title, description: s.details || '', vessel: s.vessel, source_submission_id: s.id };
    }
  }

  const crewList = await pool.query('SELECT id, name, role, vessel FROM crew WHERE active = TRUE ORDER BY role, name');

  return c.html(reportLayout('Tasks', `
    ${subNav('list')}
    <div style="margin-bottom:16px">
      <a href="/report/tasks" style="color:#1A6B8A;text-decoration:none;font-size:0.875rem">← Back to tasks</a>
    </div>
    <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700;margin-bottom:16px">${fromSubmission ? 'Create Task from Submission' : 'Create New Task'}</h2>

    <form action="/report/tasks/create" method="POST">
      ${prefill.source_submission_id ? `<input type="hidden" name="source_submission_id" value="${escapeHtml(prefill.source_submission_id)}">` : ''}

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Title *</label>
        <input type="text" name="title" required value="${escapeHtml(prefill.title || '')}" style="${inputStyle}" placeholder="e.g. Replace broken stereo on SQUID">
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Description</label>
        <textarea name="description" style="${textareaStyle}" placeholder="Details, context, instructions...">${escapeHtml(prefill.description || '')}</textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Vessel / Location</label>
          <select name="vessel" style="${dropdownStyle}">
            <option value="">Any / All</option>
            ${VESSELS.map(v => `<option value="${v}" ${prefill.vessel === v ? 'selected' : ''}>${VESSEL_LABELS[v]}</option>`).join('')}
            <option value="shore">Shore / Office</option>
            <option value="yard">Yard</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Assign To</label>
          <select name="assigned_to" style="${dropdownStyle}">
            <option value="">Unassigned</option>
            ${crewList.rows.map((cr: any) => `<option value="${cr.id}">${escapeHtml(cr.name)} (${cr.role})</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Category</label>
          <select name="category" style="${dropdownStyle}">
            <option value="general">General</option>
            <option value="maintenance">Maintenance</option>
            <option value="repair">Repair</option>
            <option value="inspection">Inspection</option>
            <option value="cleaning">Cleaning</option>
            <option value="safety">Safety</option>
            <option value="regulatory">Regulatory</option>
            <option value="upgrade">Upgrade</option>
            <option value="cosmetic">Cosmetic</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Skill Level</label>
          <select name="skill_level" style="${dropdownStyle}">
            <option value="any">Any</option>
            <option value="deckhand">Deckhand</option>
            <option value="captain">Captain</option>
            <option value="mechanic">Mechanic</option>
            <option value="specialist">Specialist</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Tags (comma-separated)</label>
        <input type="text" name="tags" style="${inputStyle}" placeholder="e.g. engine, warranty, hull, electrical">
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Location (specific area)</label>
        <input type="text" name="location" style="${inputStyle}" placeholder="e.g. engine room, port hull, forward deck">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Priority</label>
          <select name="priority" style="${dropdownStyle}">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Due Date</label>
          <input type="date" name="due_date" style="${inputStyle}">
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Est. Minutes</label>
          <input type="number" name="estimated_minutes" min="1" max="480" style="${inputStyle}" placeholder="e.g. 30">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Notes</label>
        <textarea name="notes" style="${textareaStyle}" placeholder="Warranty info, vendor contacts, special instructions..."></textarea>
      </div>

      <button type="submit" style="width:100%;padding:14px;background:#1A6B8A;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">Create Task</button>
    </form>
  `));
});

app.post('/report/tasks/create', async (c) => {
  const body = await c.req.parseBody();
  const id = nanoid();

  const estMin = parseInt(String(body.estimated_minutes || ''), 10);
  const tagsStr = String(body.tags || '').trim();
  const tagsArray = tagsStr ? tagsStr.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean) : [];
  const sourceType = String(body.source_submission_id || '') ? 'submission' : 'manual';

  await pool.query(
    `INSERT INTO assigned_tasks (id, title, description, vessel, assigned_to, assigned_by, priority, due_date, notes, source_submission_id, estimated_minutes, category, tags, skill_level, location, source_type, source_id, status)
     VALUES ($1, $2, $3, $4, $5, 'manager', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $9, 'pending')`,
    [
      id,
      String(body.title || '').trim(),
      String(body.description || '').trim() || null,
      String(body.vessel || '') || null,
      String(body.assigned_to || '') || null,
      String(body.priority || 'medium'),
      String(body.due_date || '') || null,
      String(body.notes || '').trim() || null,
      String(body.source_submission_id || '') || null,
      isNaN(estMin) ? null : estMin,
      String(body.category || 'general'),
      tagsArray,
      String(body.skill_level || 'any'),
      String(body.location || '').trim() || null,
      sourceType,
    ]
  );

  // If from a submission, update its status
  const subId = String(body.source_submission_id || '');
  if (subId) {
    await pool.query(
      `UPDATE submissions SET status = 'in-progress', updated_at = NOW() WHERE id = $1`,
      [subId]
    );
  }

  return c.redirect('/report/tasks');
});

// ─── TASK CSV IMPORT ────────────────────────────────────────

app.post('/report/tasks/import-csv', async (c) => {
  const body = await c.req.parseBody();
  const file = body.csv;
  if (!file || typeof file === 'string') return c.redirect('/report/tasks');

  const text = await (file as File).text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // Skip header
  const header = lines[0].toLowerCase();
  const dataLines = header.includes('boat') || header.includes('issue') ? lines.slice(1) : lines;

  const vesselMap: Record<string, string> = {
    'blu q': 'blu-q', 'squid': 'squid', 'cowfish': 'cowfish',
    'java': 'java-cat', 'java cat': 'java-cat', 'scout': 'scout', 'shore': 'shore',
  };
  const statusMap: Record<string, string> = {
    'to queue': 'pending', 'completed': 'completed', 'in progress': 'in-progress', 'blocked': 'blocked',
  };

  let count = 0;
  for (const line of dataLines) {
    // Parse CSV (handles quoted fields)
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { parts.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    parts.push(current.trim());

    const [boat, issue, added, status, assigned, completedBy, completed, budget, notes] = parts;
    if (!issue) continue;

    const vessel = vesselMap[boat?.toLowerCase()] || boat?.toLowerCase().replace(/\s+/g, '-') || null;
    const taskStatus = statusMap[status?.toLowerCase()] || 'pending';
    const estMinutes = budget ? Math.round(parseFloat(budget) * 60) || null : null;

    const id = nanoid();
    await pool.query(
      `INSERT INTO assigned_tasks (id, title, vessel, status, notes, estimated_minutes, source_type, category)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', 'maintenance')
       ON CONFLICT DO NOTHING`,
      [id, issue, vessel, taskStatus, notes || null, estMinutes]
    );
    count++;
  }

  return c.redirect(`/report/tasks?imported=${count}`);
});

// ─── TASK DETAIL / EDIT ─────────────────────────────────────

app.get('/report/tasks/:id', async (c) => {
  const taskId = c.req.param('id');
  const result = await pool.query(
    `SELECT t.*, ca.name as assignee_name
     FROM assigned_tasks t
     LEFT JOIN crew ca ON t.assigned_to = ca.id
     WHERE t.id = $1`,
    [taskId]
  );
  const task = result.rows[0];
  if (!task) return c.html(reportLayout('Tasks', '<p style="color:#F36D4F">Task not found.</p><a href="/report/tasks" style="color:#1A6B8A">← Back</a>'));

  const crewList = await pool.query('SELECT id, name, role FROM crew WHERE active = TRUE ORDER BY role, name');
  const saved = c.req.query('saved') === '1';

  return c.html(reportLayout('Tasks', `
    ${subNav('list')}
    <div style="margin-bottom:16px">
      <a href="/report/tasks" style="color:#1A6B8A;text-decoration:none;font-size:0.875rem">← Back to tasks</a>
    </div>

    ${saved ? '<div style="padding:10px 16px;background:rgba(26,107,138,0.08);border-radius:8px;margin-bottom:12px;font-size:0.875rem;color:#1A6B8A;text-align:center">✓ Task updated</div>' : ''}

    <form action="/report/tasks/${escapeHtml(taskId)}" method="POST">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700">${escapeHtml(task.title)}</h2>
        ${statusBadge(task.status, !!task.assigned_to)}
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Title</label>
        <input type="text" name="title" value="${escapeHtml(task.title)}" style="${inputStyle}" required>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Description</label>
        <textarea name="description" style="${textareaStyle}">${escapeHtml(task.description || '')}</textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Status</label>
          <select name="status" style="${dropdownStyle}">
            ${['pending', 'in-progress', 'blocked', 'completed', 'snoozed', 'cancelled'].map(s =>
              `<option value="${s}" ${task.status === s ? 'selected' : ''}>${STATUS_BADGES[s]?.label || s}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Priority</label>
          <select name="priority" style="${dropdownStyle}">
            ${['low', 'medium', 'high', 'urgent'].map(p =>
              `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Vessel</label>
          <select name="vessel" style="${dropdownStyle}">
            <option value="">Any / All</option>
            ${VESSELS.map(v => `<option value="${v}" ${task.vessel === v ? 'selected' : ''}>${VESSEL_LABELS[v]}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Assign To</label>
          <select name="assigned_to" style="${dropdownStyle}">
            <option value="">Unassigned</option>
            ${crewList.rows.map((cr: any) => `<option value="${cr.id}" ${task.assigned_to === cr.id ? 'selected' : ''}>${escapeHtml(cr.name)} (${cr.role})</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Due Date</label>
          <input type="date" name="due_date" value="${task.due_date ? task.due_date.split('T')[0] : ''}" style="${inputStyle}">
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Est. Minutes</label>
          <input type="number" name="estimated_minutes" min="1" max="480" value="${task.estimated_minutes || ''}" style="${inputStyle}" placeholder="e.g. 30">
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Snooze Until</label>
          <input type="date" name="snoozed_until" value="${task.snoozed_until || ''}" style="${inputStyle}">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Notes</label>
        <textarea name="notes" style="${textareaStyle};min-height:120px" placeholder="Warranty info, vendor contacts, blocked reason...">${escapeHtml(task.notes || '')}</textarea>
      </div>

      <div style="display:flex;gap:8px">
        <button type="submit" style="flex:1;padding:14px;background:#1A6B8A;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">Save Changes</button>
        ${task.status !== 'snoozed' ? `<button type="submit" name="snooze" value="1" style="padding:14px 20px;background:#FFFFFF;border:2px solid #bdc9c2;border-radius:8px;font-size:0.875rem;font-weight:500;cursor:pointer;color:#6e7a74;min-height:48px">Snooze 90d</button>` : ''}
      </div>
    </form>

    ${task.source_submission_id ? `<div style="margin-top:16px;font-size:0.75rem;color:#6e7a74">Created from <a href="/report/inbox/${escapeHtml(task.source_submission_id)}" style="color:#1A6B8A">crew submission</a></div>` : ''}
    ${task.completed_at ? `<div style="margin-top:8px;font-size:0.75rem;color:#6e7a74">Completed ${new Date(task.completed_at).toLocaleString()}</div>` : ''}
    <div style="margin-top:4px;font-size:0.6875rem;color:#9ca3af">Created ${new Date(task.created_at).toLocaleString()}</div>
  `));
});

// ─── HTMX PARTIAL ENDPOINTS (inline editing) ────────────────

// Inline status change — returns just the updated card
app.patch('/report/tasks/:id/status', async (c) => {
  const taskId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const newStatus = String(body.status || 'pending');

  const completedAt = newStatus === 'completed' ? 'NOW()' : 'completed_at';
  const startedAt = newStatus === 'in-progress' ? 'COALESCE(started_at, NOW())' : 'started_at';

  await pool.query(
    `UPDATE assigned_tasks SET status = $1, completed_at = ${completedAt}, started_at = ${startedAt}, updated_at = NOW() WHERE id = $2`,
    [newStatus, taskId]
  );

  return c.html(statusBadge(newStatus, true));
});

// Inline assignment — returns updated assignee display
app.patch('/report/tasks/:id/assign', async (c) => {
  const taskId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const crewId = String(body.crew_id || '');

  if (crewId) {
    await pool.query('UPDATE assigned_tasks SET assigned_to = $1, updated_at = NOW() WHERE id = $2', [crewId, taskId]);
    const crew = await pool.query('SELECT name FROM crew WHERE id = $1', [crewId]);
    const name = crew.rows[0]?.name || 'Unknown';
    return c.html(`<div style="width:24px;height:24px;border-radius:50%;background:#1A6B8A;color:white;display:flex;align-items:center;justify-content:center;font-size:0.5625rem;font-weight:700">${name.charAt(0)}</div>`);
  } else {
    await pool.query('UPDATE assigned_tasks SET assigned_to = NULL, updated_at = NOW() WHERE id = $1', [taskId]);
    return c.html('<span style="font-size:0.6875rem;color:#c7c7cc">Unassigned</span>');
  }
});

// Get crew dropdown for inline assignment
app.get('/report/tasks/:id/assign-dropdown', async (c) => {
  const taskId = c.req.param('id');
  const crewList = await pool.query('SELECT id, name, role FROM crew WHERE active = TRUE ORDER BY role, name');
  const task = await pool.query('SELECT assigned_to FROM assigned_tasks WHERE id = $1', [taskId]);
  const currentAssignee = task.rows[0]?.assigned_to || '';

  const options = crewList.rows.map((cr: any) =>
    `<button type="button" onclick="event.stopPropagation();htmx.ajax('PATCH','/report/tasks/${taskId}/assign',{target:'#assignee-${taskId}',swap:'innerHTML',values:{crew_id:'${cr.id}'}});this.closest('.htmx-dropdown').remove()" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:${cr.id === currentAssignee ? 'rgba(26,107,138,0.08)' : 'transparent'};font-size:0.8125rem;font-weight:${cr.id === currentAssignee ? '700' : '400'};color:#1a1c1e;cursor:pointer;border-bottom:1px solid #F0F0F0" onmouseenter="this.style.background='#F8F9FA'" onmouseleave="this.style.background='transparent'">${escapeHtml(cr.name)} <span style="font-size:0.6875rem;color:#8E8E93">(${cr.role})</span></button>`
  ).join('');

  return c.html(`
    <div class="htmx-dropdown" style="position:absolute;top:100%;left:0;z-index:100;background:white;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.15);border:1px solid #E5E5EA;min-width:200px;max-height:280px;overflow-y:auto;margin-top:4px" onclick="event.stopPropagation()">
      <div style="padding:8px 14px;font-size:0.625rem;font-weight:700;color:#8E8E93;text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid #F0F0F0">Assign To</div>
      <button type="button" onclick="event.stopPropagation();htmx.ajax('PATCH','/report/tasks/${taskId}/assign',{target:'#assignee-${taskId}',swap:'innerHTML',values:{crew_id:''}});this.closest('.htmx-dropdown').remove()" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;font-size:0.8125rem;color:#8E8E93;cursor:pointer;border-bottom:1px solid #F0F0F0;font-style:italic">Unassigned</button>
      ${options}
    </div>
  `);
});

// Get status dropdown for inline change
app.get('/report/tasks/:id/status-dropdown', async (c) => {
  const taskId = c.req.param('id');
  const statuses = [
    { value: 'pending', label: 'In Queue', color: '#8E8E93' },
    { value: 'in-progress', label: 'In Progress', color: '#1A6B8A' },
    { value: 'blocked', label: 'Blocked', color: '#FF3B30' },
    { value: 'completed', label: 'Completed', color: '#34C759' },
    { value: 'snoozed', label: 'Snoozed', color: '#8E8E93' },
  ];

  const buttons = statuses.map(s =>
    `<button type="button" onclick="event.stopPropagation();htmx.ajax('PATCH','/report/tasks/${taskId}/status',{target:'#status-${taskId}',swap:'innerHTML',values:{status:'${s.value}'}});this.closest('.htmx-dropdown').remove()" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;font-size:0.8125rem;color:${s.color};font-weight:600;cursor:pointer;border-bottom:1px solid #F0F0F0" onmouseenter="this.style.background='#F8F9FA'" onmouseleave="this.style.background='transparent'">${s.label}</button>`
  ).join('');

  return c.html(`
    <div class="htmx-dropdown" style="position:absolute;top:100%;left:0;z-index:100;background:white;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.15);border:1px solid #E5E5EA;min-width:160px;margin-top:4px" onclick="event.stopPropagation()">
      <div style="padding:8px 14px;font-size:0.625rem;font-weight:700;color:#8E8E93;text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid #F0F0F0">Status</div>
      ${buttons}
    </div>
  `);
});

// ─── Full form POST (existing) ──────────────────────────────

app.post('/report/tasks/:id', async (c) => {
  const taskId = c.req.param('id');
  const body = await c.req.parseBody();

  // Handle snooze shortcut
  if (body.snooze === '1') {
    const snoozeDate = new Date();
    snoozeDate.setDate(snoozeDate.getDate() + 90);
    const snoozeDateStr = snoozeDate.toISOString().split('T')[0];
    await pool.query(
      `UPDATE assigned_tasks SET status = 'snoozed', snoozed_until = $1, updated_at = NOW() WHERE id = $2`,
      [snoozeDateStr, taskId]
    );
    return c.redirect('/report/tasks');
  }

  const newStatus = String(body.status || 'pending');
  const completedAt = newStatus === 'completed' ? 'NOW()' : null;

  const estMinEdit = parseInt(String(body.estimated_minutes || ''), 10);
  await pool.query(
    `UPDATE assigned_tasks SET
       title = $1, description = $2, status = $3, priority = $4,
       vessel = $5, assigned_to = $6, due_date = $7, notes = $8,
       snoozed_until = $9, estimated_minutes = $10,
       completed_at = ${completedAt ? 'NOW()' : 'completed_at'},
       updated_at = NOW()
     WHERE id = $11`,
    [
      String(body.title || '').trim(),
      String(body.description || '').trim() || null,
      newStatus,
      String(body.priority || 'medium'),
      String(body.vessel || '') || null,
      String(body.assigned_to || '') || null,
      String(body.due_date || '') || null,
      String(body.notes || '').trim() || null,
      newStatus === 'snoozed' ? (String(body.snoozed_until || '') || null) : null,
      isNaN(estMinEdit) ? null : estMinEdit,
      taskId,
    ]
  );

  return c.redirect(`/report/tasks/${taskId}?saved=1`);
});

// ─── INBOX (Crew Submissions) ───────────────────────────────

app.get('/report/inbox', async (c) => {
  const statusFilter = c.req.query('status') || '';
  const vesselFilter = c.req.query('vessel') || '';

  let where = 'WHERE 1=1';
  const params: any[] = [];
  let paramIdx = 1;

  if (statusFilter) {
    where += ` AND s.status = $${paramIdx++}`;
    params.push(statusFilter);
  }
  if (vesselFilter) {
    where += ` AND s.vessel = $${paramIdx++}`;
    params.push(vesselFilter);
  }

  const result = await pool.query(
    `SELECT s.*, cr.name as crew_name
     FROM submissions s
     JOIN crew cr ON s.crew_id = cr.id
     ${where}
     ORDER BY
       CASE s.status WHEN 'new' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'in-progress' THEN 2 ELSE 3 END,
       s.created_at DESC`,
    params
  );

  const submissions = result.rows;

  const subCards = submissions.map((s: any) => {
    const icon = CATEGORY_ICONS[s.category] || '💬';
    const catLabel = s.category.replace('-', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const time = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const sBadge = s.status === 'new'
      ? '<span style="font-size:0.6875rem;padding:2px 8px;border-radius:12px;background:rgba(243,109,79,0.12);color:#F36D4F;font-weight:500">New</span>'
      : statusBadge(s.status);

    return `
      <a href="/report/inbox/${s.id}" style="display:block;text-decoration:none;color:inherit;background:#FFFFFF;border-radius:8px;padding:12px 16px;margin-bottom:6px;border-left:4px solid ${s.status === 'new' ? '#F36D4F' : '#bdc9c2'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px">
              <span>${icon}</span>
              <span style="font-weight:600;font-size:0.875rem">${escapeHtml(s.title)}</span>
              ${sBadge}
            </div>
            <div style="font-size:0.75rem;color:#6e7a74;margin-top:4px">
              ${escapeHtml(s.crew_name)} · ${VESSEL_LABELS[s.vessel] || s.vessel} · ${catLabel} · ${time}
            </div>
          </div>
          <span style="color:#6e7a74;font-size:0.875rem;flex-shrink:0;margin-left:8px">→</span>
        </div>
      </a>`;
  }).join('');

  const filterHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      <select onchange="window.location='/report/inbox?status='+this.value+'${vesselFilter ? '&vessel=' + vesselFilter : ''}'" style="${dropdownStyle}">
        <option value="">All Status</option>
        ${['new', 'reviewed', 'in-progress', 'resolved'].map(s =>
          `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
        ).join('')}
      </select>
      <select onchange="window.location='/report/inbox?vessel='+this.value+'${statusFilter ? '&status=' + statusFilter : ''}'" style="${dropdownStyle}">
        <option value="">All Vessels</option>
        ${VESSELS.map(v =>
          `<option value="${v}" ${vesselFilter === v ? 'selected' : ''}>${VESSEL_LABELS[v]}</option>`
        ).join('')}
      </select>
    </div>`;

  const newCount = submissions.filter((s: any) => s.status === 'new').length;

  return c.html(reportLayout('Inbox', `
    ${subNav('inbox')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700">Crew Submissions</h2>
      ${newCount > 0 ? `<span style="background:rgba(243,109,79,0.12);color:#F36D4F;padding:4px 10px;border-radius:12px;font-size:0.8125rem;font-weight:600">${newCount} new</span>` : ''}
    </div>
    ${filterHtml}
    ${submissions.length === 0 ? '<p style="text-align:center;color:#6e7a74;padding:40px 0">No submissions yet.</p>' : subCards}
  `));
});

app.get('/report/inbox/:id', async (c) => {
  const subId = c.req.param('id');
  const result = await pool.query(
    `SELECT s.*, cr.name as crew_name FROM submissions s JOIN crew cr ON s.crew_id = cr.id WHERE s.id = $1`,
    [subId]
  );
  const sub = result.rows[0];
  if (!sub) return c.html(reportLayout('Inbox', '<p style="color:#F36D4F">Submission not found.</p><a href="/report/inbox" style="color:#1A6B8A">← Back</a>'));

  const saved = c.req.query('saved') === '1';
  const icon = CATEGORY_ICONS[sub.category] || '💬';
  const catLabel = sub.category.replace('-', ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
  const time = new Date(sub.created_at).toLocaleString();

  return c.html(reportLayout('Inbox', `
    ${subNav('inbox')}
    <div style="margin-bottom:16px">
      <a href="/report/inbox" style="color:#1A6B8A;text-decoration:none;font-size:0.875rem">← Back to inbox</a>
    </div>

    ${saved ? '<div style="padding:10px 16px;background:rgba(26,107,138,0.08);border-radius:8px;margin-bottom:12px;font-size:0.875rem;color:#1A6B8A;text-align:center">✓ Submission updated</div>' : ''}

    <div style="background:#FFFFFF;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:1.25rem">${icon}</span>
        <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700">${escapeHtml(sub.title)}</h2>
      </div>
      <div style="font-size:0.8125rem;color:#6e7a74;margin-bottom:12px">${escapeHtml(sub.crew_name)} · ${VESSEL_LABELS[sub.vessel] || sub.vessel} · ${catLabel} · ${time}</div>
      ${sub.details ? `<div style="font-size:0.9375rem;line-height:1.6;padding:12px;background:rgba(26,107,138,0.03);border-radius:6px">${escapeHtml(sub.details)}</div>` : '<p style="color:#6e7a74;font-style:italic">No additional details</p>'}
    </div>

    <form action="/report/inbox/${escapeHtml(subId)}" method="POST">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Status</label>
          <select name="status" style="${dropdownStyle}">
            ${['new', 'reviewed', 'in-progress', 'resolved'].map(s =>
              `<option value="${s}" ${sub.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Priority</label>
          <select name="priority" style="${dropdownStyle}">
            <option value="">Not set</option>
            ${['low', 'medium', 'high', 'urgent'].map(p =>
              `<option value="${p}" ${sub.priority === p ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Resolution Note</label>
        <textarea name="resolution_note" style="${textareaStyle}" placeholder="What was done...">${escapeHtml(sub.resolution_note || '')}</textarea>
      </div>

      <div style="display:flex;gap:8px">
        <button type="submit" style="flex:1;padding:14px;background:#1A6B8A;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">Update Submission</button>
        <a href="/report/tasks/create?from_submission=${escapeHtml(subId)}" style="display:flex;align-items:center;justify-content:center;padding:14px 16px;background:#FFFFFF;border:2px solid #1A6B8A;border-radius:8px;font-size:0.875rem;font-weight:600;text-decoration:none;color:#1A6B8A;min-height:48px;white-space:nowrap">→ Create Task</a>
      </div>
    </form>
  `));
});

app.post('/report/inbox/:id', async (c) => {
  const subId = c.req.param('id');
  const body = await c.req.parseBody();

  await pool.query(
    `UPDATE submissions SET status = $1, priority = $2, resolution_note = $3, reviewed_by = 'manager', updated_at = NOW() WHERE id = $4`,
    [
      String(body.status || 'new'),
      String(body.priority || '') || null,
      String(body.resolution_note || '').trim() || null,
      subId,
    ]
  );

  return c.redirect(`/report/inbox/${subId}?saved=1`);
});

// ─── DMT SCHEDULE ───────────────────────────────────────────

app.get('/report/schedule', async (c) => {
  const weekOffset = parseInt(c.req.query('week') || '0', 10);

  // Calculate the Monday of the target week
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + (weekOffset * 7));

  const days: string[] = [];
  const dayLabels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
    dayLabels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
  }

  const todayStr = today.toISOString().split('T')[0];

  // Get scheduled templates per vessel per role
  const scheduleData: Record<string, { captain: any[]; deckhand: any[] }> = {};
  for (const vessel of VESSELS) {
    const captainSchedule = previewSchedule(vessel, 'captain', monday, 7);
    const deckhandSchedule = previewSchedule(vessel, 'deckhand', monday, 7);
    scheduleData[vessel] = { captain: captainSchedule, deckhand: deckhandSchedule };
  }

  // Get completions for the week
  const completionsResult = await pool.query(
    `SELECT template_id, vessel, trip_date, crew_id FROM completions
     WHERE trip_date >= $1 AND trip_date <= $2`,
    [days[0], days[6]]
  );

  const completionSet = new Set<string>();
  for (const row of completionsResult.rows) {
    completionSet.add(`${row.vessel}:${row.template_id}:${row.trip_date}`);
  }

  // Render schedule grid per vessel
  const vesselGrids = VESSELS.map(vessel => {
    const data = scheduleData[vessel];
    if (!data) return '';

    // Only show vessels that have scheduled templates
    const hasAny = data.captain.some(d => d.templates.length > 0) || data.deckhand.some(d => d.templates.length > 0);
    if (!hasAny) return '';

    const rows = days.map((date, i) => {
      const isToday = date === todayStr;
      const captainTemplates = data.captain[i]?.templates.filter((t: any) => !t.superseded) || [];
      const deckhandTemplates = data.deckhand[i]?.templates.filter((t: any) => !t.superseded) || [];

      const renderTemplates = (templates: any[]) => templates.map(t => {
        const done = completionSet.has(`${vessel}:${t.id}:${date}`);
        const name = t.name.replace(/\s*—\s*(Captain|Deckhand|Mate)$/i, '');
        return `<span style="font-size:0.6875rem;${done ? 'color:#1A6B8A' : isToday ? 'color:#1a1c1c;font-weight:600' : 'color:#6e7a74'}">${done ? '✓' : '○'} ${escapeHtml(name)}</span>`;
      }).join('<br>');

      return `
        <tr style="${isToday ? 'background:rgba(26,107,138,0.04)' : ''}">
          <td style="padding:8px;font-size:0.8125rem;font-weight:${isToday ? '600' : '400'};color:${isToday ? '#1A6B8A' : '#1a1c1c'};white-space:nowrap;vertical-align:top">${dayLabels[i]}</td>
          <td style="padding:8px;vertical-align:top">${captainTemplates.length > 0 ? renderTemplates(captainTemplates) : '<span style="font-size:0.6875rem;color:#bdc9c2">—</span>'}</td>
          <td style="padding:8px;vertical-align:top">${deckhandTemplates.length > 0 ? renderTemplates(deckhandTemplates) : '<span style="font-size:0.6875rem;color:#bdc9c2">—</span>'}</td>
        </tr>`;
    }).join('');

    return `
      <div style="margin-bottom:24px">
        <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:0.875rem;font-weight:700;color:#1A6B8A;margin-bottom:8px">${VESSEL_LABELS[vessel] || vessel}</h3>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;background:#FFFFFF;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="border-bottom:2px solid #bdc9c2">
                <th style="padding:8px;text-align:left;font-size:0.75rem;color:#6e7a74;font-weight:600">Day</th>
                <th style="padding:8px;text-align:left;font-size:0.75rem;color:#6e7a74;font-weight:600">Captain</th>
                <th style="padding:8px;text-align:left;font-size:0.75rem;color:#6e7a74;font-weight:600">Deckhand</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  const weekLabel = `${new Date(days[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${new Date(days[6]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return c.html(reportLayout('Schedule', `
    ${subNav('schedule')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <a href="/report/schedule?week=${weekOffset - 1}" style="padding:8px 12px;background:#FFFFFF;border:1px solid #bdc9c2;border-radius:6px;text-decoration:none;color:#1A6B8A;font-size:0.875rem;min-height:36px;display:flex;align-items:center">← Prev</a>
      <span style="font-weight:600;font-size:0.9375rem">${weekLabel}</span>
      <a href="/report/schedule?week=${weekOffset + 1}" style="padding:8px 12px;background:#FFFFFF;border:1px solid #bdc9c2;border-radius:6px;text-decoration:none;color:#1A6B8A;font-size:0.875rem;min-height:36px;display:flex;align-items:center">Next →</a>
    </div>
    ${weekOffset !== 0 ? `<a href="/report/schedule" style="display:block;text-align:center;font-size:0.75rem;color:#1A6B8A;margin-bottom:12px">Jump to this week</a>` : ''}
    ${vesselGrids || '<p style="text-align:center;color:#6e7a74;padding:40px 0">No scheduled templates found.</p>'}
    <div style="text-align:center;padding:8px;font-size:0.6875rem;color:#6e7a74">✓ = completed · ○ = pending</div>
  `));
});

export default app;
