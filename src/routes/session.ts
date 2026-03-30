import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import pool from '../db.js';
import type { CrewRow, SessionData } from '../types.js';

const app = new Hono();

// Parse session from cookie
export function getSession(c: any): SessionData | null {
  const raw = getCookie(c, 'haldo_session');
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

// Landing page — vessel, date, trip slot, name selection
app.get('/', async (c) => {
  const session = getSession(c);
  if (session) {
    return c.redirect('/today');
  }

  // Get active crew and trip configs for the form
  const crewResult = await pool.query<CrewRow>(
    'SELECT id, name, role, vessel FROM crew WHERE active = TRUE ORDER BY role, name'
  );
  const tripResult = await pool.query(
    'SELECT vessel, default_slots FROM trip_config'
  );

  const crew = crewResult.rows;
  const tripConfigs = Object.fromEntries(
    tripResult.rows.map(r => [r.vessel, r.default_slots])
  );

  const today = new Date().toISOString().split('T')[0];

  return c.html(renderLanding(crew, tripConfigs, today));
});

// Create session
app.post('/session', async (c) => {
  const body = await c.req.parseBody();
  const vessel = String(body.vessel || '');
  const role = String(body.role || '');
  const crew_id = String(body.crew_id || '');
  const trip_date = String(body.trip_date || new Date().toISOString().split('T')[0]);
  const trip_slot = String(body.trip_slot || 'AM');

  if (!vessel || !role || !crew_id) {
    return c.redirect('/');
  }

  // Look up crew name
  const result = await pool.query<CrewRow>(
    'SELECT name FROM crew WHERE id = $1 AND active = TRUE',
    [crew_id]
  );
  if (result.rows.length === 0) {
    return c.redirect('/');
  }

  const sessionData = {
    vessel,
    role,
    crew_id,
    crew_name: result.rows[0].name,
    trip_date,
    trip_slot,
  };

  const encoded = Buffer.from(JSON.stringify(sessionData)).toString('base64');
  setCookie(c, 'haldo_session', encoded, {
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
    httpOnly: true,
    sameSite: 'Lax',
  });

  return c.redirect('/today');
});

// Clear session
app.get('/logout', (c) => {
  deleteCookie(c, 'haldo_session', { path: '/' });
  return c.redirect('/');
});

function renderLanding(
  crew: CrewRow[],
  tripConfigs: Record<string, string[]>,
  today: string
): string {
  const crewJson = JSON.stringify(crew);
  const tripJson = JSON.stringify(tripConfigs);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Haldo — Honest Eco</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="landing">
    <header class="landing-header">
      <h1 class="app-name">Haldo</h1>
      <p class="app-subtitle">Honest Eco Crew Operations</p>
    </header>

    <form action="/session" method="POST" class="landing-form" id="landing-form">
      <div class="form-group">
        <label for="vessel">Which boat?</label>
        <div class="button-group" id="vessel-buttons">
          <button type="button" class="select-btn" data-value="squid">SQUID</button>
          <button type="button" class="select-btn" data-value="blu-q">Blu Q</button>
          <button type="button" class="select-btn" data-value="cowfish">Cowfish</button>
          <button type="button" class="select-btn" data-value="scout">Scout</button>
          <button type="button" class="select-btn" data-value="java-cat">Java Cat</button>
        </div>
        <input type="hidden" name="vessel" id="vessel-input" required>
      </div>

      <div class="form-group">
        <label for="trip_date">Date</label>
        <input type="date" name="trip_date" id="trip_date" value="${today}" class="date-input">
      </div>

      <div class="form-group">
        <label>Trip</label>
        <div class="button-group" id="trip-buttons">
          <button type="button" class="select-btn" data-value="AM">AM Trip</button>
          <button type="button" class="select-btn" data-value="PM">PM Trip</button>
        </div>
        <input type="hidden" name="trip_slot" id="trip-slot-input" required>
      </div>

      <div class="form-group">
        <label for="role">Your role</label>
        <div class="button-group" id="role-buttons">
          <button type="button" class="select-btn" data-value="captain">Captain</button>
          <button type="button" class="select-btn" data-value="mate">Mate</button>
        </div>
        <input type="hidden" name="role" id="role-input" required>
      </div>

      <div class="form-group">
        <label for="crew_id">Who are you?</label>
        <select name="crew_id" id="crew-select" class="crew-dropdown" required>
          <option value="">Select your name...</option>
        </select>
      </div>

      <button type="submit" class="primary-btn" id="submit-btn" disabled>
        Let's Go →
      </button>
    </form>
  </div>

  <script>
    const crew = ${crewJson};
    const tripConfigs = ${tripJson};

    // Button group selection
    document.querySelectorAll('.button-group').forEach(group => {
      group.querySelectorAll('.select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          group.querySelectorAll('.select-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const input = group.nextElementSibling;
          if (input) input.value = btn.dataset.value;
          updateCrewDropdown();
          checkReady();
        });
      });
    });

    function updateCrewDropdown() {
      const role = document.getElementById('role-input').value;
      const select = document.getElementById('crew-select');
      select.innerHTML = '<option value="">Select your name...</option>';

      if (!role) return;

      const filtered = crew.filter(c => c.role === role);
      filtered.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
      });
    }

    document.getElementById('crew-select').addEventListener('change', checkReady);

    function checkReady() {
      const vessel = document.getElementById('vessel-input').value;
      const role = document.getElementById('role-input').value;
      const crew = document.getElementById('crew-select').value;
      const tripSlot = document.getElementById('trip-slot-input').value;

      document.getElementById('submit-btn').disabled = !(vessel && role && crew && tripSlot);
    }
  </script>
</body>
</html>`;
}

export default app;
