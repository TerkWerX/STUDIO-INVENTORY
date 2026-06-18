import { api } from './api.js';
import { debounce, showToast, showModal, buildDriverSearchUrl, buildValueEstimateUrl } from './utils.js';
import { renderDashboard } from './views/dashboard.js';
import {
  renderInventory, renderItemDetail, bindLightbox, bindPhotoDropZone,
  cleanupPhotoZoneListeners, filterImageFiles
} from './views/inventory.js';
import { renderItemForm, collectFormData, bindAutoEstimate, bindBrandSuggest } from './views/item-form.js';
import { renderBrandsPage, renderBrandItems } from './views/brands.js';
import { renderReports, renderInsurance, generatePdf } from './views/reports.js';
import { renderManuals } from './views/manuals.js';
import { renderAbout, renderBackup } from './views/about.js';
import { renderLabelsPage, bindLabelsPageEvents, printSingleItemLabel } from './views/labels.js';
import { renderBinderPage, getBinderOptionsFromDom, getSelectedBinderItemIds } from './views/binder.js';
import { renderStudioView, rackItemsPayload, chainItemsPayload } from './views/studio-view.js';
import { printBinderDocument, printBinderItems, openManualForPrint } from './lib/binder-print.js';
import { getDymoStatus } from './lib/dymo-labels.js';
import { loadLabelSettings } from './lib/label-settings.js';

const state = {
  view: 'dashboard',
  meta: null,
  items: [],
  stats: null,
  filters: { sort: 'name' },
  selectedItemId: null,
  editItemId: null,
  manualSearch: '',
  manualFtsQuery: '',
  manualFtsResults: null,
  pdfSearchEnabled: true,
  brands: [],
  selectedBrand: null,
  labelPreselectId: null,
  parentItemId: null,
  studioTab: 'rooms'
};

const container = document.getElementById('view-container');

