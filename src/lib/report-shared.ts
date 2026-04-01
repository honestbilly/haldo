// Shared constants, helpers, card renderers, and layout for the manager dashboard
import pool from '../db.js';

// Fallback constants (used until DB loads)
export let VESSELS = ['squid', 'blu-q', 'cowfish', 'scout', 'java-cat'];
export let VESSEL_LABELS: Record<string, string> = {
  'squid': 'SQUID', 'blu-q': 'Blu Q', 'cowfish': 'Cowfish', 'scout': 'Scout', 'java-cat': 'Java Cat',
};
export let VESSEL_COLORS: Record<string, string> = {
  'squid': '#1A6B8A', 'blu-q': '#0D5470', 'cowfish': '#2E86AB', 'scout': '#3A7CA5', 'java-cat': '#4A90A4',
};

// Load vessels from DB (call on startup and when vessels change)
export async function loadVessels(): Promise<void> {
  try {
    const result = await pool.query('SELECT slug, name, color, vessel_type FROM vessels WHERE active = TRUE ORDER BY display_order');
    if (result.rows.length > 0) {
      // Mutate in place so ES module live bindings update
      VESSELS.length = 0;
      result.rows.filter(v => v.vessel_type === 'boat').forEach(v => VESSELS.push(v.slug));
      // Clear and repopulate objects
      for (const k of Object.keys(VESSEL_LABELS)) delete VESSEL_LABELS[k];
      for (const k of Object.keys(VESSEL_COLORS)) delete VESSEL_COLORS[k];
      for (const v of result.rows) {
        VESSEL_LABELS[v.slug] = v.name;
        VESSEL_COLORS[v.slug] = v.color;
      }
    }
  } catch (e) {
    // DB not ready yet — use fallbacks
  }
}

// All locations (boats + shore/yard/office) for dropdowns
export async function getAllLocations(): Promise<Array<{ slug: string; name: string; type: string; color: string }>> {
  try {
    const result = await pool.query('SELECT slug, name, vessel_type, color FROM vessels WHERE active = TRUE ORDER BY display_order');
    return result.rows.map(v => ({ slug: v.slug, name: v.name, type: v.vessel_type, color: v.color }));
  } catch {
    return VESSELS.map(v => ({ slug: v, name: VESSEL_LABELS[v] || v, type: 'boat', color: VESSEL_COLORS[v] || '#1A6B8A' }));
  }
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().split('T')[0];
}

export function buildReportUrl(overrides: Record<string, string>, base: Record<string, string>): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return `/report${qs ? '?' + qs : ''}`;
}

// Render a completion card — logbooks get structured layout, checklists get condensed
export function renderCompletionCard(co: any): string {
  const values = co.values_json || {};
  const hasAlerts = co.alerts_json && (co.alerts_json as any[]).length > 0;
  const isLogbook = co.template_type === 'logbook';

  // Detect incidents
  const incidentValue = values['incident-occurred'];
  const hasIncident = incidentValue && incidentValue !== 'No incidents';
  const incidentDetails = values['incident-details'] || '';

  // Detect inline notes from (+) buttons
  const inlineNotes: string[] = [];
  for (const [key, val] of Object.entries(values)) {
    if (key.startsWith('note_') && val && String(val).trim()) {
      inlineNotes.push(String(val));
    }
  }
  const hasNotes = inlineNotes.length > 0 || (co.notes && co.notes.trim());

  // Count checked items for ratio
  let checkedCount = 0;
  let totalItems = 0;
  for (const [key, val] of Object.entries(values)) {
    if (key.startsWith('note_') || key.startsWith('fail_note_') || key === 'notes' || key === 'sign_off') continue;
    totalItems++;
    if (val && val !== '' && val !== 'false') checkedCount++;
  }

  const time = co.completed_at
    ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '—';

  // Card border + background
  let cardStyle = 'background:#FFFFFF;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:4px solid #1A6B8A';
  if (hasIncident) {
    cardStyle = 'background:#FFF5F5;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:4px solid #ba1a1a;border:2px solid #F36D4F;border-left:4px solid #ba1a1a';
  } else if (hasAlerts) {
    cardStyle = 'background:#FFFFFF;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:4px solid #F36D4F';
  }

  const searchableData = `${JSON.stringify(values).toLowerCase()} ${co.template_id} ${co.crew_name?.toLowerCase() || ''} ${co.notes?.toLowerCase() || ''} ${co.vessel || ''}`;

  if (isLogbook) {
    return renderLogbookCard(co, values, hasIncident, incidentDetails, hasNotes, inlineNotes, checkedCount, totalItems, time, cardStyle, searchableData);
  } else {
    return renderChecklistCard(co, values, hasAlerts, hasNotes, inlineNotes, checkedCount, totalItems, time, cardStyle, searchableData);
  }
}

