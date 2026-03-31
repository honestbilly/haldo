import { Hono } from 'hono';
import pool from '../db.js';
import { getSession } from './session.js';
import { getTemplatesForContext, getOnDemandTemplates } from '../services/templates.js';
import { bottomNav } from '../ui.js';
import type { Template, ChecklistTemplate, LogbookTemplate, SessionData } from '../types.js';
import { getWeatherSummary } from '../services/weather/weather-cache.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

// Middleware: require session
app.use('/today', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

// Today's list
app.get('/today', async (c) => {
  const session = c.get('session');
  // Parse date as local (not UTC) to avoid timezone shift
  const [y, m, d] = session.trip_date.split('-').map(Number);
  const tripDate = new Date(y, m - 1, d);
  const templates = getTemplatesForContext(session.vessel, session.role, tripDate);
  const onDemand = getOnDemandTemplates(session.vessel, session.role);

  // Get today's completions for this crew member
  const completions = await pool.query(
    `SELECT template_id, trip_slot, completed_at FROM completions
     WHERE crew_id = $1 AND trip_date = $2 AND vessel = $3`,
    [session.crew_id, session.trip_date, session.vessel]
  );

  const completedMap = new Map<string, { trip_slot: string | null; completed_at: Date }[]>();
  for (const row of completions.rows) {
    const key = row.template_id;
    if (!completedMap.has(key)) completedMap.set(key, []);
    completedMap.get(key)!.push({ trip_slot: row.trip_slot, completed_at: row.completed_at });
  }

  // Count active handoff notes for this vessel
  const handoffResult = await pool.query(
    'SELECT COUNT(*) FROM handoff_notes WHERE vessel = $1 AND resolved = FALSE',
    [session.vessel]
  );
  const handoffCount = parseInt(handoffResult.rows[0].count);

  // Get the other role's checklist status for today (captain sees deckhand, deckhand sees captain)
  const otherRole = session.role === 'captain' ? 'deckhand' : 'captain';
  const otherRoleLabel = session.role === 'captain' ? 'Deckhand' : 'Captain';
  const otherTemplates = getTemplatesForContext(session.vessel, otherRole, tripDate);
  const otherComps = await pool.query(
    `SELECT co.template_id, co.completed_at, cr.name as crew_name FROM completions co
     JOIN crew cr ON co.crew_id = cr.id
     WHERE co.trip_date = $1 AND co.vessel = $2 AND cr.role = $3`,
    [session.trip_date, session.vessel, otherRole]
  );
  const otherCompSet = new Set(otherComps.rows.map((r: any) => r.template_id));
  const otherCrewName = otherComps.rows.length > 0 ? otherComps.rows[0].crew_name : null;
  const crewmateStatus = otherTemplates.map(t => ({
    template_name: t.name.replace(/\s*—\s*(Captain|Deckhand|Mate)$/i, ''),
    template_id: t.id,
    done: otherCompSet.has(t.id),
    crew_name: otherCrewName,
    role_label: otherRoleLabel,
  }));

  // Get maintenance tasks for this vessel (active, not snoozed/completed/cancelled)
  const tasksResult = await pool.query(
    `SELECT t.*, ca.name as assignee_name
     FROM assigned_tasks t
     LEFT JOIN crew ca ON t.assigned_to = ca.id
     WHERE (t.vessel = $1 OR t.vessel IS NULL)
       AND t.status NOT IN ('completed', 'cancelled', 'snoozed')
       AND (t.assigned_to = $2 OR t.assigned_to IS NULL)
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       t.due_date ASC NULLS LAST`,
    [session.vessel, session.crew_id]
  );
  const maintenanceTasks = tasksResult.rows;

  const weather = getWeatherSummary();
  return c.html(renderTodayList(session, templates, onDemand, completedMap, handoffCount, crewmateStatus, weather, maintenanceTasks));
});

function renderWeatherCard(weather: any): string {
  if (!weather) {
    return `
      <a href="/weather" style="display:block;text-decoration:none;color:inherit;background:linear-gradient(135deg, #006950 0%, #004D3A 100%);border-radius:12px;padding:14px 16px;margin-bottom:12px;min-height:48px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:0.8125rem;color:rgba(255,255,255,0.7)">Weather loading...</span>
          <span style="color:rgba(255,255,255,0.5)">→</span>
        </div>
      </a>`;
  }

  const nextTide = weather.tideEvents[0];
  const tideStr = nextTide
    ? `${nextTide.type === 'H' ? 'High' : 'Low'} ${nextTide.height_ft.toFixed(1)}ft ${nextTide.time.split(' ')[1] ?? ''}`
    : '';

  const alertBanner = weather.alerts.length > 0
    ? `<div style="background:rgba(245,158,11,0.2);border-radius:6px;padding:4px 8px;margin-top:6px;font-size:0.6875rem;color:#FEF3C7">⚠ ${weather.alerts[0].event}</div>`
    : '';

  return `
    <a href="/weather" style="display:block;text-decoration:none;color:inherit;background:linear-gradient(135deg, #006950 0%, #004D3A 100%);border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:1.5rem;font-weight:700;color:white">${weather.currentTemp ? Math.round(weather.currentTemp) + '°' : '--°'}</div>
          <div style="font-size:0.8125rem;color:rgba(255,255,255,0.8)">${weather.conditions}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:0.875rem;color:rgba(255,255,255,0.9)">
            ${Math.round(weather.windSpeed)} kts ${weather.windDirection}
            ${weather.windGust > weather.windSpeed + 3 ? `<span style="color:rgba(255,255,255,0.6)">g${Math.round(weather.windGust)}</span>` : ''}
          </div>
          ${weather.precipChance > 0 ? `<div style="font-size:0.75rem;color:rgba(255,255,255,0.7)">Rain ${weather.precipChance}%</div>` : ''}
          ${tideStr ? `<div style="font-size:0.75rem;color:rgba(255,255,255,0.6);margin-top:2px">${tideStr}</div>` : ''}
        </div>
      </div>
      ${alertBanner}
    </a>`;
}

function renderTodayList(
  session: any,
  templates: Template[],
  onDemand: Template[],
  completedMap: Map<string, any[]>,
  handoffCount: number = 0,
  crewmateStatus: { template_name: string; template_id: string; done: boolean; crew_name: string | null; role_label: string }[] = [],
  weather: any = null,
  maintenanceTasks: any[] = []
): string {
  const renderCard = (t: Template, pinned: boolean = false) => {
    const comps = completedMap.get(t.id) || [];
    const isDone = t.type === 'logbook' || (t.type === 'checklist' && (t as ChecklistTemplate).recurrence === 'per-trip')
      ? comps.some(c => c.trip_slot === session.trip_slot)
      : comps.length > 0;

    const est = t.type === 'checklist'
      ? (t as ChecklistTemplate).estimated_minutes
      : (t as LogbookTemplate).estimated_minutes;

    if (pinned) {
      // DMT pinned card — extract today's task name from section titles
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const [y, m, d] = session.trip_date.split('-').map(Number);
      const todayDay = dayNames[new Date(y, m - 1, d).getDay()];
      // Find today's section and extract the task name (after the dash)
      let taskName = 'Daily Maintenance';
      if (t.type === 'checklist') {
        const ct = t as ChecklistTemplate;
        const todaySection = ct.sections?.find(s => s.title.toLowerCase().startsWith(todayDay.toLowerCase()));
        if (todaySection) {
          const dashIdx = todaySection.title.indexOf('—');
          taskName = dashIdx > -1 ? todaySection.title.substring(dashIdx + 1).trim() : todaySection.title;
        }
      }
      return `
        <a href="/c/${t.id}" class="today-card dmt-pinned ${isDone ? 'done' : ''}">
          <div class="dmt-pinned-label">⚡ TODAY'S DMT</div>
          <div class="today-card-info">
            <span class="today-card-name">${taskName}</span>
            ${est ? `<span class="today-card-time">~${est} min</span>` : ''}
          </div>
          <span class="today-card-status ${isDone ? 'status-done' : 'status-pending'}">
            ${isDone ? '✓ Done' : 'Not done'}
          </span>
        </a>`;
    }

    // Strip role suffix from display name (crew only sees their own role's checklists)
    const displayName = t.name.replace(/\s*—\s*(Captain|Deckhand|Mate)$/i, '');
    return `
      <a href="/c/${t.id}" class="today-card ${isDone ? 'done' : ''}">
        <div class="today-card-info">
          <span class="today-card-name">${displayName}</span>
          ${est ? `<span class="today-card-time">~${est} min</span>` : ''}
        </div>
        <span class="today-card-status ${isDone ? 'status-done' : 'status-pending'}">
          ${isDone ? '✓ Done' : 'Not started'}
        </span>
      </a>`;
  };

  // Separate DMT from regular templates
  const dmt = templates.find(t => t.id.startsWith('daily-maintenance'));
  const regularTemplates = templates.filter(t => !t.id.startsWith('daily-maintenance'));
  const dmtHtml = dmt ? renderCard(dmt, true) : '';
  const items = regularTemplates.map(t => renderCard(t)).join('');

  // Assigned tasks: first expanded, rest collapsed
  const onDemandHtml = onDemand.length > 0 ? `
    <div class="on-demand-section">
      <h3 class="on-demand-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
        Assigned Tasks <span class="on-demand-count">${onDemand.length}</span>
        <span class="collapse-icon">▼</span>
      </h3>
      <div class="on-demand-list">
        ${onDemand.length > 0 ? renderCard(onDemand[0]) : ''}
        ${onDemand.length > 1 ? `
          <div class="on-demand-rest collapsed" id="more-tasks">
            ${onDemand.slice(1).map(t => renderCard(t)).join('')}
          </div>
          <button type="button" onclick="document.getElementById('more-tasks').classList.toggle('collapsed');this.textContent=this.textContent.includes('more')?'Show less':'${onDemand.length - 1} more tasks'" class="show-more-btn" style="width:100%;padding:8px;background:none;border:1px dashed var(--border);border-radius:var(--radius);color:var(--text-muted);font-size:0.75rem;cursor:pointer;margin-top:4px">${onDemand.length - 1} more tasks</button>
        ` : ''}
      </div>
    </div>` : '';

  // Maintenance tasks (from assigned_tasks table)
  const maintenanceHtml = maintenanceTasks.length > 0 ? `
    <div style="margin-top:16px;margin-bottom:16px">
      <h3 class="on-demand-header" style="cursor:default;display:flex;align-items:center;justify-content:space-between">
        <span>Maintenance Tasks</span>
        <span style="font-size:0.6875rem;background:rgba(112,208,235,0.15);color:#0C7DA0;padding:2px 8px;border-radius:10px">${maintenanceTasks.length}</span>
      </h3>
      ${maintenanceTasks.map((t: any) => {
        const isUnclaimed = !t.assigned_to;
        const priorityIcon = t.priority === 'urgent' ? '🔴 ' : t.priority === 'high' ? '⚠ ' : '';
        const statusColor = t.status === 'in-progress' ? 'var(--primary)' : t.status === 'blocked' ? '#F36D4F' : 'var(--text-muted)';
        const statusLabel = t.status === 'in-progress' ? 'In Progress' : t.status === 'blocked' ? 'Blocked' : isUnclaimed ? 'Tap to claim' : 'In Queue';
        const dueStr = t.due_date ? ` · Due ${new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
        return `
          <a href="/tasks/${t.id}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--surface);border-radius:var(--radius);margin-bottom:6px;text-decoration:none;color:var(--text);border-left:4px solid ${t.status === 'blocked' ? '#F36D4F' : '#70D0EB'};min-height:48px">
            <div>
              <div style="font-weight:500;font-size:0.875rem">${priorityIcon}${t.title}</div>
              <div style="font-size:0.6875rem;color:var(--text-muted)">${t.vessel ? t.vessel.toUpperCase() : 'Any'}${t.assignee_name ? ' · ' + t.assignee_name : ''}${dueStr}</div>
            </div>
            <span style="font-size:0.75rem;color:${statusColor};font-weight:500;white-space:nowrap">${statusLabel}</span>
          </a>`;
      }).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Today — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#006950">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>
<body>
  <div class="today-page">
    <header class="today-header">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>${session.crew_name} — ${session.vessel.toUpperCase()}</h1>
        <a href="/" style="font-size:0.75rem;color:var(--primary);text-decoration:none;padding:6px 10px;border:1px solid var(--border);border-radius:6px;white-space:nowrap">Switch</a>
      </div>
      <p>${session.trip_slot} Trip | ${(() => { const [y,m,d] = session.trip_date.split('-').map(Number); return new Date(y, m-1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); })()}</p>
    </header>
    ${renderWeatherCard(weather)}

    ${handoffCount > 0 ? `
    <a href="/handoff" class="handoff-banner" style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#FFF8E1;border:1px solid #F59E0B;border-radius:var(--radius);text-decoration:none;color:#92400E;margin-bottom:12px;min-height:48px">
      <span style="font-size:1.1rem">📝</span>
      <span style="flex:1;font-weight:500;font-size:0.875rem">${handoffCount} handoff note${handoffCount > 1 ? 's' : ''} from crew</span>
      <span style="color:#D97706">→</span>
    </a>` : ''}

    ${dmtHtml}

    <div class="today-list">
      ${items || '<p class="empty-state">No checklists scheduled for today.</p>'}
    </div>

    ${onDemandHtml}

    ${maintenanceHtml}

    ${crewmateStatus.length > 0 ? `
    <div style="margin-top:16px;margin-bottom:16px">
      <h3 class="on-demand-header" onclick="document.getElementById('crewmate-status').classList.toggle('collapsed')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between">
        <span>${crewmateStatus[0].role_label} Status${crewmateStatus[0].crew_name ? ` — ${crewmateStatus[0].crew_name}` : ''}</span>
        <span class="collapse-icon" style="font-size:0.75rem;color:var(--text-muted)">▼</span>
      </h3>
      <div id="crewmate-status" class="collapsed">
        ${crewmateStatus.map(ds => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:0.8125rem;color:${ds.done ? 'var(--primary)' : 'var(--text-muted)'}">
            <span style="font-size:1rem">${ds.done ? '✓' : '○'}</span>
            <span>${ds.template_name}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
      <a href="/log" style="display:inline-flex;align-items:center;gap:6px;padding:10px 14px;background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius);text-decoration:none;color:var(--text-muted);font-size:0.8125rem;font-weight:500;min-height:40px">
        <span style="color:var(--primary);font-weight:700">+</span> Log
      </a>
    </div>
  </div>
  ${bottomNav('home')}
  <script src="/public/app.js"></script>
</body>
</html>`;
}

export default app;
