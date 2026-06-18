import { api } from './api.js';
import { debounce, showToast, showModal, buildDriverSearchUrl, buildValueEstimateUrl } from './utils.js';
import { renderDashboard } from './views/dashboard.js';
import { renderInventory, renderItemDetail, bindLightbox } from './views/inventory.js';
import { renderItemForm, collectFormData, bindAutoEstimate, bindBrandSuggest } from './views/item-form.js';
import { renderBrandsPage, renderBrandItems } from './views/brands.js';
import { renderReports, renderInsurance, generatePdf } from './views/reports.js';
import { renderManuals } from './views/manuals.js';
import { renderAbout, renderBackup } from './views/about.js';

const state = {
  view: 'dashboard',
  meta: null,
  items: [],
  stats: null,
  filters: { sort: 'name' },
  selectedItemId: null,
  editItemId: null,
  manualSearch: '',
  brands: [],
  selectedBrand: null
};

const container = document.getElementById('view-container');

async function init() {
  try {
    const health = await api.health();
    document.getElementById('item-count-label').textContent = `${health.itemCount} items`;
    state.meta = await api.meta();
    showBackupBanner();
    setupNav();
    setupTheme();
    setupKeyboard();
    registerServiceWorker();
    await navigate('dashboard');
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Cannot connect to server</h3>
        <p>Start the server with <code>npm start</code> from the project folder, then refresh.</p>
        <p style="margin-top:1rem;color:var(--danger)">${err.message}</p>
      </div>`;
  }
}

function showBackupBanner() {
  const last = localStorage.getItem('lastBackup');
  const week = 7 * 24 * 60 * 60 * 1000;
  if (!last || Date.now() - parseInt(last, 10) > week) {
    document.getElementById('backup-banner').classList.remove('hidden');
  }
  document.getElementById('backup-banner-dismiss').onclick = () => {
    document.getElementById('backup-banner').classList.add('hidden');
  };
  document.getElementById('backup-banner-export').onclick = () => {
    api.exportJson();
    localStorage.setItem('lastBackup', String(Date.now()));
    document.getElementById('backup-banner').classList.add('hidden');
    showToast('Backup exported', 'success');
  };
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === 'item-form') {
        state.editItemId = null;
      }
      navigate(view);
    });
  });
}

function setupTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  document.getElementById('theme-icon').textContent = saved === 'dark' ? '☀' : '☾';
  document.getElementById('theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    document.getElementById('theme-icon').textContent = next === 'dark' ? '☀' : '☾';
  };
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'n') { e.preventDefault(); state.editItemId = null; navigate('item-form'); }
      if (e.key === 'f' && state.view === 'inventory') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
      if (e.key === 's' && state.view === 'item-form') {
        e.preventDefault();
        document.getElementById('item-form')?.requestSubmit();
      }
    }
    if (e.key === 'Escape') {
      document.getElementById('modal-overlay').classList.add('hidden');
      document.getElementById('lightbox-overlay')?.classList.add('hidden');
      if (state.view === 'item-detail') navigate('inventory');
    }
  });
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view ||
      (view === 'item-detail' && btn.dataset.view === 'inventory') ||
      (view === 'item-form' && btn.dataset.view === 'item-form') ||
      (view === 'brand-items' && btn.dataset.view === 'brands'));
  });
}

async function navigate(view, params = {}) {
  state.view = view;
  setActiveNav(view);
  container.innerHTML = '<p style="color:var(--text-muted);padding:2rem">Loading...</p>';

  try {
    switch (view) {
      case 'dashboard':
        state.stats = await api.stats();
        state.brands = await api.brands();
        container.innerHTML = renderDashboard(state.stats, state.brands);
        bindDashboardEvents();
        bindBrandFilterEvents();
        break;

      case 'brands':
        state.brands = await api.brands();
        container.innerHTML = renderBrandsPage(state.brands);
        bindBrandFilterEvents();
        bindBrandsPageEvents();
        break;

      case 'brand-items':
        state.selectedBrand = params.brand ?? state.selectedBrand ?? '';
        state.brands = state.brands.length ? state.brands : await api.brands();
        const brandQuery = state.selectedBrand ? { brand: state.selectedBrand, sort: 'name' } : { sort: 'name' };
        state.items = await api.items(brandQuery);
        let brandInfo = null;
        if (state.selectedBrand) {
          try { brandInfo = await api.brand(state.selectedBrand); } catch { /* custom */ }
        }
        container.innerHTML = renderBrandItems(state.selectedBrand, brandInfo, state.items);
        bindBrandItemsEvents();
        break;

      case 'inventory':
        state.items = await api.items(state.filters);
        container.innerHTML = renderInventory(state.items, state.meta, state.filters);
        bindInventoryEvents();
        break;

      case 'item-detail':
        const item = await api.item(params.id || state.selectedItemId);
        container.innerHTML = renderItemDetail(item);
        bindDetailEvents(item);
        bindLightbox(item.photos || []);
        break;

      case 'item-form':
        const editItem = state.editItemId ? await api.item(state.editItemId) : null;
        state.brands = state.meta?.brands?.length ? state.meta.brands : await api.brands();
        state.meta = { ...state.meta, brands: state.brands };
        container.innerHTML = renderItemForm(editItem, state.meta);
        bindFormEvents();
        break;

      case 'manuals':
        const manuals = await api.manuals();
        container.innerHTML = renderManuals(manuals, state.manualSearch);
        bindManualEvents(manuals);
        break;

      case 'reports':
        state.items = await api.items({ sort: 'name' });
        state.stats = state.stats || await api.stats();
        container.innerHTML = renderReports(state.items, state.stats);
        bindReportEvents();
        break;

      case 'insurance':
        state.items = await api.items({ sort: 'value' });
        container.innerHTML = renderInsurance(state.items);
        bindInsuranceEvents();
        break;

      case 'backup':
        container.innerHTML = renderBackup();
        bindBackupEvents();
        break;

      case 'about':
        container.innerHTML = renderAbout();
        break;
    }

    const health = await api.health();
    document.getElementById('item-count-label').textContent = `${health.itemCount} items`;
    document.getElementById('main-content').focus();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    showToast(err.message, 'error');
  }
}

function bindDashboardEvents() {
  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });
}

async function fetchLogoForBrand(brandName) {
  if (!brandName?.trim()) return;
  showToast(`Looking up logo for ${brandName}...`, 'info');
  try {
    const result = await api.fetchBrandLogo(brandName);
    if (result.ok && result.logo_path && !result.cached) {
      showToast(`Logo added for ${brandName}`, 'success');
      state.brands = await api.brands();
      if (state.meta) state.meta.brands = state.brands;
      if (['dashboard', 'brands', 'brand-items'].includes(state.view)) navigate(state.view);
    } else if (!result.ok && result.reason === 'not_found') {
      showToast(`No web logo found for ${brandName} — upload one in Brands`, 'info');
    }
  } catch { /* server also fetches in background */ }
}

function bindBrandFilterEvents() {
  container.querySelectorAll('[data-action="filter-brand"]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedBrand = btn.dataset.brand || null;
      navigate('brand-items', { brand: state.selectedBrand });
    });
  });
}

function bindBrandsPageEvents() {
  container.querySelector('[data-action="fetch-all-logos"]')?.addEventListener('click', async () => {
    showToast('Fetching logos for all brands in your inventory...', 'info');
    try {
      const r = await api.fetchAllBrandLogos(true);
      showToast(`Fetched ${r.fetched} logos (${r.failed} not found)`, r.fetched ? 'success' : 'info');
      state.brands = r.brands || await api.brands();
      navigate('brands');
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelectorAll('[data-action="fetch-logo"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      fetchLogoForBrand(btn.dataset.brand).then(() => navigate('brands'));
    });
  });

  document.getElementById('custom-brand-logo')?.addEventListener('change', (e) => {
    const label = document.getElementById('custom-brand-file-label');
    if (label) label.textContent = e.target.files[0]?.name || '';
  });

  document.getElementById('brand-logo-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('custom-brand-name').value.trim();
    const file = document.getElementById('custom-brand-logo').files[0];
    if (!name || !file) return showToast('Brand name and logo image required', 'error');
    try {
      await api.uploadBrandLogo(name, file);
      showToast(`Logo uploaded for ${name}`, 'success');
      navigate('brands');
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function bindBrandItemsEvents() {
  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });
}

function bindInventoryEvents() {
  const doSearch = debounce(() => {
    state.filters.q = document.getElementById('search-input').value;
    state.filters.category = document.getElementById('filter-category').value;
    state.filters.location = document.getElementById('filter-location').value;
    state.filters.condition = document.getElementById('filter-condition').value;
    state.filters.tag = document.getElementById('filter-tag').value;
    state.filters.min_value = document.getElementById('filter-min-value').value;
    state.filters.max_value = document.getElementById('filter-max-value').value;
    state.filters.sort = document.getElementById('filter-sort').value;
    navigate('inventory');
  }, 350);

  document.getElementById('search-input')?.addEventListener('input', doSearch);
  ['filter-category', 'filter-location', 'filter-condition', 'filter-tag', 'filter-sort'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', doSearch);
  });
  ['filter-min-value', 'filter-max-value'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', doSearch);
  });
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    state.filters = { sort: 'name' };
    navigate('inventory');
  });

  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });

  container.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
}

function bindDetailEvents(item) {
  container.querySelector('[data-nav="inventory"]')?.addEventListener('click', () => navigate('inventory'));
  container.querySelector('[data-action="edit-item"]')?.addEventListener('click', () => {
    state.editItemId = item.id;
    navigate('item-form');
  });
  container.querySelector('[data-action="delete-item"]')?.addEventListener('click', async () => {
    const ok = await showModal({
      title: 'Delete Item',
      message: `Are you sure you want to delete "${item.name}"? This cannot be undone.`,
      confirmText: 'Delete', danger: true
    });
    if (ok) {
      await api.deleteItem(item.id);
      showToast('Item deleted', 'success');
      navigate('inventory');
    }
  });

  container.querySelector('[data-action="auto-estimate"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    window.open(buildValueEstimateUrl(btn.dataset.brand, btn.dataset.model, btn.dataset.name), '_blank');
    const val = await showModal({
      title: 'Enter Replacement Value',
      message: 'After checking Reverb/eBay listings, enter the estimated replacement value:',
      confirmText: 'Save to Item', cancelText: 'Skip', prompt: true, promptValue: item.replacement_value
    });
    if (val !== null && val !== false) {
      await api.updateItem(item.id, {
        ...item, tags: item.tags.map(t => t.name),
        replacement_value: val,
        replacement_value_note: item.replacement_value_note || `Reverb/eBay estimate (${new Date().toLocaleDateString()})`
      });
      showToast('Replacement value updated', 'success');
      navigate('item-detail', { id: item.id });
    }
  });

  container.querySelector('[data-action="check-updates"]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    window.open(buildDriverSearchUrl(btn.dataset.brand, btn.dataset.model), '_blank');
    showToast('Opened driver/firmware search in browser', 'info');
  });

  container.querySelector('[data-action="upload-photos"]')?.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    try {
      await api.uploadPhotos(item.id, files);
      showToast(`${files.length} photo(s) uploaded`, 'success');
      navigate('item-detail', { id: item.id });
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelector('[data-action="upload-manual"]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await api.uploadManual(item.id, file);
      showToast('Document uploaded', 'success');
      navigate('item-detail', { id: item.id });
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelector('[data-action="upload-software"]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const version = prompt('Version (optional):') || '';
    const description = prompt('Description (optional):') || '';
    try {
      await api.uploadSoftware(item.id, file, version, description);
      showToast('Software file archived', 'success');
      navigate('item-detail', { id: item.id });
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('software-archive-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('sw-url').value;
    const version = document.getElementById('sw-version').value;
    const description = document.getElementById('sw-desc').value;
    try {
      showToast('Downloading from manufacturer URL...', 'info');
      await api.archiveSoftware(item.id, url, version, description);
      showToast('Software archived successfully', 'success');
      navigate('item-detail', { id: item.id });
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelectorAll('[data-action="delete-attachment"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showModal({ title: 'Remove File', message: 'Remove this file permanently?', confirmText: 'Remove', danger: true });
      if (ok) {
        await api.deleteAttachment(btn.dataset.id);
        showToast('File removed', 'success');
        navigate('item-detail', { id: item.id });
      }
    });
  });
}

function bindFormEvents() {
  const tagContainer = document.getElementById('tag-container');
  const tagInput = document.getElementById('tag-input');

  function addTag(name) {
    const n = name.trim();
    if (!n) return;
    const existing = [...tagContainer.querySelectorAll('.tag-chip')].map(c => c.dataset.tag.toLowerCase());
    if (existing.includes(n.toLowerCase())) return;
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.dataset.tag = n;
    chip.innerHTML = `${n} <button type="button" data-remove-tag>&times;</button>`;
    tagContainer.insertBefore(chip, tagInput);
    tagInput.value = '';
  }

  tagInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput.value); }
    if (e.key === 'Backspace' && !tagInput.value) {
      const chips = tagContainer.querySelectorAll('.tag-chip');
      if (chips.length) chips[chips.length - 1].remove();
    }
  });

  tagContainer?.addEventListener('click', (e) => {
    if (e.target.dataset.removeTag !== undefined) e.target.closest('.tag-chip')?.remove();
  });

  container.querySelectorAll('[data-add-tag]').forEach(btn => {
    btn.addEventListener('click', () => addTag(btn.dataset.addTag));
  });

  document.getElementById('item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = collectFormData();
    const id = document.getElementById('item-id').value;
    try {
      if (id) {
        await api.updateItem(id, data);
        showToast('Item updated', 'success');
        if (data.brand) fetchLogoForBrand(data.brand);
        state.selectedItemId = id;
        navigate('item-detail', { id });
      } else {
        const created = await api.createItem(data);
        showToast('Item added', 'success');
        if (data.brand) fetchLogoForBrand(data.brand);
        state.selectedItemId = created.id;
        navigate('item-detail', { id: created.id });
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelector('[data-nav="inventory"]')?.addEventListener('click', () => navigate('inventory'));
  bindAutoEstimate();
  bindBrandSuggest(state.brands || state.meta?.brands || []);
}

function bindManualEvents(manuals) {
  const doSearch = debounce(() => {
    state.manualSearch = document.getElementById('manual-search').value;
    container.innerHTML = renderManuals(manuals, state.manualSearch);
    bindManualEvents(manuals);
  }, 300);
  document.getElementById('manual-search')?.addEventListener('input', doSearch);

  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });
}

function bindReportEvents() {
  const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  document.getElementById('export-json')?.addEventListener('click', () => api.exportJson());
  document.getElementById('export-csv')?.addEventListener('click', () => api.exportCsv());

  const makeFullPdf = () => {
    const rows = state.items.map(i => [
      i.name, i.category, `${i.brand} ${i.model}`, i.serial_number,
      i.location, i.condition, fmt(i.purchase_price), fmt(i.replacement_value)
    ]);
    generatePdf('Full Inventory', ['Name', 'Category', 'Brand/Model', 'Serial', 'Location', 'Condition', 'Purchase', 'Replacement'], rows, {
      count: state.items.length,
      purchase: fmt(state.stats.totals.total_purchase),
      replacement: fmt(state.stats.totals.total_replacement)
    });
  };

  document.getElementById('export-pdf-full')?.addEventListener('click', makeFullPdf);

  document.getElementById('export-pdf-category')?.addEventListener('click', () => {
    const grouped = {};
    state.items.forEach(i => { (grouped[i.category] = grouped[i.category] || []).push(i); });
    const rows = [];
    Object.entries(grouped).sort().forEach(([cat, items]) => {
      rows.push([cat, '', '', '', '', '', '', '']);
      items.forEach(i => rows.push([i.name, i.category, i.brand, i.serial_number, i.location, i.condition, fmt(i.purchase_price), fmt(i.replacement_value)]));
    });
    generatePdf('By Category', ['Name', 'Category', 'Brand', 'Serial', 'Location', 'Condition', 'Purchase', 'Replacement'], rows);
  });

  document.getElementById('export-pdf-location')?.addEventListener('click', () => {
    const rows = state.items.map(i => [i.location, i.name, i.category, i.serial_number, i.condition, fmt(i.replacement_value)]);
    generatePdf('By Location', ['Location', 'Name', 'Category', 'Serial', 'Condition', 'Replacement'], rows);
  });

  document.getElementById('export-pdf-highvalue')?.addEventListener('click', () => {
    const threshold = parseFloat(document.getElementById('high-value-threshold')?.value) || 500;
    const high = state.items.filter(i => i.replacement_value >= threshold);
    const rows = high.map(i => [i.name, i.category, i.brand, i.serial_number, fmt(i.replacement_value)]);
    generatePdf(`High Value Over ${fmt(threshold)}`, ['Name', 'Category', 'Brand', 'Serial', 'Value'], rows);
  });
}

function bindInsuranceEvents() {
  document.getElementById('export-insurance-pdf')?.addEventListener('click', () => {
    const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
    const rows = state.items.map(i => [
      i.name, i.brand, i.model, i.serial_number, i.year, i.location,
      i.condition, fmt(i.purchase_price), fmt(i.replacement_value * i.quantity)
    ]);
    const total = state.items.reduce((s, i) => s + i.replacement_value * i.quantity, 0);
    generatePdf('Insurance Report', ['Name', 'Brand', 'Model', 'Serial', 'Year', 'Location', 'Condition', 'Purchase', 'Replacement'], rows, {
      count: state.items.length,
      purchase: '',
      replacement: fmt(total)
    });
  });
}

function bindBackupEvents() {
  document.getElementById('backup-export-json')?.addEventListener('click', () => {
    api.exportJson();
    localStorage.setItem('lastBackup', String(Date.now()));
    showToast('JSON exported', 'success');
  });
  document.getElementById('backup-export-sql')?.addEventListener('click', () => {
    api.exportSql();
    localStorage.setItem('lastBackup', String(Date.now()));
    showToast('SQL dump exported', 'success');
  });
  document.getElementById('backup-export-csv')?.addEventListener('click', () => api.exportCsv());

  document.getElementById('import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const replace = document.getElementById('import-replace').checked;
      if (replace) {
        const ok = await showModal({
          title: 'Replace All Data?',
          message: 'This will delete all existing items and replace them with the import. Continue?',
          confirmText: 'Replace All',
          danger: true
        });
        if (!ok) return;
      }
      const result = await api.importJson(data, replace);
      document.getElementById('import-status').textContent = `Imported ${result.imported} items successfully.`;
      showToast(`Imported ${result.imported} items`, 'success');
      navigate('dashboard');
    } catch (err) {
      document.getElementById('import-status').textContent = `Error: ${err.message}`;
      showToast(err.message, 'error');
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav && !nav.closest('form')) {
    e.preventDefault();
    navigate(nav.dataset.nav);
  }
});

init();