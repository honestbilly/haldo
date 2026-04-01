// Manager dashboard: template editor + crew management + login tokens
import { Hono } from 'hono';
import pool from '../db.js';
import { VESSELS, VESSEL_LABELS, escapeHtml, reportLayout } from '../lib/report-shared.js';
import { } from '../services/templates.js';
import { generateToken, revokeToken, revokeAllTokens } from './auth.js';

const app = new Hono();

// -- Old template editor routes — redirect to new Library --
app.get('/report/templates', (c) => c.redirect('/report/library'));
app.get('/report/templates/:templateId', (c) => c.redirect(`/report/library/${c.req.param('templateId')}`));
app.get('/report/templates/:templateId/clone', (c) => c.redirect(`/report/library/build?from=${c.req.param('templateId')}`));
// Keep POST for backwards compat (redirect to library's POST handler)
app.post('/report/templates/:templateId', (c) => c.redirect(`/report/library/${c.req.param('templateId')}`, 307));

// -- Crew Management & Login Tokens --

app.get('/report/crew', async (c) => {
  const crewList = await pool.query(
    `SELECT cr.*, at.token, at.last_used_at, at.revoked, at.role as auth_role
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
      crewMap.get(row.id).auth_role = row.auth_role;
    }
  }

  const appUrl = process.env.APP_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000'}`;
  const generated = c.req.query('generated');

  const crewRows = Array.from(crewMap.values()).map(cr => {
    const roleLabel = cr.role === 'captain' ? 'Captain' : 'Deckhand';
    const authLabel = cr.auth_role === 'admin' ? 'Admin' : cr.auth_role === 'manager' ? 'Manager' : '';
    const authBadge = authLabel
      ? `<span style="font-size:0.5625rem;font-weight:700;color:${cr.auth_role === 'admin' ? '#FF9500' : '#1A6B8A'};background:${cr.auth_role === 'admin' ? 'rgba(255,149,0,0.1)' : 'rgba(26,107,138,0.08)'};padding:2px 6px;border-radius:999px;text-transform:uppercase;letter-spacing:0.05em">${authLabel}</span>`
      : '';
    const statusBadge = cr.active
      ? ''
      : '<span style="font-size:0.6875rem;background:rgba(255,59,48,0.1);color:#FF3B30;padding:2px 6px;border-radius:4px">Inactive</span>';

    // Login link section — always show link if exists, plus option to regenerate
    let tokenSection = '';
    if (cr.token) {
      tokenSection = `
        <div style="margin-top:10px">
          <div style="font-size:0.6875rem;color:#8E8E93;margin-bottom:4px">Login link (tap to copy):</div>
          <input type="text" value="${appUrl}/login/${cr.token}" readonly onclick="this.select();navigator.clipboard.writeText(this.value)" style="width:100%;padding:8px 10px;border:1px solid #E5E5EA;border-radius:8px;font-family:monospace;font-size:0.6875rem;background:#F2F2F7;cursor:pointer" title="Click to copy">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <span style="font-size:0.625rem;color:#8E8E93">${cr.last_used_at ? 'Last used: ' + new Date(cr.last_used_at).toLocaleDateString() : 'Never used'}</span>
            <form action="/report/crew/${cr.id}/regenerate-token" method="POST" style="display:flex;gap:6px;align-items:center">
              <select name="auth_role" style="height:28px;border:1px solid #E5E5EA;border-radius:6px;padding:0 6px;font-size:0.625rem;background:white;-webkit-appearance:none">
                <option value="crew" ${cr.auth_role === 'crew' ? 'selected' : ''}>Crew</option>
                <option value="manager" ${cr.auth_role === 'manager' ? 'selected' : ''}>Manager</option>
                <option value="admin" ${cr.auth_role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
              <button type="submit" style="padding:4px 8px;background:none;border:1px solid #E5E5EA;border-radius:6px;font-size:0.625rem;color:#1A6B8A;font-weight:600;cursor:pointer">Regenerate</button>
            </form>
          </div>
        </div>`;
    } else {
      tokenSection = `
        <form action="/report/crew/${cr.id}/generate-token" method="POST" style="margin-top:10px;display:flex;gap:8px;align-items:center">
          <select name="auth_role" style="height:40px;border:1px solid #E5E5EA;border-radius:8px;padding:0 12px;font-size:0.8125rem;background:white;color:#1a1c1e;-webkit-appearance:none">
            <option value="crew">Crew</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" style="flex:1;padding:10px 14px;background:#1A6B8A;color:white;border:none;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;min-height:40px">Generate Login Link</button>
        </form>`;
    }

    const highlight = generated === cr.id ? 'border:2px solid #34C759;' : '';

    const toggleAction = cr.active ? 'deactivate' : 'reactivate';
    const toggleLabel = cr.active ? 'Deactivate' : 'Reactivate';
    const toggleColor = cr.active ? '#FF3B30' : '#34C759';

    return `
      <div style="background:#FFFFFF;border-radius:12px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.04);${highlight}${!cr.active ? 'opacity:0.6;' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:0.9375rem">${escapeHtml(cr.name)}</span>
            <span style="font-size:0.625rem;font-weight:600;color:white;background:${cr.role === 'captain' ? '#1A6B8A' : '#70D0EB'};padding:2px 8px;border-radius:999px">${roleLabel}</span>
            ${authBadge}
            ${statusBadge}
          </div>
          <form action="/report/crew/${cr.id}/${toggleAction}" method="POST" style="margin:0">
            <button type="submit" style="padding:4px 10px;background:none;border:1px solid ${toggleColor};border-radius:6px;font-size:0.625rem;font-weight:600;color:${toggleColor};cursor:pointer">${toggleLabel}</button>
          </form>
        </div>
        ${cr.active ? tokenSection : '<div style="margin-top:8px;font-size:0.75rem;color:#8E8E93;font-style:italic">Login revoked. Reactivate to restore access.</div>'}
      </div>`;
  }).join('');

  const created = c.req.query('created');
  const inputStyle = `width:100%;height:48px;background:#E5E8F0;border:none;border-radius:12px;padding:0 16px;font-size:0.9375rem;font-weight:500;color:#1a1c1e;outline:none;font-family:'Inter',sans-serif`;

  return c.html(reportLayout('Crew', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700">Crew & Login Links</h2>
      <span style="font-size:0.8125rem;color:#8E8E93">${crewMap.size} members</span>
    </div>

    <div style="padding:14px 16px;background:rgba(112,208,235,0.08);border-radius:12px;margin-bottom:16px;font-size:0.8125rem;color:#1a1c1e;line-height:1.5">
      <strong>How login works:</strong> Generate a login link for each crew member. Send it via WhatsApp or text. They tap it once and stay logged in permanently.
    </div>

    ${created ? '<div style="padding:12px;background:rgba(52,199,89,0.1);border-radius:12px;margin-bottom:16px;font-size:0.875rem;color:#34C759;text-align:center;font-weight:600">✓ Crew member created</div>' : ''}

    <!-- Add Crew Member -->
    <details style="background:white;border-radius:12px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <summary style="font-weight:700;font-size:0.875rem;cursor:pointer;color:#1A6B8A;display:flex;align-items:center;gap:8px">
        <span class="material-symbols-outlined" style="font-size:20px">person_add</span> Add Crew Member
      </summary>
      <form action="/report/crew/create" method="POST" style="margin-top:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#8E8E93;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Name *</label>
            <input type="text" name="name" required placeholder="Full name" style="${inputStyle}">
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#8E8E93;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Role *</label>
            <select name="role" required style="${inputStyle};-webkit-appearance:none;appearance:none">
              <option value="captain">Captain</option>
              <option value="deckhand">Deckhand</option>
            </select>
          </div>
        </div>
        <button type="submit" style="width:100%;height:48px;background:#1A6B8A;color:white;border:none;border-radius:12px;font-weight:700;font-size:0.875rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
          <span class="material-symbols-outlined" style="font-size:18px">add</span> Create & Generate Login Link
        </button>
      </form>
    </details>

    ${crewRows}
  `));
});

// Create new crew member + auto-generate login link
app.post('/report/crew/create', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();
  const role = String(body.role || 'deckhand');

  if (!name) return c.redirect('/report/crew');

  const { nanoid } = await import('nanoid');
  const crewId = nanoid();

  await pool.query(
    'INSERT INTO crew (id, name, role, active) VALUES ($1, $2, $3, TRUE)',
    [crewId, name, role]
  );

  // Auto-generate login link
  await generateToken(crewId, 'crew');

  return c.redirect(`/report/crew?created=1&generated=${crewId}`);
});

// Deactivate crew member (revokes all tokens)
app.post('/report/crew/:crewId/deactivate', async (c) => {
  const crewId = c.req.param('crewId');
  await pool.query('UPDATE crew SET active = FALSE WHERE id = $1', [crewId]);
  await revokeAllTokens(crewId);
  return c.redirect('/report/crew');
});

// Reactivate crew member
app.post('/report/crew/:crewId/reactivate', async (c) => {
  const crewId = c.req.param('crewId');
  await pool.query('UPDATE crew SET active = TRUE WHERE id = $1', [crewId]);
  return c.redirect(`/report/crew?generated=${crewId}`);
});

// Regenerate token with new auth role (revokes old one)
app.post('/report/crew/:crewId/regenerate-token', async (c) => {
  const crewId = c.req.param('crewId');
  const body = await c.req.parseBody();
  const authRole = String(body.auth_role || 'crew');
  const validRoles = ['crew', 'manager', 'admin'];
  const role = validRoles.includes(authRole) ? authRole : 'crew';

  // Revoke all existing tokens
  await revokeAllTokens(crewId);

  // Generate new token with the selected role
  await generateToken(crewId, role);
  return c.redirect(`/report/crew?generated=${crewId}`);
});

// Generate token for a crew member (with role selection)
app.post('/report/crew/:crewId/generate-token', async (c) => {
  const crewId = c.req.param('crewId');
  const body = await c.req.parseBody();
  const authRole = String(body.auth_role || 'crew');
  // Only allow valid roles
  const validRoles = ['crew', 'manager', 'admin'];
  const role = validRoles.includes(authRole) ? authRole : 'crew';
  await generateToken(crewId, role);
  return c.redirect(`/report/crew?generated=${crewId}`);
});

export default app;
