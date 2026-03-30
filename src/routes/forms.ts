import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { getSession } from './session.js';
import { getTemplatesForContext, getTemplateById } from '../services/templates.js';
import { evaluateAlerts, processAlerts } from '../services/alerts.js';
import type { Template, ChecklistTemplate, LogbookTemplate, Item, Section, LogbookStep, SessionData } from '../types.js';

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

// Today's list
app.get('/today', async (c) => {
  const session = c.get('session');
  // Parse date as local (not UTC) to avoid timezone shift
  const [y, m, d] = session.trip_date.split('-').map(Number);
  const tripDate = new Date(y, m - 1, d);
  const templates = getTemplatesForContext(session.vessel, session.role, tripDate);

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

  return c.html(renderTodayList(session, templates, completedMap));
});

// Render a checklist or logbook form
app.get('/c/:templateId', (c) => {
  const session = c.get('session');
  const template = getTemplateById(c.req.param('templateId'));
  if (!template) return c.notFound();

  if (template.type === 'checklist') {
    return c.html(renderChecklist(session, template as ChecklistTemplate));
  } else {
    return c.html(renderLogbook(session, template as LogbookTemplate));
  }
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
  completedMap: Map<string, any[]>
): string {
  const items = templates.map(t => {
    const comps = completedMap.get(t.id) || [];
    // For per-trip items, check if this specific trip_slot is done
    const isDone = t.type === 'logbook' || (t.type === 'checklist' && (t as ChecklistTemplate).recurrence === 'per-trip')
      ? comps.some(c => c.trip_slot === session.trip_slot)
      : comps.length > 0;

    const est = t.type === 'checklist'
      ? (t as ChecklistTemplate).estimated_minutes
      : (t as LogbookTemplate).estimated_minutes;

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
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Today — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="today-page">
    <header class="today-header">
      <h1>${session.crew_name} — ${session.vessel.toUpperCase()}</h1>
      <p>${session.trip_slot} Trip | ${(() => { const [y,m,d] = session.trip_date.split('-').map(Number); return new Date(y, m-1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); })()}</p>
    </header>
    <div class="today-list">
      ${items || '<p class="empty-state">No checklists scheduled for today.</p>'}
    </div>
    <a href="/logout" class="switch-link">Switch crew member</a>
  </div>
</body>
</html>`;
}

function renderItemHtml(item: Item, prefix: string = 'item_'): string {
  let mediaHtml = '';
  if (item.description_media?.length) {
    mediaHtml = item.description_media.map(m => {
      if (m.type === 'image') return `<img src="${m.url}" alt="${m.alt || m.caption || ''}" class="item-ref-image">`;
      if (m.type === 'video') return `<div class="item-video"><iframe src="https://www.youtube.com/embed/${extractYouTubeId(m.url)}" frameborder="0" allowfullscreen></iframe></div>`;
      if (m.type === 'link') return `<a href="${m.url}" target="_blank" class="item-link">${m.caption || m.url}</a>`;
      return '';
    }).join('') + (item.description_media[0]?.caption ? `<p class="media-caption">${item.description_media[0].caption}</p>` : '');
  }

  let helpHtml = '';
  if (item.help) {
    helpHtml = `
      <button type="button" class="help-toggle" onclick="this.nextElementSibling.classList.toggle('expanded')">?</button>
      <div class="help-box">
        <strong>${item.help.title}</strong>
        <p>${item.help.body}</p>
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

  let infoHtml = item.info ? `<p class="item-info">${item.info}</p>` : '';
  let requiredMark = item.required ? '<span class="required-mark">*</span>' : '';

  const requiresAttr = item.requires ? `data-requires="${item.requires}" style="display:none"` : '';

  switch (item.type) {
    case 'checkbox':
      return `
        <div class="form-item item-checkbox" ${requiresAttr}>
          <label class="checkbox-label">
            <input type="checkbox" name="${prefix}${item.id}" value="true" class="checkbox-input"
              onchange="handleCheckboxChange(this)" data-item-id="${item.id}">
            <span class="checkbox-custom"></span>
            <span class="checkbox-text">${item.label}${requiredMark}</span>
          </label>
          ${helpHtml}${sopHtml}${infoHtml}${mediaHtml}
        </div>`;

    case 'number':
      const colorClass = item.min !== undefined ? 'has-threshold' : '';
      return `
        <div class="form-item item-number ${colorClass}" ${requiresAttr}
          data-min="${item.min ?? ''}" data-max="${item.max ?? ''}">
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpHtml}
          </div>
          ${mediaHtml}
          <div class="stepper">
            <button type="button" class="stepper-btn minus" onclick="step(this, -1)">−</button>
            <div class="stepper-value-wrap">
              <input type="number" name="${prefix}${item.id}" class="stepper-input" value=""
                placeholder="—" data-item-id="${item.id}">
              ${item.unit ? `<span class="stepper-unit">${item.unit}</span>` : ''}
            </div>
            <button type="button" class="stepper-btn plus" onclick="step(this, 1)">+</button>
          </div>
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
      return `
        <div class="form-item item-select" ${requiresAttr}>
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpHtml}
          </div>
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
            ${helpHtml}
          </div>
          ${mediaHtml}
          <div class="multi-group">${checkboxes}</div>
          ${sopHtml}${infoHtml}
        </div>`;

    case 'text':
      return `
        <div class="form-item item-text" ${requiresAttr}>
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpHtml}
          </div>
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
            ${helpHtml}
          </div>
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

function renderChecklist(session: any, template: ChecklistTemplate): string {
  const totalItems = template.sections.reduce((sum, s) => sum + s.items.length, 0);

  const sectionsHtml = template.sections.map(section => {
    const sectionMedia = (section.description_media || []).map(m => {
      if (m.type === 'image') return `<img src="${m.url}" alt="${m.alt || ''}" class="section-ref-image">`;
      return '';
    }).join('');

    const itemsHtml = section.items.map(item => renderItemHtml(item)).join('');

    return `
      <div class="checklist-section">
        <div class="section-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <h3>${section.title} <span class="section-count" data-section></span></h3>
          <span class="collapse-icon">▼</span>
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
</head>
<body>
  <div class="checklist-page">
    <header class="checklist-header">
      <h1>${template.name}</h1>
      <p class="checklist-context">${session.vessel.toUpperCase()} | ${session.crew_name} | ${session.trip_slot}</p>
      <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
      <p class="progress-text" id="progress-text">0 / ${totalItems} items</p>
    </header>

    ${template.intro ? `<div class="intro-callout">${template.intro}</div>` : ''}
    ${introMedia}

    <form action="/c/${template.id}" method="POST" id="checklist-form">
      ${sectionsHtml}

      ${template.completion.notes_field ? `
        <div class="notes-section">
          <label>${template.completion.notes_prompt || 'Notes'}</label>
          <textarea name="notes" class="notes-textarea" placeholder="Any notes..."></textarea>
        </div>` : ''}

      ${template.completion.sign_off ? `
        <label class="sign-off">
          <input type="checkbox" name="sign_off">
          <span>I confirm this is accurate</span>
        </label>` : ''}

      <button type="submit" class="submit-btn" id="submit-btn">
        Submit ${template.name}
      </button>
    </form>
  </div>
  <script src="/public/app.js"></script>
</body>
</html>`;
}

function renderLogbook(session: any, template: LogbookTemplate): string {
  const role = session.role as 'captain' | 'mate';
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
          <p>Review your entries, then submit.</p>
          <label class="sign-off">
            <input type="checkbox" name="sign_off">
            <span>I confirm this is accurate</span>
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

function extractYouTubeId(url: string): string {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  return match ? match[1] : url;
}

export default app;
