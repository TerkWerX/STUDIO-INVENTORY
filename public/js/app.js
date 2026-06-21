import { api } from './api.js';
import { debounce, showToast, showModal, showChoiceModal, buildDriverSearchUrl, buildValueEstimateUrl, openLightbox, fileUrl } from './utils.js';
import { isWallPhotoCalibrated, warpedWallPreviewDataUrl } from './lib/wall-perspective.js';
import { wallLengthFt } from './lib/floorplan-geometry.js';
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
import { renderStudioSetup, rackItemsPayload, chainItemsPayload } from './views/studio-setup.js';
import { renderStudioBrowse } from './views/studio-browse.js';
import { initFloorplanEditor } from './lib/floorplan-editor.js';
import { openWallElevation, showItemQuickMenu } from './lib/wall-elevation.js';
import { applyRoomDisplay } from './lib/floorplan-geometry.js';
import { formatLength } from './lib/measurement.js';
import { openItemPlacement } from './lib/item-placement.js';
import { openWallPhotoEditor } from './lib/wall-photo-editor.js';
import { cutoutPinForEditor } from './lib/wall-cutout.js';
import { renderScanLookup, renderScanResult, startCameraScan } from './views/scan-lookup.js';
import { renderLoans } from './views/loans.js';
import {
  renderSoftwareCatalog, renderSoftwareDetail, renderSoftwareForm, collectSoftwareFormData
} from './views/software.js';
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
  manualFinder: { itemId: null, query: '', results: [], scans: {}, searched: false, error: '' },
  manualInbox: { dir: '', files: [] },
  pdfSearchEnabled: true,
  brands: [],
  selectedBrand: null,
  labelPreselectId: null,
  parentItemId: null,
  studioTab: 'rooms',
  floorplanId: null,
  studioBrowseFpId: null,
  studioBrowseHighlightItemId: null,

  floorplans: [],
  softwareFilters: { q: '', category: '', sort: 'name' },
  selectedSoftwareId: null,
  editSoftwareId: null
};

const container = document.getElementById('view-container');
let stopCameraScan = null;

const APP_ASSET_VER = '2.5.19-manualinbox1';

async function ensureFreshAssets() {
  if (localStorage.getItem('app-asset-ver') === APP_ASSET_VER) return false;
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }
  localStorage.setItem('app-asset-ver', APP_ASSET_VER);
  location.reload();
  return true;
}

async function buildStudioWallSlides(fp) {
  const photos = fp.wall_photos || {};
  const edges = Object.keys(photos)
    .map(k => Number(k))
    .filter(edge => (photos[edge] || photos[String(edge)])?.path)
    .sort((a, b) => a - b);
  const heightFt = fp.ceiling_height || 9.5;
  return Promise.all(edges.map(async (edge) => {
    const entry = photos[edge] || photos[String(edge)];
    const widthFt = wallLengthFt(fp, edge) || fp.bounds_width || 12;
    const name = `${fp.location} — Wall ${edge + 1}`;
    const url = isWallPhotoCalibrated(entry)
      ? await warpedWallPreviewDataUrl(entry.path, entry, widthFt, heightFt)
      : fileUrl(entry.path);
    return { edge, url, name };
  }));
}

async function init() {
  try {
    if (await ensureFreshAssets()) return;
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
      (view === 'labels' && btn.dataset.view === 'labels') ||
      (['software-detail', 'software-form'].includes(view) && btn.dataset.view === 'software'));
  });
}

