import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { getSession } from './session.js';
import type { SessionData } from '../types.js';
import { bottomNav } from '../ui.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

// Require session
app.use('*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

// GET /handoff — show active handoff notes for this vessel + add/edit form
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

// POST /handoff — add a new note
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

// POST /handoff/:id/update — edit a note
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

// POST /handoff/:id/resolve — mark note as resolved
app.post('/:id/resolve', async (c) => {
  const id = c.req.param('id');
  await pool.query(
    'UPDATE handoff_notes SET resolved = TRUE, updated_at = NOW() WHERE id = $1',
    [id]
  );
  return c.redirect('/handoff');
});

function renderHandoff(session: SessionData, notes: any[], saved: boolean = false): string {
  const myNotes = notes.filter(n => n.crew_id === session.crew_id);
  const otherNotes = notes.filter(n => n.crew_id !== session.crew_id);

  const renderNote = (n: any, editable: boolean) => {
    const time = new Date(n.created_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    const roleLabel = n.role === 'captain' ? 'Capt.' : 'Deckhand';

    if (editable) {
      return `
        <div class="handoff-note handoff-mine">
          <div class="handoff-meta">${roleLabel} ${n.crew_display_name || n.crew_name} — ${time}</div>
          <form action="/handoff/${n.id}/update" method="POST" class="handoff-edit-form">
            <textarea name="note" class="handoff-edit-input">${n.note}</textarea>
            <div class="handoff-actions">
              <button type="submit" class="handoff-btn save">Save</button>
              <button type="submit" formaction="/handoff/${n.id}/resolve" class="handoff-btn resolve">Done / Resolved</button>
            </div>
          </form>
        </div>`;
    }

    return `
      <div class="handoff-note">
        <div class="handoff-meta">${roleLabel} ${n.crew_display_name || n.crew_name} — ${time}</div>
        <p class="handoff-text">${n.note}</p>
        <form action="/handoff/${n.id}/resolve" method="POST" style="display:inline">
          <button type="submit" class="handoff-btn resolve">Acknowledged</button>
        </form>
      </div>`;
  };

  const otherNotesHtml = otherNotes.length > 0
    ? otherNotes.map(n => renderNote(n, false)).join('')
    : '<p class="no-notes">No handoff notes from other crew.</p>';

  const myNotesHtml = myNotes.length > 0
    ? myNotes.map(n => renderNote(n, true)).join('')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Handoff Notes — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#1A6B8A">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
  <style>
    .handoff-page { max-width: 480px; margin: 0 auto; padding: 16px; padding-bottom: 80px; }
    .handoff-header { text-align: center; margin-bottom: 16px; }
    .handoff-header h1 { font-family: var(--font-heading); font-size: 1.25rem; color: var(--primary); }
    .handoff-header p { font-size: 0.8125rem; color: var(--text-muted); }

    .handoff-section-title { font-family: var(--font-heading); font-size: 0.75rem; font-weight: 600;
      color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin: 16px 0 8px; }

    .handoff-note { background: var(--surface); border-radius: var(--radius); padding: 12px;
      margin-bottom: 8px; border-left: 3px solid var(--primary); }
    .handoff-mine { border-left-color: var(--secondary); }
    .handoff-meta { font-size: 0.6875rem; color: var(--text-muted); margin-bottom: 4px; }
    .handoff-text { font-size: 0.875rem; line-height: 1.5; }

    .handoff-edit-input { width: 100%; min-height: 48px; border: 1px solid var(--border);
      border-radius: 6px; padding: 8px; font-family: var(--font-body); font-size: 14px;
      resize: vertical; background: var(--surface); }
    .handoff-edit-input:focus { outline: none; border-color: var(--primary); }

    .handoff-actions { display: flex; gap: 8px; margin-top: 6px; }
    .handoff-btn { padding: 6px 12px; border: none; border-radius: 6px; font-size: 0.75rem;
      font-weight: 600; cursor: pointer; }
    .handoff-btn.save { background: var(--primary); color: #fff; }
    .handoff-btn.resolve { background: var(--surface-container); color: var(--text-muted); }

    .no-notes { font-size: 0.875rem; color: var(--text-muted); font-style: italic; padding: 12px 0; }

    .add-note-form { background: var(--surface); border-radius: var(--radius); padding: 12px; margin-top: 16px; }
    .add-note-form textarea { width: 100%; min-height: 72px; border: 1px solid var(--border);
      border-radius: 6px; padding: 8px; font-family: var(--font-body); font-size: 14px;
      resize: vertical; }
    .add-note-form textarea:focus { outline: none; border-color: var(--primary); }
    .add-note-form button { margin-top: 8px; width: 100%; padding: 12px; background: var(--primary);
      color: #fff; border: none; border-radius: var(--radius); font-weight: 600; font-size: 0.875rem;
      cursor: pointer; min-height: 48px; }
  </style>
</head>
<body>
  <div class="handoff-page">
    <header class="handoff-header">
      <a href="/today" style="display:block;color:var(--primary);text-decoration:none;font-size:0.875rem;margin-bottom:8px;">← Home</a>
      <h1>Handoff Notes</h1>
      <p>${session.vessel.toUpperCase()} — ${session.crew_name}</p>
    </header>

    ${saved ? `<div style="padding:10px 16px;background:rgba(26,107,138,0.08);border-radius:var(--radius);margin-bottom:12px;font-size:0.875rem;color:var(--primary);text-align:center;">✓ Note saved</div>` : ''}

    ${otherNotes.length > 0 ? `
      <h2 class="handoff-section-title">Notes from other crew</h2>
      ${otherNotesHtml}
    ` : `
      <div class="no-notes">No handoff notes waiting for you.</div>
    `}

    ${myNotes.length > 0 ? `
      <h2 class="handoff-section-title">Your notes (editable)</h2>
      ${myNotesHtml}
    ` : ''}

    <form action="/handoff" method="POST" class="add-note-form">
      <label class="handoff-section-title">Add a handoff note</label>
      <textarea name="note" placeholder="Leave a note for the next crew... (e.g., 'Low on toilet paper — check forward head')" required></textarea>
      <button type="submit">Add Note</button>
    </form>

    <a href="/today" style="display:block;text-align:center;padding:14px;margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--primary);text-decoration:none;font-weight:600;font-size:0.875rem;min-height:48px;line-height:20px">← Back to Home</a>
  </div>
  ${bottomNav('home')}
</body>
</html>`;
}

export default app;
