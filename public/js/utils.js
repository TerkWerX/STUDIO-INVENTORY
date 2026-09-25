export function formatCurrency(amount) {
  const n = parseFloat(amount) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

/** Warranty countdown from YYYY-MM-DD end date. */
export function getWarrantyStatus(endDateStr) {
  if (!endDateStr) return { status: 'none' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDateStr.includes('T') ? endDateStr : `${endDateStr}T00:00:00`);
  if (Number.isNaN(end.getTime())) return { status: 'none' };

  const msPerDay = 86400000;
  const daysLeft = Math.round((end - today) / msPerDay);

  if (daysLeft < 0) {
    return {
      status: 'expired',
      daysLeft,
      daysAgo: Math.abs(daysLeft),
      endDate: endDateStr,
      label: `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} ago`
    };
  }
  if (daysLeft === 0) {
    return { status: 'expires-today', daysLeft: 0, endDate: endDateStr, label: 'Expires today' };
  }
  return {
    status: 'active',
    daysLeft,
    endDate: endDateStr,
    label: `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`
  };
}

export function renderWarrantyStrip(item) {
  const w = getWarrantyStatus(item.warranty_end_date);
  const note = item.warranty_note ? escapeHtml(item.warranty_note) : '';

  if (w.status === 'none') {
    return `
      <div class="warranty-strip warranty-none">
        <span class="warranty-strip-label">Warranty</span>
        <span class="warranty-strip-value text-muted">Not recorded</span>
        ${note ? `<span class="warranty-strip-note">${note}</span>` : ''}
      </div>`;
  }

  const statusClass = {
    active: 'warranty-active',
    'expires-today': 'warranty-soon',
    expired: 'warranty-expired'
  }[w.status] || 'warranty-none';

  const countdown = w.status === 'expired'
    ? `${w.daysAgo} day${w.daysAgo !== 1 ? 's' : ''} ago`
    : w.status === 'expires-today'
      ? 'Today'
      : `${w.daysLeft}d`;

  return `
    <div class="warranty-strip ${statusClass}">
      <span class="warranty-strip-label">Warranty</span>
      <span class="warranty-strip-countdown">${countdown}</span>
      <span class="warranty-strip-detail">${escapeHtml(w.label)} · ends ${formatDate(w.endDate)}</span>
      ${note ? `<span class="warranty-strip-note">${note}</span>` : ''}
    </div>`;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape text for HTML element content AND quoted attribute values.
 * (Serializing a text node only escapes & < >, which is not enough inside
 * title="…" or value="…", so quotes are escaped here too.)
 */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/** A link target that can only be http(s) or same-site; anything else becomes '#'. */
export function safeUrl(url) {
  const text = String(url ?? '').trim();
  if (!text) return '#';
  try {
    const parsed = new URL(text, window.location.origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
  } catch {
    return '#';
  }
}

// Image fallbacks without inline onerror="…" handlers (blocked by the CSP).
// Error events do not bubble, so listen in the capture phase.
if (typeof document !== 'undefined' && !window.__studioImageFallbacks) {
  window.__studioImageFallbacks = true;
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const mode = img.dataset.fallback;
    if (mode === 'marker') {
      const span = document.createElement('span');
      span.className = 'map-marker-fallback';
      span.textContent = img.dataset.initials || '?';
      span.title = img.alt || '';
      img.replaceWith(span);
    } else if (mode === 'logo') {
      img.classList.add('hidden');
      img.nextElementSibling?.classList.remove('hidden');
    }
  }, true);
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// The open modal's close function, so Escape can cancel it and resolve its promise.
let activeModalClose = null;

/** Cancel the open confirm/choice modal, if any. Returns true when one was open. */
export function closeActiveModal() {
  if (!activeModalClose) return false;
  activeModalClose();
  return true;
}

/**
 * Wrap an async event handler so it runs once at a time: clicks or submits
 * while it is still working are ignored, and the button (or the form's submit
 * buttons) stays disabled until it finishes. Stops double-clicks from saving
 * the same thing twice.
 */
export function singleFlight(handler) {
  let running = false;
  return async function guarded(event, ...rest) {
    if (running) {
      event?.preventDefault?.();
      return undefined;
    }
    running = true;
    const target = event?.currentTarget;
    let controls = [];
    if (target instanceof HTMLFormElement) {
      controls = [...target.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]')];
    } else if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) {
      controls = [target];
    }
    const changed = controls.filter(control => !control.disabled);
    changed.forEach(control => { control.disabled = true; });
    try {
      return await handler.call(this, event, ...rest);
    } finally {
      running = false;
      changed.forEach(control => { control.disabled = false; });
    }
  };
}

function setModalMode(mode = 'confirm') {
  const panel = document.getElementById('modal');
  panel?.classList.remove('modal--choice');
  if (mode === 'choice') panel?.classList.add('modal--choice');
}

export function showModal({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  prompt = false,
  promptValue = '',
  promptType = 'number',
  promptPlaceholder = 'Enter value',
  promptOptions = []
}) {
  closeActiveModal(); // a new question replaces (and cancels) any open one
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    setModalMode('confirm');
    document.getElementById('modal-title').textContent = title;
    const msgEl = document.getElementById('modal-message');
    if (prompt) {
      const numericAttrs = promptType === 'number' ? ' min="0" step="1"' : '';
      if (promptType === 'select' && Array.isArray(promptOptions) && promptOptions.length) {
        msgEl.innerHTML = `${escapeHtml(message)}<select id="modal-prompt-input" class="modal-prompt-input">
          ${promptOptions.map(opt => {
    const value = typeof opt === 'object' ? opt.value : opt;
    const label = typeof opt === 'object' ? opt.label : opt;
    return `<option value="${escapeHtml(value)}" ${String(promptValue) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}
        </select>`;
      } else {
        msgEl.innerHTML = `${escapeHtml(message)}<input type="${escapeHtml(promptType)}" id="modal-prompt-input" class="modal-prompt-input" value="${escapeHtml(promptValue)}"${numericAttrs} placeholder="${escapeHtml(promptPlaceholder)}">`;
      }
    } else {
      msgEl.textContent = message;
    }
    const actions = document.getElementById('modal-actions');
    actions.innerHTML = `
      <button type="button" class="btn btn-secondary" id="modal-cancel">${escapeHtml(cancelText)}</button>
      <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="modal-confirm">${escapeHtml(confirmText)}</button>
    `;
    overlay.classList.remove('hidden');
    if (prompt) document.getElementById('modal-prompt-input')?.focus();

    const close = (result) => {
      if (activeModalClose === cancel) activeModalClose = null;
      overlay.classList.add('hidden');
      resolve(result);
    };
    const cancel = () => close(prompt ? null : false);
    activeModalClose = cancel;

    document.getElementById('modal-cancel').onclick = cancel;
    document.getElementById('modal-confirm').onclick = () => {
      if (prompt) {
        const v = document.getElementById('modal-prompt-input')?.value;
        close(v);
      } else close(true);
    };
    overlay.onclick = (e) => { if (e.target === overlay) close(prompt ? null : false); };
  });
}

/** Multi-choice modal — returns chosen option id or null. */
export function showChoiceModal({ title, message, choices = [] }) {
  closeActiveModal();
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    setModalMode('choice');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    const actions = document.getElementById('modal-actions');
    actions.innerHTML = `
      <div class="modal-choice-list">
        ${choices.map(c => `
          <button type="button" class="btn ${c.primary ? 'btn-primary' : 'btn-secondary'} modal-choice-btn" data-choice="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>
        `).join('')}
      </div>
      <button type="button" class="btn btn-secondary modal-choice-cancel" id="modal-cancel">Not now</button>
    `;
    overlay.classList.remove('hidden');
    const close = (result) => {
      if (activeModalClose === cancel) activeModalClose = null;
      overlay.classList.add('hidden');
      resolve(result);
    };
    const cancel = () => close(null);
    activeModalClose = cancel;
    document.getElementById('modal-cancel').onclick = cancel;
    actions.querySelectorAll('[data-choice]').forEach(btn => {
      btn.onclick = () => close(btn.dataset.choice);
    });
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
  });
}

export const DEFAULT_TAGS = [
  'Essential', 'Vintage', 'Lessons', 'Recording', 'Live', 'Loaned Out'
];

export const DRIVER_CATEGORIES = new Set([
  'Audio Interface', 'Mixer', 'Control Surface', 'Keyboard'
]);

export function isDriverCategory(category) {
  return DRIVER_CATEGORIES.has(category);
}

export function fileUrl(relativePath) {
  if (!relativePath) return '#';
  return `/uploads/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

/** Tiny map pin — brand logo only (~20px), no label clutter. */
export function mapMarkerLogoHtml(pin, className = 'map-marker-logo') {
  const brand = { name: pin.brand || pin.name || '?', logo_path: pin.brand_logo_path };
  const initials = escapeHtml((brand.name || '').slice(0, 2).toUpperCase() || '?');
  if (!brand.logo_path) {
    return `<span class="map-marker-fallback" title="${escapeHtml(pin.name || '')}">${initials}</span>`;
  }
  const src = fileUrl(brand.logo_path);
  const alt = escapeHtml(pin.name || brand.name);
  return `<img src="${src}" alt="${alt}" class="${escapeHtml(className)}" loading="lazy"
    title="${alt}" data-fallback="marker" data-initials="${initials}">`;
}

/** Brand logo markup with initials fallback when image fails to load. */
export function brandLogoHtml(brand, className = 'brand-logo', { large = false, srcOverride = '' } = {}) {
  const initials = escapeHtml((brand.name || '').slice(0, 2).toUpperCase() || '?');
  if (!brand.logo_path) {
    return `<div class="brand-logo-fallback${large ? ' lg' : ''}">${initials}</div>`;
  }
  const src = srcOverride || fileUrl(brand.logo_path);
  const alt = escapeHtml(brand.name || '');
  const fbClass = `brand-logo-fallback${large ? ' lg' : ''} hidden`;
  return `<span class="brand-logo-wrap">
    <img src="${escapeHtml(src)}" alt="${alt}" class="${escapeHtml(className)}" loading="lazy" data-fallback="logo">
    <span class="${fbClass}">${initials}</span>
  </span>`;
}

export function buildDriverSearchUrl(brand, model) {
  const q = encodeURIComponent(`${brand} ${model} driver firmware download latest`.trim());
  return `https://www.google.com/search?q=${q}`;
}

export function buildValueEstimateUrl(brand, model, name) {
  const term = encodeURIComponent(`${brand} ${model || name} used for sale`.trim());
  return `https://www.google.com/search?q=site:reverb.com+OR+site:ebay.com+${term}`;
}

export function openLightbox(images, startIndex = 0) {
  const overlay = document.getElementById('lightbox-overlay');
  if (!overlay || !images.length) return;
  let idx = startIndex;
  const img = overlay.querySelector('.lightbox-img');
  const caption = overlay.querySelector('.lightbox-caption');
  const counter = overlay.querySelector('.lightbox-counter');

  const show = (i) => {
    idx = (i + images.length) % images.length;
    img.src = images[idx].url;
    img.alt = images[idx].name;
    caption.textContent = images[idx].name;
    counter.textContent = `${idx + 1} / ${images.length}`;
  };

  overlay.querySelector('.lightbox-prev').onclick = () => show(idx - 1);
  overlay.querySelector('.lightbox-next').onclick = () => show(idx + 1);
  overlay.querySelector('.lightbox-close').onclick = () => overlay.classList.add('hidden');
  overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add('hidden'); };

  show(startIndex);
  overlay.classList.remove('hidden');
}

/** Route wheel deltas to the nearest scrollable page ancestor (used when map zoom is locked). */
export function forwardWheelScroll(e) {
  let el = e.currentTarget?.parentElement;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    const canScrollY = el.scrollHeight > el.clientHeight
      && (style.overflowY === 'auto' || style.overflowY === 'scroll');
    const canScrollX = el.scrollWidth > el.clientWidth
      && (style.overflowX === 'auto' || style.overflowX === 'scroll');
    if (canScrollY || canScrollX) {
      if (canScrollY) el.scrollTop += e.deltaY;
      if (canScrollX) el.scrollLeft += e.deltaX;
      return;
    }
    el = el.parentElement;
  }
  window.scrollBy(e.deltaX, e.deltaY);
}