async function navigate(view, params = {}) {
  if (state.view === 'scan' && view !== 'scan') {
    stopCameraScan?.();
    stopCameraScan = null;
  }
  if (view !== 'item-detail') cleanupPhotoZoneListeners();
  state.view = view;
  document.getElementById('main-content')?.classList.toggle('studio-browse-active', view === 'studio-view');
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

      case 'scan':
        container.innerHTML = renderScanLookup();
        bindScanLookupEvents();
        break;

      case 'studio-setup': {
        state.meta = state.meta || await api.meta();
        const [map, racks, chains, allItems, floorplans] = await Promise.all([
          api.studioMap(),
          api.racks(),
          api.signalChains(),
          api.items({ sort: 'name', include_accessories: '1' }),
          api.floorplans()
        ]);
        state.items = Array.isArray(allItems) ? allItems : [];
        state.floorplans = Array.isArray(floorplans) ? floorplans : [];
        container.innerHTML = renderStudioSetup({
          map,
          racks: Array.isArray(racks) ? racks : [],
          chains: Array.isArray(chains) ? chains : [],
          items: state.items,
          floorplans: Array.isArray(floorplans) ? floorplans : [],
          locations: Array.isArray(state.meta?.locations) ? state.meta.locations : []
        }, state.studioTab, state.floorplanId);
        bindStudioSetupEvents();
        break;
      }

      case 'studio-view': {
        state.floorplans = await api.floorplans();
        container.innerHTML = renderStudioBrowse(
          state.floorplans,
          state.studioBrowseFpId,
          state.studioBrowseHighlightItemId
        );
        bindStudioBrowseEvents();
        state.studioBrowseHighlightItemId = null;
        break;
      }

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

      case 'loans': {
        const loanData = await api.loans();
        container.innerHTML = renderLoans(loanData);
        bindLoansEvents();
        break;
      }

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

      case 'software': {
        const licenses = await api.software(state.softwareFilters);
        container.innerHTML = renderSoftwareCatalog(licenses, state.softwareFilters);
        bindSoftwareEvents();
        break;
      }

      case 'software-detail': {
        const swId = params.id || state.selectedSoftwareId;
        const sw = await api.softwareItem(swId);
        state.selectedSoftwareId = sw.id;
        container.innerHTML = renderSoftwareDetail(sw);
        bindSoftwareDetailEvents(sw);
        break;
      }

      case 'software-form': {
        state.meta = state.meta || await api.meta();
        const editSw = state.editSoftwareId ? await api.softwareItem(state.editSoftwareId) : null;
        const hostItems = await api.items({ sort: 'name' });
        container.innerHTML = renderSoftwareForm(editSw, { ...state.meta, hostItems });
        bindSoftwareFormEvents(editSw);
        break;
      }

      case 'manuals': {
        const [manuals, items, guestInfo, manualInbox] = await Promise.all([
          api.manuals(),
          api.items({ sort: 'name', include_accessories: '1' }),
          api.guestSettings(),
          api.manualInbox()
        ]);
        state.items = Array.isArray(items) ? items : [];
        state.manualInbox = manualInbox || { dir: '', files: [] };
        state.pdfSearchEnabled = guestInfo.pdfSearchEnabled !== false;
        container.innerHTML = renderManuals(manuals, {
          searchQuery: state.manualSearch,
          ftsQuery: state.manualFtsQuery,
          ftsResults: state.manualFtsResults,
          pdfSearchEnabled: state.pdfSearchEnabled,
          items: state.items,
          finder: state.manualFinder,
          inbox: state.manualInbox
        });
        bindManualEvents(manuals, state.items);
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
  container.querySelectorAll('[data-action="view-software"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedSoftwareId = el.dataset.id;
      navigate('software-detail', { id: el.dataset.id });
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

  container.querySelector('[data-action="wall-cutout-edit"]')?.addEventListener('click', async () => {
    await openWallCutoutForItem(item, {
      onDone: () => navigate('item-detail', { id: item.id })
    });
  });

  container.querySelector('[data-action="wall-cutout-remove"]')?.addEventListener('click', async () => {
    const ok = await showModal({
      title: 'Remove saved wall cutout?',
      message: 'This removes the cutout stored on this item. It does not change studio placement.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      danger: true
    });
    if (!ok) return;
    try {
      await api.clearWallCutout(item.id);
      showToast('Wall cutout removed', 'success');
      navigate('item-detail', { id: item.id });
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelector('[data-action="place-on-map"]')?.addEventListener('click', async () => {
    const racks = await api.racks().catch(() => []);
    const floorplans = await api.floorplans();
    state.floorplans = floorplans;
    await openItemPlacement({
      item,
      floorplans,
      racks,
      api,
      onToast: showToast,
      onDone: () => navigate('item-detail', { id: item.id })
    });
  });

  container.querySelector('[data-action="view-on-map"]')?.addEventListener('click', async () => {
    const floorplans = await api.floorplans();
    state.floorplans = floorplans;
    const fpId = item.map_placement?.floorplan_id
      || floorplans.find(f => f.location === item.location)?.id;
    if (!fpId) {
      showToast('No room map for this item yet', 'error');
      return;
    }
    state.studioBrowseFpId = fpId;
    state.studioBrowseHighlightItemId = item.id;
    navigate('studio-view');
  });

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

  document.getElementById('loan-checkout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const checkout = await api.checkoutItem(item.id, {
        borrower_name: document.getElementById('loan-borrower').value,
        borrower_contact: document.getElementById('loan-contact').value,
        loaned_at: document.getElementById('loan-date').value,
        due_date: document.getElementById('loan-due').value,
        note: document.getElementById('loan-note').value,
        condition_out: document.getElementById('loan-condition-out').value
      });
      showToast(
        checkout.wall_removed
          ? 'Checked out — removed from wall view until returned'
          : 'Item checked out',
        'success'
      );
      navigate('item-detail', { id: item.id });
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('loan-return-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const loanId = e.target.dataset.loanId;
    try {
      const returned = await api.returnLoan(loanId, {
        returned_at: document.getElementById('return-date').value,
        condition_in: document.getElementById('return-condition').value,
        return_note: document.getElementById('return-note').value
      });
      showToast('Item marked returned', 'success');
      if (returned.wall_rehang_pending) {
        await promptWallRehang(item, returned.wall_placement);
      }
      navigate('item-detail', { id: item.id });
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelectorAll('[data-action="delete-loan"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showModal({
        title: 'Remove loan record?',
        message: 'Delete this history entry from the loan log?',
        confirmText: 'Remove',
        danger: true
      });
      if (!ok) return;
      try {
        await api.deleteLoan(btn.dataset.id);
        showToast('Loan record removed', 'success');
        navigate('item-detail', { id: item.id });
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

  container.querySelector('[data-action="manual-web-search"]')?.addEventListener('click', () => {
    runManualWebSearch(item.id, { itemName: item.name });
  });

  container.querySelector('[data-action="manual-inbox-import"]')?.addEventListener('click', () => {
    promptImportManualFromInbox(item.id, {
      itemName: item.name,
      onDone: () => navigate('item-detail', { id: item.id })
    });
  });

  container.querySelector('[data-action="archive-manual-url"]')?.addEventListener('click', () => {
    promptArchiveManualFromUrl(item.id, {
      itemName: item.name,
      onDone: () => navigate('item-detail', { id: item.id })
    });
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

        const addCutout = await showModal({
          title: 'Add wall cutout photo?',
          message: `"${data.name}" is saved. Add an optional life-size cutout for your virtual studio wall? This is separate from inventory photos — you can skip and add it later from the item page.`,
          confirmText: 'Add cutout',
          cancelText: 'Skip for now'
        });
        if (addCutout) {
          const fresh = await api.item(created.id);
          openWallCutoutForItem(fresh, {
            onDone: () => navigate('item-detail', { id: created.id })
          });
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

function bindManualEvents(manuals, items = []) {
  const rerender = () => {
    container.innerHTML = renderManuals(manuals, {
      searchQuery: state.manualSearch,
      ftsQuery: state.manualFtsQuery,
      ftsResults: state.manualFtsResults,
      pdfSearchEnabled: state.pdfSearchEnabled,
      items,
      finder: state.manualFinder,
      inbox: state.manualInbox
    });
    bindManualEvents(manuals, items);
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

  container.querySelectorAll('[data-action="archive-manual-url"]').forEach(btn => {
    btn.addEventListener('click', () => {
      promptArchiveManualFromUrl(btn.dataset.id, {
        itemName: btn.dataset.name || '',
        onDone: () => navigate('manuals')
      });
    });
  });

  container.querySelector('[data-action="open-manual-inbox"]')?.addEventListener('click', async () => {
    try {
      state.manualInbox = await api.openManualInbox();
      showToast('Manual Inbox folder opened', 'success');
      rerender();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelector('[data-action="refresh-manual-inbox"]')?.addEventListener('click', async () => {
    try {
      state.manualInbox = await api.manualInbox();
      showToast('Manual Inbox refreshed', 'success');
      rerender();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelectorAll('[data-action="manual-inbox-import"]').forEach(btn => {
    btn.addEventListener('click', () => {
      promptImportManualFromInbox(btn.dataset.id, {
        itemName: btn.dataset.name || '',
        onDone: () => navigate('manuals')
      });
    });
  });

  container.querySelectorAll('[data-action="manual-web-search"]').forEach(btn => {
    btn.addEventListener('click', () => {
      runManualWebSearch(btn.dataset.id, { itemName: btn.dataset.name || '' });
    });
  });

  container.querySelector('[data-action="manual-web-search-go"]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    runManualWebSearch(btn.dataset.id, {
      itemName: btn.dataset.name || '',
      query: document.getElementById('manual-web-query')?.value || ''
    });
  });
  document.getElementById('manual-web-query')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const btn = container.querySelector('[data-action="manual-web-search-go"]');
    if (!btn) return;
    runManualWebSearch(btn.dataset.id, {
      itemName: btn.dataset.name || '',
      query: e.currentTarget.value || ''
    });
  });

  container.querySelectorAll('[data-action="scan-manual-result"]').forEach(btn => {
    btn.addEventListener('click', () => {
      scanManualResultPage(btn.dataset.id, btn.dataset.url);
    });
  });

  container.querySelectorAll('[data-action="archive-manual-result"]').forEach(btn => {
    btn.addEventListener('click', () => {
      archiveManualResult(btn.dataset.id, btn.dataset.url);
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

function bindLoansEvents() {
  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });

  container.querySelectorAll('[data-action="return-loan"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showModal({
        title: 'Mark returned?',
        message: 'Record this item as returned to the studio today?',
        confirmText: 'Returned',
        cancelText: 'Cancel'
      });
      if (!ok) return;
      try {
        const returned = await api.returnLoan(btn.dataset.id, {});
        showToast('Item marked returned', 'success');
        if (returned.wall_rehang_pending && returned.wall_placement) {
          const gear = await api.item(returned.item.id);
          await promptWallRehang(gear, returned.wall_placement);
        }
        navigate('loans');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('[data-action="delete-loan"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showModal({
        title: 'Remove loan record?',
        message: 'Delete this returned loan from history?',
        confirmText: 'Remove',
        danger: true
      });
      if (!ok) return;
      try {
        await api.deleteLoan(btn.dataset.id);
        showToast('Record removed', 'success');
        navigate('loans');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
}

function bindSoftwareEvents() {
  container.querySelectorAll('[data-nav="software-form"]').forEach(el => {
    el.addEventListener('click', () => {
      state.editSoftwareId = null;
      navigate('software-form');
    });
  });

  container.querySelectorAll('[data-action="view-software"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedSoftwareId = el.dataset.id;
      navigate('software-detail', { id: el.dataset.id });
    });
  });

  const applyFilters = debounce(() => {
    state.softwareFilters = {
      q: document.getElementById('sw-search')?.value.trim() || '',
      category: document.getElementById('sw-filter-category')?.value || '',
      sort: document.getElementById('sw-filter-sort')?.value || 'name'
    };
    navigate('software');
  }, 300);

  document.getElementById('sw-search')?.addEventListener('input', applyFilters);
  const syncSoftwareFiltersFromDom = () => {
    state.softwareFilters = {
      q: document.getElementById('sw-search')?.value.trim() || '',
      category: document.getElementById('sw-filter-category')?.value || '',
      sort: document.getElementById('sw-filter-sort')?.value || 'name'
    };
  };
  document.getElementById('sw-filter-category')?.addEventListener('change', () => {
    syncSoftwareFiltersFromDom();
    navigate('software');
  });
  document.getElementById('sw-filter-sort')?.addEventListener('change', () => {
    syncSoftwareFiltersFromDom();
    navigate('software');
  });
}

function bindSoftwareDetailEvents(sw) {
  container.querySelector('[data-action="edit-software"]')?.addEventListener('click', () => {
    state.editSoftwareId = sw.id;
    navigate('software-form');
  });

  container.querySelector('[data-action="delete-software"]')?.addEventListener('click', async () => {
    const ok = await showModal({
      title: 'Delete software entry?',
      message: `Remove "${sw.name}" from your catalog? Screenshot and license data will be deleted.`,
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      await api.deleteSoftware(sw.id);
      showToast('Software removed', 'success');
      navigate('software');
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelector('[data-action="reveal-license"]')?.addEventListener('click', (e) => {
    const code = container.querySelector('.sw-license-masked');
    const copyBtn = container.querySelector('[data-action="copy-license"]');
    if (code) {
      code.textContent = code.dataset.key || '';
      e.target.classList.add('hidden');
      copyBtn?.classList.remove('hidden');
    }
  });

  container.querySelector('[data-action="copy-license"]')?.addEventListener('click', async (e) => {
    const key = e.target.dataset.key;
    try {
      await navigator.clipboard.writeText(key);
      showToast('License key copied', 'success');
    } catch {
      showToast('Could not copy — select and copy manually', 'error');
    }
  });

  container.querySelector('[data-action="view-item"]')?.addEventListener('click', (e) => {
    state.selectedItemId = e.target.closest('[data-action="view-item"]')?.dataset.id;
    navigate('item-detail', { id: state.selectedItemId });
  });

  container.querySelector('[data-action="upload-sw-screenshot"]')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api.uploadSoftwareScreenshot(sw.id, file);
      showToast('Screenshot uploaded', 'success');
      navigate('software-detail', { id: sw.id });
    } catch (err) { showToast(err.message, 'error'); }
    e.target.value = '';
  });

  container.querySelector('[data-action="remove-sw-screenshot"]')?.addEventListener('click', async () => {
    const ok = await showModal({
      title: 'Remove screenshot?',
      message: 'Delete the interface screenshot for this entry?',
      confirmText: 'Remove',
      danger: true
    });
    if (!ok) return;
    try {
      await api.removeSoftwareScreenshot(sw.id);
      showToast('Screenshot removed', 'success');
      navigate('software-detail', { id: sw.id });
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function bindSoftwareFormEvents(editSw) {
  container.querySelector('[data-action="cancel-software-form"]')?.addEventListener('click', () => {
    if (editSw) navigate('software-detail', { id: editSw.id });
    else navigate('software');
  });

  document.getElementById('sw-form-screenshot')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !editSw) return;
    try {
      await api.uploadSoftwareScreenshot(editSw.id, file);
      showToast('Screenshot uploaded', 'success');
      state.editSoftwareId = editSw.id;
      navigate('software-form');
    } catch (err) { showToast(err.message, 'error'); }
    e.target.value = '';
  });

  document.getElementById('software-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = collectSoftwareFormData();
    try {
      if (editSw) {
        await api.updateSoftware(editSw.id, data);
        state.editSoftwareId = null;
        state.selectedSoftwareId = editSw.id;
        showToast('Software updated', 'success');
        navigate('software-detail', { id: editSw.id });
      } else {
        const created = await api.createSoftware(data);
        state.selectedSoftwareId = created.id;
        showToast('Added to catalog — add a screenshot next!', 'success');
        navigate('software-detail', { id: created.id });
      }
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function bindStudioSetupEvents() {
  container.querySelectorAll('[data-studio-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.studioTab = btn.dataset.studioTab;
      navigate('studio-setup');
    });
  });

  container.querySelectorAll('[data-action="open-studio-view"]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.studioBrowseFpId = Number(btn.dataset.fp) || null;
      navigate('studio-view');
    });
  });

  container.querySelectorAll('[data-action="view-item"]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedItemId = el.dataset.id;
      navigate('item-detail', { id: el.dataset.id });
    });
  });

  document.getElementById('new-room-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const location = document.getElementById('room-name')?.value?.trim();
    if (!location) return showToast('Enter a room name', 'error');
    try {
      const fp = await api.createFloorplan({ location });
      state.floorplanId = fp.id;
      state.studioTab = 'floorplans';
      showToast(`Room “${location}” created — draw the outline next`, 'success');
      navigate('studio-setup');
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelectorAll('[data-action="room-floorplan"]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.floorplanId = Number(btn.dataset.id);
      state.studioTab = 'floorplans';
      navigate('studio-setup');
    });
  });

  container.querySelectorAll('[data-action="room-create-floorplan"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const location = decodeURIComponent(btn.dataset.location || '').trim();
      if (!location) return;
      try {
        const fp = await api.createFloorplan({ location });
        state.floorplanId = fp.id;
        state.studioTab = 'floorplans';
        showToast(`Floorplan created for “${location}”`, 'success');
        navigate('studio-setup');
      } catch (err) { showToast(err.message, 'error'); }
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
      navigate('studio-setup');
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
      navigate('studio-setup');
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelectorAll('[data-action="delete-rack"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showModal({ title: 'Delete rack?', message: 'Remove this rack layout (gear items stay in inventory).', confirmText: 'Delete', danger: true })) return;
      await api.deleteRack(btn.dataset.id);
      showToast('Rack deleted', 'success');
      navigate('studio-setup');
    });
  });

  container.querySelectorAll('[data-action="delete-chain"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showModal({ title: 'Delete chain?', message: 'Remove this signal chain layout.', confirmText: 'Delete', danger: true })) return;
      await api.deleteSignalChain(btn.dataset.id);
      showToast('Chain deleted', 'success');
      navigate('studio-setup');
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
      navigate('studio-setup');
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
      navigate('studio-setup');
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
      navigate('studio-setup');
    });
  });

  container.querySelectorAll('[data-action="chain-remove-item"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chainId = btn.dataset.chain;
      const removeId = Number(btn.dataset.item);
      const chain = await api.signalChains().then(cs => cs.find(c => String(c.id) === String(chainId)));
      const items = (chain?.items || []).filter(s => s.id !== removeId).map((s, i) => ({ item_id: s.id, position: i }));
      await api.setSignalChainItems(chainId, items);
      navigate('studio-setup');
    });
  });

  bindFloorplanEvents(state.floorplans);
}

