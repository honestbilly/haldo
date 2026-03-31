import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { getSession } from './session.js';
import { bottomNav, htmlHead } from '../ui.js';
import type { SessionData } from '../types.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

// Middleware: require session for /log
app.use('/log', async (c, next) => {
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

export default app;
