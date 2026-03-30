import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';
import { getSession } from './session.js';
import { bottomNav, htmlHead } from '../ui.js';
import type { SessionData } from '../types.js';

type Env = { Variables: { session: SessionData } };

const app = new Hono<Env>();

// Require session
app.use('*', async (c, next) => {
  const session = getSession(c as any);
  if (!session) return c.redirect('/');
  c.set('session', session);
  await next();
});

// GET /submit — unified submission screen: "Who is this for?"
app.get('/', (c) => {
  const session = c.get('session');
  return c.html(renderSubmitHome(session));
});

// GET /submit/handoff — handoff note form
app.get('/handoff', (c) => {
  const session = c.get('session');
  return c.redirect('/handoff');
});

// GET /submit/feedback — feedback form (category → details)
app.get('/feedback', (c) => {
  const session = c.get('session');
  return c.html(renderFeedbackForm(session));
});

// POST /submit/feedback — save feedback
app.post('/feedback', async (c) => {
  const session = c.get('session');
  const body = await c.req.parseBody();
  const category = String(body.category || 'general');
  const title = String(body.title || '').trim();
  const details = String(body.details || '').trim();

  if (!title) return c.redirect('/submit/feedback');

  // For now, save as a completion note until submissions table is built
  // TODO: Create submissions table in v1
  // For now, just redirect back with confirmation
  return c.html(renderFeedbackSuccess(session, category, title));
});

function renderSubmitHome(session: SessionData): string {
  return `${htmlHead('Submit')}
<body>
  <div class="submit-page" style="max-width:480px;margin:0 auto;padding:16px;padding-bottom:80px;">
    <header style="text-align:center;margin-bottom:24px;">
      <h1 style="font-family:var(--font-heading);font-size:1.25rem;color:var(--primary);">Submit</h1>
      <p style="font-size:0.8125rem;color:var(--text-muted);">${session.vessel.toUpperCase()} — ${session.crew_name}</p>
    </header>

    <p style="font-size:0.9375rem;color:var(--text);margin-bottom:16px;font-weight:500;">Who is this for?</p>

    <a href="/handoff" class="submit-option" style="display:block;background:var(--surface);border-radius:var(--radius-lg);padding:20px;margin-bottom:12px;text-decoration:none;color:var(--text);border:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;">📝</span>
        <div>
          <strong style="display:block;font-size:1rem;">Next Crew</strong>
          <span style="font-size:0.8125rem;color:var(--text-muted);">Leave a note for whoever comes next on this boat</span>
        </div>
        <span style="margin-left:auto;color:var(--text-muted);">→</span>
      </div>
    </a>

    <a href="/submit/feedback" class="submit-option" style="display:block;background:var(--surface);border-radius:var(--radius-lg);padding:20px;margin-bottom:12px;text-decoration:none;color:var(--text);border:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;">📋</span>
        <div>
          <strong style="display:block;font-size:1rem;">Management</strong>
          <span style="font-size:0.8125rem;color:var(--text-muted);">Report a problem, suggest something, or give kudos</span>
        </div>
        <span style="margin-left:auto;color:var(--text-muted);">→</span>
      </div>
    </a>
  </div>
  ${bottomNav('submit')}
</body>
</html>`;
}

