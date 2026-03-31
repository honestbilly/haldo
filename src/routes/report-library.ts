// Repeated Task Library: view, build, and edit checklist templates
// Sub-navigation tab under the Tasks hub
import { Hono } from 'hono';
import { VESSELS, VESSEL_LABELS, escapeHtml, reportLayout } from '../lib/report-shared.js';
import { getAllTemplates, saveTemplate, loadTemplates } from '../services/templates.js';
import type { ChecklistTemplate } from '../types.js';

const app = new Hono();

const inputStyle = `padding:10px 12px;border:1px solid #bdc9c2;border-radius:8px;font-family:"Inter",-apple-system,sans-serif;font-size:14px;background:#FFFFFF;color:#1a1c1c;width:100%;min-height:44px`;
const dropdownStyle = inputStyle;
const textareaStyle = `${inputStyle};min-height:80px;resize:vertical`;

function subNav(active: string): string {
  const tabs = [
    { id: 'list', label: 'Task List', href: '/report/tasks' },
    { id: 'inbox', label: 'Inbox', href: '/report/inbox' },
    { id: 'schedule', label: 'Schedule', href: '/report/schedule' },
    { id: 'library', label: 'Library', href: '/report/library' },
  ];
  return `<div style="display:flex;gap:12px;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #bdc9c2">
    ${tabs.map(t => `<a href="${t.href}" style="padding:6px 12px;border-radius:6px;font-size:0.8125rem;font-weight:500;text-decoration:none;${active === t.id ? 'background:#006950;color:white' : 'background:rgba(0,105,80,0.06);color:#006950'}">${t.label}</a>`).join('')}
  </div>`;
}

const TRIGGER_TYPES: Record<string, { label: string; desc: string }> = {
  'daily-rotation': { label: 'Daily Rotation (DMT)', desc: 'One task per day, rotating Mon-Sun. ≤15 min.' },
  'weekly':         { label: 'Weekly', desc: 'Runs on a specific day each week.' },
  'monthly':        { label: 'Monthly', desc: 'Runs on a specific date each month.' },
  'calendar-date':  { label: 'Calendar Date', desc: 'One-time on a specific date.' },
  'engine-hours':   { label: 'Engine Hours', desc: 'Triggered when engine hours reach a threshold.' },
  'condition':      { label: 'Visual / Condition', desc: 'Crew runs when they observe the condition.' },
  'on-demand':      { label: 'On-Demand', desc: 'Captain picks from the library when needed.' },
  'per-trip':       { label: 'Per-Trip', desc: 'After every trip (logbooks).' },
};

function inferTriggerType(t: any): string {
  if (t.type === 'logbook') return 'per-trip';
  const ct = t as ChecklistTemplate;
  if (ct.recurrence === 'on-demand') return 'on-demand';
  if (ct.recurrence === 'monthly') return 'monthly';
  if (ct.recurrence === 'weekly') return 'weekly';
  if (ct.recurrence === 'one-time') return 'calendar-date';
  if (ct.recurrence === 'daily' && ct.id?.startsWith('daily-maintenance')) return 'daily-rotation';
  if (ct.recurrence === 'daily') return 'weekly'; // daily with trigger_day = effectively weekly
  return 'on-demand';
}

// ─── LIBRARY VIEW ───────────────────────────────────────────

