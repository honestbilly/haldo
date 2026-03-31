import { Hono } from 'hono';
import { nanoid } from 'nanoid';
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

// GET /submit — single-page submit form matching Stitch mockup
app.get('/', (c) => {
  const session = c.get('session');
  return c.html(renderSubmitPage(session));
});

// Redirect old routes
app.get('/handoff', (c) => c.redirect('/handoff'));
app.get('/feedback', (c) => c.redirect('/submit'));

// POST /submit/feedback — save submission
app.post('/feedback', async (c) => {
  const session = c.get('session');
  const body = await c.req.parseBody();
  const category = String(body.category || 'general');
  const title = String(body.title || '').trim();
  const details = String(body.details || '').trim();

  if (!title) return c.redirect('/submit');

  await pool.query(
    `INSERT INTO submissions (id, crew_id, vessel, category, title, details, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'new')`,
    [nanoid(), session.crew_id, session.vessel, category, title, details || null]
  );

  return c.html(renderSuccess(session, title));
});

function renderSubmitPage(session: SessionData): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

  return `${htmlHead('Submit')}
<body style="background:#F2F2F7">
  <!-- Header -->
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:64px">
    <a href="/today" style="color:#1A6B8A;text-decoration:none;font-weight:600;font-size:0.875rem;display:flex;align-items:center;gap:4px">
      <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Home
    </a>
    <span style="font-family:'Inter',sans-serif;font-weight:600;font-size:0.9375rem;color:#1a1c1e">${session.vessel.toUpperCase()} — ${session.crew_name.toUpperCase()}</span>
    <div style="width:32px;height:32px;border-radius:50%;background:#1A6B8A;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.875rem">${session.crew_name.charAt(0)}</div>
  </header>

  <main style="padding:96px 24px 120px;max-width:480px;margin:0 auto">
    <h1 style="font-family:'Manrope',sans-serif;font-size:1.75rem;font-weight:800;color:#1a1c1e;margin-bottom:24px">Submit</h1>

    <form action="/submit/feedback" method="POST">
      <!-- Category Selection Card -->
      <section style="background:white;border-radius:16px;padding:24px;margin-bottom:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#F36D4F;margin-bottom:4px">Categorization</p>
        <h2 style="font-family:'Manrope',sans-serif;font-size:1.25rem;font-weight:700;color:#1a1c1e;margin-bottom:16px">Who is this for?</h2>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" id="cat-grid">
          <button type="button" data-cat="maintenance" class="cat-btn cat-active" style="grid-column:span 2;height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-radius:12px;background:#1A6B8A;color:white;border:none;font-family:'Inter',sans-serif;font-weight:600;font-size:0.9375rem;cursor:pointer;transition:all 0.2s" onclick="selectCat(this)">
            <span style="display:flex;align-items:center;gap:12px"><span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1;font-size:22px">build</span> Maintenance</span>
            <span class="material-symbols-outlined cat-check" style="font-size:22px">check_circle</span>
          </button>
          <button type="button" data-cat="suggestion" class="cat-btn" style="height:54px;display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:12px;background:#F2F2F7;color:#5b5f67;border:2px solid transparent;font-family:'Inter',sans-serif;font-weight:500;font-size:0.875rem;cursor:pointer;transition:all 0.2s" onclick="selectCat(this)">
            <span class="material-symbols-outlined" style="font-size:20px">lightbulb</span> Suggestion
          </button>
          <button type="button" data-cat="safety" class="cat-btn" style="height:54px;display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:12px;background:#F2F2F7;color:#5b5f67;border:2px solid transparent;font-family:'Inter',sans-serif;font-weight:500;font-size:0.875rem;cursor:pointer;transition:all 0.2s" onclick="selectCat(this)">
            <span class="material-symbols-outlined" style="font-size:20px">warning</span> Safety
          </button>
          <button type="button" data-cat="meeting-topic" class="cat-btn" style="height:54px;display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:12px;background:#F2F2F7;color:#5b5f67;border:2px solid transparent;font-family:'Inter',sans-serif;font-weight:500;font-size:0.875rem;cursor:pointer;transition:all 0.2s" onclick="selectCat(this)">
            <span class="material-symbols-outlined" style="font-size:20px">event</span> Meeting
          </button>
          <button type="button" data-cat="kudos" class="cat-btn" style="height:54px;display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:12px;background:#F2F2F7;color:#5b5f67;border:2px solid transparent;font-family:'Inter',sans-serif;font-weight:500;font-size:0.875rem;cursor:pointer;transition:all 0.2s" onclick="selectCat(this)">
            <span class="material-symbols-outlined" style="font-size:20px">star</span> Kudos
          </button>
          <button type="button" data-cat="sop-feedback" class="cat-btn" style="height:54px;display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:12px;background:#F2F2F7;color:#5b5f67;border:2px solid transparent;font-family:'Inter',sans-serif;font-weight:500;font-size:0.875rem;cursor:pointer;transition:all 0.2s" onclick="selectCat(this)">
            <span class="material-symbols-outlined" style="font-size:20px">menu_book</span> SOP
          </button>
          <button type="button" data-cat="general" class="cat-btn" style="height:54px;display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:12px;background:#F2F2F7;color:#5b5f67;border:2px solid transparent;font-family:'Inter',sans-serif;font-weight:500;font-size:0.875rem;cursor:pointer;transition:all 0.2s" onclick="selectCat(this)">
            <span class="material-symbols-outlined" style="font-size:20px">chat</span> General
          </button>
        </div>
        <input type="hidden" name="category" id="cat-input" value="maintenance">
      </section>

      <!-- Details Form Section -->
      <section style="background:white;border-radius:16px;padding:24px;margin-bottom:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#F36D4F;margin-bottom:4px">Task Information</p>
        <h2 style="font-family:'Manrope',sans-serif;font-size:1.25rem;font-weight:700;color:#1a1c1e;margin-bottom:20px">Issue Details</h2>

        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#5b5f67;margin-bottom:8px;margin-left:4px">What's the issue?</label>
          <input type="text" name="title" required placeholder="Short title..."
            style="width:100%;height:54px;padding:0 20px;background:#E5E8F0;border:none;border-radius:12px;font-size:16px;font-family:'Inter',sans-serif;color:#1a1c1e;outline:none;transition:all 0.2s"
            onfocus="this.style.background='white';this.style.boxShadow='0 0 0 2px #1A6B8A'"
            onblur="this.style.background='#E5E8F0';this.style.boxShadow='none'">
        </div>

        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#5b5f67;margin-bottom:8px;margin-left:4px">Details (optional)</label>
          <textarea name="details" placeholder="Describe what you found..."
            style="width:100%;height:120px;padding:16px 20px;background:#E5E8F0;border:none;border-radius:12px;font-size:16px;font-family:'Inter',sans-serif;color:#1a1c1e;resize:none;outline:none;transition:all 0.2s"
            onfocus="this.style.background='white';this.style.boxShadow='0 0 0 2px #1A6B8A'"
            onblur="this.style.background='#E5E8F0';this.style.boxShadow='none'"></textarea>
        </div>

        <!-- Photo upload area -->
        <label style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;height:140px;border:2px dashed rgba(174,178,187,0.3);border-radius:12px;color:#8E8E93;background:rgba(249,249,254,0.5);cursor:pointer">
          <span class="material-symbols-outlined" style="font-size:32px">add_a_photo</span>
          <span style="font-size:0.75rem;font-weight:500">Add photo or video</span>
          <input type="file" accept="image/*" capture="environment" name="photo" style="display:none">
        </label>
      </section>

      <!-- Safety warning (hidden, shown when Safety selected) -->
      <div id="safety-warning" style="display:none;padding:16px;background:#FFF5F5;border:2px solid #FF3B30;border-radius:12px;margin-bottom:16px">
        <strong style="color:#ba1a1a;display:flex;align-items:center;gap:6px">
          <span class="material-symbols-outlined" style="font-size:20px;color:#FF3B30">emergency</span> Safety Incident?
        </strong>
        <p style="font-size:0.8125rem;margin-top:8px;color:#1a1c1e;line-height:1.5">If this involves injury or vessel damage, the captain must contact the U.S. Coast Guard immediately. VHF Channel 16 or (305) 535-4300.</p>
      </div>

      <!-- Submit Button -->
      <div style="padding:0 8px">
        <button type="submit" style="width:100%;height:54px;background:#F36D4F;color:white;border:none;border-radius:12px;font-family:'Manrope',sans-serif;font-size:1.125rem;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(243,109,79,0.3);display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.2s;-webkit-tap-highlight-color:transparent"
          onmousedown="this.style.transform='scale(0.98)'" onmouseup="this.style.transform='scale(1)'" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
          Submit <span class="material-symbols-outlined" style="font-size:20px">send</span>
        </button>
        <p style="text-align:center;font-size:11px;color:#8E8E93;margin-top:16px">Submitting as ${session.role === 'captain' ? 'Captain' : 'Deckhand'} ${session.crew_name} — ${timeStr} UTC</p>
      </div>
    </form>
  </main>

  <script>
    function selectCat(btn) {
      // Reset all buttons
      document.querySelectorAll('.cat-btn').forEach(function(b) {
        b.classList.remove('cat-active');
        b.style.background = '#F2F2F7';
        b.style.color = '#5b5f67';
        b.style.gridColumn = '';
        var check = b.querySelector('.cat-check');
        if (check) check.style.display = 'none';
      });
      // Activate clicked button
      btn.classList.add('cat-active');
      btn.style.background = '#1A6B8A';
      btn.style.color = 'white';
      btn.style.gridColumn = 'span 2';
      var check = btn.querySelector('.cat-check');
      if (!check) {
        check = document.createElement('span');
        check.className = 'material-symbols-outlined cat-check';
        check.style.fontSize = '22px';
        check.textContent = 'check_circle';
        btn.appendChild(check);
      }
      check.style.display = '';
      // Set hidden input
      document.getElementById('cat-input').value = btn.dataset.cat;
      // Safety warning
      document.getElementById('safety-warning').style.display = btn.dataset.cat === 'safety' ? 'block' : 'none';
    }
  </script>
  ${bottomNav('submit')}
</body>
</html>`;
}

function renderSuccess(session: SessionData, title: string): string {
  return `${htmlHead('Submitted')}
<body style="background:#F2F2F7">
  <div style="max-width:480px;margin:0 auto;padding:80px 24px;text-align:center;padding-bottom:120px">
    <div style="width:80px;height:80px;border-radius:50%;background:rgba(52,199,89,0.12);color:#34C759;font-size:2.5rem;display:flex;align-items:center;justify-content:center;margin:0 auto 24px">
      <span class="material-symbols-outlined" style="font-size:40px;font-variation-settings:'FILL' 1">check_circle</span>
    </div>
    <h1 style="font-family:'Manrope',sans-serif;font-size:1.5rem;font-weight:800;color:#1a1c1e;margin-bottom:8px">Submitted</h1>
    <p style="color:#5b5f67;font-size:0.9375rem">"${title}" sent to management.</p>
    <a href="/today" style="display:inline-flex;align-items:center;gap:6px;margin-top:32px;color:#1A6B8A;font-weight:600;text-decoration:none;font-size:0.9375rem">
      <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Back to Home
    </a>
  </div>
  ${bottomNav('submit')}
</body>
</html>`;
}

export default app;
