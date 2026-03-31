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
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#006950">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>
<body>
  <div class="logbook-page">
    <header class="logbook-header">
      <h1>${template.name}</h1>
      <p class="checklist-context">${session.vessel.toUpperCase()} | ${session.crew_name} | ${session.trip_slot}</p>
      <div class="step-progress">
        <span id="step-indicator">Step 1 of ${totalSteps}</span>
        <div class="progress-bar"><div class="progress-fill" id="step-progress-fill" style="width:${100 / totalSteps}%"></div></div>
      </div>
    </header>

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

      <div class="wizard-nav">
        <button type="button" class="nav-btn back-btn" id="back-btn" onclick="wizardNav(-1)" style="visibility:hidden">← Back</button>
        <button type="button" class="nav-btn next-btn" id="next-btn" onclick="wizardNav(1)">Next →</button>
        <button type="submit" class="nav-btn submit-nav-btn" id="wizard-submit" style="display:none">Submit Logbook</button>
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
        captainInput.style.color = '#006950';
        captainInput.style.fontWeight = '600';
      }

      // Auto-select trip slot
      const slotBtn = document.querySelector('[data-value="${session.trip_slot}"]');
      if (slotBtn) slotBtn.click();
    });
  </script>
  ${bottomNav('home')}
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
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#006950">
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
