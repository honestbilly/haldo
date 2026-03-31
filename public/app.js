// ============================================================
// Haldo — Frontend interaction logic
// Handles: steppers, threshold colors, expand-on-fail,
// conditional visibility, wizard nav, progress tracking
// ============================================================

// --- Number Stepper ---
function step(btn, delta) {
  const wrap = btn.closest('.stepper');
  const input = wrap.querySelector('.stepper-input');
  const current = parseInt(input.value) || 0;
  const newVal = Math.max(0, current + delta);
  input.value = newVal;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// --- Threshold coloring ---
document.addEventListener('input', (e) => {
  if (e.target.classList.contains('stepper-input')) {
    updateThresholdColor(e.target);
    updateProgress();
  }
});

function updateThresholdColor(input) {
  const item = input.closest('.item-number');
  if (!item) return;

  const min = parseFloat(item.dataset.min);
  const max = parseFloat(item.dataset.max);
  const val = parseFloat(input.value);

  input.classList.remove('threshold-good', 'threshold-warn', 'threshold-bad');

  if (isNaN(val) || input.value === '') return;

  if (!isNaN(min) && val < min) {
    input.classList.add('threshold-bad');
    showExpandOnFail(item, true);
  } else if (!isNaN(max) && val >= max) {
    input.classList.add('threshold-good');
    showExpandOnFail(item, false);
  } else {
    input.classList.add('threshold-warn');
    showExpandOnFail(item, false);
  }
}

function showExpandOnFail(item, show) {
  const expand = item.querySelector('.expand-on-fail');
  if (expand) {
    expand.style.display = show ? 'block' : 'none';
  }
}

// --- Expand/collapse for help boxes and inline notes ---
// Content is OUTSIDE the label row so buttons don't shift.
function toggleExpand(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.classList.toggle('expanded');
  if (isOpen) {
    const textarea = el.querySelector('textarea');
    if (textarea) textarea.focus();
  }
}

// --- Select option buttons ---
function selectOption(btn, inputName) {
  const group = btn.closest('.option-group');
  group.querySelectorAll('.option-btn').forEach(b => {
    b.classList.remove('active', 'below-threshold');
  });
  btn.classList.add('active');

  const input = document.querySelector(`input[name="${inputName}"]`);
  if (input) input.value = btn.dataset.value;

  // Handle conditional visibility for select items (like merch-sold → show item fields)
  const itemId = input?.dataset?.itemId;
  if (itemId) {
    const isPositive = btn.dataset.value === 'Yes' || btn.dataset.value === 'true';
    document.querySelectorAll(`[data-requires="${itemId}"]`).forEach(el => {
      el.style.display = isPositive ? '' : 'none';
    });
  }

  updateProgress();

  // In logbook wizard: auto-advance if this is the last unfilled item in the step
  if (typeof wizardNav === 'function' && typeof currentStep !== 'undefined') {
    var step = btn.closest('.wizard-step');
    if (step) {
      var allItems = step.querySelectorAll('.form-item');
      var allFilled = true;
      allItems.forEach(function(item) {
        if (item.style.display === 'none') return;
        var cb = item.querySelector('.checkbox-input');
        if (cb) { if (!cb.checked) allFilled = false; return; }
        var hid = item.querySelector('input[type="hidden"]');
        if (hid) { if (!hid.value) allFilled = false; return; }
        var txt = item.querySelector('.text-input, input[type="text"], input[type="date"]');
        if (txt) { if (!txt.value.trim()) allFilled = false; return; }
        var stepper = item.querySelector('.stepper-input');
        if (stepper) { if (stepper.value === '') allFilled = false; return; }
      });
      if (allFilled) {
        setTimeout(function() { wizardNav(1); }, 300);
      }
    }
  }
}

// --- Checkbox change handler (for requires/conditional) ---
function handleCheckboxChange(checkbox) {
  const itemId = checkbox.dataset.itemId;
  if (!itemId) return;

  // Find all items that require this checkbox
  document.querySelectorAll(`[data-requires="${itemId}"]`).forEach(el => {
    el.style.display = checkbox.checked ? '' : 'none';
  });

  updateProgress();
}

// --- Progress tracking ---
function updateProgress() {
  const form = document.getElementById('checklist-form');
  if (!form) return;

  const items = form.querySelectorAll('.form-item:not([style*="display: none"])');
  let total = 0;
  let filled = 0;

  items.forEach(item => {
    // Skip items hidden by requires
    if (item.style.display === 'none') return;
    total++;

    const checkbox = item.querySelector('.checkbox-input');
    if (checkbox) { if (checkbox.checked) filled++; return; }

    const stepper = item.querySelector('.stepper-input');
    if (stepper) { if (stepper.value !== '') filled++; return; }

    const hidden = item.querySelector('input[type="hidden"]');
    if (hidden && hidden.value) { filled++; return; }

    const textarea = item.querySelector('.text-input');
    if (textarea) { if (textarea.value.trim()) filled++; return; }

    const multiChecked = item.querySelectorAll('.multi-group input:checked');
    if (item.classList.contains('item-multi-select')) { if (multiChecked.length > 0) filled++; return; }
  });

  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  if (progressFill) progressFill.style.width = total > 0 ? `${(filled / total) * 100}%` : '0%';
  if (progressText) progressText.textContent = `${filled} / ${total} items`;
}

// --- Wizard navigation ---
let currentStep = 0;

function wizardNav(delta) {
  const steps = document.querySelectorAll('.wizard-step');
  const total = typeof totalSteps !== 'undefined' ? totalSteps : steps.length;

  steps[currentStep].style.display = 'none';
  currentStep += delta;

  if (currentStep < 0) currentStep = 0;
  if (currentStep >= total) currentStep = total - 1;

  steps[currentStep].style.display = '';

  // Update UI
  const backBtn = document.getElementById('back-btn');
  const nextBtn = document.getElementById('next-btn');
  const submitBtn = document.getElementById('wizard-submit');
  const indicator = document.getElementById('step-indicator');
  const progressFill = document.getElementById('step-progress-fill');

  if (backBtn) backBtn.style.visibility = currentStep === 0 ? 'hidden' : 'visible';

  if (currentStep === total - 1) {
    if (nextBtn) nextBtn.style.display = 'none';
    if (submitBtn) submitBtn.style.display = '';
  } else {
    if (nextBtn) nextBtn.style.display = '';
    if (submitBtn) submitBtn.style.display = 'none';
  }

  if (indicator) indicator.textContent = `Step ${currentStep + 1} of ${total}`;
  if (progressFill) progressFill.style.width = `${((currentStep + 1) / total) * 100}%`;

  // Scroll to top of step
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Build review summary when reaching the last step
  const reviewEl = document.getElementById('review-summary');
  if (reviewEl && steps[currentStep]?.querySelector('#review-summary')) {
    buildReviewSummary(reviewEl);
  }
}

function buildReviewSummary(container) {
  container.innerHTML = '';
  const form = document.getElementById('logbook-form') || document.getElementById('checklist-form');
  if (!form) return;

  const items = form.querySelectorAll('.form-item');
  let html = '<div class="review-list">';

  items.forEach(item => {
    if (item.style.display === 'none') return;

    const label = item.querySelector('.item-label, .checkbox-text');
    if (!label) return;
    const labelText = label.textContent.replace(/\*$/, '').trim();

    let value = '';

    // Checkbox
    const cb = item.querySelector('.checkbox-input');
    if (cb) { value = cb.checked ? '✓' : '—'; }

    // Stepper / number
    const stepper = item.querySelector('.stepper-input');
    if (stepper) {
      const unit = item.querySelector('.stepper-unit');
      value = stepper.value ? stepper.value + (unit ? ' ' + unit.textContent : '') : '—';
    }

    // Select (hidden input)
    const hidden = item.querySelector('input[type="hidden"]');
    if (hidden && hidden.value && !stepper) { value = hidden.value; }

    // Text
    const textarea = item.querySelector('.text-input');
    if (textarea) { value = textarea.value.trim() || '—'; }

    // Multi-select
    if (item.classList.contains('item-multi-select')) {
      const checked = item.querySelectorAll('.multi-group input:checked');
      value = checked.length > 0 ? Array.from(checked).map(c => c.value).join(', ') : '—';
    }

    // Option buttons (select type)
    const activeOpt = item.querySelector('.option-btn.active');
    if (activeOpt && !hidden?.value) { value = activeOpt.textContent; }

    if (value) {
      html += '<div class="review-row"><span class="review-label">' + labelText + '</span><span class="review-value">' + value + '</span></div>';
    }
  });

  html += '</div>';
  container.innerHTML = html;
}

// --- Review summary toggle (for checklists) ---
function toggleReviewSummary() {
  const el = document.getElementById('review-summary');
  if (!el) return;
  if (el.style.display === 'none') {
    buildReviewSummary(el);
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// --- Photo preview ---
document.addEventListener('change', (e) => {
  if (e.target.type === 'file' && e.target.accept?.includes('image')) {
    const container = e.target.closest('.form-item')?.querySelector('.photo-previews')
      || e.target.closest('.expand-on-fail');
    if (!container) return;

    for (const file of e.target.files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = document.createElement('img');
        img.src = ev.target.result;
        img.style.width = '72px';
        img.style.height = '72px';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '8px';
        container.appendChild(img);
      };
      reader.readAsDataURL(file);
    }
  }
});

// --- Auto-save form data to localStorage ---
// Saves all form inputs so nothing is lost if crew pockets their phone
let autoSaveTimer = null;

function getFormKey() {
  // Key based on the page URL (which includes the template ID)
  return 'haldo_form_' + window.location.pathname;
}

function autoSave() {
  const form = document.getElementById('checklist-form') || document.getElementById('logbook-form');
  if (!form) return;

  const data = {};
  const inputs = form.querySelectorAll('input, textarea, select');
  inputs.forEach(el => {
    if (!el.name || el.type === 'file') return;
    if (el.type === 'checkbox') {
      data[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
    } else {
      data[el.name] = el.value;
    }
  });

  // Also save active option buttons
  form.querySelectorAll('.option-btn.active').forEach(btn => {
    const input = btn.closest('.form-item')?.querySelector('input[type="hidden"]');
    if (input?.name) data[input.name] = input.value;
  });

  data._savedAt = Date.now();
  data._step = typeof currentStep !== 'undefined' ? currentStep : 0;

  try {
    localStorage.setItem(getFormKey(), JSON.stringify(data));
  } catch(e) { /* localStorage full or unavailable */ }
}

function restoreForm() {
  const key = getFormKey();
  const raw = localStorage.getItem(key);
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    // Check staleness — 24 hours
    if (data._savedAt && (Date.now() - data._savedAt) > 86400000) {
      localStorage.removeItem(key);
      return;
    }

    const form = document.getElementById('checklist-form') || document.getElementById('logbook-form');
    if (!form) return;

    let restored = false;
    Object.entries(data).forEach(([name, value]) => {
      if (name.startsWith('_')) return;
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) return;

      if (el.type === 'checkbox') {
        el.checked = !!value;
        restored = true;
      } else if (el.type === 'hidden') {
        el.value = value;
        // Also highlight the matching option button
        const optBtn = el.closest('.form-item')?.querySelector(`[data-value="${value}"]`);
        if (optBtn) optBtn.classList.add('active');
        restored = true;
      } else if (value) {
        el.value = value;
        restored = true;
      }
    });

    // Restore wizard step
    if (data._step && typeof wizardNav === 'function' && data._step > 0) {
      for (let i = 0; i < data._step; i++) wizardNav(1);
    }

    if (restored) {
      // Show "resuming" banner
      const banner = document.createElement('div');
      banner.className = 'resume-banner';
      banner.innerHTML = 'Resuming where you left off <button onclick="this.parentElement.remove()">×</button>';
      const header = document.querySelector('.checklist-header, .logbook-header');
      if (header) header.after(banner);
    }
  } catch(e) { /* bad data, ignore */ }
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(autoSave, 500);
}

// Clear saved data after successful submission
function clearAutoSave() {
  localStorage.removeItem(getFormKey());
}

// --- Initialize on load ---
document.addEventListener('DOMContentLoaded', () => {
  // Restore saved form data
  restoreForm();

  updateProgress();

  // Initialize all threshold colors
  document.querySelectorAll('.stepper-input').forEach(updateThresholdColor);

  // Initialize conditional visibility
  document.querySelectorAll('[data-requires]').forEach(el => {
    const reqId = el.dataset.requires;
    const checkbox = document.querySelector(`[data-item-id="${reqId}"]`);
    if (checkbox && !checkbox.checked) {
      el.style.display = 'none';
    }
  });

  // Auto-save on any input change
  const form = document.getElementById('checklist-form') || document.getElementById('logbook-form');
  if (form) {
    form.addEventListener('input', scheduleAutoSave);
    form.addEventListener('change', scheduleAutoSave);
    // Save immediately when page loses visibility (phone pocketed)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') autoSave();
    });
    // Save on page unload
    window.addEventListener('beforeunload', autoSave);
    // Clear saved data on successful form submission
    form.addEventListener('submit', clearAutoSave);
  }

  // Register service worker for PWA + offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/public/sw.js').catch(() => {});
  }

  // Sync queued submissions when back online
  window.addEventListener('online', () => {
    const pending = JSON.parse(localStorage.getItem('haldo_pending') || '[]');
    if (pending.length === 0) return;
    pending.forEach(item => {
      fetch(item.url, {
        method: 'POST',
        headers: { 'Content-Type': item.contentType || 'application/x-www-form-urlencoded' },
        body: item.body,
      }).catch(() => {});
    });
    localStorage.removeItem('haldo_pending');
  });
});