app.get('/report/library', async (c) => {
  const templates = getAllTemplates();

  // Group by trigger type
  const groups = new Map<string, any[]>();
  for (const t of templates) {
    const trigger = inferTriggerType(t);
    if (!groups.has(trigger)) groups.set(trigger, []);
    groups.get(trigger)!.push(t);
  }

  const groupOrder = ['daily-rotation', 'weekly', 'monthly', 'calendar-date', 'engine-hours', 'condition', 'on-demand', 'per-trip'];

  const groupsHtml = groupOrder
    .filter(key => groups.has(key))
    .map(key => {
      const info = TRIGGER_TYPES[key];
      const items = groups.get(key)!;

      const cards = items.map((t: any) => {
        const vesselLabel = VESSEL_LABELS[t.vessel] || t.vessel || 'All';
        const roleLabel = t.role === 'all' ? 'All' : t.role.charAt(0).toUpperCase() + t.role.slice(1);
        const est = t.estimated_minutes ? `~${t.estimated_minutes} min` : '';
        const itemCount = t.type === 'checklist'
          ? (t.sections?.reduce((sum: number, s: any) => sum + (s.items?.length || 0), 0) || 0)
          : (t.steps?.reduce((sum: number, s: any) => sum + (s.items?.length || 0), 0) || 0);

        return `
          <a href="/report/library/${encodeURIComponent(t.id)}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#FFFFFF;border-radius:8px;margin-bottom:6px;text-decoration:none;color:#1a1c1c;min-height:48px">
            <div>
              <div style="font-weight:600;font-size:0.875rem">${escapeHtml(t.name)}</div>
              <div style="font-size:0.75rem;color:#6e7a74">${vesselLabel} · ${roleLabel}${est ? ' · ' + est : ''} · ${itemCount} items</div>
            </div>
            <span style="color:#6e7a74;font-size:0.875rem">→</span>
          </a>`;
      }).join('');

      return `
        <div style="margin-bottom:24px">
          <h3 style="font-family:'Manrope',-apple-system,sans-serif;font-size:0.8125rem;font-weight:700;color:#006950;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${info.label} <span style="background:rgba(0,105,80,0.1);color:#006950;padding:2px 6px;border-radius:10px;font-size:0.6875rem">${items.length}</span></h3>
          <p style="font-size:0.75rem;color:#6e7a74;margin-bottom:8px">${info.desc}</p>
          ${cards}
        </div>`;
    }).join('');

  return c.html(reportLayout('Tasks', `
    ${subNav('library')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700">Repeated Task Library</h2>
      <a href="/report/library/build" style="display:flex;align-items:center;justify-content:center;padding:10px 16px;background:#006950;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.875rem;min-height:44px">+ Build New</a>
    </div>
    ${groupsHtml}
  `));
});

// ─── BUILDER FORM ───────────────────────────────────────────