// -- Logbook card: structured readable layout --
function renderLogbookCard(
  co: any, values: any, hasIncident: boolean, incidentDetails: string,
  hasNotes: boolean, inlineNotes: string[], checkedCount: number, totalItems: number,
  time: string, cardStyle: string, searchableData: string
): string {
  const v = (key: string) => {
    const val = values[key];
    if (!val || val === '' || val === 'false') return '';
    return Array.isArray(val) ? val.join(', ') : String(val);
  };

  const vessel = VESSEL_LABELS[co.vessel] || co.vessel?.toUpperCase() || '';
  const slot = co.trip_slot || v('trip-slot') || '';
  const title = `${slot} Trip — ${vessel}`;

  // Crew line: captain first, then mate — no role labels
  const crewParts: string[] = [];
  if (co.crew_name) crewParts.push(escapeHtml(co.crew_name));
  const mateName = v('mate-name');
  if (mateName && mateName !== co.crew_name) crewParts.push(escapeHtml(mateName));
  const crewOnBoard = v('crew-on-board');
  if (crewOnBoard) {
    const names = crewOnBoard.split(',').map((n: string) => n.trim()).filter((n: string) => n && n !== co.crew_name && n !== mateName);
    crewParts.push(...names.map((n: string) => escapeHtml(n)));
  }
  const crewStr = crewParts.join(', ');

  const pax = v('guests-attended') || v('total-guests') || v('guest-count') || '';

  // Locations
  const snorkel = v('snorkel-location') || v('snorkel-site') || '';
  const dolphins = v('dolphin-location') || v('dolphin-sighting-location') || '';
  const otherLoc = v('other-location') || '';
  const locParts: string[] = [];
  if (snorkel) locParts.push(`Snorkel: ${escapeHtml(snorkel)}`);
  if (dolphins) locParts.push(`Dolphins: ${escapeHtml(dolphins)}`);
  if (otherLoc) locParts.push(`Other: ${escapeHtml(otherLoc)}`);
  const locStr = locParts.length > 0 ? locParts.join(' · ') : '';

  const weather = v('weather-conditions') || v('weather') || '';

  // Engine hours
  const ehPortStart = v('engine-hours-port-start') || v('engine-hours-start');
  const ehPortEnd = v('engine-hours-end') || v('engine-hours-port-end');
  const ehStbdStart = v('engine-hours-stbd-start');
  const ehStbdEnd = v('engine-hours-stbd-end');
  let engineStr = '';
  if (ehPortStart || ehPortEnd) {
    engineStr = `Engine Hours: ${ehPortStart || '?'} → ${ehPortEnd || '?'} (Port)`;
    if (ehStbdStart || ehStbdEnd) engineStr += ` · ${ehStbdStart || '?'} → ${ehStbdEnd || '?'} (Stbd)`;
  }

  // Merch
  const merchParts: string[] = [];
  const hat = v('merch-hat'); if (hat && hat !== '0') merchParts.push(`${hat} hat${hat === '1' ? '' : 's'}`);
  const tshirt = v('merch-tshirt'); if (tshirt && tshirt !== '0') merchParts.push(`${tshirt} t-shirt${tshirt === '1' ? '' : 's'}`);
  const sunshirt = v('merch-sunshirt'); if (sunshirt && sunshirt !== '0') merchParts.push(`${sunshirt} sun shirt${sunshirt === '1' ? '' : 's'}`);
  const sweatshirt = v('merch-sweatshirt'); if (sweatshirt && sweatshirt !== '0') merchParts.push(`${sweatshirt} sweatshirt${sweatshirt === '1' ? '' : 's'}`);
  const payment = v('merch-payment');
  let merchStr = '';
  if (merchParts.length > 0) {
    merchStr = `Merch: ${merchParts.join(', ')}${payment ? ` — ${escapeHtml(payment)}` : ''}`;
  } else if (payment === 'No sales today') {
    merchStr = 'Merch: No sales today';
  }

  // Notes
  const notes = co.notes ? escapeHtml(co.notes) : '';
  const merchNotes = v('merch-notes');

  // Notes icon for upper right
  const notesIcon = hasNotes
    ? `<span title="${escapeHtml(inlineNotes.join(' | '))}" style="cursor:help;font-size:1rem">📎</span>`
    : '';

  // Line styles
  const lineStyle = 'font-size:0.8125rem;color:#1a1c1c;line-height:1.6;margin:0;';
  const mutedStyle = 'font-size:0.8125rem;color:#6e7a74;line-height:1.6;margin:0;';

  return `
    <div class="completion-card" data-searchable="${escapeHtml(searchableData)}" data-vessel="${co.vessel || ''}" style="${cardStyle}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          ${hasIncident ? '<div style="font-size:0.6875rem;font-weight:700;color:#ba1a1a;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px">⚠️ INCIDENT REPORTED</div>' : ''}
          <div style="font-weight:700;font-size:1rem;color:#1a1c1c">${escapeHtml(title)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:0.75rem;color:#6e7a74">${time} · ${escapeHtml(co.crew_name || '')} ${notesIcon}</div>
          <div style="font-size:0.6875rem;color:#1A6B8A;font-weight:500">${checkedCount}/${totalItems} items ✓</div>
        </div>
      </div>

      ${crewStr || pax ? `<p style="${lineStyle}">Crew: ${crewStr}${pax ? ` · Pax: ${escapeHtml(pax)}` : ''}</p>` : ''}
      ${locStr ? `<p style="${lineStyle}">${locStr}</p>` : ''}
      ${weather ? `<p style="${mutedStyle}">Weather: ${escapeHtml(weather)}</p>` : ''}
      ${notes ? `<p style="${lineStyle};margin-top:4px">Notes: ${notes}</p>` : ''}
      ${engineStr ? `<p style="${mutedStyle};margin-top:4px">${engineStr}</p>` : ''}
      ${merchStr ? `<p style="${mutedStyle}">${merchStr}</p>` : ''}
      ${merchNotes ? `<p style="${mutedStyle}">Merch note: ${escapeHtml(merchNotes)}</p>` : ''}

      ${hasIncident ? `
        <div style="margin-top:8px;padding:8px 12px;background:#ba1a1a;color:white;font-weight:600;font-size:0.8125rem;border-radius:8px">
          ⚠️ ${escapeHtml(String(values['incident-occurred'] || ''))}${incidentDetails ? ` — ${escapeHtml(String(incidentDetails)).substring(0, 200)}` : ''}
        </div>` : ''}
    </div>`;
}

