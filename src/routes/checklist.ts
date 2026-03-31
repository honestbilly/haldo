import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { getSession } from './session.js';
import { getAuth } from './auth.js';
import { getTemplateById, saveTemplate, loadTemplates } from '../services/templates.js';
import { evaluateAlerts, processAlerts } from '../services/alerts.js';
import { renderItemHtml, escapeAttr, extractYouTubeId } from '../lib/render-item.js';
import { renderLogbook, renderSuccess } from './logbook.js';
import { bottomNav } from '../ui.js';
import type { ChecklistTemplate, LogbookTemplate, SessionData } from '../types.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

// Middleware: require session
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
    // Fetch active crew for the logbook deckhand picker (from DB, not hardcoded)
    const crewResult = await pool.query(
      `SELECT id, name, role FROM crew WHERE active = TRUE ORDER BY role, name`
    );
    const crewList = crewResult.rows;
    return c.html(renderLogbook(session, template as LogbookTemplate, crewList));
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

export default app;