app.get('/report/library/build', async (c) => {
  const fromId = c.req.query('from');
  let prefill: any = null;
  if (fromId) {
    const templates = getAllTemplates();
    prefill = templates.find(t => t.id === fromId);
  }

  const allTemplates = getAllTemplates();
  const existingIds = allTemplates.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return c.html(reportLayout('Tasks', `
    ${subNav('library')}
    <div style="margin-bottom:16px">
      <a href="/report/library" style="color:#006950;text-decoration:none;font-size:0.875rem">← Back to library</a>
    </div>
    <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700;margin-bottom:16px">${prefill ? 'Clone: ' + escapeHtml(prefill.name) : 'Build New Repeated Task'}</h2>

    <form action="/report/library/build" method="POST" id="builder-form">
      <!-- Step 1: Basics -->
      <div style="background:#FFFFFF;border-radius:8px;padding:16px;margin-bottom:16px">
        <h3 style="font-size:0.875rem;font-weight:600;margin-bottom:12px">Basics</h3>

        <div style="margin-bottom:12px">
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Name *</label>
          <input type="text" name="name" required value="${escapeHtml(prefill?.name || '')}" style="${inputStyle}" placeholder="e.g. Engine Room Check">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Vessel</label>
            <select name="vessel" style="${dropdownStyle}">
              <option value="all">All Vessels</option>
              ${VESSELS.map(v => `<option value="${v}" ${prefill?.vessel === v ? 'selected' : ''}>${VESSEL_LABELS[v]}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Role</label>
            <select name="role" style="${dropdownStyle}">
              <option value="all" ${prefill?.role === 'all' ? 'selected' : ''}>All</option>
              <option value="captain" ${prefill?.role === 'captain' ? 'selected' : ''}>Captain</option>
              <option value="deckhand" ${prefill?.role === 'deckhand' ? 'selected' : ''}>Deckhand</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Est. Minutes</label>
            <input type="number" name="estimated_minutes" min="1" max="480" value="${prefill?.estimated_minutes || ''}" style="${inputStyle}" placeholder="e.g. 15">
          </div>
        </div>

        <div style="margin-bottom:12px">
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Trigger Type *</label>
          <select name="trigger_type" id="trigger-type" style="${dropdownStyle}" onchange="updateTriggerFields()">
            <option value="daily-rotation">Daily Rotation (DMT) — one task per day</option>
            <option value="weekly">Weekly — runs on a specific day</option>
            <option value="monthly">Monthly — runs on a specific date</option>
            <option value="calendar-date">Calendar Date — one-time</option>
            <option value="engine-hours">Engine Hours — threshold triggered</option>
            <option value="condition">Visual / Condition Based</option>
            <option value="on-demand">On-Demand — captain picks</option>
          </select>
        </div>

        <!-- Conditional schedule fields -->
        <div id="field-trigger-day" style="margin-bottom:12px;display:none">
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Day of Week</label>
          <select name="trigger_day" style="${dropdownStyle}">
            ${DAYS.map(d => `<option value="${d.toLowerCase()}">${d}</option>`).join('')}
          </select>
        </div>

        <div id="field-trigger-date" style="margin-bottom:12px;display:none">
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Day of Month</label>
          <input type="number" name="trigger_date_num" min="1" max="28" style="${inputStyle}" placeholder="e.g. 1 (for the 1st)">
        </div>

        <div id="field-calendar-date" style="margin-bottom:12px;display:none">
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Specific Date</label>
          <input type="date" name="calendar_date" style="${inputStyle}">
        </div>

        <div id="field-engine-hours" style="margin-bottom:12px;display:none">
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Engine Hour Threshold</label>
          <input type="number" name="engine_hour_threshold" min="1" style="${inputStyle}" placeholder="e.g. 100 (every 100 hours)">
        </div>

        <div id="field-condition" style="margin-bottom:12px;display:none">
          <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Condition Description</label>
          <input type="text" name="condition_desc" style="${inputStyle}" placeholder="e.g. When motor zincs look worn">
        </div>
      </div>

      <!-- Step 2: DMT Day Tasks (only for daily-rotation) -->
      <div id="dmt-days" style="background:#FFFFFF;border-radius:8px;padding:16px;margin-bottom:16px;display:none">
        <h3 style="font-size:0.875rem;font-weight:600;margin-bottom:12px">Daily Tasks (one per day)</h3>
        <p style="font-size:0.75rem;color:#6e7a74;margin-bottom:12px">Name each day's task. Checklist items go in the next section.</p>
        ${DAYS.map((d, i) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:0.8125rem;font-weight:600;color:#006950;width:32px">${d.substring(0, 3)}</span>
            <input type="text" name="day_${i}_name" style="${inputStyle}" placeholder="e.g. ${['Bilge Inspection', 'Engine Room Check', 'Safety Equipment', 'Electrical Systems', 'Hull & Deck', 'Snorkel Gear', 'Deep Clean'][i]}">
          </div>`).join('')}
      </div>

      <!-- Step 3: Checklist Items -->
      <div style="background:#FFFFFF;border-radius:8px;padding:16px;margin-bottom:16px">
        <h3 style="font-size:0.875rem;font-weight:600;margin-bottom:4px">Checklist Items</h3>
        <p style="font-size:0.75rem;color:#6e7a74;margin-bottom:12px" id="items-hint">Add the items crew will check off. For DMTs, these items appear on every day's task.</p>

        <div id="items-container">
          <div class="item-row" style="background:rgba(0,105,80,0.03);border-radius:8px;padding:12px;margin-bottom:8px">
            <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;margin-bottom:8px">
              <input type="text" name="items[0].label" style="${inputStyle}" placeholder="Item label (e.g. Check bilge for water)">
              <select name="items[0].type" style="${dropdownStyle};width:120px" onchange="toggleItemFields(this)">
                <option value="checkbox">Checkbox</option>
                <option value="number">Number</option>
                <option value="select">Select</option>
                <option value="text">Text</option>
                <option value="photo">Photo</option>
              </select>
              <label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;color:#6e7a74;white-space:nowrap"><input type="checkbox" name="items[0].required" value="1"> Req</label>
            </div>
            <div class="item-extra-fields" style="display:none">
              <div class="number-fields" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
                <input type="number" name="items[0].min" style="${inputStyle}" placeholder="Min">
                <input type="number" name="items[0].max" style="${inputStyle}" placeholder="Max">
                <input type="text" name="items[0].unit" style="${inputStyle}" placeholder="Unit (e.g. psi)">
              </div>
              <div class="select-fields" style="display:none;margin-bottom:8px">
                <input type="text" name="items[0].options" style="${inputStyle}" placeholder="Options (comma-separated, e.g. Good, Fair, Poor)">
              </div>
            </div>
            <details style="margin-top:4px">
              <summary style="font-size:0.75rem;color:#6e7a74;cursor:pointer">+ Add help text / instructions</summary>
              <div style="margin-top:8px">
                <input type="text" name="items[0].help_title" style="${inputStyle}" placeholder="Help title">
                <textarea name="items[0].help_body" style="${textareaStyle};margin-top:4px" placeholder="Instructions or reference info..."></textarea>
              </div>
            </details>
          </div>
        </div>

        <button type="button" onclick="addItem()" style="width:100%;padding:10px;background:none;border:2px dashed #bdc9c2;border-radius:8px;color:#006950;font-weight:600;font-size:0.8125rem;cursor:pointer;min-height:44px;margin-top:8px">+ Add Item</button>
      </div>

      <!-- Step 4: Advanced -->
      <details style="background:#FFFFFF;border-radius:8px;padding:16px;margin-bottom:16px">
        <summary style="font-size:0.875rem;font-weight:600;cursor:pointer">Advanced Options</summary>
        <div style="margin-top:12px">
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:0.8125rem;font-weight:500;color:#6e7a74;margin-bottom:4px">Supersedes (replaces these when active)</label>
            <select name="supersedes" multiple style="${dropdownStyle};min-height:80px">
              ${existingIds}
            </select>
            <p style="font-size:0.6875rem;color:#6e7a74;margin-top:2px">Hold Cmd/Ctrl to select multiple</p>
          </div>

          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;font-size:0.8125rem;color:#1a1c1c"><input type="checkbox" name="require_all" value="1" checked> Require all items</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:0.8125rem;color:#1a1c1c"><input type="checkbox" name="sign_off" value="1" checked> Require sign-off</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:0.8125rem;color:#1a1c1c"><input type="checkbox" name="notes_field" value="1"> Add notes field</label>
          </div>
        </div>
      </details>

      <button type="submit" style="width:100%;padding:14px;background:#006950;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">Save to Library</button>
    </form>

    <script>
      var itemCount = 1;

      function updateTriggerFields() {
        var type = document.getElementById('trigger-type').value;
        document.getElementById('field-trigger-day').style.display = type === 'weekly' ? '' : 'none';
        document.getElementById('field-trigger-date').style.display = type === 'monthly' ? '' : 'none';
        document.getElementById('field-calendar-date').style.display = type === 'calendar-date' ? '' : 'none';
        document.getElementById('field-engine-hours').style.display = type === 'engine-hours' ? '' : 'none';
        document.getElementById('field-condition').style.display = type === 'condition' ? '' : 'none';
        document.getElementById('dmt-days').style.display = type === 'daily-rotation' ? '' : 'none';
        document.getElementById('items-hint').textContent = type === 'daily-rotation'
          ? 'These items appear on every day\\'s task. Each day gets its own section with these items.'
          : 'Add the items crew will check off.';
      }

      function toggleItemFields(sel) {
        var row = sel.closest('.item-row');
        var extra = row.querySelector('.item-extra-fields');
        var numFields = row.querySelector('.number-fields');
        var selFields = row.querySelector('.select-fields');
        extra.style.display = (sel.value === 'number' || sel.value === 'select') ? '' : 'none';
        numFields.style.display = sel.value === 'number' ? 'grid' : 'none';
        selFields.style.display = sel.value === 'select' ? '' : 'none';
      }

      function addItem() {
        var idx = itemCount++;
        var container = document.getElementById('items-container');
        var html = '<div class="item-row" style="background:rgba(0,105,80,0.03);border-radius:8px;padding:12px;margin-bottom:8px">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
          + '<span style="font-size:0.75rem;color:#6e7a74">Item ' + (idx + 1) + '</span>'
          + '<button type="button" onclick="this.closest(\\'.item-row\\').remove()" style="background:none;border:none;color:#F36D4F;font-size:0.875rem;cursor:pointer;padding:4px 8px">✕ Remove</button>'
          + '</div>'
          + '<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;margin-bottom:8px">'
          + '<input type="text" name="items[' + idx + '].label" style="' + '${inputStyle}'.replace(/"/g, '\\"') + '" placeholder="Item label">'
          + '<select name="items[' + idx + '].type" style="' + '${dropdownStyle}'.replace(/"/g, '\\"') + ';width:120px" onchange="toggleItemFields(this)">'
          + '<option value="checkbox">Checkbox</option><option value="number">Number</option><option value="select">Select</option><option value="text">Text</option><option value="photo">Photo</option></select>'
          + '<label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;color:#6e7a74;white-space:nowrap"><input type="checkbox" name="items[' + idx + '].required" value="1"> Req</label></div>'
          + '<div class="item-extra-fields" style="display:none">'
          + '<div class="number-fields" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">'
          + '<input type="number" name="items[' + idx + '].min" style="' + '${inputStyle}'.replace(/"/g, '\\"') + '" placeholder="Min">'
          + '<input type="number" name="items[' + idx + '].max" style="' + '${inputStyle}'.replace(/"/g, '\\"') + '" placeholder="Max">'
          + '<input type="text" name="items[' + idx + '].unit" style="' + '${inputStyle}'.replace(/"/g, '\\"') + '" placeholder="Unit"></div>'
          + '<div class="select-fields" style="display:none;margin-bottom:8px">'
          + '<input type="text" name="items[' + idx + '].options" style="' + '${inputStyle}'.replace(/"/g, '\\"') + '" placeholder="Options (comma-separated)"></div></div>'
          + '<details style="margin-top:4px"><summary style="font-size:0.75rem;color:#6e7a74;cursor:pointer">+ Add help text</summary>'
          + '<div style="margin-top:8px"><input type="text" name="items[' + idx + '].help_title" style="' + '${inputStyle}'.replace(/"/g, '\\"') + '" placeholder="Help title">'
          + '<textarea name="items[' + idx + '].help_body" style="' + '${textareaStyle}'.replace(/"/g, '\\"') + ';margin-top:4px" placeholder="Instructions..."></textarea></div></details></div>';
        container.insertAdjacentHTML('beforeend', html);
      }

      updateTriggerFields();
    </script>
  `));
});

// ─── BUILD POST (assemble JSON from form) ───────────────────

app.post('/report/library/build', async (c) => {
  const body = await c.req.parseBody({ all: true });

  const name = String(body.name || '').trim();
  if (!name) return c.redirect('/report/library/build?error=Name+required');

  const vessel = String(body.vessel || 'all');
  const role = String(body.role || 'all');
  const triggerType = String(body.trigger_type || 'on-demand');
  const estMin = parseInt(String(body.estimated_minutes || ''), 10);

  // Generate ID from name + vessel + role
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + (vessel !== 'all' ? '-' + vessel : '')
    + (role !== 'all' ? '-' + role : '');

  // Map trigger type to recurrence
  let recurrence = 'on-demand';
  let trigger_day: string | undefined;
  let trigger_dates: string[] | undefined;

  switch (triggerType) {
    case 'daily-rotation': recurrence = 'daily'; break;
    case 'weekly':
      recurrence = 'weekly';
      trigger_day = String(body.trigger_day || 'monday');
      break;
    case 'monthly':
      recurrence = 'monthly';
      const dateNum = parseInt(String(body.trigger_date_num || '1'), 10);
      trigger_dates = [String(dateNum)];
      break;
    case 'calendar-date':
      recurrence = 'one-time';
      const calDate = String(body.calendar_date || '');
      if (calDate) trigger_dates = [calDate];
      break;
    case 'engine-hours':
    case 'condition':
    case 'on-demand':
      recurrence = 'on-demand';
      break;
  }

  // Parse items from form
  const items: any[] = [];
  for (let i = 0; i < 50; i++) {
    const label = String((body as any)[`items[${i}].label`] || '').trim();
    if (!label) continue;
    const itemType = String((body as any)[`items[${i}].type`] || 'checkbox');
    const required = (body as any)[`items[${i}].required`] === '1';

    const item: any = {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label,
      type: itemType,
      required: required || undefined,
    };

    if (itemType === 'number') {
      const min = parseFloat(String((body as any)[`items[${i}].min`] || ''));
      const max = parseFloat(String((body as any)[`items[${i}].max`] || ''));
      const unit = String((body as any)[`items[${i}].unit`] || '').trim();
      if (!isNaN(min)) item.min = min;
      if (!isNaN(max)) item.max = max;
      if (unit) item.unit = unit;
    }

    if (itemType === 'select') {
      const opts = String((body as any)[`items[${i}].options`] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      if (opts.length > 0) item.options = opts;
    }

    const helpTitle = String((body as any)[`items[${i}].help_title`] || '').trim();
    const helpBody = String((body as any)[`items[${i}].help_body`] || '').trim();
    if (helpBody) {
      item.help = { title: helpTitle || 'Instructions', body: helpBody };
    }

    items.push(item);
  }

  // Build sections
  let sections: any[];

  if (triggerType === 'daily-rotation') {
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    sections = DAYS.map((day, i) => {
      const dayName = String((body as any)[`day_${i}_name`] || '').trim() || 'Maintenance';
      return {
        title: `${day} — ${dayName}`,
        items: items.map(item => ({ ...item, id: `${day.toLowerCase().substring(0, 3)}-${item.id}` })),
      };
    });
  } else {
    sections = [{ title: name, items }];
  }

  // Parse supersedes
  const supersedesRaw = body.supersedes;
  const supersedes = Array.isArray(supersedesRaw)
    ? supersedesRaw.map(String).filter(Boolean)
    : (supersedesRaw ? [String(supersedesRaw)] : undefined);

  // Build the template
  const template: any = {
    id,
    name,
    type: 'checklist',
    vessel,
    role,
    recurrence,
    version: new Date().toISOString().split('T')[0],
    source: 'Created via Haldo builder',
    sections,
    completion: {
      require_all: body.require_all === '1',
      sign_off: body.sign_off === '1',
      notes_field: body.notes_field === '1',
    },
  };

  if (trigger_day) template.trigger_day = trigger_day;
  if (trigger_dates) template.trigger_dates = trigger_dates;
  if (!isNaN(estMin) && estMin > 0) template.estimated_minutes = estMin;
  if (supersedes && supersedes.length > 0) template.supersedes = supersedes;

  // Engine hours metadata
  if (triggerType === 'engine-hours') {
    const threshold = parseInt(String(body.engine_hour_threshold || ''), 10);
    if (!isNaN(threshold)) template.engine_hour_threshold = threshold;
  }
  if (triggerType === 'condition') {
    template.condition_description = String(body.condition_desc || '').trim();
  }

  try {
    await saveTemplate(template);
    await loadTemplates();
    return c.redirect('/report/library');
  } catch (err: any) {
    return c.redirect(`/report/library/build?error=${encodeURIComponent(err.message || 'Save failed')}`);
  }
});

// ─── EDIT EXISTING TEMPLATE (form view) ─────────────────────

app.get('/report/library/:templateId', async (c) => {
  const templateId = c.req.param('templateId');
  const templates = getAllTemplates();
  const template = templates.find(t => t.id === templateId);

  if (!template) {
    return c.html(reportLayout('Tasks', `
      ${subNav('library')}
      <p style="color:#F36D4F">Template "${escapeHtml(templateId)}" not found.</p>
      <a href="/report/library" style="color:#006950">← Back to library</a>
    `));
  }

  const saved = c.req.query('saved') === '1';
  const jsonStr = JSON.stringify(template, null, 2);

  const triggerType = inferTriggerType(template);
  const triggerInfo = TRIGGER_TYPES[triggerType] || TRIGGER_TYPES['on-demand'];
  const vesselLabel = VESSEL_LABELS[template.vessel] || template.vessel || 'All';
  const roleLabel = template.role === 'all' ? 'All' : template.role.charAt(0).toUpperCase() + template.role.slice(1);

  const ct = template as ChecklistTemplate;
  const itemCount = ct.sections?.reduce((sum, s) => sum + (s.items?.length || 0), 0) || 0;
  const sectionCount = ct.sections?.length || 0;

  return c.html(reportLayout('Tasks', `
    ${subNav('library')}
    <div style="margin-bottom:16px">
      <a href="/report/library" style="color:#006950;text-decoration:none;font-size:0.875rem">← Back to library</a>
    </div>

    ${saved ? '<div style="padding:10px 16px;background:rgba(0,105,80,0.08);border-radius:8px;margin-bottom:12px;font-size:0.875rem;color:#006950;text-align:center">✓ Template saved</div>' : ''}

    <div style="background:#FFFFFF;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <h2 style="font-family:'Manrope',-apple-system,sans-serif;font-size:1.125rem;font-weight:700">${escapeHtml(template.name)}</h2>
          <div style="font-size:0.8125rem;color:#6e7a74;margin-top:4px">${vesselLabel} · ${roleLabel} · ${triggerInfo.label}</div>
        </div>
        <span style="font-size:0.6875rem;padding:2px 8px;border-radius:12px;background:rgba(0,105,80,0.1);color:#006950">${itemCount} items · ${sectionCount} sections</span>
      </div>

      ${ct.estimated_minutes ? `<div style="font-size:0.8125rem;color:#6e7a74">Estimated: ~${ct.estimated_minutes} min</div>` : ''}
      ${ct.supersedes?.length ? `<div style="font-size:0.8125rem;color:#6e7a74;margin-top:4px">Supersedes: ${ct.supersedes.join(', ')}</div>` : ''}
    </div>

    <form action="/report/library/${encodeURIComponent(templateId)}" method="POST">
      <textarea name="json" style="width:100%;min-height:400px;padding:16px;border:2px solid #bdc9c2;border-radius:8px;font-family:'Menlo','Monaco','Consolas',monospace;font-size:13px;line-height:1.5;background:#FFFFFF;color:#1a1c1c;resize:vertical;tab-size:2;white-space:pre" spellcheck="false">${escapeHtml(jsonStr)}</textarea>

      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="submit" style="flex:1;padding:14px;background:#006950;color:white;border:none;border-radius:8px;font-size:0.9375rem;font-weight:600;cursor:pointer;min-height:48px">Save Changes</button>
        <a href="/report/library/build?from=${encodeURIComponent(templateId)}" style="display:flex;align-items:center;justify-content:center;padding:14px 20px;background:#FFFFFF;border:2px solid #bdc9c2;border-radius:8px;font-size:0.875rem;font-weight:500;text-decoration:none;color:#1a1c1c;min-height:48px">Clone</a>
      </div>
    </form>

    <details style="margin-top:16px">
      <summary style="font-size:0.8125rem;color:#6e7a74;cursor:pointer;font-weight:500">Template JSON Reference</summary>
      <div style="margin-top:8px;padding:12px;background:#FFFFFF;border-radius:8px;font-size:0.75rem;color:#6e7a74;line-height:1.6">
        <p><strong>Item types:</strong> checkbox, number, select, multi_select, text, photo</p>
        <p><strong>Number fields:</strong> min, max, unit, alert_below_min</p>
        <p><strong>Help boxes:</strong> "help": { "title": "...", "body": "..." }</p>
        <p><strong>Conditional:</strong> "requires": "other-item-id"</p>
        <p><strong>Recurrence:</strong> daily, weekly, monthly, per-trip, on-demand</p>
        <p><strong>Scheduling:</strong> trigger_day (Mon-Sun), trigger_dates ([1,15])</p>
      </div>
    </details>
  `));
});

app.post('/report/library/:templateId', async (c) => {
  const templateId = c.req.param('templateId');
  const body = await c.req.parseBody();
  const jsonStr = String(body.json || '');

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.id || !parsed.name || !parsed.type) {
      throw new Error('Missing required fields: id, name, type');
    }
    await saveTemplate(parsed);
    await loadTemplates();
    return c.redirect(`/report/library/${encodeURIComponent(templateId)}?saved=1`);
  } catch (err: any) {
    return c.redirect(`/report/library/${encodeURIComponent(templateId)}?error=${encodeURIComponent(err.message || 'Invalid JSON')}`);
  }
});

export default app;