// -- Checklist card: condensed with item count --
function renderChecklistCard(
  co: any, values: any, hasAlerts: boolean, hasNotes: boolean, inlineNotes: string[],
  checkedCount: number, totalItems: number, time: string, cardStyle: string, searchableData: string
): string {
  // Build condensed non-checkbox values
  const summaryParts: string[] = [];
  for (const [key, val] of Object.entries(values)) {
    if (!val || val === '' || val === 'true' || val === 'false') continue;
    if (key.startsWith('note_') || key.startsWith('fail_note_')) continue;
    const label = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const strVal = Array.isArray(val) ? (val as string[]).join(', ') : String(val);
    summaryParts.push(`<strong style="color:#1a1c1c;font-weight:500">${escapeHtml(label)}:</strong> ${escapeHtml(strVal.substring(0, 80))}`);
  }
  const valuesHtml = summaryParts.length > 0
    ? summaryParts.join('<span style="color:#bdc9c2"> · </span>')
    : '';

  const templateName = co.template_id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

  const notesIcon = hasNotes
    ? `<span title="${escapeHtml(inlineNotes.join(' | '))}" style="cursor:help;font-size:1rem">📎</span>`
    : '';

  const alertBadge = hasAlerts
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.6875rem;font-weight:600;background:rgba(243,109,79,0.1);color:#F36D4F">⚠ ${(co.alerts_json as any[]).length} flagged</span>`
    : '';

  return `
    <div class="completion-card" data-searchable="${escapeHtml(searchableData)}" data-vessel="${co.vessel || ''}" style="${cardStyle}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <span style="font-weight:600;font-size:0.875rem;color:#1a1c1c">${escapeHtml(templateName)}</span>
          ${alertBadge}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:0.75rem;color:#6e7a74">${time} · ${escapeHtml(co.crew_name || '')} ${notesIcon}</div>
          <div style="font-size:0.6875rem;color:#1A6B8A;font-weight:500">${checkedCount}/${totalItems} ✓</div>
        </div>
      </div>
      ${valuesHtml ? `<div style="font-size:0.8125rem;color:#6e7a74;line-height:1.5;margin-top:4px">${valuesHtml}</div>` : ''}
      ${co.notes ? `<div style="font-size:0.8125rem;color:#1a1c1c;margin-top:4px">Notes: ${escapeHtml(co.notes)}</div>` : ''}
    </div>`;
}