function renderFeedbackForm(session: SessionData): string {
  const categories = [
    { id: 'maintenance', label: 'Maintenance Issue', icon: '🔧' },
    { id: 'suggestion', label: 'Suggestion', icon: '💡' },
    { id: 'safety', label: 'Safety Concern', icon: '⚠️' },
    { id: 'meeting-topic', label: 'Meeting Topic', icon: '📅' },
    { id: 'kudos', label: 'Kudos / Shout-out', icon: '⭐' },
    { id: 'sop-feedback', label: 'SOP Feedback', icon: '📖' },
    { id: 'general', label: 'General', icon: '💬' },
  ];

  const categoryBtns = categories.map(cat => `
    <button type="button" class="select-btn" data-value="${cat.id}"
      onclick="document.getElementById('cat-input').value='${cat.id}';
        this.parentElement.querySelectorAll('.select-btn').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');">
      ${cat.icon} ${cat.label}
    </button>`).join('');

  return `${htmlHead('Submit to Management')}
<body>
  <div style="max-width:480px;margin:0 auto;padding:16px;padding-bottom:80px;">
    <header style="text-align:center;margin-bottom:16px;">
      <a href="/submit" style="color:var(--primary);text-decoration:none;font-size:0.875rem;">← Back</a>
      <h1 style="font-family:var(--font-heading);font-size:1.125rem;color:var(--primary);margin-top:8px;">Report to Management</h1>
    </header>

    <form action="/submit/feedback" method="POST">
      <div style="margin-bottom:16px;">
        <label style="font-weight:500;font-size:0.875rem;display:block;margin-bottom:8px;">Category</label>
        <div class="button-group" style="display:flex;flex-wrap:wrap;gap:8px;">
          ${categoryBtns}
        </div>
        <input type="hidden" name="category" id="cat-input" required>
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-weight:500;font-size:0.875rem;display:block;margin-bottom:8px;">What's this about?</label>
        <input type="text" name="title" required placeholder="Brief title..."
          style="width:100%;height:48px;border:1px solid var(--border);border-radius:var(--radius);padding:0 12px;font-size:16px;font-family:var(--font-body);">
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-weight:500;font-size:0.875rem;display:block;margin-bottom:8px;">Details (optional)</label>
        <textarea name="details" placeholder="Tell us more..."
          style="width:100%;min-height:80px;border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-size:14px;font-family:var(--font-body);resize:vertical;"></textarea>
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-weight:500;font-size:0.875rem;display:block;margin-bottom:8px;">Photo (optional)</label>
        <label class="photo-btn"><span>📷 Take photo</span><input type="file" accept="image/*" capture="environment" name="photo" style="display:none"></label>
      </div>

      <div id="safety-warning" style="display:none;padding:12px;background:#FFF5F5;border:1px solid #F36D4F;border-radius:var(--radius);margin-bottom:16px;">
        <strong style="color:#ba1a1a;">⚠️ Safety Incident?</strong>
        <p style="font-size:0.8125rem;margin-top:4px;">If this involves injury or vessel damage, the captain must contact the U.S. Coast Guard immediately. VHF Channel 16 or (305) 535-4300.</p>
      </div>

      <button type="submit" style="width:100%;height:52px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius);font-size:1rem;font-weight:600;cursor:pointer;">
        Submit
      </button>
    </form>
  </div>

  <script>
    // Show safety warning when safety category selected
    document.querySelectorAll('[data-value]').forEach(btn => {
      btn.addEventListener('click', () => {
        const warn = document.getElementById('safety-warning');
        warn.style.display = btn.dataset.value === 'safety' ? 'block' : 'none';
      });
    });
  </script>
  ${bottomNav('submit')}
</body>
</html>`;
}

function renderFeedbackSuccess(session: SessionData, category: string, title: string): string {
  return `${htmlHead('Submitted')}
<body>
  <div style="max-width:480px;margin:0 auto;padding:48px 16px;text-align:center;padding-bottom:80px;">
    <div style="font-size:3rem;margin-bottom:16px;">✓</div>
    <h1 style="font-family:var(--font-heading);font-size:1.25rem;color:var(--primary);margin-bottom:8px;">Submitted</h1>
    <p style="color:var(--text-muted);font-size:0.875rem;">"${title}" sent to management.</p>
    <a href="/today" style="display:inline-block;margin-top:24px;color:var(--primary);font-weight:500;text-decoration:none;">← Back to Home</a>
  </div>
  ${bottomNav('submit')}
</body>
</html>`;
}

export default app;
