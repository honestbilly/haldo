// Manager dashboard: template editor + crew management + login tokens
import { Hono } from 'hono';
import pool from '../db.js';
import { VESSELS, VESSEL_LABELS, escapeHtml, reportLayout } from '../lib/report-shared.js';
import { getAllTemplates, loadTemplates, saveTemplate, deleteTemplate } from '../services/templates.js';
import { generateToken, revokeToken } from './auth.js';

const app = new Hono();

// -- Template Editor --

// Template list
app.get('/report/templates', async (c) => {
  const templates = getAllTemplates();

  // Group by category
  const categories: Record<string, any[]> = {};
  for (const t of templates) {
    const cat = t.id.includes('wakeup') ? 'Wake Up' :
      t.id.includes('between') ? 'Between Trips' :
      t.id.includes('put-to-bed') ? 'Put to Bed' :
      t.id.includes('daily-maintenance') ? 'Daily Maintenance' :
      t.id.includes('monthly') ? 'Monthly Maintenance' :
      t.id.includes('logbook') ? 'Trip Logbook' :
      t.id.includes('snorkel') ? 'Inventory' :
      t.id.includes('oil') ? 'On-Demand Maintenance' :
      'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(t);
  }

  const categoryHtml = Object.entries(categories).map(([cat, tmpls]) => {
    const rows = tmpls.map(t => {
      const vesselLabel = VESSEL_LABELS[t.vessel] || t.vessel;
      const roleLabel = t.role === 'all' ? 'All' : t.role.charAt(0).toUpperCase() + t.role.slice(1);
      const recurrence = t.type === 'checklist' ? (t as any).recurrence || '' : 'per-trip';
      return `
        <a href="/report/templates/${encodeURIComponent(t.id)}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#FFFFFF;border-radius:8px;margin-bottom:6px;text-decoration:none;color:#1a1c1c;border-left:4px solid #006950;min-height:48px">
          <div>
            <div style="font-weight:600;font-size:0.875rem">${escapeHtml(t.name)}</div>
            <div style="font-size:0.75rem;color:#6e7a74">${vesselLabel} · ${roleLabel} · ${recurrence}</div>
          </div>
          <span style="color:#6e7a74;font-size:0.875rem">→</span>
        </a>`;
    }).join('');

    return `
      <div style="margin-bottom:20px">
        <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:0.8125rem;font-weight:700;color:#6e7a74;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">${escapeHtml(cat)}</h3>
        ${rows}
      </div>`;
  }).join('');

  return c.html(reportLayout('Templates', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700;color:#1a1c1c">Templates</h2>
      <span style="font-size:0.8125rem;color:#6e7a74">${templates.length} total</span>
    </div>
    ${categoryHtml}
  `));
});

// Edit single template
app.get('/report/templates/:templateId', async (c) => {
  const templateId = c.req.param('templateId');
  const templates = getAllTemplates();
  const template = templates.find(t => t.id === templateId);

  if (!template) {
    return c.html(reportLayout('Templates', `
      <p style="color:#F36D4F">Template "${escapeHtml(templateId)}" not found.</p>
      <a href="/report/templates" style="color:#006950">← Back to templates</a>
    `));
  }

  const jsonStr = JSON.stringify(template, null, 2);
  const saved = c.req.query('saved') === '1';
  const error = c.req.query('error');

  return c.html(reportLayout('Templates', `
    <div style="margin-bottom:16px">
      <a href="/report/templates" style="color:#006950;text-decoration:none;font-size:0.875rem">← Back to templates</a>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700">${escapeHtml(template.name)}</h2>
      <span style="font-size:0.75rem;color:#6e7a74">${escapeHtml(template.id)}</span>
    </div>

    ${saved ? '<div style="padding:10px 16px;background:rgba(0,105,80,0.08);border-radius:8px;margin-bottom:12px;font-size:0.875rem;color:#006950;text-align:center">✓ Template saved and reloaded</div>' : ''}
    ${error ? `<div style="padding:10px 16px;background:rgba(186,26,26,0.08);border-radius:8px;margin-bottom:12px;font-size:0.875rem;color:#ba1a1a">${escapeHtml(decodeURIComponent(error))}</div>` : ''}

    <form action="/report/templates/${encodeURIComponent(templateId)}" method="POST">
      <textarea name="json" style="width:100%;min-height:500px;padding:16px;border:2px solid #bdc9c2;border-radius:8px;font-family:'Menlo','Monaco','Consolas',monospace;font-size:13px;line-height:1.5;background:#FFFFFF;color:#1a1c1c;resize:vertical;tab-size:2;white-space:pre" spellcheck="false">${escapeHtml(jsonStr)}</textarea>

      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="submit" style="flex:1;padding:14px;background:#006950;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">Save Template</button>
        <a href="/report/templates/${encodeURIComponent(templateId)}/clone" style="display:flex;align-items:center;justify-content:center;padding:14px 20px;background:#FFFFFF;border:2px solid #bdc9c2;border-radius:8px;font-size:0.875rem;font-weight:500;text-decoration:none;color:#1a1c1c;min-height:48px">Clone</a>
      </div>
    </form>

    <details style="margin-top:24px">
      <summary style="cursor:pointer;font-size:0.8125rem;color:#6e7a74;font-weight:500">Template JSON Reference</summary>
      <div style="margin-top:8px;padding:12px;background:#FFFFFF;border-radius:8px;font-size:0.75rem;color:#6e7a74;line-height:1.6">
        <p><strong>Item types:</strong> checkbox, number, select, multi_select, text, photo</p>
        <p><strong>Number fields:</strong> min, max, unit, alert_below</p>
        <p><strong>Help boxes:</strong> "help": { "title": "...", "body": "..." }</p>
        <p><strong>SOP links:</strong> "sop": { "title": "...", "steps": [...], "source": "..." }</p>
        <p><strong>Conditional:</strong> "requires": "other-item-id"</p>
        <p><strong>Recurrence:</strong> daily, weekly, monthly, per-trip, on-demand</p>
        <p><strong>Scheduling:</strong> trigger_day (Mon-Sun), trigger_dates ([1,15])</p>
      </div>
    </details>
  `));
});

// Save template
app.post('/report/templates/:templateId', async (c) => {
  const templateId = c.req.param('templateId');
  const body = await c.req.parseBody();
  const jsonStr = String(body.json || '');

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.id || !parsed.name || !parsed.type) {
      throw new Error('Missing required fields: id, name, type');
    }
    await saveTemplate(parsed);
    await loadTemplates(); // Reload cache
    return c.redirect(`/report/templates/${encodeURIComponent(templateId)}?saved=1`);
  } catch (err: any) {
    const msg = err.message || 'Invalid JSON';
    return c.redirect(`/report/templates/${encodeURIComponent(templateId)}?error=${encodeURIComponent(msg)}`);
  }
});

// Clone template
app.get('/report/templates/:templateId/clone', async (c) => {
  const templateId = c.req.param('templateId');
  const templates = getAllTemplates();
  const template = templates.find(t => t.id === templateId);

  if (!template) return c.redirect('/report/templates');

  const cloneId = templateId + '-copy';
  const clone = { ...JSON.parse(JSON.stringify(template)), id: cloneId, name: template.name + ' (Copy)' };
  await saveTemplate(clone);
  await loadTemplates();
  return c.redirect(`/report/templates/${encodeURIComponent(cloneId)}?saved=1`);
});

// -- Crew Management & Login Tokens --

app.get('/report/crew', async (c) => {
  const crewList = await pool.query(
    `SELECT cr.*, at.token, at.last_used_at, at.revoked
     FROM crew cr
     LEFT JOIN auth_tokens at ON cr.id = at.crew_id AND at.revoked = FALSE
     ORDER BY cr.role, cr.name`
  );

  // Group by crew member (may have multiple tokens, take the latest non-revoked one)
  const crewMap = new Map<string, any>();
  for (const row of crewList.rows) {
    if (!crewMap.has(row.id)) {
      crewMap.set(row.id, { ...row });
    } else if (row.token && !crewMap.get(row.id).token) {
      crewMap.get(row.id).token = row.token;
      crewMap.get(row.id).last_used_at = row.last_used_at;
    }
  }

  const appUrl = process.env.APP_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000'}`;
  const generated = c.req.query('generated');

  const crewRows = Array.from(crewMap.values()).map(cr => {
    const roleLabel = cr.role === 'captain' ? 'Captain' : 'Deckhand';
    const statusBadge = cr.active
      ? '<span style="font-size:0.6875rem;background:rgba(0,105,80,0.1);color:#006950;padding:2px 6px;border-radius:4px">Active</span>'
      : '<span style="font-size:0.6875rem;background:rgba(186,26,26,0.1);color:#ba1a1a;padding:2px 6px;border-radius:4px">Inactive</span>';

    const tokenSection = cr.token
      ? `<div style="margin-top:6px">
          <div style="font-size:0.6875rem;color:#6e7a74;margin-bottom:2px">Login link:</div>
          <input type="text" value="${appUrl}/login/${cr.token}" readonly onclick="this.select();navigator.clipboard.writeText(this.value)" style="width:100%;padding:6px 8px;border:1px solid #bdc9c2;border-radius:6px;font-family:monospace;font-size:0.75rem;background:#f9fafb;cursor:pointer" title="Click to copy">
          <div style="font-size:0.625rem;color:#6e7a74;margin-top:2px">${cr.last_used_at ? 'Last used: ' + new Date(cr.last_used_at).toLocaleDateString() : 'Never used'}</div>
        </div>`
      : `<form action="/report/crew/${cr.id}/generate-token" method="POST" style="margin-top:6px">
          <button type="submit" style="padding:6px 12px;background:#006950;color:white;border:none;border-radius:6px;font-size:0.75rem;cursor:pointer;min-height:36px">Generate Login Link</button>
        </form>`;

    const highlight = generated === cr.id ? 'border:2px solid #006950;' : '';

    return `
      <div style="background:#FFFFFF;border-radius:8px;padding:14px 16px;margin-bottom:8px;${highlight}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-weight:600;font-size:0.9375rem">${escapeHtml(cr.name)}</span>
            <span style="font-size:0.75rem;color:#6e7a74;margin-left:6px">${roleLabel}</span>
            ${statusBadge}
          </div>
          <span style="font-size:0.75rem;color:#6e7a74">${VESSEL_LABELS[cr.vessel] || cr.vessel || 'Unassigned'}</span>
        </div>
        ${tokenSection}
      </div>`;
  }).join('');

  return c.html(reportLayout('Crew', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700">Crew & Login Links</h2>
      <span style="font-size:0.8125rem;color:#6e7a74">${crewMap.size} members</span>
    </div>

    <div style="padding:12px;background:rgba(112,208,235,0.1);border-radius:8px;margin-bottom:16px;font-size:0.8125rem;color:#1a1c1c;line-height:1.5">
      <strong>How login works:</strong> Generate a login link for each crew member. Send it via WhatsApp or text. They tap it once and stay logged in permanently. To revoke access, deactivate the crew member.
    </div>

    ${crewRows}
  `));
});

// Generate token for a crew member
app.post('/report/crew/:crewId/generate-token', async (c) => {
  const crewId = c.req.param('crewId');
  await generateToken(crewId, 'crew');
  return c.redirect(`/report/crew?generated=${crewId}`);
});

export default app;