// Render checklist summary symbol row for a vessel
export function renderChecklistSymbols(checklists: any[]): string {
  // Match template IDs by prefix — actual IDs are like 'wakeup-captain', 'between-trips-mate', etc.
  const CHECKLIST_CATEGORIES = [
    { prefix: 'wakeup', label: 'Wake Up' },
    { prefix: 'between-trips', label: 'Between' },
    { prefix: 'put-to-bed', label: 'Put to Bed' },
    { prefix: 'daily-maintenance', label: 'DMT' },
  ];

  const matched = new Set<string>();

  const symbols = CHECKLIST_CATEGORIES.map(cat => {
    // Find any completion matching this category prefix
    const matches = checklists.filter(co => co.template_id.startsWith(cat.prefix));
    if (matches.length > 0) {
      matches.forEach(m => matched.add(m.template_id));
      const times = matches.map(m => {
        const role = m.template_id.includes('captain') ? 'Capt' : 'DH';
        const t = m.completed_at
          ? new Date(m.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          : '';
        return `${role}${t ? ' ' + t : ''}`;
      });
      return `<span style="color:#1A6B8A;font-size:0.8125rem" title="${escapeHtml(cat.label)}: ${escapeHtml(times.join(', '))}">&#9745; ${escapeHtml(cat.label)}</span>`;
    } else {
      return `<span style="color:#ba1a1a;font-size:0.8125rem;opacity:0.6" title="${escapeHtml(cat.label)} not completed">&#10007; ${escapeHtml(cat.label)}</span>`;
    }
  });

  // Also include any checklists not matching standard categories
  for (const co of checklists) {
    if (!matched.has(co.template_id)) {
      const label = co.template_id.replace(/-/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
      const time = co.completed_at
        ? new Date(co.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : '';
      symbols.push(`<span style="color:#1A6B8A;font-size:0.8125rem">&#9745; ${escapeHtml(label)}${time ? ' (' + time + ')' : ''}</span>`);
    }
  }

  return `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;padding:6px 0;font-family:'Inter',-apple-system,sans-serif">${symbols.join('<span style="color:#bdc9c2"> &middot; </span>')}</div>`;
}

// Shared layout for all manager dashboard pages
export function reportLayout(activeTab: string, content: string): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const navTab = (label: string, href: string, tabName: string) => {
    const isActive = activeTab === tabName;
    return `<a href="${href}" style="display:flex;align-items:center;height:44px;padding:0 16px;text-decoration:none;font-weight:${isActive ? '700' : '500'};font-size:0.8125rem;color:${isActive ? '#1A6B8A' : '#8E8E93'};border-bottom:2px solid ${isActive ? '#1A6B8A' : 'transparent'};transition:color 0.15s;white-space:nowrap">${label}</a>`;
  };

  // Sidebar nav — Operations + Build sections
  const opsItems = [
    { id: 'Activity', label: 'Activity', icon: 'dashboard', href: '/report' },
    { id: 'Inbox', label: 'Inbox', icon: 'inbox', href: '/report/inbox' },
    { id: 'Tasks', label: 'Tasks', icon: 'build', href: '/report/tasks' },
  ];

  const peopleItems = [
    { id: 'Crew', label: 'Crew', icon: 'group', href: '/report/crew' },
    { id: 'Schedule', label: 'Schedule', icon: 'calendar_month', href: '/report/crew-schedule' },
  ];

  const buildItems = [
    { id: 'Library', label: 'Library', icon: 'auto_stories', href: '/report/library' },
    { id: 'Checklists', label: 'Checklists', icon: 'fact_check', href: '/report/templates' },
    { id: 'Vessels', label: 'Vessels', icon: 'directions_boat', href: '/report/vessels' },
  ];

  const sidebarItems = [...opsItems, ...peopleItems, ...buildItems];

  const renderSidebarSection = (label: string, items: typeof opsItems) => {
    const links = items.map(item => {
      const isActive = activeTab === item.id
        || (item.id === 'Activity' && (activeTab === 'Today' || activeTab === 'History'))
        || (item.id === 'Inbox' && activeTab === 'Inbox');
      return `<a href="${item.href}" style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:0.875rem;font-weight:${isActive ? '700' : '500'};color:${isActive ? '#1A6B8A' : 'rgba(26,28,30,0.6)'};background:${isActive ? 'white' : 'transparent'};${isActive ? 'box-shadow:0 1px 3px rgba(0,0,0,0.06)' : ''};transition:all 0.15s">
        <span class="material-symbols-outlined" style="font-size:20px;${isActive ? "font-variation-settings:'FILL' 1" : ''}">${item.icon}</span>
        ${item.label}
      </a>`;
    }).join('');
    return `
      <div style="margin-bottom:8px">
        <div style="font-size:0.5625rem;font-weight:700;color:rgba(26,28,30,0.3);text-transform:uppercase;letter-spacing:0.15em;padding:8px 16px 4px">${label}</div>
        ${links}
      </div>`;
  };

  const sidebarHtml = renderSidebarSection('Operations', opsItems)
    + renderSidebarSection('People', peopleItems)
    + renderSidebarSection('Build', buildItems);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${activeTab} &mdash; Haldo Manager</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
  <script src="/public/htmx.min.js" defer></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: #F3F4F3;
      color: #1a1c1e;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .material-symbols-outlined {
      font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      vertical-align: middle;
    }
    a { color: inherit; }
    .log-row { transition: background 0.15s; }
    .log-row:hover { background: #F8F9FA; }
    .task-card { transition: box-shadow 0.2s; }
    .task-card:hover { box-shadow: 0 8px 20px rgba(0,0,0,0.06); }

    /* Sidebar layout: sidebar on desktop, stacked on mobile */
    .mgr-layout { display: flex; gap: 48px; max-width: 1280px; margin: 0 auto; padding: 32px; min-height: 100vh; }
    .mgr-sidebar { width: 240px; flex-shrink: 0; position: sticky; top: 32px; align-self: flex-start; }
    .mgr-main { flex: 1; min-width: 0; }
    @media (max-width: 900px) {
      .mgr-layout { flex-direction: column; gap: 0; padding: 16px; }
      .mgr-sidebar { width: 100%; position: static; margin-bottom: 24px; }
      .mgr-sidebar nav { display: flex; gap: 4px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .mgr-sidebar nav a { white-space: nowrap; }
      .mgr-sidebar .sidebar-header { display: none; }
    }
  </style>
</head>
<body>
  <div class="mgr-layout">
    <!-- Sidebar Navigation (Stitch pattern) -->
    <aside class="mgr-sidebar">
      <div class="sidebar-header" style="margin-bottom:32px">
        <h1 style="font-family:'Manrope',sans-serif;font-size:1.375rem;font-weight:800;color:#1A6B8A;letter-spacing:-0.02em">Haldo Manager</h1>
        <p style="font-size:0.75rem;color:rgba(26,28,30,0.5);font-weight:500;margin-top:4px">Fleet Overview</p>
      </div>
      <nav style="display:flex;flex-direction:column;gap:4px">
        ${sidebarHtml}
      </nav>
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #E5E5EA">
        <a href="/today" style="display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:0.8125rem;color:rgba(26,28,30,0.5);text-decoration:none;font-weight:500;transition:color 0.15s" onmouseenter="this.style.color='#1A6B8A'" onmouseleave="this.style.color='rgba(26,28,30,0.5)'">
          <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Back to Crew App
        </a>
      </div>
      <div style="margin-top:auto;padding-top:24px">
        <span style="font-size:0.625rem;font-weight:500;color:rgba(26,28,30,0.3);text-transform:uppercase;letter-spacing:0.15em">${today}</span>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="mgr-main">
      ${content}
    </main>
  </div>
  <script>
    // Close HTMX dropdowns on outside click
    document.addEventListener('click', function(e) {
      document.querySelectorAll('.htmx-dropdown').forEach(function(dd) {
        if (!dd.contains(e.target) && !dd.parentElement.contains(e.target)) {
          dd.remove();
        }
      });
    });

    // Client-side search (instant filter across all fields)
    var searchInput = document.getElementById('report-search');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var q = this.value.toLowerCase().trim();
        document.querySelectorAll('.completion-card').forEach(function(card) {
          var searchable = card.getAttribute('data-searchable') || '';
          card.style.display = (!q || searchable.indexOf(q) !== -1) ? '' : 'none';
        });
        // Hide empty vessel groups
        document.querySelectorAll('.vessel-group').forEach(function(group) {
          var visible = group.querySelectorAll('.completion-card').length;
          var hidden = 0;
          group.querySelectorAll('.completion-card').forEach(function(c) {
            if (c.style.display === 'none') hidden++;
          });
          group.style.display = (visible - hidden) > 0 ? '' : 'none';
        });
      });
    }

    // Apply crew/date-range filters (navigates server-side)
    function applyFilters() {
      var params = new URLSearchParams(window.location.search);
      var vessel = document.getElementById('vessel-filter');
      var crew = document.getElementById('crew-filter');
      var rangeFrom = document.getElementById('range-from');
      var rangeTo = document.getElementById('range-to');

      if (vessel && vessel.value) { params.set('vessel', vessel.value); } else { params.delete('vessel'); }
      if (crew && crew.value) { params.set('crew', crew.value); } else { params.delete('crew'); }
      if (rangeFrom && rangeFrom.value) { params.set('from', rangeFrom.value); params.delete('date'); } else { params.delete('from'); }
      if (rangeTo && rangeTo.value) { params.set('to', rangeTo.value); params.delete('date'); } else { params.delete('to'); }

      var qs = params.toString();
      window.location = '/report' + (qs ? '?' + qs : '');
    }
  </script>
</body>
</html>`;
}
