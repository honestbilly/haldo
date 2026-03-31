import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { getSession } from './session.js';
import { getAuth } from './auth.js';
import { getTemplatesForContext, getTemplateById, getOnDemandTemplates, saveTemplate, loadTemplates } from '../services/templates.js';
import { evaluateAlerts, processAlerts } from '../services/alerts.js';
import type { Template, ChecklistTemplate, LogbookTemplate, Item, Section, LogbookStep, SessionData } from '../types.js';
import { bottomNav, htmlHead } from '../ui.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

// Middleware: require session
app.use('/today', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

app.use('/c/*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

app.use('/complete/*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

// Free-form log entry
app.get('/log', (c) => {
  const session = c.get('session');
  return c.html(renderFreeFormLog(session));
});

app.post('/log', async (c) => {
  const session = c.get('session');
  const body = await c.req.parseBody();
  const title = String(body.title || '').trim();
  const details = String(body.details || '').trim();
  const category = String(body.category || 'general');

  if (!title) return c.redirect('/log');

  const completionId = nanoid();
  await pool.query(
    `INSERT INTO completions (id, template_id, template_type, vessel, crew_id, trip_date, trip_slot,
     started_at, completed_at, values_json, notes, signed_off)
     VALUES ($1, 'free-form', 'log', $2, $3, $4, $5, NOW(), NOW(), $6, $7, FALSE)`,
    [
      completionId,
      session.vessel,
      session.crew_id,
      session.trip_date,
      session.trip_slot,
      JSON.stringify({ title, category, details }),
      details || null,
    ]
  );

  return c.redirect('/today');
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

  return c.html(renderTodayList(session, templates, onDemand, completedMap, handoffCount));
});

// Render a checklist or logbook form
app.get('/c/:templateId', async (c) => {
  const session = c.get('session');
  const template = getTemplateById(c.req.param('templateId'));
  if (!template) return c.notFound();

  // Check if manager is in edit mode
  const auth = getAuth(c as any);
  const canEdit = (session.auth_role === 'manager' || session.auth_role === 'admin')
    || (auth && (auth.auth_role === 'manager' || auth.auth_role === 'admin'))
    || !process.env.REQUIRE_AUTH; // Dev fallback
  const editMode = canEdit && c.req.query('edit') === '1';

  // For wake-up checklists, pre-fill engine hours from last completion
  let lastEngineHours: Record<string, string> = {};
  if (template.id.startsWith('wakeup-')) {
    const lastCompletion = await pool.query(
      `SELECT values_json FROM completions
       WHERE template_id = $1 AND vessel = $2 AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [template.id, session.vessel]
    );
    if (lastCompletion.rows.length > 0) {
      const vals = lastCompletion.rows[0].values_json;
      if (vals?.['engine-hours-port-start']) lastEngineHours['engine-hours-port-start'] = String(vals['engine-hours-port-start']);
      if (vals?.['engine-hours-stbd-start']) lastEngineHours['engine-hours-stbd-start'] = String(vals['engine-hours-stbd-start']);
    }
  }

  if (template.type === 'checklist') {
    const savedMsg = c.req.query('saved') === '1';
    return c.html(renderChecklist(session, template as ChecklistTemplate, lastEngineHours, !!editMode, !!canEdit, savedMsg));
  } else {
    return c.html(renderLogbook(session, template as LogbookTemplate));
  }
});

// Save in-place edits to a template (with rollback backup)
app.post('/c/:templateId/edit', async (c) => {
  // Allow edit if auth token says manager/admin, or if no REQUIRE_AUTH (dev mode)
  const auth = getAuth(c as any);
  const session = getSession(c as any);
  const isManager = (auth && (auth.auth_role === 'manager' || auth.auth_role === 'admin'))
    || (session?.auth_role === 'manager' || session?.auth_role === 'admin')
    || !process.env.REQUIRE_AUTH;
  if (!isManager) {
    return c.text('Unauthorized', 403);
  }

  const templateId = c.req.param('templateId');
  const template = getTemplateById(templateId);
  if (!template || template.type !== 'checklist') return c.notFound();

  // Save rollback backup before editing
  const { writeFile, mkdir } = await import('fs/promises');
  const { join } = await import('path');
  const backupDir = join(process.cwd(), 'templates', '.backups');
  try {
    await mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(backupDir, `${templateId}_${timestamp}.json`);
    await writeFile(backupPath, JSON.stringify(template, null, 2));
  } catch (e) {
    // Backup failure shouldn't block the save, but log it
    console.warn('[edit] Failed to create backup:', e);
  }

  const body = await c.req.parseBody();

  // Rebuild sections/items from the edited form data
  const checklist = template as ChecklistTemplate;
  for (const section of checklist.sections) {
    // Update section title
    const sectionTitleKey = `section_title_${section.title.replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (body[sectionTitleKey]) {
      section.title = String(body[sectionTitleKey]);
    }

    for (const item of section.items) {
      // Update item label
      const labelKey = `edit_label_${item.id}`;
      if (body[labelKey] !== undefined) {
        item.label = String(body[labelKey]);
      }

      // Update help text
      const helpTitleKey = `edit_help_title_${item.id}`;
      const helpBodyKey = `edit_help_body_${item.id}`;
      if (body[helpBodyKey] !== undefined) {
        const helpBody = String(body[helpBodyKey]).trim();
        const helpTitle = body[helpTitleKey] ? String(body[helpTitleKey]).trim() : (item.help?.title || '');
        if (helpBody) {
          item.help = { title: helpTitle || 'Help', body: helpBody };
        } else {
          delete (item as any).help;
        }
      }

      // Update info text
      const infoKey = `edit_info_${item.id}`;
      if (body[infoKey] !== undefined) {
        const info = String(body[infoKey]).trim();
        if (info) {
          item.info = info;
        } else {
          delete (item as any).info;
        }
      }
    }
  }

  // Save and reload
  checklist.version = new Date().toISOString().split('T')[0];
  await saveTemplate(checklist);
  await loadTemplates();

  return c.redirect(`/c/${templateId}?edit=1&saved=1`);
});

// Submit a completion
app.post('/c/:templateId', async (c) => {
  const session = c.get('session');
  const template = getTemplateById(c.req.param('templateId'));
  if (!template) return c.notFound();

  const body = await c.req.parseBody();
  const values: Record<string, unknown> = {};

  // Parse all form values
  for (const [key, val] of Object.entries(body)) {
    if (key.startsWith('item_')) {
      const itemId = key.replace('item_', '');
      values[itemId] = val;
    }
    // Handle multi_select (multiple checkboxes with same name)
    if (key.startsWith('multi_')) {
      const itemId = key.replace('multi_', '');
      if (!values[itemId]) values[itemId] = [];
      (values[itemId] as string[]).push(String(val));
    }
  }

  const notes = String(body.notes || '');
  const signedOff = body.sign_off === 'on';

  // Evaluate alerts
  const triggered = evaluateAlerts(template, values);

  // Save completion
  const completionId = nanoid();
  await pool.query(
    `INSERT INTO completions (id, template_id, template_type, vessel, crew_id, trip_date, trip_slot,
     started_at, completed_at, values_json, alerts_json, notes, signed_off)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8, $9, $10, $11)`,
    [
      completionId,
      template.id,
      template.type,
      session.vessel,
      session.crew_id,
      session.trip_date,
      session.trip_slot,
      JSON.stringify(values),
      triggered.length > 0 ? JSON.stringify(triggered) : null,
      notes || null,
      signedOff,
    ]
  );

  // Process alerts (save to DB + send email)
  if (triggered.length > 0) {
    await processAlerts(completionId, template.id, triggered, {
      vessel: session.vessel,
      crewName: session.crew_name,
      templateName: template.name,
    });
  }

  return c.redirect(`/complete/${completionId}?alerts=${triggered.length}`);
});

// Success screen
app.get('/complete/:id', (c) => {
  const session = c.get('session');
  const alertCount = Number(c.req.query('alerts') || 0);
  return c.html(renderSuccess(session, alertCount));
});

// ============================================================
// Render functions
// ============================================================

function renderTodayList(
  session: any,
  templates: Template[],
  onDemand: Template[],
  completedMap: Map<string, any[]>,
  handoffCount: number = 0
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

    return `
      <a href="/c/${t.id}" class="today-card ${isDone ? 'done' : ''}">
        <div class="today-card-info">
          <span class="today-card-name">${t.name}</span>
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
      <h1>${session.crew_name} — ${session.vessel.toUpperCase()}</h1>
      <p>${session.trip_slot} Trip | ${(() => { const [y,m,d] = session.trip_date.split('-').map(Number); return new Date(y, m-1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); })()}</p>
    </header>
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

function renderItemHtml(item: Item, prefix: string = 'item_', editMode: boolean = false): string {
  let mediaHtml = '';
  if (item.description_media?.length) {
    mediaHtml = item.description_media.map(m => {
      if (m.type === 'image') return `<img src="${m.url}" alt="${m.alt || m.caption || ''}" class="item-ref-image">`;
      if (m.type === 'video') return `<div class="item-video"><iframe src="https://www.youtube.com/embed/${extractYouTubeId(m.url)}" frameborder="0" allowfullscreen></iframe></div>`;
      if (m.type === 'link') return `<a href="${m.url}" target="_blank" class="item-link">${m.caption || m.url}</a>`;
      return '';
    }).join('') + (item.description_media[0]?.caption ? `<p class="media-caption">${item.description_media[0].caption}</p>` : '');
  }

  // Help and note buttons go in the label row; their expanded content goes BELOW
  // the label row so buttons don't shift position. Standard accordion pattern.
  let helpBtnHtml = '';
  let helpContentHtml = '';
  if (item.help) {
    helpBtnHtml = `<button type="button" class="help-toggle" onclick="toggleExpand('help-${item.id}')">?</button>`;
    helpContentHtml = editMode
      ? `<div class="help-box expanded" id="help-${item.id}" style="display:block">
          <input type="text" name="edit_help_title_${item.id}" value="${escapeAttr(item.help.title)}" class="edit-inline edit-bold" placeholder="Help title">
          <textarea name="edit_help_body_${item.id}" class="edit-inline edit-textarea" placeholder="Help body text">${escapeAttr(item.help.body)}</textarea>
        </div>`
      : `<div class="help-box" id="help-${item.id}">
          <strong>${item.help.title}</strong>
          <p>${item.help.body}</p>
        </div>`;
  } else if (editMode) {
    helpBtnHtml = `<button type="button" class="help-toggle" onclick="toggleExpand('help-${item.id}')" style="opacity:0.4">?</button>`;
    helpContentHtml = `
      <div class="help-box" id="help-${item.id}">
        <input type="text" name="edit_help_title_${item.id}" value="" class="edit-inline edit-bold" placeholder="+ Add help title">
        <textarea name="edit_help_body_${item.id}" class="edit-inline edit-textarea" placeholder="+ Add help text"></textarea>
      </div>`;
  }

  let sopHtml = '';
  if (item.sop) {
    const stepsHtml = item.sop.steps.map((s, i) => `<li>${s}</li>`).join('');
    sopHtml = `
      <button type="button" class="sop-toggle" onclick="this.nextElementSibling.classList.toggle('expanded')">
        <span class="sop-icon">&#128214;</span> How to do this
      </button>
      <div class="sop-card">
        <strong class="sop-title">${item.sop.title}</strong>
        <ol class="sop-steps">${stepsHtml}</ol>
        <cite class="sop-source">Source: ${item.sop.source}</cite>
      </div>`;
  }

  let infoHtml = item.info ? `<p class="item-info">${editMode
    ? `<input type="text" name="edit_info_${item.id}" value="${escapeAttr(item.info)}" class="edit-inline" placeholder="Info text...">`
    : item.info}</p>` : (editMode ? `<p class="item-info"><input type="text" name="edit_info_${item.id}" value="" class="edit-inline" placeholder="+ Add info text"></p>` : '');
  let requiredMark = item.required ? '<span class="required-mark">*</span>' : '';

  // Note button in label row; content expands BELOW the row
  const noteBtnHtml = `<button type="button" class="inline-note-toggle" onclick="toggleExpand('note-${item.id}')" title="Add a note">+</button>`;
  const noteContentHtml = `
    <div class="inline-note-box" id="note-${item.id}">
      <textarea name="note_${item.id}" class="inline-note-input" placeholder="Add a note about this item..."></textarea>
      <div class="inline-note-photo">
        <label class="photo-btn photo-btn-sm"><span>📷</span><input type="file" accept="image/*" capture="environment" name="note_photo_${item.id}" style="display:none"></label>
      </div>
    </div>`;

  const requiresAttr = item.requires ? `data-requires="${item.requires}" style="display:none"` : '';

  switch (item.type) {
    case 'checkbox':
      const cbLabel = editMode
        ? `<input type="text" name="edit_label_${item.id}" value="${escapeAttr(item.label)}" class="edit-inline edit-label">`
        : `<span class="checkbox-text">${item.label}${requiredMark}</span>`;
      return `
        <div class="form-item item-checkbox ${editMode ? 'edit-mode' : ''}" ${requiresAttr}>
          <div class="item-label-row">
            <label class="checkbox-label">
              ${editMode ? '' : `<input type="checkbox" name="${prefix}${item.id}" value="true" class="checkbox-input" onchange="handleCheckboxChange(this)" data-item-id="${item.id}"><span class="checkbox-custom"></span>`}
              ${cbLabel}
            </label>
            ${helpBtnHtml}${editMode ? '' : noteBtnHtml}
          </div>
          ${helpContentHtml}${editMode ? '' : noteContentHtml}
          ${sopHtml}${infoHtml}${mediaHtml}
        </div>`;

    case 'number':
      const colorClass = item.min !== undefined ? 'has-threshold' : '';
      // Large-value items (engine hours, guest counts) get direct input only.
      // Small-range items (merch qty, etc.) keep stepper buttons.
      const isLargeValue = (item.min !== undefined && item.min >= 100) ||
        (item.max !== undefined && item.max >= 100) ||
        item.id.includes('engine-hours') || item.id.includes('guests') ||
        item.id.includes('passengers') || item.id.includes('fuel');

      const stepperHtml = isLargeValue
        ? `<div class="direct-input-wrap">
            <input type="number" inputmode="numeric" pattern="[0-9]*" name="${prefix}${item.id}"
              class="stepper-input direct-number" value="" placeholder="Enter value"
              data-item-id="${item.id}">
            ${item.unit ? `<span class="stepper-unit">${item.unit}</span>` : ''}
          </div>`
        : `<div class="stepper">
            <button type="button" class="stepper-btn minus" onclick="step(this, -1)">−</button>
            <div class="stepper-value-wrap">
              <input type="number" inputmode="numeric" pattern="[0-9]*" name="${prefix}${item.id}"
                class="stepper-input" value="" placeholder="—" data-item-id="${item.id}">
              ${item.unit ? `<span class="stepper-unit">${item.unit}</span>` : ''}
            </div>
            <button type="button" class="stepper-btn plus" onclick="step(this, 1)">+</button>
          </div>`;

      const numLabel = editMode
        ? `<input type="text" name="edit_label_${item.id}" value="${escapeAttr(item.label)}" class="edit-inline edit-label">`
        : `<span class="item-label">${item.label}${requiredMark}</span>`;
      return `
        <div class="form-item item-number ${colorClass} ${editMode ? 'edit-mode' : ''}" ${requiresAttr}
          data-min="${item.min ?? ''}" data-max="${item.max ?? ''}">
          <div class="item-label-row">
            ${numLabel}
            ${helpBtnHtml}${editMode ? '' : noteBtnHtml}
          </div>
          ${helpContentHtml}${noteContentHtml}
          ${mediaHtml}
          ${stepperHtml}
          ${item.min !== undefined ? `<p class="threshold-info">Min: ${item.min}${item.max !== undefined ? ` | Max: ${item.max}` : ''} ${item.unit || ''}</p>` : ''}
          <div class="expand-on-fail" style="display:none">
            <input type="text" name="fail_note_${item.id}" placeholder="What's the issue?" class="fail-note">
            <label class="photo-btn"><span>📷 Take photo</span><input type="file" accept="image/*" capture="environment" style="display:none"></label>
          </div>
          ${sopHtml}${infoHtml}
        </div>`;

    case 'select':
      const optButtons = (item.options || []).map(opt =>
        `<button type="button" class="option-btn" data-value="${opt}" onclick="selectOption(this, '${prefix}${item.id}')">${opt}</button>`
      ).join('');
      const selLabel = editMode
        ? `<input type="text" name="edit_label_${item.id}" value="${escapeAttr(item.label)}" class="edit-inline edit-label">`
        : `<span class="item-label">${item.label}${requiredMark}</span>`;
      return `
        <div class="form-item item-select ${editMode ? 'edit-mode' : ''}" ${requiresAttr}>
          <div class="item-label-row">
            ${selLabel}
            ${helpBtnHtml}${editMode ? '' : noteBtnHtml}
          </div>
          ${helpContentHtml}${noteContentHtml}
          ${mediaHtml}
          <div class="option-group">${optButtons}</div>
          <input type="hidden" name="${prefix}${item.id}" data-item-id="${item.id}">
          ${sopHtml}${infoHtml}
        </div>`;

    case 'multi_select':
      const checkboxes = (item.options || []).map(opt =>
        `<label class="multi-option">
          <input type="checkbox" name="multi_${item.id}" value="${opt}">
          <span class="multi-option-text">${opt}</span>
        </label>`
      ).join('');
      return `
        <div class="form-item item-multi-select" ${requiresAttr}>
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpBtnHtml}
          </div>
          ${helpContentHtml}
          ${mediaHtml}
          <div class="multi-group">${checkboxes}</div>
          ${sopHtml}${infoHtml}
        </div>`;

    case 'text':
      return `
        <div class="form-item item-text" ${requiresAttr}>
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpBtnHtml}
          </div>
          ${helpContentHtml}
          ${mediaHtml}
          <textarea name="${prefix}${item.id}" class="text-input"
            placeholder="${item.placeholder || ''}" data-item-id="${item.id}"></textarea>
          ${sopHtml}${infoHtml}
        </div>`;

    case 'photo':
      return `
        <div class="form-item item-photo" ${requiresAttr}>
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpBtnHtml}
          </div>
          ${helpContentHtml}
          ${mediaHtml}
          <label class="photo-capture-btn">
            <span>📷 ${item.placeholder || 'Take photo'}</span>
            <input type="file" name="${prefix}${item.id}" accept="image/*" capture="environment" multiple>
          </label>
          <div class="photo-previews" id="previews_${item.id}"></div>
          ${sopHtml}${infoHtml}
        </div>`;

    default:
      return '';
  }
}

function renderChecklist(session: any, template: ChecklistTemplate, lastEngineHours: Record<string, string> = {}, editMode: boolean = false, canEdit: boolean = false, savedMsg: boolean = false): string {
  const totalItems = template.sections.reduce((sum, s) => sum + s.items.length, 0);

  // Day-of-week detection for DMT templates
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date(session.trip_date || new Date().toISOString().split('T')[0]);
  const todayDay = dayNames[today.getDay()];
  const isDMT = template.id.startsWith('daily-maintenance');

  const sectionsHtml = template.sections.map(section => {
    const sectionMedia = (section.description_media || []).map(m => {
      if (m.type === 'image') return `<img src="${m.url}" alt="${m.alt || ''}" class="section-ref-image">`;
      return '';
    }).join('');

    const itemsHtml = section.items.map(item => renderItemHtml(item, 'item_', editMode)).join('');

    // For DMT: detect if this section matches today's day
    const sectionDay = isDMT ? dayNames.find(d => section.title.toLowerCase().startsWith(d.toLowerCase())) : null;
    const isToday = isDMT && sectionDay === todayDay;
    const isOtherDay = isDMT && sectionDay && sectionDay !== todayDay;

    const todayBadge = isToday ? '<span class="today-badge">TODAY</span>' : '';
    const collapsedClass = isOtherDay ? ' collapsed' : '';
    const todayClass = isToday ? ' section-today' : '';

    const sectionTitleHtml = editMode
      ? `<input type="text" name="section_title_${section.title.replace(/[^a-zA-Z0-9]/g, '_')}" value="${escapeAttr(section.title)}" class="edit-inline edit-section-title">`
      : `${section.title} ${todayBadge}<span class="section-count" data-section></span>`;

    return `
      <div class="checklist-section${collapsedClass}${todayClass}">
        <div class="section-header" ${editMode ? '' : 'onclick="this.parentElement.classList.toggle(\'collapsed\')"'}>
          <h3>${sectionTitleHtml}</h3>
          ${editMode ? '' : '<span class="collapse-icon">▼</span>'}
        </div>
        ${section.description ? `<p class="section-desc">${section.description}</p>` : ''}
        ${sectionMedia}
        <div class="section-items">${itemsHtml}</div>
      </div>`;
  }).join('');

  const introMedia = (template.intro_media || []).map(m => {
    if (m.type === 'video') return `<div class="intro-video"><iframe src="https://www.youtube.com/embed/${extractYouTubeId(m.url)}" frameborder="0" allowfullscreen></iframe></div>`;
    if (m.type === 'image') return `<img src="${m.url}" alt="${m.alt || ''}" class="intro-image">`;
    if (m.type === 'link') return `<p><a href="${m.url}" target="_blank" class="intro-link">${m.caption || m.url}</a></p>`;
    return '';
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${template.name} — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#006950">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>
<body${editMode ? ' class="edit-mode-active"' : ''}>
  <div class="checklist-page">
    <header class="checklist-header">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>${template.name}</h1>
        ${canEdit ? `<a href="/c/${template.id}${editMode ? '' : '?edit=1'}" class="edit-toggle-btn" style="font-size:0.75rem;padding:6px 12px;border-radius:6px;text-decoration:none;font-weight:600;${editMode ? 'background:#F36D4F;color:#fff' : 'background:rgba(0,105,80,0.1);color:#006950'}">${editMode ? '✕ Exit Edit' : '✏️ Edit'}</a>` : ''}
      </div>
      <p class="checklist-context">${session.vessel.toUpperCase()} | ${session.crew_name} | ${session.trip_slot}</p>
      ${editMode ? `<div style="padding:10px 12px;background:#FFF8E1;border:2px solid #F59E0B;border-radius:8px;margin:8px 0;font-size:0.8125rem;color:#92400E;text-align:center">
        <strong>⚠️ EDIT MODE</strong> — changes update the template for all crew<br>
        <span style="font-size:0.6875rem">Auto-exits in <span id="edit-timer">2:00</span> if no save. Tap a field to edit it.</span>
      </div>` : ''}
      ${savedMsg ? '<div style="padding:8px 12px;background:rgba(0,105,80,0.08);border-radius:8px;margin:8px 0;font-size:0.8125rem;color:#006950;text-align:center">✓ Changes saved</div>' : ''}
      ${editMode ? '' : `<div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div><p class="progress-text" id="progress-text">0 / ${totalItems} items</p>`}
    </header>

    ${isDMT ? (() => {
      const todaySection = template.sections.find(s => s.title.toLowerCase().startsWith(todayDay.toLowerCase()));
      const taskName = todaySection ? todaySection.title.replace(/^\\w+\\s*—\\s*/, '') : 'Check your task below';
      return `<div class="intro-callout dmt-intro">
        <strong>Today is ${todayDay}</strong> — your task: <strong>${taskName}</strong>
        <br><small>Other days shown collapsed below for reference.</small>
      </div>`;
    })() : (template.intro ? `<div class="intro-callout">${template.intro}</div>` : '')}
    ${introMedia}

    ${editMode ? `<form action="/c/${template.id}/edit" method="POST" id="edit-form">` : `<form action="/c/${template.id}" method="POST" id="checklist-form">`}
      ${sectionsHtml}

      ${editMode ? `
      <div style="position:sticky;bottom:60px;background:var(--surface);border-top:2px solid #F59E0B;padding:12px;margin:16px -16px 0;display:flex;gap:8px">
        <button type="button" onclick="confirmSave()" style="flex:1;padding:14px;background:#006950;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;min-height:48px">Save Changes</button>
        <a href="/c/${template.id}" style="display:flex;align-items:center;justify-content:center;padding:14px 20px;background:#fff;border:2px solid #bdc9c2;border-radius:8px;text-decoration:none;color:#1a1c1c;font-weight:500;min-height:48px">Cancel</a>
      </div>
      <script>
        // Tap-to-unlock: fields start locked, tap the item card to enable editing
        document.querySelectorAll('.form-item.edit-mode').forEach(function(item) {
          item.addEventListener('click', function(e) {
            if (item.classList.contains('field-unlocked')) return;
            item.classList.add('field-unlocked');
            item.querySelectorAll('.edit-inline').forEach(function(field) {
              field.classList.add('unlocked');
              field.style.pointerEvents = 'auto';
            });
            // Focus the first input
            var first = item.querySelector('.edit-inline.unlocked');
            if (first) first.focus();
            // Reset timeout on interaction
            editTimeout = 120;
          });
        });

        // Confirmation before save
        function confirmSave() {
          if (confirm('Save changes to this template? This will update it for ALL crew members.')) {
            document.getElementById('edit-form').submit();
          }
        }

        // Reset timeout on any input activity
        document.addEventListener('input', function(e) {
          if (e.target && e.target.classList && e.target.classList.contains('edit-inline')) {
            editTimeout = 120;
          }
        });

        // Auto-exit edit mode after 2 minutes
        var editTimeout = 120; // seconds
        var timerEl = document.getElementById('edit-timer');
        var editInterval = setInterval(function() {
          editTimeout--;
          if (editTimeout <= 0) {
            clearInterval(editInterval);
            alert('Edit mode timed out. Returning to normal view.');
            window.location.href = '/c/${template.id}';
            return;
          }
          var m = Math.floor(editTimeout / 60);
          var s = editTimeout % 60;
          if (timerEl) timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        }, 1000);
      </script>` : `
      ${template.completion.notes_field ? `
        <div class="notes-section">
          <label>${template.completion.notes_prompt || 'Notes'}</label>
          <textarea name="notes" class="notes-textarea" placeholder="Any notes..."></textarea>
        </div>` : ''}

      <div class="review-section">
        <button type="button" class="review-toggle" onclick="toggleReviewSummary()">
          Review your entries before submitting
        </button>
        <div id="review-summary" class="review-summary" style="display:none"></div>
      </div>

      ${template.completion.sign_off ? `
        <label class="sign-off">
          <input type="checkbox" name="sign_off">
          <span>I, ${session.role === 'captain' ? 'Captain' : 'Deckhand'} ${session.crew_name}, confirm this is accurate</span>
        </label>` : ''}

      <button type="submit" class="submit-btn" id="submit-btn">
        Submit ${template.name}
      </button>`}
    </form>
  </div>
  ${bottomNav('home')}
  <script src="/public/app.js"></script>
  ${Object.keys(lastEngineHours).length > 0 ? `<script>
    // Pre-fill engine hours from last completion
    document.addEventListener('DOMContentLoaded', () => {
      ${Object.entries(lastEngineHours).map(([id, val]) => `
        const input_${id.replace(/-/g, '_')} = document.querySelector('[name="item_${id}"]');
        if (input_${id.replace(/-/g, '_')}) {
          input_${id.replace(/-/g, '_')}.value = '${val}';
          input_${id.replace(/-/g, '_')}.placeholder = 'Last: ${val}';
        }
      `).join('')}
    });
  </script>` : ''}
</body>
</html>`;
}

function renderFreeFormLog(session: any): string {
  const categories = [
    { id: 'maintenance', label: '🔧 Maintenance / Repair' },
    { id: 'safety', label: '⚠️ Safety / Incident' },
    { id: 'equipment', label: '⚙️ Equipment Change' },
    { id: 'operational', label: '🚢 Operational Note' },
    { id: 'general', label: '📝 General' },
  ];

  const categoryBtns = categories.map(cat =>
    `<button type="button" class="select-btn" data-value="${cat.id}"
      onclick="document.getElementById('log-cat').value='${cat.id}';
        this.parentElement.querySelectorAll('.select-btn').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');">
      ${cat.label}
    </button>`
  ).join('');

  return `${htmlHead('Add Log Entry')}
<body>
  <div class="checklist-page">
    <header class="page-header" style="padding:16px 0">
      <a href="/today" class="back-link" style="color:var(--primary);text-decoration:none;font-size:0.875rem">← Home</a>
      <h1 style="font-family:var(--font-heading);font-size:1.25rem;margin-top:4px">Add Log Entry</h1>
      <p style="font-size:0.8125rem;color:var(--text-muted)">${session.vessel.toUpperCase()} — ${session.crew_name}</p>
    </header>

    <div style="padding:10px 12px;background:rgba(112,208,235,0.1);border-radius:var(--radius);margin-bottom:12px;font-size:0.8125rem;color:#1a1c1c;line-height:1.5">
      Log an event that is <strong>not associated with a trip departure</strong>. Examples: engine replacement, dock repair, safety incident between trips, equipment delivery, coast guard visit.
    </div>

    <form action="/log" method="POST" style="padding-bottom:80px">
      <div class="form-item" style="background:var(--surface);border-radius:var(--radius);padding:16px;margin-bottom:12px">
        <label style="font-weight:500;font-size:0.875rem;display:block;margin-bottom:8px">Category</label>
        <div class="button-group" style="display:flex;flex-wrap:wrap;gap:8px">
          ${categoryBtns}
        </div>
        <input type="hidden" name="category" id="log-cat" value="general">
      </div>

      <div class="form-item" style="background:var(--surface);border-radius:var(--radius);padding:16px;margin-bottom:12px">
        <label style="font-weight:500;font-size:0.875rem;display:block;margin-bottom:8px">What happened?</label>
        <input type="text" name="title" required placeholder="Brief description..."
          style="width:100%;height:48px;border:1px solid var(--border);border-radius:var(--radius);padding:0 12px;font-size:16px;font-family:var(--font-body)">
      </div>

      <div class="form-item" style="background:var(--surface);border-radius:var(--radius);padding:16px;margin-bottom:12px">
        <label style="font-weight:500;font-size:0.875rem;display:block;margin-bottom:8px">Details (optional)</label>
        <textarea name="details" placeholder="More context, part numbers, what was done..."
          style="width:100%;min-height:100px;border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-size:14px;font-family:var(--font-body);resize:vertical"></textarea>
      </div>

      <div class="form-item" style="background:var(--surface);border-radius:var(--radius);padding:16px;margin-bottom:12px">
        <label style="font-weight:500;font-size:0.875rem;display:block;margin-bottom:8px">Photo (optional)</label>
        <label class="photo-btn" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;background:var(--surface-container);border-radius:var(--radius);cursor:pointer;font-size:0.875rem">
          <span>📷 Take photo</span>
          <input type="file" accept="image/*" capture="environment" name="photo" style="display:none">
        </label>
      </div>

      <button type="submit" class="submit-btn" style="display:block;width:100%;padding:16px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius);font-size:1rem;font-weight:600;cursor:pointer;min-height:52px">
        Add Log Entry
      </button>
    </form>
  </div>
  ${bottomNav('home')}
  <script src="/public/app.js"></script>
</body>
</html>`;
}

function renderLogbook(session: any, template: LogbookTemplate): string {
  const role = session.role as 'captain' | 'deckhand';
  const visibleSteps = role === 'captain' ? template.captain_steps : template.mate_steps;

  if (visibleSteps.length === 0) {
    return `<!DOCTYPE html><html><body><p>This logbook is not available for your role.</p><a href="/today">Back</a></body></html>`;
  }

  const stepsHtml = template.steps
    .filter(s => visibleSteps.includes(s.step))
    .map((step, idx) => {
      const itemsHtml = step.items
        .filter(item => !step.captain_only || role === 'captain')
        .map(item => renderItemHtml(item))
        .join('');

      return `
        <div class="wizard-step" data-step="${idx}" ${idx > 0 ? 'style="display:none"' : ''}>
          <h2 class="step-title">${step.title}</h2>
          ${itemsHtml}
        </div>`;
    }).join('');

  const totalSteps = visibleSteps.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${template.name} — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#006950">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>
<body>
  <div class="logbook-page">
    <header class="logbook-header">
      <h1>${template.name}</h1>
      <p class="checklist-context">${session.vessel.toUpperCase()} | ${session.crew_name} | ${session.trip_slot}</p>
      <div class="step-progress">
        <span id="step-indicator">Step 1 of ${totalSteps}</span>
        <div class="progress-bar"><div class="progress-fill" id="step-progress-fill" style="width:${100 / totalSteps}%"></div></div>
      </div>
    </header>

    <form action="/c/${template.id}" method="POST" id="logbook-form">
      ${stepsHtml}

      ${template.completion.sign_off ? `
        <div class="wizard-step" data-step="${totalSteps}" style="display:none">
          <h2 class="step-title">Review & Submit</h2>
          <p>Check your entries below, then confirm and submit.</p>
          <div id="review-summary" class="review-summary"></div>
          <label class="sign-off">
            <input type="checkbox" name="sign_off">
            <span>I, ${session.role === 'captain' ? 'Captain' : 'Deckhand'} ${session.crew_name}, confirm this is accurate</span>
          </label>
        </div>` : ''}

      <div class="wizard-nav">
        <button type="button" class="nav-btn back-btn" id="back-btn" onclick="wizardNav(-1)" style="visibility:hidden">← Back</button>
        <button type="button" class="nav-btn next-btn" id="next-btn" onclick="wizardNav(1)">Next →</button>
        <button type="submit" class="nav-btn submit-nav-btn" id="wizard-submit" style="display:none">Submit Logbook</button>
      </div>
    </form>
  </div>
  <script>
    const totalSteps = ${totalSteps + (template.completion.sign_off ? 1 : 0)};
  </script>
  <script src="/public/app.js"></script>
  <script>
    // Pre-fill known values from session
    document.addEventListener('DOMContentLoaded', () => {
      const tripDateInput = document.querySelector('[name="item_trip-date"]');
      if (tripDateInput && !tripDateInput.value) tripDateInput.value = '${session.trip_date}';

      const captainInput = document.querySelector('[name="item_captain-name"]');
      if (captainInput && !captainInput.value) captainInput.value = '${session.crew_name}';

      // Auto-select trip slot
      const slotBtns = document.querySelectorAll('[data-value="AM (9-1)"], [data-value="PM (2-6)"]');
      slotBtns.forEach(btn => {
        if (btn.dataset.value.startsWith('${session.trip_slot}')) {
          btn.click();
        }
      });
    });
  </script>
  ${bottomNav('home')}
</body>
</html>`;
}

function renderSuccess(session: any, alertCount: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Done! — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#006950">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>
<body>
  <div class="success-page">
    <div class="success-icon">✓</div>
    <h1>Submitted!</h1>
    ${alertCount > 0
      ? `<div class="alert-summary">Billy has been notified — ${alertCount} item${alertCount === 1 ? '' : 's'} need attention.</div>`
      : `<p class="all-good">All good — everything checks out.</p>`
    }
    <a href="/today" class="primary-btn">Back to Today's List</a>
    <a href="/logout" class="switch-link">Switch crew member</a>
  </div>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractYouTubeId(url: string): string {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  return match ? match[1] : url;
}

export default app;
