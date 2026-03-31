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

  // Fetch active handoff notes for this vessel (full content, not just count)
  const handoffResult = await pool.query(
    `SELECT h.*, c.name as crew_display_name FROM handoff_notes h
     LEFT JOIN crew c ON h.crew_id = c.id
     WHERE h.vessel = $1 AND h.resolved = FALSE
     ORDER BY h.created_at DESC`,
    [session.vessel]
  );
  const handoffNotes = handoffResult.rows;

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

  // Get maintenance tasks ASSIGNED TO this crew member (not unassigned — those go in the queue)
  const tasksResult = await pool.query(
    `SELECT t.*, ca.name as assignee_name
     FROM assigned_tasks t
     LEFT JOIN crew ca ON t.assigned_to = ca.id
     WHERE (t.vessel = $1 OR t.vessel IS NULL)
       AND t.status NOT IN ('completed', 'cancelled', 'snoozed')
       AND t.assigned_to = $2
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       t.due_date ASC NULLS LAST`,
    [session.vessel, session.crew_id]
  );
  const myTasks = tasksResult.rows;

  // Count available tasks in the queue (unassigned, for this vessel)
  const queueResult = await pool.query(
    `SELECT COUNT(*) FROM assigned_tasks
     WHERE (vessel = $1 OR vessel IS NULL)
       AND assigned_to IS NULL
       AND status NOT IN ('completed', 'cancelled', 'snoozed')`,
    [session.vessel]
  );
  const queueCount = parseInt(queueResult.rows[0].count);

  const weather = getWeatherSummary();
  return c.html(renderTodayList(session, templates, onDemand, completedMap, handoffNotes, crewmateStatus, weather, myTasks, queueCount));
});

