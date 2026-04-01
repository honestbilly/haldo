// Vessel management: list, create, edit, deactivate
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { escapeHtml, reportLayout, loadVessels } from '../lib/report-shared.js';

const app = new Hono();

// List all vessels
app.get('/report/vessels', async (c) => {
  const result = await pool.query('SELECT * FROM vessels ORDER BY display_order, name');
  const vessels = result.rows;
  const saved = c.req.query('saved') === '1';

  const vesselCards = vessels.map((v: any) => `
    <div style="background:white;border-radius:12px;padding:16px 20px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.04);display:flex;align-items:center;justify-content:space-between;${!v.active ? 'opacity:0.5;' : ''}">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:12px;background:${v.color || '#1A6B8A'};display:flex;align-items:center;justify-content:center">
          <span class="material-symbols-outlined" style="font-size:20px;color:white">${v.vessel_type === 'boat' ? 'directions_boat' : v.vessel_type === 'shore' ? 'home' : v.vessel_type === 'yard' ? 'warehouse' : 'business'}</span>
        </div>
        <div>
          <div style="font-weight:700;font-size:0.9375rem">${escapeHtml(v.name)}</div>
          <div style="font-size:0.75rem;color:#8E8E93">${v.slug} · ${v.vessel_type}${!v.active ? ' · Inactive' : ''}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <a href="/report/vessels/${v.id}/edit" style="padding:6px 12px;border:1px solid #E5E5EA;border-radius:8px;font-size:0.6875rem;font-weight:600;color:#1A6B8A;text-decoration:none">Edit</a>
        ${v.active
          ? `<form action="/report/vessels/${v.id}/deactivate" method="POST" style="display:inline"><button type="submit" style="padding:6px 12px;border:1px solid #FF3B30;border-radius:8px;font-size:0.6875rem;font-weight:600;color:#FF3B30;background:none;cursor:pointer">Deactivate</button></form>`
          : `<form action="/report/vessels/${v.id}/activate" method="POST" style="display:inline"><button type="submit" style="padding:6px 12px;border:1px solid #34C759;border-radius:8px;font-size:0.6875rem;font-weight:600;color:#34C759;background:none;cursor:pointer">Activate</button></form>`
        }
      </div>
    </div>`).join('');

  const inputStyle = `width:100%;height:48px;background:#E5E8F0;border:none;border-radius:12px;padding:0 16px;font-size:0.9375rem;font-weight:500;color:#1a1c1e;outline:none;font-family:'Inter',sans-serif`;

  return c.html(reportLayout('Vessels', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h2 style="font-family:'Manrope',sans-serif;font-size:1.25rem;font-weight:800">Vessels & Locations</h2>
      <span style="font-size:0.8125rem;color:#8E8E93">${vessels.length} total</span>
    </div>

    ${saved ? '<div style="padding:12px;background:rgba(52,199,89,0.1);border-radius:12px;margin-bottom:16px;font-size:0.875rem;color:#34C759;text-align:center;font-weight:600">✓ Saved</div>' : ''}

    <!-- Add Vessel -->
    <details style="background:white;border-radius:12px;padding:16px 20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <summary style="font-weight:700;font-size:0.875rem;cursor:pointer;color:#1A6B8A;display:flex;align-items:center;gap:8px">
        <span class="material-symbols-outlined" style="font-size:20px">add_circle</span> Add Vessel or Location
      </summary>
      <form action="/report/vessels/create" method="POST" style="margin-top:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#8E8E93;margin-bottom:4px">Name *</label>
            <input type="text" name="name" required placeholder="e.g. New Vessel" style="${inputStyle}">
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#8E8E93;margin-bottom:4px">Slug *</label>
            <input type="text" name="slug" required placeholder="e.g. new-vessel" style="${inputStyle}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#8E8E93;margin-bottom:4px">Type</label>
            <select name="vessel_type" style="${inputStyle}">
              <option value="boat">Boat</option>
              <option value="shore">Shore / Office</option>
              <option value="yard">Yard</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#8E8E93;margin-bottom:4px">Color</label>
            <input type="color" name="color" value="#1A6B8A" style="width:100%;height:48px;border:none;border-radius:12px;cursor:pointer">
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#8E8E93;margin-bottom:4px">Display Order</label>
            <input type="number" name="display_order" value="50" style="${inputStyle}">
          </div>
        </div>
        <button type="submit" style="width:100%;height:48px;background:#1A6B8A;color:white;border:none;border-radius:12px;font-weight:700;font-size:0.875rem;cursor:pointer">Add Vessel</button>
      </form>
    </details>

    ${vesselCards}
  `));
});

// Create vessel
app.post('/report/vessels/create', async (c) => {
  const body = await c.req.parseBody();
  const id = nanoid();
  await pool.query(
    'INSERT INTO vessels (id, name, slug, color, vessel_type, display_order) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, String(body.name).trim(), String(body.slug).trim().toLowerCase(), String(body.color || '#1A6B8A'), String(body.vessel_type || 'boat'), parseInt(String(body.display_order || '50'))]
  );
  await loadVessels();
  return c.redirect('/report/vessels?saved=1');
});

// Deactivate vessel
app.post('/report/vessels/:id/deactivate', async (c) => {
  await pool.query('UPDATE vessels SET active = FALSE WHERE id = $1', [c.req.param('id')]);
  await loadVessels();
  return c.redirect('/report/vessels');
});

// Activate vessel
app.post('/report/vessels/:id/activate', async (c) => {
  await pool.query('UPDATE vessels SET active = TRUE WHERE id = $1', [c.req.param('id')]);
  await loadVessels();
  return c.redirect('/report/vessels');
});

export default app;
