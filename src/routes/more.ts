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

  const completions = await pool.query(
    `SELECT COUNT(*) FROM completions WHERE crew_id = $1 AND trip_date = $2`,
    [session.crew_id, session.trip_date]
  );
  const todayCount = parseInt(completions.rows[0].count);

  // iOS grouped list row helper
  const row = (icon: string, label: string, href: string, right: string = '<span class="material-symbols-outlined" style="font-size:20px;color:#c7c7cc">chevron_right</span>', subtitle: string = '') => `
    <a href="${href}" style="display:flex;align-items:center;padding:16px;text-decoration:none;color:#1a1c1e;transition:background 0.1s;-webkit-tap-highlight-color:transparent;min-height:54px" ontouchstart="this.style.background='#F2F2F7'" ontouchend="this.style.background='transparent'">
      <span class="material-symbols-outlined" style="color:#1A6B8A;font-size:22px;margin-right:12px">${icon}</span>
      <div style="flex:1">
        <span style="font-size:1.0625rem;font-weight:500">${label}</span>
        ${subtitle ? `<span style="display:block;font-size:0.6875rem;color:#8E8E93">${subtitle}</span>` : ''}
      </div>
      ${right}
    </a>`;

  const separator = '<div style="height:1px;background:#E5E5EA;margin-left:50px"></div>';

  return c.html(`${htmlHead('More')}
<body style="background:#F2F2F7">
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;justify-content:center;align-items:center;height:64px">
    <span style="font-family:'Manrope',sans-serif;font-weight:700;font-size:1.125rem;color:#1a1c1e">More</span>
  </header>

  <main style="max-width:480px;margin:0 auto;padding:80px 16px 120px">
    <!-- Profile -->
    <section style="display:flex;flex-direction:column;align-items:center;padding-top:8px;margin-bottom:32px">
      <div style="width:56px;height:56px;border-radius:50%;background:#1A6B8A;display:flex;align-items:center;justify-content:center;color:white;font-family:'Manrope',sans-serif;font-weight:700;font-size:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
        ${session.crew_name.charAt(0)}
      </div>
      <h2 style="margin-top:12px;font-family:'Manrope',sans-serif;font-weight:700;font-size:1.25rem;color:#1a1c1e">${session.crew_name}</h2>
      <p style="font-size:0.8125rem;color:#8E8E93;font-weight:500;text-transform:uppercase;letter-spacing:0.1em">${session.role === 'captain' ? 'Captain' : 'Deckhand'} — ${session.vessel.toUpperCase()} — ${session.trip_slot}</p>
    </section>

    <!-- Section 1: Crew Stats -->
    <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);margin-bottom:16px">
      ${row('assignment_turned_in', 'My Completions Today', '/today',
        `<span style="background:rgba(26,107,138,0.1);color:#1A6B8A;padding:2px 10px;border-radius:999px;font-size:0.75rem;font-weight:700;margin-right:8px">${todayCount}</span><span class="material-symbols-outlined" style="font-size:20px;color:#c7c7cc">chevron_right</span>`
      )}
      ${separator}
      ${row('sticky_note_2', 'Handoff Notes', '/handoff')}
    </div>

    <!-- Section 2: Management -->
    <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);margin-bottom:16px">
      ${row('analytics', 'MGMT Dashboard', '/report', undefined, 'Manager access')}
    </div>

    <!-- Section 3: Operations -->
    <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);margin-bottom:32px">
      ${row('directions_boat', 'Switch Vessel / Trip', '/')}
    </div>

    <!-- Footer -->
    <footer style="text-align:center;padding:24px 0 48px">
      <p style="font-size:0.6875rem;color:#8E8E93;font-weight:500">Haldo v0 — Honest Eco Crew Operations</p>
    </footer>
  </main>
  ${bottomNav('more')}
</body>
</html>`);
});

export default app;
