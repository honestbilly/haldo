import { renderItemHtml } from '../lib/render-item.js';
import { bottomNav } from '../ui.js';
import type { LogbookTemplate } from '../types.js';

export function renderLogbook(session: any, template: LogbookTemplate, crewList: Array<{ id: string; name: string; role: string }> = []): string {
  const role = session.role as 'captain' | 'deckhand';
  // Default to all steps if captain_steps/mate_steps not defined (e.g. on-demand drills)
  const allStepNums = template.steps.map(s => s.step);
  const visibleSteps = role === 'captain'
    ? (template.captain_steps ?? allStepNums)
    : (template.mate_steps ?? allStepNums);

  if (!visibleSteps || visibleSteps.length === 0) {
    return `<!DOCTYPE html><html><body><p>This logbook is not available for your role.</p><a href="/today">Back</a></body></html>`;
  }

  // Build dynamic crew options from DB for deckhand picker
  const deckhands = crewList.filter(c => c.role === 'deckhand');
  const captains = crewList.filter(c => c.role === 'captain' && c.name !== session.crew_name);

  const stepsHtml = template.steps
    .filter(s => visibleSteps.includes(s.step))
    .map((step, idx) => {
      const itemsHtml = step.items
        .filter(item => !step.captain_only || role === 'captain')
        .map(item => {
          // Dynamically populate crew picker items from the database
          if (item.id === 'deckhand-name' && item.type === 'select' && deckhands.length > 0) {
            const dynamicItem = { ...item, options: deckhands.map(d => d.name) };
            return renderItemHtml(dynamicItem);
          }
          if (item.id === 'crew-on-board' && item.type === 'multi_select' && crewList.length > 0) {
            const dynamicItem = { ...item, options: crewList.map(c => c.name) };
            return renderItemHtml(dynamicItem);
          }
          return renderItemHtml(item);
        })
        .join('');

      return `
        <div class="wizard-step" data-step="${idx}" ${idx > 0 ? 'style="display:none"' : ''}>
          <h2 class="step-title">${step.title}</h2>
          ${itemsHtml}
        </div>`;
    }).join('');

  const totalSteps = visibleSteps.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${template.name} — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#1A6B8A">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>
<body style="background:#F2F2F7">
  <!-- Fixed Header (Stitch pattern) -->
  <header style="position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(255,255,255,0.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 3px rgba(0,0,0,0.06);padding:12px 24px;height:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <a href="/today" style="color:#1A6B8A;text-decoration:none;font-weight:600;font-size:0.875rem;display:flex;align-items:center;gap:4px">
        <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Home
      </a>
      <h1 style="font-family:'Manrope',sans-serif;font-weight:700;font-size:1rem;color:#1a1c1e">${template.name}</h1>
      <span style="font-size:0.6875rem;font-weight:700;color:#1A6B8A;background:rgba(26,107,138,0.08);padding:4px 10px;border-radius:10px">${session.vessel.toUpperCase()}</span>
    </div>
    <div style="display:flex;align-items:center;gap:12px">
      <span id="step-indicator" style="font-size:0.75rem;font-weight:600;color:#8E8E93">Step 1 of ${totalSteps}</span>
      <div style="flex:1;height:4px;background:#E5E5EA;border-radius:2px;overflow:hidden">
        <div id="step-progress-fill" style="height:100%;background:#1A6B8A;border-radius:2px;transition:width 0.3s;width:${100 / totalSteps}%"></div>
      </div>
    </div>
  </header>

  <div class="logbook-page" style="padding-top:100px">

    <form action="/c/${template.id}" method="POST" id="logbook-form">
      ${stepsHtml}

      ${template.completion.sign_off ? `
        <div class="wizard-step" data-step="${totalSteps}" style="display:none">
          <h2 class="step-title">Review & Submit</h2>
          <p>Check your entries below, then confirm and submit.</p>
          <div id="review-summary" class="review-summary"></div>
          <label class="sign-off">
            <input type="checkbox" name="sign_off">
            <span>I, ${session.role === 'captain' ? 'Captain' : 'Deckhand'} ${session.crew_name}, confirm this is accurate</span>
          </label>
        </div>` : ''}

      <div style="position:fixed;bottom:0;left:0;right:0;display:flex;gap:8px;padding:12px 24px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));background:rgba(255,255,255,0.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 -1px 3px rgba(0,0,0,0.06);max-width:480px;margin:0 auto;z-index:1100">
        <button type="button" id="back-btn" onclick="wizardNav(-1)" style="visibility:hidden;flex:1;height:54px;background:white;border:2px solid #c7c7cc;border-radius:12px;font-family:'Inter',sans-serif;font-weight:700;font-size:1rem;color:#1a1c1e;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Back
        </button>
        <button type="button" id="next-btn" onclick="wizardNav(1)" style="flex:1;height:54px;background:#1A6B8A;border:none;border-radius:12px;font-family:'Inter',sans-serif;font-weight:700;font-size:1rem;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 12px rgba(26,107,138,0.25);transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
          Next <span class="material-symbols-outlined" style="font-size:18px">arrow_forward</span>
        </button>
        <button type="submit" id="wizard-submit" style="display:none;flex:1;height:54px;background:#F36D4F;border:none;border-radius:12px;font-family:'Manrope',sans-serif;font-weight:700;font-size:1rem;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 12px rgba(243,109,79,0.3);transition:transform 0.15s" ontouchstart="this.style.transform='scale(0.98)'" ontouchend="this.style.transform='scale(1)'">
          <span class="material-symbols-outlined" style="font-size:18px;font-variation-settings:'FILL' 1">check_circle</span> Submit
        </button>
      </div>
    </form>
  </div>
  <script>
    const totalSteps = ${totalSteps + (template.completion.sign_off ? 1 : 0)};
  </script>
  <script src="/public/app.js"></script>
  <script>
    // Pre-fill known values from session
    document.addEventListener('DOMContentLoaded', () => {
      const tripDateInput = document.querySelector('[name="item_trip-date"]');
      if (tripDateInput && !tripDateInput.value) tripDateInput.value = '${session.trip_date}';

      // Auto-fill captain name and make it read-only (they're the one filling it out)
      const captainInput = document.querySelector('[name="item_captain-name"]');
      if (captainInput) {
        captainInput.value = '${session.crew_name}';
        captainInput.readOnly = true;
        captainInput.style.background = '#f0faf6';
        captainInput.style.color = '#1A6B8A';
        captainInput.style.fontWeight = '600';
      }

      // Auto-select trip slot
      const slotBtn = document.querySelector('[data-value="${session.trip_slot}"]');
      if (slotBtn) slotBtn.click();
    });
  </script>
  <!-- No bottom nav on logbook wizard — wizard nav buttons are the navigation -->
</body>
</html>`;
}

export function renderSuccess(session: any, alertCount: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Done! — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#1A6B8A">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>
<body>
  <div class="success-page">
    <div class="success-icon">✓</div>
    <h1>Submitted!</h1>
    ${alertCount > 0
      ? `<div class="alert-summary">Billy has been notified — ${alertCount} item${alertCount === 1 ? '' : 's'} need attention.</div>`
      : `<p class="all-good">All good — everything checks out.</p>`
    }
    <a href="/today" class="primary-btn">Back to Today's List</a>
    <a href="/" class="switch-link">Switch vessel / trip</a>
  </div>
</body>
</html>`;
}
