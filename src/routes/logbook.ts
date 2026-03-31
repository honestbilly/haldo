import { renderItemHtml } from '../lib/render-item.js';
import { bottomNav } from '../ui.js';
import type { LogbookTemplate } from '../types.js';

export function renderLogbook(session: any, template: LogbookTemplate): string {
  const role = session.role as 'captain' | 'deckhand';
  const visibleSteps = role === 'captain' ? template.captain_steps : template.mate_steps;

  if (visibleSteps.length === 0) {
    return `<!DOCTYPE html><html><body><p>This logbook is not available for your role.</p><a href="/today">Back</a></body></html>`;
  }

  const stepsHtml = template.steps
    .filter(s => visibleSteps.includes(s.step))
    .map((step, idx) => {
      const itemsHtml = step.items
        .filter(item => !step.captain_only || role === 'captain')
        .map(item => renderItemHtml(item))
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

      const captainInput = document.querySelector('[name="item_captain-name"]');
      if (captainInput && !captainInput.value) captainInput.value = '${session.crew_name}';

      // Auto-select trip slot
      const slotBtns = document.querySelectorAll('[data-value="AM (9-1)"], [data-value="PM (2-6)"]');
      slotBtns.forEach(btn => {
        if (btn.dataset.value.startsWith('${session.trip_slot}')) {
          btn.click();
        }
      });
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
    <a href="/logout" class="switch-link">Switch crew member</a>
  </div>
</body>
</html>`;
}
