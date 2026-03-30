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
  input.dispatchEvent(new Event('input'));
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

// --- Select option buttons ---
function selectOption(btn, inputName) {
  const group = btn.closest('.option-group');
  group.querySelectorAll('.option-btn').forEach(b => {
    b.classList.remove('active', 'below-threshold');
  });
  btn.classList.add('active');

  const input = document.querySelector(`input[name="${inputName}"]`);
  if (input) input.value = btn.dataset.value;

  // Check if below threshold (for select items with alert_below)
  // This is handled server-side, but we can add visual feedback
  updateProgress();
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

// --- Initialize on load ---
document.addEventListener('DOMContentLoaded', () => {
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
});
