const API = '/api';
// Ordinary requests give up after two minutes. Uploads, restores, backups and
// downloads onto the studio computer pass NO_TIMEOUT: the server has its own limits.
const DEFAULT_TIMEOUT_MS = 120000;
const NO_TIMEOUT = 0;

// Before v2.6 a token was kept in localStorage; the session is now an HttpOnly cookie.
try { localStorage.removeItem('studio-owner-token'); } catch { /* storage blocked */ }

function downloadUrl(path) {
  return `${API}${path}`;
}

let ownerAuthHandler = null;
let ownerAuthPrompt = null;

/** Called when a request finds the owner session has ended; resolves true once signed in again. */
function onOwnerAuthRequired(handler) {
  ownerAuthHandler = handler;
}

function requestSignal(signal, timeoutMs) {
  const signals = [signal];
  if (timeoutMs && typeof AbortSignal.timeout === 'function') signals.push(AbortSignal.timeout(timeoutMs));
  const active = signals.filter(Boolean);
  if (active.length <= 1) return active[0];
  return typeof AbortSignal.any === 'function' ? AbortSignal.any(active) : active[0];
}

async function request(path, options = {}) {
  const { timeoutMs = options.body instanceof FormData ? NO_TIMEOUT : DEFAULT_TIMEOUT_MS, retried = false, ...fetchOptions } = options;
  fetchOptions.signal = requestSignal(fetchOptions.signal, timeoutMs);
  let res;
  try {
    res = await fetch(`${API}${path}`, fetchOptions);
  } catch (err) {
    if (err?.name === 'AbortError' && options.signal?.aborted) throw err; // cancelled on purpose
    if (err?.name === 'TimeoutError') throw new Error('The studio computer took too long to answer. Try again.');
    throw new Error("Can't reach Studio Inventory. Check that the studio computer is on and the app is running.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401 && err.ownerAuthRequired && ownerAuthHandler && !retried && !path.startsWith('/auth/')) {
      // Sign in once (shared by every request waiting on it), then try again.
      ownerAuthPrompt ||= Promise.resolve(ownerAuthHandler()).finally(() => { ownerAuthPrompt = null; });
      if (await ownerAuthPrompt) return request(path, { ...options, retried: true });
    }
    const out = new Error(err.error || `Request failed (${res.status})`);
    Object.assign(out, err, { status: res.status });
    throw out;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  onOwnerAuthRequired,
  health: () => request('/health'),
  authStatus: () => request('/auth/status'),
  setupOwnerPin: async (pin) => {
    const result = await request('/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    return result;
  },
  ownerLogin: async (pin) => {
    const result = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    return result;
  },
  updateCheck: (force = false) => request(`/update-check${force ? '?force=1' : ''}`),
  stats: () => request('/stats'),
  meta: () => request('/meta'),
  items: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return request(`/items${qs ? '?' + qs : ''}`);
  },
  item: (id) => request(`/items/${id}`),
  scanLink: (id, baseUrl = '') => request(`/items/${id}/scan-link${baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : ''}`),
  photoLink: (id, baseUrl = '') => request(`/items/${id}/photo-link${baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : ''}`),
  createItem: (data) => request('/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateItem: (id, data) => request(`/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteItem: (id, { erase = false, confirmName = '' } = {}) => request(`/items/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ erase, confirmName })
  }),
  uploadPhotos: (itemId, files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return request(`/items/${itemId}/photos`, { method: 'POST', body: fd });
  },
  uploadManual: (itemId, fileOrFiles) => {
    const fd = new FormData();
    const list = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    const field = list.length > 1 ? 'files' : 'file';
    for (const file of list) fd.append(field, file);
    return request(`/items/${itemId}/manuals`, { method: 'POST', body: fd });
  },
  archiveManual: (itemId, url, description = '') => request(`/items/${itemId}/manuals/archive`, {
    timeoutMs: NO_TIMEOUT,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, description })
  }),
  findManualsOnline: (itemId, query = '', kind = 'all') => request(`/items/${itemId}/manuals/web-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, kind })
  }),
  discoverManualLinks: (itemId, url) => request(`/items/${itemId}/manuals/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  }),
  uploadReceipt: (itemId, file, description = '') => {
    const fd = new FormData();
    fd.append('file', file);
    if (description) fd.append('description', description);
    return request(`/items/${itemId}/receipts`, { method: 'POST', body: fd });
  },
  uploadSoftware: (itemId, file, version, description) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('version', version || '');
    fd.append('description', description || '');
    return request(`/items/${itemId}/software/upload`, { method: 'POST', body: fd });
  },
  archiveSoftware: (itemId, url, version, description) => request(`/items/${itemId}/software/archive`, {
    timeoutMs: NO_TIMEOUT,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, version, description })
  }),
  deleteAttachment: (id) => request(`/attachments/${id}`, { method: 'DELETE' }),
  brands: () => request('/brands'),
  brand: (name) => request(`/brands/${encodeURIComponent(name)}`),
  fetchBrandLogo: (name, force = false) => request(`/brands/${encodeURIComponent(name)}/fetch-logo${force ? '?force=1' : ''}`, { method: 'POST' }),
  fetchAllBrandLogos: (force = false) => request(`/brands/fetch-all${force ? '?force=1' : ''}`, { method: 'POST', timeoutMs: NO_TIMEOUT }),
  uploadBrandLogo: (name, file) => {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('logo', file);
    return request('/brands/logo', { method: 'POST', body: fd });
  },
  manuals: () => request('/manuals'),
  serverLog: () => request('/logs'),
  shutdown: () => request('/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  openServerLog: () => request('/logs/open', { method: 'POST' }),
  manualInbox: () => request('/manual-inbox'),
  openManualInbox: () => request('/manual-inbox/open', { method: 'POST' }),
  importManualFromInbox: (itemId, filename) => request(`/items/${itemId}/manuals/import-inbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename })
  }),
  documents: () => request('/documents'),
  exportFullBackup: () => window.open(downloadUrl('/export/full'), '_blank'),
  backupFolder: () => request('/backup/folder'),
  setBackupFolder: (dir, keep) => request('/backup/folder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir, keep })
  }),
  runFolderBackup: () => request('/backup/folder/run', { method: 'POST', timeoutMs: NO_TIMEOUT }),
  refreshRecoveryCopy: () => request('/backup/recovery-copy', { method: 'POST', timeoutMs: NO_TIMEOUT }),
  recoveryKey: () => request('/backup/recovery-key'),
  confirmRecoveryKey: (recoveryKey) => request('/backup/recovery-key/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recoveryKey })
  }),
  moveBackupLeftovers: () => request('/backup/move-leftovers', { method: 'POST' }),
  encryptCatalog: () => request('/backup/encrypt', { method: 'POST', timeoutMs: NO_TIMEOUT }),
  exportJson: () => window.open(downloadUrl('/export/json'), '_blank'),
  exportSql: () => window.open(downloadUrl('/export/sql'), '_blank'),
  exportCsv: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    window.open(downloadUrl(`/export/csv${qs ? '?' + qs : ''}`), '_blank');
  },
  importFullBackup: (file) => {
    const fd = new FormData();
    fd.append('backup', file);
    return request('/import/full', { method: 'POST', body: fd });
  },
  importJson: (data, replace = false, confirmPhrase = '') => request('/import/json', {
    timeoutMs: NO_TIMEOUT,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: data.items || data,
      software_licenses: Array.isArray(data.software_licenses) ? data.software_licenses : undefined,
      replace,
      confirmPhrase
    })
  }),
  importCsv: (csvText) => request('/import/csv', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csvText
  }),
  addMaintenance: (itemId, data) => request(`/items/${itemId}/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  deleteMaintenance: (id) => request(`/maintenance/${id}`, { method: 'DELETE' }),
  loans: () => request('/loans'),
  checkoutItem: (itemId, data) => request(`/items/${itemId}/loans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  returnLoan: (loanId, data) => request(`/loans/${loanId}/return`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  deleteLoan: (id) => request(`/loans/${id}`, { method: 'DELETE' }),
  studioMap: () => request('/studio/map'),
  racks: () => request('/racks'),
  createRack: (data) => request('/racks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteRack: (id) => request(`/racks/${id}`, { method: 'DELETE' }),
  // Racks, chains and map pins change one entry at a time, so two devices can't undo each other's edits.
  addRackItem: (id, itemId, slotLabel = '') => request(`/racks/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: itemId, slot_label: slotLabel }) }),
  removeRackItem: (id, itemId) => request(`/racks/${id}/items/${itemId}`, { method: 'DELETE' }),
  signalChains: () => request('/signal-chains'),
  createSignalChain: (data) => request('/signal-chains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteSignalChain: (id) => request(`/signal-chains/${id}`, { method: 'DELETE' }),
  addSignalChainItem: (id, itemId) => request(`/signal-chains/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: itemId }) }),
  removeSignalChainItem: (id, itemId) => request(`/signal-chains/${id}/items/${itemId}`, { method: 'DELETE' }),
  brandLogoSettings: () => request('/settings/brand-logos'),
  updateBrandLogoSettings: (lookups) => request('/settings/brand-logos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lookups: !!lookups }) }),
  guestSettings: () => request('/settings/guest'),
  updateGuestSettings: (data) => request('/settings/guest', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  regenerateGuestToken: () => request('/settings/guest/regenerate', { method: 'POST' }),
  searchManuals: (q) => request(`/manuals/search?q=${encodeURIComponent(q)}`),
  reindexManuals: () => request('/manuals/reindex', { method: 'POST', timeoutMs: NO_TIMEOUT }),
  lookup: (code) => request(`/lookup?code=${encodeURIComponent(code)}`),
  scanLabel: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return request('/label-scan', { method: 'POST', body: fd });
  },
  floorplans: async () => {
    const data = await request('/floorplans');
    if (!Array.isArray(data)) {
      throw new Error('Could not load floorplans — restart Studio Inventory (npm start) to pick up the latest server.');
    }
    return data;
  },
  createFloorplan: (data) => request('/floorplans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  uploadFloorplanImage: (id, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return request(`/floorplans/${id}/image`, { method: 'POST', body: fd });
  },
  clearFloorplanFloorImage: (id) => request(`/floorplans/${id}/floor-image`, { method: 'DELETE' }),
  setFloorplanFloorView: (id, data) => request(`/floorplans/${id}/floor-image/view`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  setFloorplanGeometry: (id, data) => request(`/floorplans/${id}/geometry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  /** upsert: pins to add or move (fields left out keep their saved values); remove: item ids to take off the map. */
  updateFloorplanItems: (id, { upsert = [], remove = [] } = {}) => request(`/floorplans/${id}/items`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upsert, remove })
  }),
  deleteFloorplan: (id) => request(`/floorplans/${id}`, { method: 'DELETE' }),
  itemPlacement: (id) => request(`/items/${id}/placement`),
  uploadWallPhoto: (itemId, formData) => request(`/items/${itemId}/wall-photo`, { method: 'POST', body: formData }),
  saveWallCutout: (itemId, data) => request(`/items/${itemId}/wall-cutout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  clearWallCutout: (itemId) => request(`/items/${itemId}/wall-cutout`, { method: 'DELETE' }),
  uploadWallBackground: (floorplanId, edge, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return request(`/floorplans/${floorplanId}/walls/${edge}/photo`, { method: 'POST', body: fd });
  },
  setWallBackgroundCalibration: (floorplanId, edge, data) => request(`/floorplans/${floorplanId}/walls/${edge}/calibration`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  wallRehang: (itemId, action) => request(`/items/${itemId}/wall-rehang`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  }),
  software: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return request(`/software${qs ? '?' + qs : ''}`);
  },
  softwareItem: (id) => request(`/software/${id}`),
  createSoftware: (data) => request('/software', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateSoftware: (id, data) => request(`/software/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteSoftware: (id, { erase = false, confirmName = '' } = {}) => request(`/software/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ erase, confirmName })
  }),
  uploadSoftwareScreenshot: (id, file) => {
    const fd = new FormData();
    fd.append('screenshot', file);
    return request(`/software/${id}/screenshot`, { method: 'POST', body: fd });
  },
  removeSoftwareScreenshot: (id) => request(`/software/${id}/screenshot`, { method: 'DELETE' })
};
