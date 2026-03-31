// Handoff notes — rebuilt from Stitch HTML pattern
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { getSession } from './session.js';
import type { SessionData } from '../types.js';
import { bottomNav, htmlHead } from '../ui.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

app.get('/', async (c) => {
  const session = c.get('session');
  const notes = await pool.query(
    `SELECT h.*, c.name as crew_display_name FROM handoff_notes h
     LEFT JOIN crew c ON h.crew_id = c.id
     WHERE h.vessel = $1 AND h.resolved = FALSE
     ORDER BY h.created_at DESC`,
    [session.vessel]
  );

  const saved = c.req.query('saved') === '1';
  return c.html(renderHandoff(session, notes.rows, saved));
});

app.post('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.parseBody();
  const note = String(body.note || '').trim();
  if (note) {
    await pool.query(
      `INSERT INTO handoff_notes (id, vessel, crew_id, crew_name, role, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [nanoid(), session.vessel, session.crew_id, session.crew_name, session.role, note]
    );
  }
  return c.redirect('/handoff?saved=1');
});

app.post('/:id/update', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const note = String(body.note || '').trim();
  if (note) {
    await pool.query(
      `UPDATE handoff_notes SET note = $1, updated_at = NOW() WHERE id = $2 AND crew_id = $3`,
      [note, id, session.crew_id]
    );
  }
  return c.redirect('/handoff?saved=1');
});

app.post('/:id/resolve', async (c) => {
  const id = c.req.param('id');
  await pool.query('UPDATE handoff_notes SET resolved = TRUE, updated_at = NOW() WHERE id = $1', [id]);
  return c.redirect('/handoff');
});

function renderHandoff(session: SessionData, notes: any[], saved: boolean): string {
  const myNotes = notes.filter(n => n.crew_id === session.crew_id);
  const otherNotes = notes.filter(n => n.crew_id !== session.crew_id);

  const timeAgo = (d: Date) => {
    const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

  const sectionHeader = (text: string) =>
    `<h2 style="font-size:0.6875rem;font-weight:700;letter-spacing:0.15em;color:#6e7a74;text-transform:uppercase;margin-bottom:12px">${text}</h2>`;

  const otherNotesHtml = otherNotes.length > 0 ? otherNotes.map(n => {
    const roleLabel = n.role === 'captain' ? 'Capt.' : 'DH';
    const name = n.crew_display_name || n.crew_name;
    return `
      <article style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <span style="background:#E5E8F0;padding:4px 8px;border-radius:4px;font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1a1c1e">${roleLabel} ${esc(name)}</span>
          <span style="font-size:0.625rem;color:#8E8E93;font-weight:500">${timeAgo(n.created_at)}</span>
        </div>
        <p style="font-size:0.875rem;line-height:1.6;color:#5b5f67;margin-bottom:16px">${esc(n.note)}</p>
        <form action="/handoff/${n.id}/resolve" method="POST" style="display:inline">
          <button type="submit" style="background:#E5E8F0;color:#5b5f67;padding:8px 16px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all 0.15s;-webkit-tap-highlight-color:transparent" ontouchstart="this.style.transform='scale(0.95)'" ontouchend="this.style.transform='scale(1)'">Acknowledged</button>
        </form>
      </article>`;
  }).join('') : '<p style="color:#8E8E93;font-style:italic;font-size:0.875rem;padding:8px 0">No handoff notes waiting for you.</p>';

  const myNotesHtml = myNotes.map(n => `
    <div style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);border-left:4px solid #70D0EB;margin-bottom:12px">
      <div style="margin-bottom:12px">
        <span style="background:rgba(26,107,138,0.05);color:#1A6B8A;padding:4px 8px;border-radius:4px;font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;font-style:italic">Drafting</span>
      </div>
      <form action="/handoff/${n.id}/update" method="POST">
        <textarea name="note" style="width:100%;background:transparent;border:none;font-size:0.875rem;color:#5b5f67;resize:none;min-height:60px;padding:0;outline:none;font-family:'Inter',sans-serif;line-height:1.6">${esc(n.note)}</textarea>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button type="submit" style="background:#1A6B8A;color:white;padding:10px 20px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all 0.15s" ontouchstart="this.style.transform='scale(0.95)'" ontouchend="this.style.transform='scale(1)'">Save</button>
          <button type="submit" formaction="/handoff/${n.id}/resolve" style="background:#E5E8F0;color:#5b5f67;padding:10px 20px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all 0.15s" ontouchstart="this.style.transform='scale(0.95)'" ontouchend="this.style.transform='scale(1)'">Done / Resolved</button>
        </div>
      </form>
    </div>
  `).join('');

  return `${htmlHead('Handoff Notes')}
<body style="background:#F2F2F7">
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:64px">
    <a href="/today" style="color:#1A6B8A;text-decoration:none;font-weight:600;font-size:0.875rem;display:flex;align-items:center;gap:4px">
      <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Home
    </a>
    <span style="font-weight:700;font-size:1rem;color:#1a1c1e">${session.vessel.toUpperCase()} Handoff Notes</span>
    <span style="font-size:0.8125rem;color:#8E8E93"></span>
  </header>

  <main style="max-width:480px;margin:0 auto;padding:80px 24px 120px">
    ${saved ? '<div style="padding:12px;background:rgba(52,199,89,0.1);border-radius:12px;margin-bottom:16px;font-size:0.875rem;color:#34C759;text-align:center;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px"><span class="material-symbols-outlined" style="font-size:18px;font-variation-settings:\'FILL\' 1">check_circle</span> Note saved</div>' : ''}

    <!-- Notes from other crew -->
    <section style="margin-bottom:32px">
      ${sectionHeader('Notes from other crew')}
      ${otherNotesHtml}
    </section>

    <!-- Your notes -->
    ${myNotes.length > 0 ? `
    <section style="margin-bottom:32px">
      ${sectionHeader('Your notes (editable)')}
      ${myNotesHtml}
    </section>` : ''}

    <!-- Add note -->
    <section style="margin-bottom:32px">
      ${sectionHeader('Add a handoff note')}
      <form action="/handoff" method="POST">
        <div style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
          <textarea name="note" required placeholder="Leave a note for the next crew..." style="width:100%;min-height:80px;border:none;background:transparent;font-size:0.9375rem;font-family:'Inter',sans-serif;color:#1a1c1e;resize:none;outline:none;line-height:1.6"></textarea>
        </div>
        <button type="submit" style="width:100%;height:54px;background:#F36D4F;color:white;border:none;border-radius:12px;font-family:'Manrope',sans-serif;font-size:1.0625rem;font-weight:700;cursor:pointer;margin-top:12px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px rgba(243,109,79,0.25);transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:20px">add</span> Add Note
        </button>
      </form>
    </section>
  </main>
  ${bottomNav('home')}
</body>
</html>`;
}

export default app;
