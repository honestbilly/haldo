import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import pool from '../db.js';
import type { CrewRow, SessionData } from '../types.js';
import { getAuth } from './auth.js';

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
  let crew_id = String(body.crew_id || '');
  const custom_name = String(body.custom_name || '').trim();
  const trip_date = String(body.trip_date || new Date().toISOString().split('T')[0]);
  const trip_slot = String(body.trip_slot || 'AM');

  if (!vessel || !role) {
    return c.redirect('/');
  }

  let crew_name: string;

  // Handle "Someone else..." — create ad-hoc crew record
  if (crew_id === '__custom__' && custom_name) {
    const { nanoid } = await import('nanoid');
    const newId = nanoid();
    await pool.query(
      'INSERT INTO crew (id, name, role, vessel) VALUES ($1, $2, $3, $4)',
      [newId, custom_name, role, vessel]
    );
    crew_id = newId;
    crew_name = custom_name;
  } else if (crew_id && crew_id !== '__custom__') {
    // Look up existing crew name
    const result = await pool.query<CrewRow>(
      'SELECT name FROM crew WHERE id = $1 AND active = TRUE',
      [crew_id]
    );
    if (result.rows.length === 0) {
      return c.redirect('/');
    }
    crew_name = result.rows[0].name;
  } else {
    return c.redirect('/');
  }

  // Check if this person has a manager/admin auth token
  const auth = getAuth(c as any);
  const authRole = auth?.auth_role || 'crew';

  const sessionData = {
    vessel,
    role,
    crew_id,
    crew_name,
    trip_date,
    trip_slot,
    auth_role: authRole,
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

  const sectionLabel = (text: string) =>
    `<h2 style="padding:0 16px;font-size:0.8125rem;font-weight:600;color:#5b5f67;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">${text}</h2>`;

  const pillBtn = (value: string, label: string, isFullWidth: boolean = false) =>
    `<button type="button" class="select-btn" data-value="${value}" style="height:54px;${isFullWidth ? 'width:100%;' : 'flex:1;'}background:#F2F2F7;color:#1A6B8A;border:2px solid rgba(26,107,138,0.1);border-radius:999px;font-weight:700;font-size:0.875rem;letter-spacing:0.02em;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s;-webkit-tap-highlight-color:transparent">${label}</button>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <title>Haldo — Honest Eco</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#1A6B8A">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
  <style>
    .select-btn.active {
      background: #1A6B8A !important;
      color: white !important;
      border-color: #1A6B8A !important;
    }
  </style>
</head>
<body style="background:#F2F2F7">
  <!-- Logo Header -->
  <header style="text-align:center;padding:48px 0 32px">
    <h1 style="font-family:'Manrope',sans-serif;font-size:2.5rem;font-weight:800;color:#1A6B8A;letter-spacing:-0.02em">Haldo</h1>
    <p style="font-size:0.875rem;color:#8E8E93;font-weight:500;margin-top:4px">Honest Eco Crew Operations</p>
  </header>

  <main style="max-width:480px;margin:0 auto;padding:0 16px 48px">
    <form action="/session" method="POST" id="landing-form">
      <!-- Vessel -->
      <section style="margin-bottom:24px">
        ${sectionLabel('Select your vessel')}
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
          <div class="button-group" id="vessel-buttons" style="display:flex;flex-direction:column;gap:10px">
            ${pillBtn('squid', 'SQUID', true)}
            ${pillBtn('blu-q', 'Blu Q', true)}
            ${pillBtn('cowfish', 'Cowfish', true)}
            ${pillBtn('scout', 'Scout', true)}
            ${pillBtn('java-cat', 'Java Cat', true)}
          </div>
          <input type="hidden" name="vessel" id="vessel-input" required>
        </div>
      </section>

      <!-- Date -->
      <section style="margin-bottom:24px">
        ${sectionLabel('Trip date')}
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
          <input type="date" name="trip_date" id="trip_date" value="${today}" style="width:100%;height:54px;background:#E5E8F0;border:none;border-radius:16px;padding:0 20px;font-size:1rem;font-weight:500;color:#1a1c1e;outline:none;-webkit-appearance:none">
        </div>
      </section>

      <!-- Trip Slot -->
      <section style="margin-bottom:24px">
        ${sectionLabel('Trip')}
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
          <div class="button-group" id="trip-buttons" style="display:flex;gap:8px">
            ${pillBtn('AM', 'AM')}
            ${pillBtn('PM', 'PM')}
            ${pillBtn('Sunset', 'Sunset')}
          </div>
          <input type="hidden" name="trip_slot" id="trip-slot-input" required>
        </div>
      </section>

      <!-- Role -->
      <section style="margin-bottom:24px">
        ${sectionLabel('Your role')}
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
          <div class="button-group" id="role-buttons" style="display:flex;gap:8px">
            <button type="button" class="select-btn" data-value="captain" style="flex:1;height:54px;background:#F2F2F7;color:#1A6B8A;border:2px solid rgba(26,107,138,0.1);border-radius:999px;font-weight:700;font-size:0.875rem;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:all 0.15s">
              <span class="material-symbols-outlined" style="font-size:20px;font-variation-settings:'FILL' 1">anchor</span> Captain
            </button>
            <button type="button" class="select-btn" data-value="deckhand" style="flex:1;height:54px;background:#F2F2F7;color:#1A6B8A;border:2px solid rgba(26,107,138,0.1);border-radius:999px;font-weight:700;font-size:0.875rem;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:all 0.15s">
              <span class="material-symbols-outlined" style="font-size:20px">handshake</span> Deckhand
            </button>
          </div>
          <input type="hidden" name="role" id="role-input" required>
        </div>
      </section>

      <!-- Crew Name -->
      <section style="margin-bottom:32px">
        ${sectionLabel('Who are you?')}
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
          <select name="crew_id" id="crew-select" required style="width:100%;height:54px;background:#E5E8F0;border:none;border-radius:16px;padding:0 20px;font-size:1rem;font-weight:500;color:#1a1c1e;outline:none;-webkit-appearance:none;appearance:none;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238E8E93' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E&quot;);background-repeat:no-repeat;background-position:right 20px center">
            <option value="">Select your name...</option>
          </select>
          <div id="custom-name-row" style="display:none;margin-top:10px">
            <input type="text" name="custom_name" id="custom-name-input" placeholder="Enter your name..." autocomplete="off" style="width:100%;height:54px;background:#E5E8F0;border:none;border-radius:16px;padding:0 20px;font-size:1rem;font-weight:500;color:#1a1c1e;outline:none">
          </div>
        </div>
      </section>

      <!-- Submit -->
      <button type="submit" id="submit-btn" disabled style="width:100%;height:58px;background:#1A6B8A;color:white;border:none;border-radius:16px;font-family:'Manrope',sans-serif;font-size:1.125rem;font-weight:700;cursor:pointer;opacity:0.4;transition:all 0.2s;-webkit-tap-highlight-color:transparent">
        Let's Go →
      </button>
    </form>
  </main>

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
      const customRow = document.getElementById('custom-name-row');
      const customInput = document.getElementById('custom-name-input');
      select.innerHTML = '<option value="">Select your name...</option>';
      customRow.style.display = 'none';
      customInput.value = '';

      if (!role) return;

      // Show all crew, but prioritize matching role first
      const matching = crew.filter(c => c.role === role);
      const other = crew.filter(c => c.role !== role);

      matching.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
      });

      // Add other-role crew under a separator (for captains filling mate roles, etc.)
      if (other.length > 0) {
        const sep = document.createElement('option');
        sep.disabled = true;
        sep.textContent = '── Other crew ──';
        select.appendChild(sep);
        other.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name + ' (' + c.role + ')';
          select.appendChild(opt);
        });
      }

      // "Someone else" option for relief crew
      const otherOpt = document.createElement('option');
      otherOpt.value = '__custom__';
      otherOpt.textContent = 'Someone else...';
      select.appendChild(otherOpt);
    }

    document.getElementById('crew-select').addEventListener('change', function() {
      const customRow = document.getElementById('custom-name-row');
      const customInput = document.getElementById('custom-name-input');
      if (this.value === '__custom__') {
        customRow.style.display = 'block';
        customInput.focus();
      } else {
        customRow.style.display = 'none';
        customInput.value = '';
      }
      checkReady();
    });

    document.getElementById('custom-name-input').addEventListener('input', checkReady);

    function checkReady() {
      const vessel = document.getElementById('vessel-input').value;
      const role = document.getElementById('role-input').value;
      const crewVal = document.getElementById('crew-select').value;
      const tripSlot = document.getElementById('trip-slot-input').value;
      const customName = document.getElementById('custom-name-input').value.trim();

      const crewReady = crewVal && (crewVal !== '__custom__' || customName.length > 0);
      const btn = document.getElementById('submit-btn');
      const ready = vessel && role && crewReady && tripSlot;
      btn.disabled = !ready;
      btn.style.opacity = ready ? '1' : '0.4';
    }
  </script>
</body>
</html>`;
}

export default app;