function bindStudioBrowseEvents() {
  const root = container.querySelector('.studio-browse');
  if (!root) return;

  const fpId = Number(root.dataset.studioBrowseFp);
  const fp = (state.floorplans || []).find(f => String(f.id) === String(fpId));

  const mapEl = root.querySelector('#studio-browse-map');
  if (mapEl && fp) {
    const bw = parseFloat(mapEl.dataset.boundsWidth) || fp.bounds_width || 0;
    const bd = parseFloat(mapEl.dataset.boundsDepth) || fp.bounds_depth || 0;
    if (bw && bd) applyRoomDisplay(mapEl, bw, bd);
  }

  document.getElementById('studio-browse-room')?.addEventListener('change', (e) => {
    state.studioBrowseFpId = Number(e.target.value);
    navigate('studio-view');
  });

  root.querySelectorAll('.studio-browse-pin').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pin = (fp?.items || []).find(p => String(p.id) === btn.dataset.itemId);
      showItemQuickMenu({
        itemId: Number(btn.dataset.itemId),
        itemName: pin?.name || 'Item',
        anchorEl: btn,
        fetchItem: (id) => api.item(id)
      });
    });
  });

  root.querySelectorAll('[data-studio-wall]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        state.floorplans = await api.floorplans();
        const freshFp = (state.floorplans || []).find(f => String(f.id) === String(fpId));
        if (!freshFp) {
          showToast('Room not found — refresh and try again', 'error');
          return;
        }
        const wallEdge = Number(btn.dataset.studioWall);
        btn.disabled = true;
        const wallEntry = freshFp.wall_photos?.[wallEdge] || freshFp.wall_photos?.[String(wallEdge)];
        if (!wallEntry?.path) {
          showToast('No wall photo yet — add one in Studio Setup', 'error');
          return;
        }
        openWallElevation({
          fp: freshFp,
          wallEdge,
          items: freshFp.items || [],
          browseMode: true,
          fetchItem: (id) => api.item(id),
          onToast: showToast
        });
      } catch (err) {
        showToast(err.message || 'Could not open wall view', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  const hi = root.querySelector('.studio-browse-pin-highlight');
  hi?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function bindScanLookupEvents() {
  const resultsEl = document.getElementById('scan-results');
  const wedgeInput = document.getElementById('scan-wedge-input');

  const showResult = (result) => {
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = renderScanResult(result);
    resultsEl.querySelector('[data-action="view-item"]')?.addEventListener('click', (e) => {
      state.selectedItemId = e.currentTarget.dataset.id;
      navigate('item-detail', { id: e.currentTarget.dataset.id });
    });
    resultsEl.querySelectorAll('[data-action="scan-pick"]').forEach(btn => {
      btn.addEventListener('click', () => runLookup(`SI:${btn.dataset.id}`));
    });
    document.getElementById('scan-another')?.addEventListener('click', () => {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      wedgeInput?.focus();
    });
  };

  const runLookup = async (code) => {
    const c = String(code || '').trim();
    if (!c) return showToast('Enter or scan a code', 'error');
    try {
      showResult(await api.lookup(c));
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  wedgeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runLookup(wedgeInput.value); wedgeInput.select(); }
  });
  document.getElementById('scan-wedge-go')?.addEventListener('click', () => runLookup(wedgeInput?.value));

  let cameraOn = false;
  document.getElementById('scan-camera-toggle')?.addEventListener('click', async () => {
    const btn = document.getElementById('scan-camera-toggle');
    if (cameraOn) {
      stopCameraScan?.();
      stopCameraScan = null;
      cameraOn = false;
      btn.textContent = 'Start Camera';
      return;
    }
    btn.textContent = 'Stop Camera';
    cameraOn = true;
    stopCameraScan = await startCameraScan(
      (code) => { cameraOn = false; btn.textContent = 'Start Camera'; runLookup(code); },
      (msg) => { showToast(msg, 'error'); cameraOn = false; btn.textContent = 'Start Camera'; }
    );
  });

  wedgeInput?.focus();
}

function syncFloorplanInState(updated) {
  if (!updated?.id) return;
  const list = [...(state.floorplans || [])];
  const idx = list.findIndex(f => String(f.id) === String(updated.id));
  if (idx >= 0) list[idx] = updated;
  else list.push(updated);
  state.floorplans = list;
}

async function openWallCutoutForItem(item, { onDone } = {}) {
  const full = item.photos !== undefined ? item : await api.item(item.id);
  const floorplans = state.floorplans?.length ? state.floorplans : await api.floorplans();
  state.floorplans = floorplans;
  const fp = floorplans.find(f => f.location === full.location);
  openWallPhotoEditor({
    item: full,
    pin: cutoutPinForEditor(full),
    unit: fp?.unit || 'ft',
    mode: 'inventory',
    onSave: async (patch) => {
      await api.saveWallCutout(full.id, patch);
      if (full.map_placement?.floorplan_id) {
        await mergePinUpdates(full.map_placement.floorplan_id, [{ item_id: full.id, ...patch }], fp);
        state.floorplans = await api.floorplans();
      }
      onDone?.();
    },
    onToast: showToast
  });
}

async function openPhotoHangForPin(fpId, fp, pin) {
  const item = await api.item(pin.id);
  openWallPhotoEditor({
    item,
    pin,
    unit: fp.unit || 'ft',
    onSave: async (patch) => {
      const pins = buildFullFloorplanPins(fp);
      const row = pins.find(p => p.item_id === pin.id);
      if (row) Object.assign(row, { placement: 'wall', wall_display: true, ...patch });
      else pins.push({ item_id: pin.id, placement: 'wall', wall_display: true, ...patch });
      await api.setFloorplanItems(fpId, pins);
      await api.saveWallCutout(pin.id, patch).catch(() => {});
      state.floorplans = await api.floorplans();
      showToast('Wall photo updated', 'success');
    },
    onToast: showToast
  });
}

function openFloorplanWallInline(fp, edge, { setupMode = true, onBack } = {}) {
  const fpId = fp.id;
  const mount = document.getElementById('floorplan-wall-inline');
  if (!mount) return null;

  return openWallElevation({
    fp,
    wallEdge: edge,
    items: fp.items || [],
    mountEl: mount,
    setupMode,
    onClose: () => onBack?.(),
    onUploadWallPhoto: async (file) => {
      const updated = await api.uploadWallBackground(fpId, edge, file);
      syncFloorplanInState(updated);
      Object.assign(fp, updated);
      return updated;
    },
    onSaveWallCalibration: async (data) => {
      const updated = await api.setWallBackgroundCalibration(fpId, edge, data);
      syncFloorplanInState(updated);
      Object.assign(fp, updated);
      return updated;
    },
    onToast: showToast
  });
}

function buildFullFloorplanPins(fp) {
  return (fp?.items || []).map(p => ({
    item_id: p.id,
    x_pct: p.x_pct,
    y_pct: p.y_pct,
    placement: p.placement || 'floor',
    wall_edge: p.wall_edge,
    wall_t: p.wall_t,
    height_ft: p.height_ft,
    icon_mode: p.icon_mode,
    wall_photo_path: p.wall_photo_path,
    photo_width_ft: p.photo_width_ft,
    photo_height_ft: p.photo_height_ft,
    rotation_deg: p.rotation_deg || 0,
    photo_calibration: p.photo_calibration,
    wall_display: p.wall_display !== false
  }));
}

async function mergePinUpdates(fpId, updates, fp) {
  const floorplan = fp || (state.floorplans || []).find(f => String(f.id) === String(fpId));
  const pins = buildFullFloorplanPins(floorplan);
  for (const u of updates) {
    const row = pins.find(p => p.item_id === u.item_id);
    if (row) Object.assign(row, u);
    else pins.push({ item_id: u.item_id, x_pct: 50, y_pct: 50, ...u });
  }
  await api.setFloorplanItems(fpId, pins);
}

async function promptWallRehang(item, placement) {
  if (!placement || placement.placement !== 'wall') return;
  const wallNum = (placement.wall_edge ?? 0) + 1;
  const height = placement.height_ft != null ? `${formatLength(placement.height_ft, placement.unit || 'in')} up` : 'saved height';
  const choice = await showChoiceModal({
    title: `Hang ${item.name} back on the wall?`,
    message: `This was on Wall ${wallNum} (${height}) before it was loaned out. Where should it go now?`,
    choices: [
      { id: 'same', label: 'Same spot', primary: true },
      { id: 'reposition', label: 'New spot on wall' },
      { id: 'off_wall', label: 'Not on wall' }
    ]
  });
  if (!choice) return;

  try {
    await api.wallRehang(item.id, choice);
    if (choice === 'same') {
      showToast('Back on the wall at the same spot', 'success');
    } else if (choice === 'reposition') {
      const floorplans = state.floorplans?.length ? state.floorplans : await api.floorplans();
      const racks = await api.racks().catch(() => []);
      await openItemPlacement({
        item,
        floorplans,
        racks,
        api,
        onToast: showToast,
        onDone: () => navigate('item-detail', { id: item.id })
      });
    } else {
      showToast('Removed from wall — still on the room map', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function promptArchiveManualFromUrl(itemId, { itemName = '', onDone } = {}) {
  const url = await showModal({
    title: 'Save Manual from URL',
    message: `Paste the direct PDF/manual link${itemName ? ` for "${itemName}"` : ''}. Studio Inventory will copy it into this item's managed manual folder and attach it to the record.`,
    confirmText: 'Save Manual',
    cancelText: 'Cancel',
    prompt: true,
    promptType: 'url',
    promptPlaceholder: 'https://manufacturer.com/support/manual.pdf'
  });
  const trimmed = String(url || '').trim();
  if (!trimmed) return;

  try {
    showToast('Downloading manual into Studio Inventory...', 'info');
    await api.archiveManual(itemId, trimmed);
    showToast('Manual saved to this item', 'success');
    await onDone?.();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function promptImportManualFromInbox(itemId, { itemName = '', onDone } = {}) {
  let inbox;
  try {
    inbox = await api.manualInbox();
    state.manualInbox = inbox || { dir: '', files: [] };
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  const files = Array.isArray(inbox.files) ? inbox.files : [];
  if (!files.length) {
    await showModal({
      title: 'Manual Inbox Empty',
      message: `Save downloaded PDFs/manuals to ${inbox.dir || 'data/manual-inbox'}, then refresh and import them to the matching item.`,
      confirmText: 'OK',
      cancelText: 'Close'
    });
    return;
  }

  const filename = await showModal({
    title: 'Import from Manual Inbox',
    message: `Choose the downloaded manual to attach${itemName ? ` to "${itemName}"` : ''}. It will be moved into this item's managed manual folder.`,
    confirmText: 'Import',
    cancelText: 'Cancel',
    prompt: true,
    promptType: 'select',
    promptOptions: files.map(file => ({
      value: file.name,
      label: `${file.name} (${formatFileSize(file.size)})`
    }))
  });
  if (!filename) return;

  try {
    await api.importManualFromInbox(itemId, filename);
    state.manualInbox = await api.manualInbox();
    showToast('Manual imported to this item', 'success');
    await onDone?.();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function runManualWebSearch(itemId, { query = '', itemName = '' } = {}) {
  const currentQuery = String(query || '').trim();
  state.manualFinder = {
    itemId: String(itemId),
    query: currentQuery,
    results: [],
    scans: {},
    searched: true,
    error: ''
  };
  if (state.view !== 'manuals') await navigate('manuals');

  try {
    showToast(`Searching manuals${itemName ? ` for ${itemName}` : ''}...`, 'info');
    const found = await api.findManualsOnline(itemId, currentQuery);
    state.manualFinder = {
      itemId: String(itemId),
      query: found.query || currentQuery,
      results: Array.isArray(found.results) ? found.results : [],
      scans: {},
      searched: true,
      error: ''
    };
  } catch (err) {
    state.manualFinder = {
      ...state.manualFinder,
      searched: true,
      error: err.message || 'Manual search failed'
    };
    showToast(state.manualFinder.error, 'error');
  }
  await navigate('manuals');
  document.getElementById('manual-web-results')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function scanManualResultPage(itemId, url) {
  try {
    showToast('Scanning page for manual PDFs...', 'info');
    const found = await api.discoverManualLinks(itemId, url);
    state.manualFinder = {
      ...state.manualFinder,
      itemId: String(itemId),
      scans: {
        ...(state.manualFinder?.scans || {}),
        [url]: Array.isArray(found.candidates) ? found.candidates : []
      }
    };
    await navigate('manuals');
    document.getElementById('manual-web-results')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function archiveManualResult(itemId, url) {
  try {
    showToast('Saving manual into Studio Inventory...', 'info');
    await api.archiveManual(itemId, url);
    showToast('Manual saved to this item', 'success');
    state.manualFinder = { itemId: null, query: '', results: [], scans: {}, searched: false, error: '' };
    await navigate('manuals');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function bindFloorplanEvents(floorplans = []) {
  const drawWrap = container.querySelector('.floorplan-draw-wrap');
  if (drawWrap) {
    const fpId = Number(drawWrap.dataset.floorplanId);
    const fp = floorplans.find(f => String(f.id) === String(fpId))
      || floorplans.find(f => String(f.id) === String(state.floorplanId));
    if (fp) {
      initFloorplanEditor(drawWrap, {
        fp,
        onSaveGeometry: (data) => api.setFloorplanGeometry(fpId, data),
        onSaveFloorView: async (data) => {
          const updated = await api.setFloorplanFloorView(fpId, data);
          syncFloorplanInState(updated);
          Object.assign(fp, updated);
        },
        onRefresh: () => { state.studioTab = 'floorplans'; navigate('studio-setup'); },
        onToast: showToast,
        onOpenWall: (edge, { onBack }) => {
          openFloorplanWallInline(fp, edge, { setupMode: true, onBack });
        }
      });
    }
  }

  document.getElementById('floorplan-select')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) return;
    state.floorplanId = Number(val);
    state.studioTab = 'floorplans';
    navigate('studio-setup');
  });

  document.getElementById('floorplan-create')?.addEventListener('click', async () => {
    const newLoc = document.getElementById('floorplan-new-location')?.value?.trim();
    const select = document.getElementById('floorplan-select');
    const selectedText = select?.selectedOptions[0]?.textContent?.trim();
    const location = newLoc || (selectedText && selectedText !== '— Select a room —' ? selectedText : '');
    if (!location) {
      showToast('Type a new room name or select an existing room', 'error');
      return;
    }
    try {
      const existing = (state.floorplans || []).find(f => f.location === location);
      if (existing) {
        state.floorplanId = existing.id;
        state.studioTab = 'floorplans';
        showToast(`Opened “${location}”`, 'success');
        navigate('studio-setup');
        return;
      }
      const fp = await api.createFloorplan({ location });
      state.floorplanId = fp.id;
      state.studioTab = 'floorplans';
      showToast(`Room “${location}” created — draw the outline`, 'success');
      navigate('studio-setup');
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('floorplan-image-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const fpId = container.querySelector('.floorplan-editor')?.dataset.floorplanId;
    if (!file || !fpId) return;
    try {
      await api.uploadFloorplanImage(fpId, file);
      showToast('Room photo uploaded', 'success');
      state.studioTab = 'floorplans';
      navigate('studio-setup');
    } catch (err) { showToast(err.message, 'error'); }
    e.target.value = '';
  });

  container.querySelector('[data-action="fp-switch-draw"]')?.addEventListener('click', async () => {
    const fpId = container.querySelector('.floorplan-editor')?.dataset.floorplanId
      || container.querySelector('.floorplan-draw-wrap')?.dataset.floorplanId;
    if (!fpId) return;
    try {
      await api.setFloorplanGeometry(fpId, { map_mode: 'draw' });
      showToast('Switched to drawn map — outline your room', 'success');
      state.studioTab = 'floorplans';
      navigate('studio-setup');
    } catch (err) { showToast(err.message, 'error'); }
  });

  let hiddenPhotoInput = document.getElementById('floorplan-image-input-optional');
  if (!hiddenPhotoInput) {
    hiddenPhotoInput = document.createElement('input');
    hiddenPhotoInput.type = 'file';
    hiddenPhotoInput.accept = 'image/*';
    hiddenPhotoInput.hidden = true;
    hiddenPhotoInput.id = 'floorplan-image-input-optional';
    container.appendChild(hiddenPhotoInput);
  }
  if (!hiddenPhotoInput.dataset.bound) {
    hiddenPhotoInput.dataset.bound = '1';
    container.querySelector('[data-action="fp-floor-image"]')?.addEventListener('click', () => {
      hiddenPhotoInput.click();
    });
    hiddenPhotoInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const fpId = container.querySelector('.floorplan-draw-wrap')?.dataset.floorplanId;
      if (!file || !fpId) return;
      const fp = (state.floorplans || []).find(f => String(f.id) === String(fpId));
      const closed = (fp?.polygon || []).length >= 3;
      if (!closed) {
        showToast('Close the room outline first — floor image fills inside the shape only', 'error');
        e.target.value = '';
        return;
      }
      try {
        await api.uploadFloorplanImage(fpId, file);
        showToast('Floor image applied inside room outline', 'success');
        state.studioTab = 'floorplans';
        navigate('studio-setup');
      } catch (err) { showToast(err.message, 'error'); }
      e.target.value = '';
    });
  }

  container.querySelector('[data-action="fp-remove-floor-image"]')?.addEventListener('click', async () => {
    const fpId = container.querySelector('.floorplan-draw-wrap')?.dataset.floorplanId;
    if (!fpId) return;
    try {
      await api.clearFloorplanFloorImage(fpId);
      showToast('Floor image removed', 'success');
      state.floorplans = await api.floorplans();
      state.studioTab = 'floorplans';
      navigate('studio-setup');
    } catch (err) { showToast(err.message, 'error'); }
  });

  const activeFpId = () => container.querySelector('.floorplan-draw-wrap')?.dataset.floorplanId
    || container.querySelector('.floorplan-editor')?.dataset.floorplanId;

  container.querySelectorAll('[data-action="fp-wall-view"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fpId = Number(activeFpId());
      const fp = floorplans.find(f => String(f.id) === String(fpId));
      if (!fp) return;
      const edge = Number(btn.dataset.edge);
      openWallElevation({
        fp,
        wallEdge: edge,
        items: fp.items || [],
        setupMode: true,
        onUploadWallPhoto: (file) => api.uploadWallBackground(fpId, edge, file),
        onSaveWallCalibration: (data) => api.setWallBackgroundCalibration(fpId, edge, data),
        onToast: showToast
      });
    });
  });

  container.querySelector('[data-action="delete-floorplan"]')?.addEventListener('click', async () => {
    const id = container.querySelector('[data-action="delete-floorplan"]')?.dataset.id;
    if (!id || !await showModal({ title: 'Delete room setup?', message: 'Remove this room base layout (gear stays in inventory).', confirmText: 'Delete', danger: true })) return;
    await api.deleteFloorplan(id);
    state.floorplanId = null;
    showToast('Floorplan deleted', 'success');
    navigate('studio-setup');
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
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/service-worker.js').then(reg => {
    reg.update().catch(() => {});
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem('sw-reload') === '1') return;
    sessionStorage.setItem('sw-reload', '1');
    window.location.reload();
  });
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav && !nav.closest('form')) {
    e.preventDefault();
    navigate(nav.dataset.nav);
  }
});

init();
