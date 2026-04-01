// Completed Logs viewer — filter by vessel, role, date, type
// Replaces the old 404 "Checklists" sidebar link
import { Hono } from 'hono';
import pool from '../db.js';
import { VESSELS, VESSEL_LABELS, escapeHtml, reportLayout } from '../lib/report-shared.js';

const app = new Hono();

app.get('/report/logs', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  const qDate = c.req.query('date') || today;
  const qVessel = c.req.query('vessel') || 'all';
  const qRole = c.req.query('role') || 'all';
  const qType = c.req.query('type') || 'all';

  // Build query
  const conditions: string[] = ['co.trip_date = $1'];
  const params: any[] = [qDate];
  let paramIdx = 2;

  if (qVessel !== 'all') {
    conditions.push(`co.vessel = $${paramIdx++}`);
    params.push(qVessel);
  }
  if (qRole !== 'all') {
    conditions.push(`cr.role = $${paramIdx++}`);
    params.push(qRole);
  }
  if (qType !== 'all') {
    conditions.push(`co.template_type = $${paramIdx++}`);
    params.push(qType);
  }

  const result = await pool.query(
    `SELECT co.*, cr.name as crew_name, cr.role as crew_role
     FROM completions co
     LEFT JOIN crew cr ON co.crew_id = cr.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY co.vessel, co.completed_at DESC`,
    params
  );
  const completions = result.rows;

  // Group by vessel
  const byVessel = new Map<string, any[]>();
  for (const co of completions) {
    const v = co.vessel || 'unknown';
    if (!byVessel.has(v)) byVessel.set(v, []);
    byVessel.get(v)!.push(co);
  }

  // Date navigation
  const [y, m, d] = qDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const prevDate = (() => { const p = new Date(dt); p.setDate(p.getDate() - 1); return p.toISOString().split('T')[0]; })();
  const nextDate = (() => { const n = new Date(dt); n.setDate(n.getDate() + 1); return n.toISOString().split('T')[0]; })();
  const displayDate = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const buildUrl = (overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { date: qDate, vessel: qVessel, role: qRole, type: qType, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== 'all' && v !== today) p.set(k, v);
      else if (k === 'date' && v !== today) p.set(k, v);
    }
    const qs = p.toString();
    return `/report/logs${qs ? '?' + qs : ''}`;
  };

  // Vessel filter pills
  const vesselPills = [
    { slug: 'all', label: 'All' },
    ...VESSELS.map(v => ({ slug: v, label: VESSEL_LABELS[v] || v })),
  ].map(v => {
    const active = v.slug === qVessel;
    return `<a href="${buildUrl({ vessel: v.slug })}" style="padding:6px 14px;border-radius:999px;font-size:0.75rem;font-weight:${active ? '700' : '500'};text-decoration:none;${active ? 'background:#1A6B8A;color:white' : 'background:white;color:#5b5f67;border:1px solid #E5E5EA'}">${v.label}</a>`;
  }).join('');

  // Type pills
  const typePills = [
    { val: 'all', label: 'All' },
    { val: 'checklist', label: 'Checklists' },
    { val: 'logbook', label: 'Vessel Logs' },
  ].map(t => {
    const active = t.val === qType;
    return `<a href="${buildUrl({ type: t.val })}" style="padding:6px 14px;border-radius:999px;font-size:0.75rem;font-weight:${active ? '700' : '500'};text-decoration:none;${active ? 'background:#0D5470;color:white' : 'background:white;color:#5b5f67;border:1px solid #E5E5EA'}">${t.label}</a>`;
  }).join('');

  // Role pills
  const rolePills = ['all', 'captain', 'deckhand'].map(r => {
    const active = r === qRole;
    const label = r === 'all' ? 'All Roles' : r.charAt(0).toUpperCase() + r.slice(1);
    return `<a href="${buildUrl({ role: r })}" style="padding:6px 14px;border-radius:999px;font-size:0.75rem;font-weight:${active ? '700' : '500'};text-decoration:none;${active ? 'background:#5b5f67;color:white' : 'background:white;color:#5b5f67;border:1px solid #E5E5EA'}">${label}</a>`;
  }).join('');

  // Render completion cards
  const renderLogCard = (co: any) => {
    const values = co.values_json || {};
    const isLogbook = co.template_type === 'logbook';
    const hasAlerts = co.alerts_json && (co.alerts_json as any[]).length > 0;
    const accentColor = isLogbook ? '#1A6B8A' : '#34C759';
    const typeLabel = isLogbook ? 'Vessel Log' : 'Checklist';
    const roleBadge = co.crew_role === 'captain' ? 'Capt.' : 'DH';

    const time = co.completed_at
      ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      : '—';

    // Extract preview data from values
    const previewParts: string[] = [];
    if (values['engine-hours-port']) previewParts.push(`Eng: ${values['engine-hours-port']}/${values['engine-hours-stbd'] || '—'}`);
    if (values['fuel-burned']) previewParts.push(`Fuel: ${values['fuel-burned']} gal`);
    if (values['pax-count-am'] || values['pax-count']) previewParts.push(`Pax: ${values['pax-count-am'] || values['pax-count']}`);

    // Count filled items
    let filled = 0, total = 0;
    for (const [key, val] of Object.entries(values)) {
      if (key.startsWith('note_') || key === 'notes' || key === 'sign_off') continue;
      total++;
      if (val && val !== '' && val !== 'false') filled++;
    }

    // Expanded values grid
    const valuesGrid = Object.entries(values)
      .filter(([k]) => !k.startsWith('note_') && k !== 'notes' && k !== 'sign_off')
      .map(([key, val]) => {
        const label = key.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const displayVal = typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val || '—');
        return `<div style="padding:8px 10px;background:rgba(26,107,138,0.04);border-radius:8px">
          <div style="font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8E8E93;margin-bottom:2px">${escapeHtml(label)}</div>
          <div style="font-size:0.8125rem;font-weight:500;color:#1a1c1e">${escapeHtml(displayVal)}</div>
        </div>`;
      }).join('');

    return `
      <details style="background:white;border-radius:12px;border:1px solid rgba(0,0,0,0.04);box-shadow:0 1px 3px rgba(0,0,0,0.03);margin-bottom:10px;overflow:hidden;position:relative">
        <div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:${accentColor}"></div>
        <summary style="padding:14px 16px 14px 20px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;list-style:none;-webkit-appearance:none">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
            <div>
              <h3 style="font-size:0.875rem;font-weight:700;color:#1a1c1e;margin-bottom:2px">${escapeHtml(co.template_id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()))}</h3>
              <div style="display:flex;align-items:center;gap:8px;font-size:0.6875rem;color:#8E8E93">
                <span>${roleBadge} ${escapeHtml(co.crew_name || 'Unknown')}</span>
                <span>·</span>
                <span>${time}</span>
                ${previewParts.length > 0 ? `<span>·</span><span style="color:#5b5f67">${previewParts.join(' · ')}</span>` : ''}
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${hasAlerts ? `<span style="font-size:0.625rem;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(243,109,79,0.1);color:#F36D4F">${(co.alerts_json as any[]).length} alerts</span>` : ''}
            <span style="font-size:0.625rem;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(52,199,89,0.08);color:#34C759">${filled}/${total}</span>
            <span class="material-symbols-outlined" style="font-size:18px;color:#c7c7cc">expand_more</span>
          </div>
        </summary>
        <div style="padding:0 20px 16px;border-top:1px solid #F2F2F7">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin-top:12px">
            ${valuesGrid}
          </div>
          ${co.notes ? `<div style="margin-top:12px;padding:10px;background:rgba(112,208,235,0.06);border-radius:8px;font-size:0.8125rem;color:#5b5f67"><strong>Notes:</strong> ${escapeHtml(co.notes)}</div>` : ''}
        </div>
      </details>`;
  };

  // Vessel groups
  const groupsHtml = Array.from(byVessel.entries()).map(([vessel, items]) => {
    const vesselName = VESSEL_LABELS[vessel] || vessel.toUpperCase();
    return `
      <div style="margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span class="material-symbols-outlined" style="font-size:18px;color:#1A6B8A">directions_boat</span>
          <h3 style="font-family:'Manrope',sans-serif;font-weight:700;font-size:1rem;color:#1a1c1e">${vesselName}</h3>
          <span style="font-size:0.625rem;font-weight:600;color:#8E8E93">${items.length} completions</span>
        </div>
        ${items.map(renderLogCard).join('')}
      </div>`;
  }).join('');

  const emptyState = completions.length === 0 ? `
    <div style="text-align:center;padding:48px 0;color:#8E8E93">
      <span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:12px;color:#E5E5EA">search_off</span>
      <p style="font-size:1rem;font-weight:600;color:#1a1c1e;margin-bottom:4px">No logs found</p>
      <p style="font-size:0.875rem">Try a different date or adjust filters.</p>
    </div>` : '';

  return c.html(reportLayout('Logs', `
    <h1 style="font-family:'Manrope',sans-serif;font-size:1.5rem;font-weight:800;color:#1a1c1e;letter-spacing:-0.02em;margin-bottom:16px">Completed Logs</h1>

    <!-- Date navigation -->
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:16px">
      <a href="${buildUrl({ date: prevDate })}" style="width:36px;height:36px;border-radius:999px;background:white;border:1px solid #E5E5EA;display:flex;align-items:center;justify-content:center;text-decoration:none;color:#1a1c1e">
        <span class="material-symbols-outlined" style="font-size:18px">chevron_left</span>
      </a>
      <span style="font-family:'Manrope',sans-serif;font-weight:700;font-size:1.0625rem;color:#1a1c1e;min-width:200px;text-align:center">${displayDate}</span>
      <a href="${buildUrl({ date: nextDate })}" style="width:36px;height:36px;border-radius:999px;background:white;border:1px solid #E5E5EA;display:flex;align-items:center;justify-content:center;text-decoration:none;color:#1a1c1e">
        <span class="material-symbols-outlined" style="font-size:18px">chevron_right</span>
      </a>
      ${qDate !== today ? `<a href="${buildUrl({ date: today })}" style="font-size:0.75rem;color:#1A6B8A;font-weight:600;text-decoration:none;margin-left:8px">Today</a>` : ''}
    </div>

    <!-- Filters -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:20px">
      <div style="display:flex;gap:4px">${vesselPills}</div>
      <div style="width:1px;height:20px;background:#E5E5EA;margin:0 4px"></div>
      <div style="display:flex;gap:4px">${typePills}</div>
      <div style="width:1px;height:20px;background:#E5E5EA;margin:0 4px"></div>
      <div style="display:flex;gap:4px">${rolePills}</div>
    </div>

    <!-- Results -->
    ${groupsHtml}
    ${emptyState}
  `));
});

export default app;
