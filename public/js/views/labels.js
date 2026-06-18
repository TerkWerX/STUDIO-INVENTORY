import { escapeHtml } from '../utils.js';
import { LABEL_SIZES, loadLabelSettings, saveLabelSettings, getScanUrl } from '../lib/label-settings.js';
import { getDymoStatus, printOwnerLabel, renderLabelPreview, printLabelFallback } from '../lib/dymo-labels.js';

export function renderLabelsPage(items, settings, dymoStatus, preselectedId = null) {
  const sizeOptions = Object.values(LABEL_SIZES).map(s =>
    `<option value="${s.id}" ${settings.labelSize === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');

  const printerOptions = (dymoStatus.printers || []).map(p =>
    `<option value="${escapeHtml(p)}" ${settings.printerName === p ? 'selected' : ''}>${escapeHtml(p)}</option>`
  ).join('');

  const dymoOk = dymoStatus.available && dymoStatus.printers?.length;
  const statusClass = dymoOk ? 'status-on' : 'status-off';
  const statusText = dymoOk
    ? `DYMO ready — ${dymoStatus.printers.length} printer(s) found`
    : (dymoStatus.error || 'DYMO Connect not detected — use browser print fallback');

  return `
    <h2 class="page-title">Owner Labels</h2>
    <p class="page-subtitle">Print QR labels for your gear — scan with any phone to open manuals, software, and item details</p>

    <div class="card label-settings-card">
      <h3 class="section-title">Label Settings</h3>
      <div class="form-grid label-settings-grid">
        <div class="form-group">
          <label for="label-studio-name">Studio / Owner Name</label>
          <input type="text" id="label-studio-name" value="${escapeHtml(settings.studioName)}" placeholder="My Studio">
        </div>
        <div class="form-group">
          <label for="label-base-url">QR Base URL <span class="text-muted-sm">(your NUC IP for phone scans)</span></label>
          <input type="url" id="label-base-url" value="${escapeHtml(settings.baseUrl)}" placeholder="http://192.168.1.50:3847">
        </div>
        <div class="form-group">
          <label for="label-size">Label Size</label>
          <select id="label-size">${sizeOptions}</select>
          <p class="text-muted-sm" id="label-size-hint">${escapeHtml(LABEL_SIZES[settings.labelSize]?.description || '')}</p>
        </div>
        <div class="form-group">
          <label for="label-printer">DYMO Printer</label>
          <select id="label-printer">
            <option value="">Auto-detect LabelWriter</option>
            ${printerOptions}
          </select>
          <p class="${statusClass}" style="margin-top:0.5rem">${escapeHtml(statusText)}</p>
        </div>
      </div>
      <p class="text-muted-sm label-dymo-note">
        Requires <strong>DYMO Connect</strong> (or DYMO Label software) with your LabelWriter 450 Turbo connected.
        <a href="https://www.dymo.com/support" target="_blank" rel="noopener">DYMO support</a>
      </p>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="section-title">Select Gear</h3>
        <div class="btn-group">
          <button type="button" class="btn btn-ghost btn-sm" data-action="label-select-all">Select All</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="label-select-none">Clear</button>
        </div>
      </div>

      ${items.length ? `
        <div class="label-item-list">
          ${items.map(item => `
            <label class="label-item-row ${preselectedId == item.id ? 'label-item-selected' : ''}">
              <input type="checkbox" class="label-item-check" value="${item.id}"
                ${preselectedId == item.id ? 'checked' : ''}>
              <div class="label-item-info">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="text-muted-sm">${escapeHtml(item.brand)} ${escapeHtml(item.model)}${item.serial_number ? ` · S/N ${escapeHtml(item.serial_number)}` : ''}</span>
              </div>
              <button type="button" class="btn btn-sm btn-ghost" data-action="label-preview-one" data-id="${item.id}">Preview</button>
            </label>
          `).join('')}
        </div>

        <div class="label-actions">
          <button type="button" class="btn btn-primary" data-action="label-print-selected">Print Selected (DYMO)</button>
          <button type="button" class="btn btn-secondary" data-action="label-print-fallback">Print Selected (Browser)</button>
        </div>
      ` : `
        <div class="empty-state">
          <h3>No items yet</h3>
          <p>Add gear to your inventory first, then print owner labels.</p>
          <button type="button" class="btn btn-primary" data-nav="item-form" style="margin-top:1rem">Add Item</button>
        </div>
      `}
    </div>

    <div id="label-preview-panel" class="card label-preview-panel hidden">
      <h3 class="section-title">Label Preview</h3>
      <p class="text-muted-sm" id="label-preview-name"></p>
      <p class="text-muted-sm" id="label-preview-url"></p>
      <div id="label-preview-image-wrap" class="label-preview-image-wrap"></div>
    </div>
  `;
}

export function readLabelSettingsFromForm() {
  return {
    studioName: document.getElementById('label-studio-name')?.value.trim() || 'Studio Inventory',
    baseUrl: document.getElementById('label-base-url')?.value.trim().replace(/\/$/, '') || window.location.origin,
    labelSize: document.getElementById('label-size')?.value || '30252',
    printerName: document.getElementById('label-printer')?.value || ''
  };
}

export function getSelectedLabelItems(allItems) {
  const ids = new Set(
    [...document.querySelectorAll('.label-item-check:checked')].map(el => el.value)
  );
  return allItems.filter(i => ids.has(String(i.id)));
}

export function bindLabelsPageEvents({ items, onToast, onRefreshStatus }) {
  const persistSettings = () => saveLabelSettings(readLabelSettingsFromForm());

  ['label-studio-name', 'label-base-url', 'label-size', 'label-printer'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', persistSettings);
    document.getElementById(id)?.addEventListener('input', persistSettings);
  });

  document.getElementById('label-size')?.addEventListener('change', (e) => {
    const hint = document.getElementById('label-size-hint');
    if (hint) hint.textContent = LABEL_SIZES[e.target.value]?.description || '';
  });

  document.querySelector('[data-action="label-select-all"]')?.addEventListener('click', () => {
    document.querySelectorAll('.label-item-check').forEach(c => { c.checked = true; });
  });
  document.querySelector('[data-action="label-select-none"]')?.addEventListener('click', () => {
    document.querySelectorAll('.label-item-check').forEach(c => { c.checked = false; });
  });

  const printBatch = async (useDymo) => {
    const selected = getSelectedLabelItems(items);
    if (!selected.length) return onToast('Select at least one item', 'error');

    const settings = readLabelSettingsFromForm();
    saveLabelSettings(settings);

    let printed = 0;
    for (const item of selected) {
      const opts = {
        ...settings,
        scanUrl: getScanUrl(item.id, settings.baseUrl)
      };
      try {
        if (useDymo) {
          await printOwnerLabel(item, opts);
        } else {
          printLabelFallback(item, opts);
          await new Promise(r => setTimeout(r, 600));
        }
        printed++;
      } catch (err) {
        onToast(`${item.name}: ${err.message}`, 'error');
        if (useDymo) break;
      }
    }
    if (printed) onToast(`Printed ${printed} label${printed !== 1 ? 's' : ''}`, 'success');
  };

  document.querySelector('[data-action="label-print-selected"]')?.addEventListener('click', () => printBatch(true));
  document.querySelector('[data-action="label-print-fallback"]')?.addEventListener('click', () => printBatch(false));

  document.querySelectorAll('[data-action="label-preview-one"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => String(i.id) === btn.dataset.id);
      if (!item) return;
      const settings = readLabelSettingsFromForm();
      const panel = document.getElementById('label-preview-panel');
      const url = getScanUrl(item.id, settings.baseUrl);
      document.getElementById('label-preview-name').textContent = item.name;
      document.getElementById('label-preview-url').textContent = `QR → ${url}`;
      panel.classList.remove('hidden');

      const wrap = document.getElementById('label-preview-image-wrap');
      wrap.innerHTML = '<p class="text-muted">Generating preview…</p>';
      try {
        const imgSrc = await renderLabelPreview(item, { ...settings, scanUrl: url });
        wrap.innerHTML = `<img src="${imgSrc}" alt="Label preview" class="label-preview-img">`;
      } catch {
        wrap.innerHTML = `<p class="text-muted">DYMO preview unavailable. QR will link to:<br><code>${escapeHtml(url)}</code></p>`;
      }
    });
  });

  if (onRefreshStatus) {
    document.getElementById('label-printer')?.addEventListener('focus', onRefreshStatus);
  }
}

export async function printSingleItemLabel(item, onToast) {
  const settings = loadLabelSettings();
  try {
    await printOwnerLabel(item, {
      ...settings,
      scanUrl: getScanUrl(item.id, settings.baseUrl)
    });
    onToast(`Label sent to DYMO for ${item.name}`, 'success');
  } catch (err) {
    onToast(err.message, 'error');
    try {
      printLabelFallback(item, {
        ...settings,
        scanUrl: getScanUrl(item.id, settings.baseUrl)
      });
      onToast('Opened browser print fallback', 'info');
    } catch (e2) {
      onToast(e2.message, 'error');
    }
  }
}