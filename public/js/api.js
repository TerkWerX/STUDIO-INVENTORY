const API = '/api';
const OWNER_TOKEN_KEY = 'studio-owner-token';

function ownerToken() {
  return localStorage.getItem(OWNER_TOKEN_KEY) || '';
}

function setOwnerToken(token) {
  if (token) localStorage.setItem(OWNER_TOKEN_KEY, token);
  else localStorage.removeItem(OWNER_TOKEN_KEY);
}

function withOwnerHeaders(options = {}) {
  const token = ownerToken();
  if (!token) return options;
  const headers = new Headers(options.headers || {});
  headers.set('X-Studio-Owner-Token', token);
  return { ...options, headers };
}

function downloadUrl(path) {
  const token = ownerToken();
  if (!token) return `${API}${path}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${API}${path}${sep}owner_token=${encodeURIComponent(token)}`;
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, withOwnerHeaders(options));
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const out = new Error(err.error || `Request failed (${res.status})`);
    Object.assign(out, err, { status: res.status });
    throw out;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  ownerToken,
  setOwnerToken,
  health: () => request('/health'),
  authStatus: () => request('/auth/status'),
  setupOwnerPin: async (pin) => {
    const result = await request('/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    setOwnerToken(result.token);
    return result;
  },
  ownerLogin: async (pin) => {
    const result = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    setOwnerToken(result.token);
    return result;
  },
  updateCheck: () => request('/update-check'),
  stats: () => request('/stats'),
  meta: () => request('/meta'),
  items: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return request(`/items${qs ? '?' + qs : ''}`);
  },
  item: (id) => request(`/items/${id}`),
  createItem: (data) => request('/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateItem: (id, data) => request(`/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteItem: (id) => request(`/items/${id}`, { method: 'DELETE' }),
  uploadPhotos: (itemId, files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return request(`/items/${itemId}/photos`, { method: 'POST', body: fd });
  },
  uploadManual: (itemId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(`/items/${itemId}/manuals`, { method: 'POST', body: fd });
  },
  archiveManual: (itemId, url, description = '') => request(`/items/${itemId}/manuals/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, description })
  }),
  findManualsOnline: (itemId, query = '') => request(`/items/${itemId}/manuals/web-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, version, description })
  }),
  deleteAttachment: (id) => request(`/attachments/${id}`, { method: 'DELETE' }),
  brands: () => request('/brands'),
  brand: (name) => request(`/brands/${encodeURIComponent(name)}`),
  fetchBrandLogo: (name, force = false) => request(`/brands/${encodeURIComponent(name)}/fetch-logo${force ? '?force=1' : ''}`, { method: 'POST' }),
  fetchAllBrandLogos: (force = false) => request(`/brands/fetch-all${force ? '?force=1' : ''}`, { method: 'POST' }),
  uploadBrandLogo: (name, file) => {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('logo', file);
    return request('/brands/logo', { method: 'POST', body: fd });
  },
  manuals: () => request('/manuals'),
  manualInbox: () => request('/manual-inbox'),
  openManualInbox: () => request('/manual-inbox/open', { method: 'POST' }),
  importManualFromInbox: (itemId, filename) => request(`/items/${itemId}/manuals/import-inbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename })
  }),
  documents: () => request('/documents'),
  exportFullBackup: () => window.open(downloadUrl('/export/full'), '_blank'),
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
  importJson: (data, replace = false) => request('/import/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: data.items || data, replace })
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
  setRackItems: (id, items) => request(`/racks/${id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }),
  signalChains: () => request('/signal-chains'),
  createSignalChain: (data) => request('/signal-chains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteSignalChain: (id) => request(`/signal-chains/${id}`, { method: 'DELETE' }),
  setSignalChainItems: (id, items) => request(`/signal-chains/${id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }),
  guestSettings: () => request('/settings/guest'),
  updateGuestSettings: (data) => request('/settings/guest', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  regenerateGuestToken: () => request('/settings/guest/regenerate', { method: 'POST' }),
  searchManuals: (q) => request(`/manuals/search?q=${encodeURIComponent(q)}`),
  reindexManuals: () => request('/manuals/reindex', { method: 'POST' }),
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
  setFloorplanItems: (id, items) => request(`/floorplans/${id}/items`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
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
  deleteSoftware: (id) => request(`/software/${id}`, { method: 'DELETE' }),
  uploadSoftwareScreenshot: (id, file) => {
    const fd = new FormData();
    fd.append('screenshot', file);
    return request(`/software/${id}/screenshot`, { method: 'POST', body: fd });
  },
  removeSoftwareScreenshot: (id) => request(`/software/${id}/screenshot`, { method: 'DELETE' })
};
