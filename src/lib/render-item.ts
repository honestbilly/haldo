import type { Item } from '../types.js';

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function extractYouTubeId(url: string): string {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  return match ? match[1] : url;
}

export function renderItemHtml(item: Item, prefix: string = 'item_', editMode: boolean = false): string {
  let mediaHtml = '';
  if (item.description_media?.length) {
    mediaHtml = item.description_media.map(m => {
      if (m.type === 'image') return `<img src="${m.url}" alt="${m.alt || m.caption || ''}" class="item-ref-image">`;
      if (m.type === 'video') return `<div class="item-video"><iframe src="https://www.youtube.com/embed/${extractYouTubeId(m.url)}" frameborder="0" allowfullscreen></iframe></div>`;
      if (m.type === 'link') return `<a href="${m.url}" target="_blank" class="item-link">${m.caption || m.url}</a>`;
      return '';
    }).join('') + (item.description_media[0]?.caption ? `<p class="media-caption">${item.description_media[0].caption}</p>` : '');
  }

  // Help and note buttons go in the label row; their expanded content goes BELOW
  // the label row so buttons don't shift position. Standard accordion pattern.
  let helpBtnHtml = '';
  let helpContentHtml = '';
  if (item.help) {
    helpBtnHtml = `<button type="button" class="help-toggle" onclick="toggleExpand('help-${item.id}')">?</button>`;
    helpContentHtml = editMode
      ? `<div class="help-box expanded" id="help-${item.id}" style="display:block">
          <input type="text" name="edit_help_title_${item.id}" value="${escapeAttr(item.help.title)}" class="edit-inline edit-bold" placeholder="Help title">
          <textarea name="edit_help_body_${item.id}" class="edit-inline edit-textarea" placeholder="Help body text">${escapeAttr(item.help.body)}</textarea>
        </div>`
      : `<div class="help-box" id="help-${item.id}">
          <strong>${item.help.title}</strong>
          <p>${item.help.body}</p>
        </div>`;
  } else if (editMode) {
    helpBtnHtml = `<button type="button" class="help-toggle" onclick="toggleExpand('help-${item.id}')" style="opacity:0.4">?</button>`;
    helpContentHtml = `
      <div class="help-box" id="help-${item.id}">
        <input type="text" name="edit_help_title_${item.id}" value="" class="edit-inline edit-bold" placeholder="+ Add help title">
        <textarea name="edit_help_body_${item.id}" class="edit-inline edit-textarea" placeholder="+ Add help text"></textarea>
      </div>`;
  }

  let sopHtml = '';
  if (item.sop) {
    const stepsHtml = item.sop.steps.map((s, i) => `<li>${s}</li>`).join('');
    sopHtml = `
      <button type="button" class="sop-toggle" onclick="this.nextElementSibling.classList.toggle('expanded')">
        <span class="sop-icon">&#128214;</span> How to do this
      </button>
      <div class="sop-card">
        <strong class="sop-title">${item.sop.title}</strong>
        <ol class="sop-steps">${stepsHtml}</ol>
        <cite class="sop-source">Source: ${item.sop.source}</cite>
      </div>`;
  }

  let infoHtml = item.info ? `<p class="item-info">${editMode
    ? `<input type="text" name="edit_info_${item.id}" value="${escapeAttr(item.info)}" class="edit-inline" placeholder="Info text...">`
    : item.info}</p>` : (editMode ? `<p class="item-info"><input type="text" name="edit_info_${item.id}" value="" class="edit-inline" placeholder="+ Add info text"></p>` : '');
  let requiredMark = item.required ? '<span class="required-mark">*</span>' : '';

  // Note button in label row; content expands BELOW the row
  const noteBtnHtml = `<button type="button" class="inline-note-toggle" onclick="toggleExpand('note-${item.id}')" title="Add a note">+</button>`;
  const noteContentHtml = `
    <div class="inline-note-box" id="note-${item.id}">
      <textarea name="note_${item.id}" class="inline-note-input" placeholder="Add a note about this item..."></textarea>
      <div class="inline-note-photo">
        <label class="photo-btn photo-btn-sm"><span>📷</span><input type="file" accept="image/*" capture="environment" name="note_photo_${item.id}" style="display:none"></label>
      </div>
    </div>`;

  const requiresAttr = item.requires ? `data-requires="${item.requires}" style="display:none"` : '';

  switch (item.type) {
    case 'checkbox':
      const cbLabel = editMode
        ? `<input type="text" name="edit_label_${item.id}" value="${escapeAttr(item.label)}" class="edit-inline edit-label">`
        : `<span class="checkbox-text">${item.label}${requiredMark}</span>`;
      return `
        <div class="form-item item-checkbox ${editMode ? 'edit-mode' : ''}" ${requiresAttr}>
          <div class="item-label-row">
            <label class="checkbox-label">
              ${editMode ? '' : `<input type="checkbox" name="${prefix}${item.id}" value="true" class="checkbox-input" onchange="handleCheckboxChange(this)" data-item-id="${item.id}"><span class="checkbox-custom"></span>`}
              ${cbLabel}
            </label>
            ${helpBtnHtml}${editMode ? '' : noteBtnHtml}
          </div>
          ${helpContentHtml}${editMode ? '' : noteContentHtml}
          ${sopHtml}${infoHtml}${mediaHtml}
        </div>`;

    case 'number':
      const colorClass = item.min !== undefined ? 'has-threshold' : '';
      // Large-value items (engine hours, guest counts) get direct input only.
      // Small-range items (merch qty, etc.) keep stepper buttons.
      const isLargeValue = (item.min !== undefined && item.min >= 100) ||
        (item.max !== undefined && item.max >= 100) ||
        item.id.includes('engine-hours') || item.id.includes('guests') ||
        item.id.includes('passengers') || item.id.includes('fuel');

      const stepperHtml = isLargeValue
        ? `<div class="direct-input-wrap">
            <input type="number" inputmode="numeric" pattern="[0-9]*" name="${prefix}${item.id}"
              class="stepper-input direct-number" value="" placeholder="Enter value"
              data-item-id="${item.id}">
            ${item.unit ? `<span class="stepper-unit">${item.unit}</span>` : ''}
          </div>`
        : `<div class="stepper">
            <button type="button" class="stepper-btn minus" onclick="step(this, -1)">−</button>
            <div class="stepper-value-wrap">
              <input type="number" inputmode="numeric" pattern="[0-9]*" name="${prefix}${item.id}"
                class="stepper-input" value="" placeholder="—" data-item-id="${item.id}">
              ${item.unit ? `<span class="stepper-unit">${item.unit}</span>` : ''}
            </div>
            <button type="button" class="stepper-btn plus" onclick="step(this, 1)">+</button>
          </div>`;

      const numLabel = editMode
        ? `<input type="text" name="edit_label_${item.id}" value="${escapeAttr(item.label)}" class="edit-inline edit-label">`
        : `<span class="item-label">${item.label}${requiredMark}</span>`;
      return `
        <div class="form-item item-number ${colorClass} ${editMode ? 'edit-mode' : ''}" ${requiresAttr}
          data-min="${item.min ?? ''}" data-max="${item.max ?? ''}">
          <div class="item-label-row">
            ${numLabel}
            ${helpBtnHtml}${editMode ? '' : noteBtnHtml}
          </div>
          ${helpContentHtml}${noteContentHtml}
          ${mediaHtml}
          ${stepperHtml}
          ${item.min !== undefined ? `<p class="threshold-info">Min: ${item.min}${item.max !== undefined ? ` | Max: ${item.max}` : ''} ${item.unit || ''}</p>` : ''}
          <div class="expand-on-fail" style="display:none">
            <input type="text" name="fail_note_${item.id}" placeholder="What's the issue?" class="fail-note">
            <label class="photo-btn"><span>📷 Take photo</span><input type="file" accept="image/*" capture="environment" style="display:none"></label>
          </div>
          ${sopHtml}${infoHtml}
        </div>`;

    case 'select':
      const optButtons = (item.options || []).map(opt =>
        `<button type="button" class="option-btn" data-value="${opt}" onclick="selectOption(this, '${prefix}${item.id}')">${opt}</button>`
      ).join('');
      const selLabel = editMode
        ? `<input type="text" name="edit_label_${item.id}" value="${escapeAttr(item.label)}" class="edit-inline edit-label">`
        : `<span class="item-label">${item.label}${requiredMark}</span>`;
      return `
        <div class="form-item item-select ${editMode ? 'edit-mode' : ''}" ${requiresAttr}>
          <div class="item-label-row">
            ${selLabel}
            ${helpBtnHtml}${editMode ? '' : noteBtnHtml}
          </div>
          ${helpContentHtml}${noteContentHtml}
          ${mediaHtml}
          <div class="option-group">${optButtons}</div>
          <input type="hidden" name="${prefix}${item.id}" data-item-id="${item.id}">
          ${sopHtml}${infoHtml}
        </div>`;

    case 'multi_select':
      const checkboxes = (item.options || []).map(opt =>
        `<label class="multi-option">
          <input type="checkbox" name="multi_${item.id}" value="${opt}">
          <span class="multi-option-text">${opt}</span>
        </label>`
      ).join('');
      return `
        <div class="form-item item-multi-select" ${requiresAttr}>
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpBtnHtml}
          </div>
          ${helpContentHtml}
          ${mediaHtml}
          <div class="multi-group">${checkboxes}</div>
          ${sopHtml}${infoHtml}
        </div>`;

    case 'text':
      return `
        <div class="form-item item-text" ${requiresAttr}>
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpBtnHtml}
          </div>
          ${helpContentHtml}
          ${mediaHtml}
          <textarea name="${prefix}${item.id}" class="text-input"
            placeholder="${item.placeholder || ''}" data-item-id="${item.id}"></textarea>
          ${sopHtml}${infoHtml}
        </div>`;

    case 'photo':
      return `
        <div class="form-item item-photo" ${requiresAttr}>
          <div class="item-label-row">
            <span class="item-label">${item.label}${requiredMark}</span>
            ${helpBtnHtml}
          </div>
          ${helpContentHtml}
          ${mediaHtml}
          <label class="photo-capture-btn">
            <span>📷 ${item.placeholder || 'Take photo'}</span>
            <input type="file" name="${prefix}${item.id}" accept="image/*" capture="environment" multiple>
          </label>
          <div class="photo-previews" id="previews_${item.id}"></div>
          ${sopHtml}${infoHtml}
        </div>`;

    default:
      return '';
  }
}
