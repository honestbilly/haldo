import { Hono } from 'hono';
import pool from '../db.js';
import { getSession } from './session.js';
import { bottomNav, htmlHead } from '../ui.js';
import type { SessionData } from '../types.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

app.get('/', async (c) => {
  const session = c.get('session');

  // Count today's completions
  const completions = await pool.query(
    `SELECT COUNT(*) FROM completions WHERE crew_id = $1 AND trip_date = $2`,
    [session.crew_id, session.trip_date]
  );
  const todayCount = parseInt(completions.rows[0].count);

  return c.html(`${htmlHead('More')}
<body>
  <div style="max-width:480px;margin:0 auto;padding:16px;padding-bottom:80px;">
    <header style="text-align:center;margin-bottom:24px;padding-top:8px;">
      <div style="width:56px;height:56px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-size:1.5rem;font-weight:700;">
        ${session.crew_name.charAt(0)}
      </div>
      <h1 style="font-family:var(--font-heading);font-size:1.125rem;">${session.crew_name}</h1>
      <p style="font-size:0.8125rem;color:var(--text-muted);">${session.role === 'captain' ? 'Captain' : 'Deckhand'} — ${session.vessel.toUpperCase()} — ${session.trip_slot}</p>
    </header>

    <div style="display:flex;flex-direction:column;gap:2px;">
      <a href="/today" style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:var(--surface);text-decoration:none;color:var(--text);border-radius:var(--radius) var(--radius) 0 0;border:1px solid var(--border);">
        <span>📋 My Completions Today</span>
        <span style="color:var(--primary);font-weight:600;">${todayCount}</span>
      </a>

      <a href="/handoff" style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:var(--surface);text-decoration:none;color:var(--text);border:1px solid var(--border);border-top:0;">
        <span>📝 Handoff Notes</span>
        <span style="color:var(--text-muted);">→</span>
      </a>

      <a href="/report" style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:var(--surface);text-decoration:none;color:var(--text);border:1px solid var(--border);border-top:0;">
        <span>📊 MGMT Dashboard</span>
        <span style="color:var(--text-muted);">→</span>
      </a>

      <a href="/logout" style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:var(--surface);text-decoration:none;color:var(--text);border-radius:0 0 var(--radius) var(--radius);border:1px solid var(--border);border-top:0;">
        <span>👤 Switch Crew Member</span>
        <span style="color:var(--text-muted);">→</span>
      </a>
    </div>

    <p style="text-align:center;margin-top:32px;font-size:0.6875rem;color:var(--text-muted);">Haldo v0 — Honest Eco Crew Operations</p>
  </div>
  ${bottomNav('more')}
</body>
</html>`);
});

export default app;