function renderWeatherCard(weather: any): string {
  if (!weather) {
    return `
      <a href="/weather" style="display:block;text-decoration:none;color:inherit;background:linear-gradient(135deg, #1A6B8A 0%, #004D3A 100%);border-radius:12px;padding:14px 16px;margin-bottom:12px;min-height:48px">
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
    <a href="/weather" style="display:block;text-decoration:none;color:inherit;background:linear-gradient(135deg, #1A6B8A 0%, #0D5470 100%);border-radius:16px;padding:24px 20px;margin-bottom:16px;position:relative;overflow:hidden;box-shadow:0 12px 32px rgba(0,40,40,0.12);min-height:140px">
      <div style="position:absolute;right:-16px;top:-16px;width:96px;height:96px;background:rgba(255,255,255,0.1);border-radius:50%;filter:blur(24px)"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;position:relative">
        <div>
          <div style="font-size:3rem;font-weight:800;color:white;letter-spacing:-0.02em;line-height:1">${weather.currentTemp ? Math.round(weather.currentTemp) + '°' : '--°'}</div>
          <div style="font-size:1.125rem;font-weight:500;color:rgba(255,255,255,0.9);margin-top:4px">${weather.conditions}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;font-weight:600;color:rgba(255,255,255,0.95);text-transform:uppercase;letter-spacing:0.05em">
            <span class="material-symbols-outlined" style="font-size:16px;color:rgba(255,255,255,0.8)">air</span>
            ${Math.round(weather.windSpeed)} kts ${weather.windDirection}${weather.windGust > weather.windSpeed + 3 ? ' g' + Math.round(weather.windGust) : ''}
          </div>
          ${weather.precipChance > 0 ? `<div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;font-weight:600;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:0.05em">
            <span class="material-symbols-outlined" style="font-size:16px;color:rgba(255,255,255,0.7)">water_drop</span>
            Rain ${weather.precipChance}%
          </div>` : ''}
          ${tideStr ? `<div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;font-weight:600;color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:0.05em">
            <span class="material-symbols-outlined" style="font-size:16px;color:rgba(255,255,255,0.6)">waves</span>
            ${tideStr}
          </div>` : ''}
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
  handoffNotes: any[] = [],
  crewmateStatus: { template_name: string; template_id: string; done: boolean; crew_name: string | null; role_label: string }[] = [],
  weather: any = null,
  myTasks: any[] = [],
  queueCount: number = 0
): string {
  // Stitch card pattern: white card, 12px radius, 20px padding, shadow-sm, 6px absolute left bar, 72px min-height
  const stitchCard = (href: string, title: string, subtitle: string, statusText: string, leftBarColor: string, isDone: boolean) => `
    <a href="${href}" style="display:flex;align-items:center;justify-content:space-between;min-height:72px;background:white;border-radius:12px;padding:20px;padding-left:26px;box-shadow:0 2px 8px rgba(0,0,0,0.04);text-decoration:none;color:#1a1c1e;position:relative;overflow:hidden;transition:transform 0.15s;-webkit-tap-highlight-color:transparent" ontouchstart="this.style.transform='scale(0.99)'" ontouchend="this.style.transform='scale(1)'">
      <div style="position:absolute;left:0;top:0;bottom:0;width:6px;background:${leftBarColor}"></div>
      <div style="display:flex;flex-direction:column;gap:2px">
        <h3 style="font-weight:700;font-size:0.9375rem;color:#1a1c1e">${title}</h3>
        ${subtitle ? `<div style="display:flex;align-items:center;gap:6px;color:#5b5f67;font-size:0.75rem;font-weight:500"><span class="material-symbols-outlined" style="font-size:14px">schedule</span> ${subtitle}</div>` : ''}
      </div>
      <span style="font-weight:700;font-size:0.625rem;letter-spacing:0.1em;text-transform:uppercase;color:${isDone ? '#34C759' : '#5b5f67'}">${statusText}</span>
    </a>`;

  const renderCard = (t: Template, pinned: boolean = false) => {
    const comps = completedMap.get(t.id) || [];
    const isDone = t.type === 'logbook' || (t.type === 'checklist' && (t as ChecklistTemplate).recurrence === 'per-trip')
      ? comps.some(c => c.trip_slot === session.trip_slot)
      : comps.length > 0;

    const est = t.type === 'checklist'
      ? (t as ChecklistTemplate).estimated_minutes
      : (t as LogbookTemplate).estimated_minutes;
    const estStr = est ? `~${est} min` : '';

    if (pinned) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const [y, m, d] = session.trip_date.split('-').map(Number);
      const todayDay = dayNames[new Date(y, m - 1, d).getDay()];
      let taskName = 'Daily Maintenance';
      if (t.type === 'checklist') {
        const ct = t as ChecklistTemplate;
        const todaySection = ct.sections?.find(s => s.title.toLowerCase().startsWith(todayDay.toLowerCase()));
        if (todaySection) {
          const dashIdx = todaySection.title.indexOf('—');
          taskName = dashIdx > -1 ? todaySection.title.substring(dashIdx + 1).trim() : todaySection.title;
        }
      }
      // DMT card — Stitch pattern with bolt icon badge
      return `
        <a href="/c/${t.id}" style="display:block;background:white;border-radius:12px;padding:20px;padding-left:26px;box-shadow:0 2px 8px rgba(0,0,0,0.04);text-decoration:none;color:#1a1c1e;position:relative;overflow:hidden;min-height:72px;margin-bottom:12px;transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.99)'" ontouchend="this.style.transform='scale(1)'">
          <div style="position:absolute;left:0;top:0;bottom:0;width:6px;background:#1A6B8A"></div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="background:#1A6B8A;color:white;font-size:0.625rem;font-weight:900;padding:3px 8px;border-radius:4px;letter-spacing:-0.02em;display:flex;align-items:center;gap:4px"><span class="material-symbols-outlined" style="font-size:14px;font-variation-settings:'FILL' 1">bolt</span> TODAY'S DMT</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="font-weight:700;font-size:1rem">${taskName}</h3>
            <div style="text-align:right">
              ${estStr ? `<div style="font-size:0.75rem;color:#5b5f67;font-weight:500">${estStr}</div>` : ''}
              <div style="font-weight:700;font-size:0.625rem;letter-spacing:0.1em;text-transform:uppercase;color:${isDone ? '#34C759' : '#5b5f67'}">${isDone ? '✓ Done' : 'Not done'}</div>
            </div>
          </div>
        </a>`;
    }

    const displayName = t.name.replace(/\s*—\s*(Captain|Deckhand|Mate)$/i, '');
    const barColor = isDone ? '#34C759' : '#34C759'; // Green left bar for checklists (Stitch uses green-600)
    return stitchCard(`/c/${t.id}`, displayName, estStr, isDone ? '✓ Done' : 'Not started', barColor, isDone);
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

  // My assigned tasks (from assigned_tasks table — only tasks assigned to ME)
  const myTasksHtml = myTasks.length > 0 ? `
    <div style="margin-top:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px;margin-bottom:12px">
        <h2 style="font-family:var(--font-heading);font-weight:700;font-size:1.125rem;display:flex;align-items:center;gap:8px">
          <span class="material-symbols-outlined" style="color:#F36D4F;font-size:20px">assignment</span> Assigned Tasks
        </h2>
        <span style="font-size:0.625rem;font-weight:700;background:rgba(243,109,79,0.12);color:#F36D4F;padding:4px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:0.05em">${myTasks.length} active</span>
      </div>
      ${myTasks.map((t: any) => {
        const priorityIcon = t.priority === 'urgent' ? '<span class="material-symbols-outlined" style="font-size:18px;color:#ba1a1a">error</span> ' : t.priority === 'high' ? '<span class="material-symbols-outlined" style="font-size:18px;color:#F36D4F">warning</span> ' : '';
        const barColor = t.status === 'blocked' ? '#F36D4F' : '#F36D4F';
        const statusBg = t.status === 'in-progress' ? 'rgba(112,208,235,0.15)' : t.status === 'blocked' ? 'rgba(243,109,79,0.12)' : 'rgba(110,122,116,0.08)';
        const statusColor = t.status === 'in-progress' ? '#0C7DA0' : t.status === 'blocked' ? '#F36D4F' : '#8E8E93';
        const statusLabel = t.status === 'in-progress' ? 'IN PROGRESS' : t.status === 'blocked' ? 'BLOCKED' : 'TO DO';
        const dueStr = t.due_date ? ` · Due ${new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
        const estStr = t.estimated_minutes ? ` · ~${t.estimated_minutes}min` : '';
        return `
          <a href="/tasks/${t.id}" style="display:block;text-decoration:none;color:var(--text);background:var(--surface);border-radius:16px;padding:20px;margin-bottom:8px;position:relative;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);min-height:72px">
            <div style="position:absolute;left:0;top:0;bottom:0;width:6px;background:${barColor}"></div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <h3 style="font-weight:700;font-size:0.9375rem;display:flex;align-items:center;gap:6px">${priorityIcon}${t.title}</h3>
                <p style="font-size:0.75rem;color:var(--text-muted);font-weight:500;margin-top:4px">${t.vessel ? t.vessel.toUpperCase() : 'Any'}${dueStr}${estStr}</p>
              </div>
              <span style="font-size:0.5625rem;font-weight:800;padding:3px 8px;border-radius:999px;background:${statusBg};color:${statusColor};text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap">${statusLabel}</span>
            </div>
          </a>`;
      }).join('')}
    </div>` : '';

  // View all tasks link (filtered by vessel)
  const viewAllTasksHtml = `
    <a href="/tasks/queue" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;background:white;border-radius:12px;text-decoration:none;color:#1A6B8A;font-weight:600;font-size:0.875rem;box-shadow:0 1px 3px rgba(0,0,0,0.04);margin-bottom:16px;transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
      View All Tasks <span class="material-symbols-outlined" style="font-size:18px">arrow_forward</span>
    </a>`;

  const dateDisplay = (() => { const [y,m,d] = session.trip_date.split('-').map(Number); return new Date(y, m-1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <title>Today — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#1A6B8A">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>
<body style="background:#F2F2F7">
  <!-- Fixed Header with vessel pill -->
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;padding:0 20px;height:64px;padding-top:env(safe-area-inset-top,0)">
    <span style="font-size:0.8125rem;font-weight:600;color:#1a1c1e">${session.crew_name}</span>
    <button onclick="if(confirm('Switch vessel? Your checklists and tasks will change.')){window.location='/'}" style="background:#1A6B8A;color:white;border:none;padding:8px 20px;border-radius:999px;font-family:'Manrope',sans-serif;font-weight:700;font-size:0.875rem;letter-spacing:0.02em;cursor:pointer;-webkit-tap-highlight-color:transparent;box-shadow:0 2px 8px rgba(26,107,138,0.25)">${session.vessel.toUpperCase()}</button>
    <div style="width:32px;height:32px;border-radius:50%;background:#1A6B8A;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.8125rem">${session.crew_name.charAt(0)}</div>
  </header>

  <main style="padding:80px 16px 120px;max-width:480px;margin:0 auto;padding-top:calc(80px + env(safe-area-inset-top,0px))">
    <!-- Page Context: Vessel + Date (no trip slot) -->
    <section style="margin-bottom:20px">
      <h2 style="font-family:'Manrope',sans-serif;font-weight:800;font-size:1.75rem;color:#1a1c1e;letter-spacing:-0.02em">${session.vessel.toUpperCase()}</h2>
      <p style="font-size:0.9375rem;font-weight:500;color:#5b5f67">${dateDisplay}</p>
    </section>

    <!-- Compact weather strip (deranked) -->
    ${weather ? `
    <a href="/weather" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:white;border-radius:12px;text-decoration:none;color:#1a1c1e;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-family:'Manrope',sans-serif;font-weight:800;font-size:1.25rem">${weather.currentTemp ? Math.round(weather.currentTemp) + '°' : '--'}</span>
        <span style="font-size:0.8125rem;color:#5b5f67">${weather.conditions}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;font-size:0.75rem;color:#8E8E93">
        <span><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle">air</span> ${Math.round(weather.windSpeed)}kts ${weather.windDirection}</span>
        ${weather.precipChance > 5 ? `<span><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle">water_drop</span> ${weather.precipChance}%</span>` : ''}
        <span class="material-symbols-outlined" style="font-size:16px;color:#c7c7cc">chevron_right</span>
      </div>
    </a>` : ''}

    ${handoffNotes.length > 0 ? `
    <div style="background:var(--surface);border-radius:16px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
      <div style="position:absolute;left:0;top:0;bottom:0;width:6px;background:#70D0EB"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:700;font-size:0.625rem;color:#70D0EB;text-transform:uppercase;letter-spacing:0.1em">
          <span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px">sticky_note_2</span>
          ${session.vessel.toUpperCase()} Handoff Notes
        </span>
        <a href="/handoff" style="font-size:0.75rem;color:#70D0EB;text-decoration:none;font-weight:700;display:flex;align-items:center;gap:4px">View all <span class="material-symbols-outlined" style="font-size:14px">arrow_forward</span></a>
      </div>
      ${handoffNotes.slice(0, 3).map((n: any) => {
        const roleLabel = n.role === 'captain' ? 'Capt.' : 'DH';
        const name = n.crew_display_name || n.crew_name;
        return `<div style="padding:8px 0;border-top:1px solid rgba(112,208,235,0.15);font-size:0.8125rem;color:#1a1c1e;line-height:1.4">
          <span style="font-weight:700;color:#5b5f67;font-size:0.6875rem">${roleLabel} ${name}:</span>
          <span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${n.note}</span>
        </div>`;
      }).join('')}
      ${handoffNotes.length > 3 ? `<div style="font-size:0.75rem;color:#D97706;padding-top:4px">+${handoffNotes.length - 3} more</div>` : ''}
    </div>` : ''}

    <!-- Today's DMT -->
    ${dmtHtml}

    <!-- Daily Routine: 3 square cards in a row -->
    ${(() => {
      const routineTemplates = regularTemplates.filter(t =>
        t.id.startsWith('wakeup') || t.id.startsWith('between') || t.id.startsWith('put-to-bed')
      );
      const otherChecklists = regularTemplates.filter(t =>
        !t.id.startsWith('wakeup') && !t.id.startsWith('between') && !t.id.startsWith('put-to-bed') && t.type !== 'logbook'
      );

      const routineCards = [
        { prefix: 'wakeup', icon: 'coffee', label: 'Wake Up' },
        { prefix: 'between', icon: 'restaurant', label: 'Between' },
        { prefix: 'put-to-bed', icon: 'bed', label: 'Bed' },
      ];

      const routineHtml = routineCards.map(rc => {
        const tmpl = routineTemplates.find(t => t.id.startsWith(rc.prefix));
        if (!tmpl) return '';
        const comps = completedMap.get(tmpl.id) || [];
        const isDone = comps.length > 0;
        return `
          <a href="/c/${tmpl.id}" style="flex:1;background:white;border-radius:16px;padding:16px 8px;text-decoration:none;color:#1a1c1e;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.04);display:flex;flex-direction:column;align-items:center;gap:8px;min-height:100px;transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.96)'" ontouchend="this.style.transform='scale(1)'">
            <span class="material-symbols-outlined" style="font-size:28px;color:${isDone ? '#34C759' : '#1A6B8A'};${isDone ? "font-variation-settings:'FILL' 1" : ''}">${rc.icon}</span>
            <span style="font-size:0.75rem;font-weight:600">${rc.label}</span>
            <span class="material-symbols-outlined" style="font-size:20px;color:${isDone ? '#34C759' : '#c7c7cc'};${isDone ? "font-variation-settings:'FILL' 1" : ''}">${isDone ? 'check_circle' : 'radio_button_unchecked'}</span>
          </a>`;
      }).join('');

      const otherHtml = otherChecklists.map(t => {
        const comps2 = completedMap.get(t.id) || [];
        const isDone2 = comps2.length > 0;
        const displayName = t.name.replace(/\s*—\s*(Captain|Deckhand|Mate)$/i, '');
        const est2 = t.type === 'checklist' ? (t as ChecklistTemplate).estimated_minutes : (t as LogbookTemplate).estimated_minutes;
        return stitchCard(`/c/${t.id}`, displayName, est2 ? `~${est2} min` : '', isDone2 ? '✓ DONE' : 'NOT STARTED', isDone2 ? '#34C759' : '#34C759', isDone2);
      }).join('');

      return `
        <section style="margin-bottom:20px">
          <h2 style="font-size:0.6875rem;font-weight:700;letter-spacing:0.15em;color:#8E8E93;text-transform:uppercase;margin-bottom:12px;padding:0 4px">Daily Routine</h2>
          <div style="display:flex;gap:10px;margin-bottom:12px">
            ${routineHtml}
          </div>
        </section>
        ${otherHtml ? `<section style="margin-bottom:20px"><div style="display:flex;flex-direction:column;gap:12px">${otherHtml}</div></section>` : ''}`;
    })()}

    <!-- Logbook (visually separate) -->
    ${(() => {
      const logbooks = regularTemplates.filter(t => t.type === 'logbook');
      const logbookCards = templates.filter(t => t.type === 'logbook');
      if (logbookCards.length === 0) return '';
      return `
        <section style="margin-bottom:24px">
          <h2 style="font-size:0.6875rem;font-weight:700;letter-spacing:0.15em;color:#8E8E93;text-transform:uppercase;margin-bottom:12px;padding:0 4px">Logbook</h2>
          ${logbookCards.map(t => {
            const comps = completedMap.get(t.id) || [];
            const isDone = comps.some(c => c.trip_slot === session.trip_slot);
            const est = (t as LogbookTemplate).estimated_minutes;
            return stitchCard(`/c/${t.id}`, `${t.name}`, est ? `~${est} min` : '', isDone ? '✓ DONE' : 'NOT DONE', isDone ? '#34C759' : '#1A6B8A', isDone);
          }).join('')}
        </section>`;
    })()}

    ${onDemandHtml}

    ${myTasksHtml}
    ${viewAllTasksHtml}

    <!-- Crewmate Status -->
    ${crewmateStatus.length > 0 ? `
    <section style="margin-bottom:24px">
      <h2 style="font-family:'Manrope',sans-serif;font-weight:700;font-size:1.125rem;color:#1a1c1e;display:flex;align-items:center;gap:8px;padding:0 4px;margin-bottom:12px;cursor:pointer" onclick="document.getElementById('crewmate-status').style.display=document.getElementById('crewmate-status').style.display==='none'?'':'none'">
        <span class="material-symbols-outlined" style="color:#70D0EB;font-size:22px">group</span>
        ${crewmateStatus[0].role_label} Status${crewmateStatus[0].crew_name ? ` — ${crewmateStatus[0].crew_name}` : ''}
      </h2>
      <div id="crewmate-status" style="display:none;background:white;border-radius:12px;padding:8px 0;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
        ${crewmateStatus.map(ds => `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 20px;font-size:0.875rem;color:${ds.done ? '#34C759' : '#5b5f67'}">
            <span class="material-symbols-outlined" style="font-size:20px;${ds.done ? "font-variation-settings:'FILL' 1;color:#34C759" : 'color:#c7c7cc'}">${ds.done ? 'check_circle' : 'radio_button_unchecked'}</span>
            <span style="font-weight:${ds.done ? '600' : '400'}">${ds.template_name}</span>
          </div>`).join('')}
      </div>
    </section>` : ''}
  </main>
  ${bottomNav('home')}
  <script src="/public/app.js"></script>
</body>
</html>`;
}

export default app;