async function init() {
  try {
    const health = await api.health();
    updateSidebarVersion(health);
    state.meta = await api.meta();
    showBackupBanner();
    checkForAppUpdate();
    setupNav();
    setupTheme();
    setupKeyboard();
    registerServiceWorker();

    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const id = params.get('id');
    const edit = params.get('edit');
    if (edit || view || id) history.replaceState(null, '', '/');

    if (edit) {
      state.editItemId = edit;
      await navigate('item-form');
    } else if (view === 'item-detail' && id) {
      state.selectedItemId = id;
      await navigate('item-detail', { id });
    } else if (view === 'item-form') {
      await navigate('item-form');
    } else if (view === 'labels') {
      if (id) state.labelPreselectId = id;
      await navigate('labels');
    } else {
      await navigate('dashboard');
    }
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Cannot connect to server</h3>
        <p>Start the server with <code>npm start</code> from the project folder, then refresh.</p>
        <p style="margin-top:1rem;color:var(--danger)">${err.message}</p>
      </div>`;
  }
}

function updateSidebarVersion(health) {
  const label = document.getElementById('item-count-label');
  const version = health.version ? `v${health.version}` : '';
  label.textContent = version
    ? `${health.itemCount} items · ${version}`
    : `${health.itemCount} items`;
}

async function checkForAppUpdate() {
  try {
    const info = await api.updateCheck();
    if (!info.updateAvailable || !info.latestVersion) return;

    const dismissed = localStorage.getItem('dismissedUpdateVersion');
    if (dismissed === info.latestVersion) return;

    const banner = document.getElementById('update-banner');
    const text = document.getElementById('update-banner-text');
    text.textContent = `Studio Inventory v${info.latestVersion} is available (you have v${info.currentVersion}). Your inventory data is kept when you install the update.`;

    document.getElementById('update-banner-download').onclick = () => {
      window.open(info.releaseUrl, '_blank', 'noopener');
    };
    document.getElementById('update-banner-dismiss').onclick = () => {
      localStorage.setItem('dismissedUpdateVersion', info.latestVersion);
      banner.classList.add('hidden');
    };

    banner.classList.remove('hidden');
  } catch {
    /* offline or GitHub unreachable */
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
      (view === 'brand-items' && btn.dataset.view === 'brands') ||
      (view === 'labels' && btn.dataset.view === 'labels'));
  });
}

async function navigate(view, params = {}) {
  if (view !== 'item-detail') cleanupPhotoZoneListeners();
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

      case 'studio-view':
        const [map, racks, chains, allItems] = await Promise.all([
          api.studioMap(),
          api.racks(),
          api.signalChains(),
          api.items({ sort: 'name', include_accessories: '1' })
        ]);
        state.items = allItems;
        container.innerHTML = renderStudioView({ map, racks, chains, items: allItems }, state.studioTab);
        bindStudioViewEvents({ map, racks, chains, items: allItems });
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
        state.items = await api.items({
          ...state.filters,
          include_accessories: state.filters.show_accessories ? '1' : undefined
        });
        container.innerHTML = renderInventory(state.items, state.meta, state.filters);
        bindInventoryEvents();
        break;

      case 'item-detail':
        const item = await api.item(params.id || state.selectedItemId);
        container.innerHTML = renderItemDetail(item);
        bindDetailEvents(item);
        bindPhotoDropZone(container, item, {
          onUpload: async (itemId, files) => {
            await api.uploadPhotos(itemId, files);
            showToast(`${files.length} photo(s) uploaded`, 'success');
            navigate('item-detail', { id: itemId });
          },
          onError: (msg) => showToast(msg, 'error')
        });
        bindLightbox(item.photos || []);
        break;

      case 'item-form': {
        const editItem = state.editItemId
          ? await api.item(state.editItemId)
          : (state.parentItemId ? { parent_item_id: state.parentItemId } : null);
        const [parentItems, brands] = await Promise.all([
          api.items({ sort: 'name' }),
          state.meta?.brands?.length ? Promise.resolve(state.meta.brands) : api.brands()
        ]);
        state.brands = brands;
        state.meta = { ...state.meta, brands, parentItems };
        container.innerHTML = renderItemForm(editItem, state.meta);
        state.parentItemId = null;
        bindFormEvents();
        break;
      }

      case 'manuals': {
        const [manuals, guestInfo] = await Promise.all([api.manuals(), api.guestSettings()]);
        state.pdfSearchEnabled = guestInfo.pdfSearchEnabled !== false;
        container.innerHTML = renderManuals(manuals, {
          searchQuery: state.manualSearch,
          ftsQuery: state.manualFtsQuery,
          ftsResults: state.manualFtsResults,
          pdfSearchEnabled: state.pdfSearchEnabled
        });
        bindManualEvents(manuals);
        break;
      }

      case 'labels':
        state.items = await api.items({ sort: 'name' });
        const dymoStatus = await getDymoStatus();
        const labelSettings = loadLabelSettings();
        if (!labelSettings.baseUrl) labelSettings.baseUrl = window.location.origin;
        container.innerHTML = renderLabelsPage(state.items, labelSettings, dymoStatus, state.labelPreselectId);
        bindLabelsPageEvents({
          items: state.items,
          onToast: showToast,
          onRefreshStatus: async () => {
            const s = await getDymoStatus();
            if (!s.printers?.length) return;
          }
        });
        state.labelPreselectId = null;
        break;

      case 'binder':
        state.items = await api.items({ sort: 'name' });
        state.stats = state.stats || await api.stats();
        const binderSettings = loadLabelSettings();
        container.innerHTML = renderBinderPage(state.items, state.stats, binderSettings.studioName);
        bindBinderEvents();
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

      case 'backup': {
        const guestSettings = await api.guestSettings();
        container.innerHTML = renderBackup(guestSettings);
        bindBackupEvents();
        break;
      }

      case 'about':
        container.innerHTML = renderAbout();
        break;
    }

    const health = await api.health();
    updateSidebarVersion(health);
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
  container.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
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
    state.filters.show_accessories = document.getElementById('filter-show-accessories')?.checked || false;
    navigate('inventory');
  }, 350);

  document.getElementById('search-input')?.addEventListener('input', doSearch);
  ['filter-category', 'filter-location', 'filter-condition', 'filter-tag', 'filter-sort'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', doSearch);
  });
  document.getElementById('filter-show-accessories')?.addEventListener('change', doSearch);
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

  container.querySelector('[data-action="add-accessory"]')?.addEventListener('click', () => {
    state.editItemId = null;
    state.parentItemId = item.id;
    navigate('item-form');
  });

  container.querySelector('[data-action="view-parent"]')?.addEventListener('click', (e) => {
    state.selectedItemId = e.currentTarget.dataset.id;
    navigate('item-detail', { id: e.currentTarget.dataset.id });
  });

  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });
  container.querySelector('[data-action="print-binder-page"]')?.addEventListener('click', () => {
    try {
      const settings = loadLabelSettings();
      printBinderItems([item], { studioName: settings.studioName });
      showToast('Binder page opened — use Print in the dialog', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelector('[data-action="print-label"]')?.addEventListener('click', async () => {
    await printSingleItemLabel(item, showToast);
  });

  container.querySelectorAll('[data-action="print-manual-pdf"]').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        openManualForPrint(btn.dataset.path, btn.dataset.name);
        showToast('Manual opened — click Print Manual when ready', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  document.getElementById('maintenance-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.addMaintenance(item.id, {
        service_date: document.getElementById('maint-date').value,
        service_type: document.getElementById('maint-type').value,
        note: document.getElementById('maint-note').value
      });
      showToast('Service entry added', 'success');
      navigate('item-detail', { id: item.id });
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelectorAll('[data-action="delete-maintenance"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.deleteMaintenance(btn.dataset.id);
        showToast('Entry removed', 'success');
        navigate('item-detail', { id: item.id });
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

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
    const files = filterImageFiles(e.target.files);
    if (!files.length) return showToast('No image files selected', 'error');
    try {
      await api.uploadPhotos(item.id, files);
      showToast(`${files.length} photo(s) uploaded`, 'success');
      navigate('item-detail', { id: item.id });
    } catch (err) { showToast(err.message, 'error'); }
    e.target.value = '';
  });

  container.querySelector('[data-action="upload-receipt"]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await api.uploadReceipt(item.id, file);
      showToast('Receipt uploaded', 'success');
      navigate('item-detail', { id: item.id });
    } catch (err) { showToast(err.message, 'error'); }
    e.target.value = '';
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

        const printPage = await showModal({
          title: 'Print binder page?',
          message: `"${data.name}" was added. Print a gear page now for your 3-ring binder?`,
          confirmText: 'Print Page',
          cancelText: 'Not Now'
        });
        if (printPage) {
          try {
            const settings = loadLabelSettings();
            printBinderItems([created], { studioName: settings.studioName });
            showToast('Binder page opened', 'info');
          } catch (err) {
            showToast(err.message, 'error');
          }
        }

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
  const rerender = () => {
    container.innerHTML = renderManuals(manuals, {
      searchQuery: state.manualSearch,
      ftsQuery: state.manualFtsQuery,
      ftsResults: state.manualFtsResults,
      pdfSearchEnabled: state.pdfSearchEnabled
    });
    bindManualEvents(manuals);
  };

  const doSearch = debounce(() => {
    state.manualSearch = document.getElementById('manual-search').value;
    rerender();
  }, 300);
  document.getElementById('manual-search')?.addEventListener('input', doSearch);

  const runFtsSearch = async () => {
    const q = document.getElementById('manual-fts-search')?.value?.trim() || '';
    state.manualFtsQuery = q;
    if (q.length < 2) {
      state.manualFtsResults = [];
      rerender();
      return;
    }
    try {
      state.manualFtsResults = await api.searchManuals(q);
      rerender();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('manual-fts-go')?.addEventListener('click', runFtsSearch);
  document.getElementById('manual-fts-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runFtsSearch(); }
  });

  document.getElementById('manual-reindex')?.addEventListener('click', async () => {
    const ok = await showModal({
      title: 'Reindex All PDF Manuals?',
      message: 'This extracts text from every PDF manual for full-text search. It may take a minute on large libraries.',
      confirmText: 'Reindex',
      cancelText: 'Cancel'
    });
    if (!ok) return;
    try {
      showToast('Reindexing PDF manuals...', 'info');
      const result = await api.reindexManuals();
      showToast(`Indexed ${result.indexed || 0} manual(s)`, 'success');
      if (state.manualFtsQuery.length >= 2) {
        state.manualFtsResults = await api.searchManuals(state.manualFtsQuery);
      }
      rerender();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });

  container.querySelectorAll('[data-action="print-manual-pdf"]').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        openManualForPrint(btn.dataset.path, btn.dataset.name);
        showToast('Manual opened — click Print Manual when ready', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function bindBinderEvents() {
  const itemById = (id) => state.items.find(i => String(i.id) === String(id));

  const runPrint = (items, partial = {}) => {
    if (!items.length) {
      showToast('No items selected', 'error');
      return;
    }
    try {
      const opts = { ...getBinderOptionsFromDom(), ...partial, items, stats: state.stats };
      printBinderDocument(opts);
      showToast(`Opened ${items.length} page${items.length !== 1 ? 's' : ''} for printing`, 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('binder-print-full')?.addEventListener('click', () => {
    runPrint(state.items, { includeCover: true, includeIndex: true });
  });

  document.getElementById('binder-print-selected')?.addEventListener('click', () => {
    const ids = getSelectedBinderItemIds();
    const items = ids.map(itemById).filter(Boolean);
    runPrint(items, { includeCover: false, includeIndex: false });
  });

  document.getElementById('binder-print-index')?.addEventListener('click', () => {
    if (!state.items.length) {
      showToast('No items in inventory', 'error');
      return;
    }
    try {
      const opts = getBinderOptionsFromDom();
      printBinderDocument({
        items: state.items,
        stats: state.stats,
        studioName: opts.studioName,
        includeCover: false,
        includeIndex: true,
        includeItemPages: false,
        includePhotos: false
      });
      showToast('Index page opened for printing', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('binder-select-all')?.addEventListener('click', () => {
    document.querySelectorAll('.binder-item-check').forEach(el => { el.checked = true; });
  });

  document.getElementById('binder-select-none')?.addEventListener('click', () => {
    document.querySelectorAll('.binder-item-check').forEach(el => { el.checked = false; });
  });

  container.querySelectorAll('[data-action="binder-print-one"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = itemById(btn.dataset.id);
      if (!item) return;
      try {
        const opts = getBinderOptionsFromDom();
        printBinderItems([item], opts);
        showToast('Binder page opened', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('[data-action="binder-print-manual"]').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        openManualForPrint(btn.dataset.path, btn.dataset.name);
        showToast('Manual opened — click Print Manual when ready', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function bindStudioViewEvents() {
  container.querySelectorAll('[data-studio-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.studioTab = btn.dataset.studioTab;
      navigate('studio-view');
    });
  });

  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });

  document.getElementById('new-rack-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.createRack({
        name: document.getElementById('rack-name').value,
        location: document.getElementById('rack-location').value,
        notes: document.getElementById('rack-notes').value
      });
      showToast('Rack created', 'success');
      navigate('studio-view');
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('new-chain-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.createSignalChain({
        name: document.getElementById('chain-name').value,
        description: document.getElementById('chain-desc').value
      });
      showToast('Signal chain created', 'success');
      state.studioTab = 'chains';
      navigate('studio-view');
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelectorAll('[data-action="delete-rack"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showModal({ title: 'Delete rack?', message: 'Remove this rack layout (gear items stay in inventory).', confirmText: 'Delete', danger: true })) return;
      await api.deleteRack(btn.dataset.id);
      showToast('Rack deleted', 'success');
      navigate('studio-view');
    });
  });

  container.querySelectorAll('[data-action="delete-chain"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showModal({ title: 'Delete chain?', message: 'Remove this signal chain layout.', confirmText: 'Delete', danger: true })) return;
      await api.deleteSignalChain(btn.dataset.id);
      showToast('Chain deleted', 'success');
      navigate('studio-view');
    });
  });

  container.querySelectorAll('[data-action="rack-add-item"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rackId = btn.dataset.rack;
      const select = container.querySelector(`.rack-add-select[data-rack="${rackId}"]`);
      const slotInput = container.querySelector(`.rack-slot-input[data-rack="${rackId}"]`);
      const itemId = select?.value;
      if (!itemId) return showToast('Select an item', 'error');
      const rack = await api.racks().then(rs => rs.find(r => String(r.id) === String(rackId)));
      const items = [...(rack?.items || []).map((s, i) => ({
        item_id: s.id, position: i, slot_label: s.slot_label || ''
      })), {
        item_id: Number(itemId),
        position: (rack?.items?.length || 0),
        slot_label: slotInput?.value || ''
      }];
      await api.setRackItems(rackId, items);
      showToast('Added to rack', 'success');
      state.studioTab = 'racks';
      navigate('studio-view');
    });
  });

  container.querySelectorAll('[data-action="rack-remove-item"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rackId = btn.dataset.rack;
      const removeId = Number(btn.dataset.item);
      const rack = await api.racks().then(rs => rs.find(r => String(r.id) === String(rackId)));
      const items = (rack?.items || []).filter(s => s.id !== removeId).map((s, i) => ({
        item_id: s.id, position: i, slot_label: s.slot_label || ''
      }));
      await api.setRackItems(rackId, items);
      navigate('studio-view');
    });
  });

  container.querySelectorAll('[data-action="chain-add-item"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chainId = btn.dataset.chain;
      const select = container.querySelector(`.chain-add-select[data-chain="${chainId}"]`);
      const itemId = select?.value;
      if (!itemId) return showToast('Select an item', 'error');
      const chain = await api.signalChains().then(cs => cs.find(c => String(c.id) === String(chainId)));
      const items = [...(chain?.items || []).map((s, i) => ({ item_id: s.id, position: i })), {
        item_id: Number(itemId), position: (chain?.items?.length || 0)
      }];
      await api.setSignalChainItems(chainId, items);
      showToast('Added to chain', 'success');
      state.studioTab = 'chains';
      navigate('studio-view');
    });
  });

  container.querySelectorAll('[data-action="chain-remove-item"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chainId = btn.dataset.chain;
      const removeId = Number(btn.dataset.item);
      const chain = await api.signalChains().then(cs => cs.find(c => String(c.id) === String(chainId)));
      const items = (chain?.items || []).filter(s => s.id !== removeId).map((s, i) => ({ item_id: s.id, position: i }));
      await api.setSignalChainItems(chainId, items);
      navigate('studio-view');
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
  const guestUrlSection = document.getElementById('guest-url-section');
  const guestUrlInput = document.getElementById('guest-url');
  const guestEnabledCheck = document.getElementById('guest-enabled');

  const setGuestSectionState = (enabled) => {
    guestUrlSection?.classList.toggle('guest-url-disabled', !enabled);
  };

  guestEnabledCheck?.addEventListener('change', async () => {
    try {
      const result = await api.updateGuestSettings({ guestEnabled: guestEnabledCheck.checked });
      if (guestUrlInput) guestUrlInput.value = result.guestUrl || guestUrlInput.value;
      setGuestSectionState(guestEnabledCheck.checked);
      showToast(result.guestEnabled ? 'Guest link enabled' : 'Guest link disabled', 'success');
    } catch (err) {
      guestEnabledCheck.checked = !guestEnabledCheck.checked;
      showToast(err.message, 'error');
    }
  });

  document.getElementById('guest-copy-url')?.addEventListener('click', async () => {
    const url = guestUrlInput?.value;
    if (!url) return showToast('No guest URL available', 'error');
    try {
      await navigator.clipboard.writeText(url);
      showToast('Guest link copied', 'success');
    } catch {
      guestUrlInput?.select();
      showToast('Select the URL and copy manually', 'info');
    }
  });

  document.getElementById('guest-regenerate')?.addEventListener('click', async () => {
    const ok = await showModal({
      title: 'Regenerate Guest Token?',
      message: 'The old link will stop working. Anyone using the previous URL will need the new one.',
      confirmText: 'Regenerate',
      danger: true
    });
    if (!ok) return;
    try {
      const result = await api.regenerateGuestToken();
      if (guestUrlInput) guestUrlInput.value = result.guestUrl || '';
      showToast('New guest link generated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  setGuestSectionState(guestEnabledCheck?.checked);

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

  document.getElementById('download-csv-template')?.addEventListener('click', () => {
    const template = [
      'name,brand,model,serial_number,category,location,condition,replacement_value,depreciated_value,purchase_price,purchase_date,warranty_end_date,on_insurance_policy,tags',
      'Shure SM57,Shure,SM57,SN12345,Microphone,Main Rack,Good,99,89,2024-01-15,,vocal;dynamic',
      'Boss DD-500,Boss,DD-500,,Pedal,Pedalboard,Excellent,399,349,,,delay'
    ].join('\n');
    const blob = new Blob([template], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'studio-inventory-import-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('import-csv-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('import-csv-status');
    try {
      const text = await file.text();
      const result = await api.importCsv(text);
      status.textContent = `Imported ${result.imported} item(s)${result.skipped ? `, ${result.skipped} row(s) skipped` : ''}.`;
      showToast(`Imported ${result.imported} items from CSV`, 'success');
      navigate('inventory');
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      showToast(err.message, 'error');
    }
    e.target.value = '';
  });

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