const API = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  health: () => request('/health'),
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
  documents: () => request('/documents'),
  exportJson: () => window.open('/api/export/json', '_blank'),
  exportSql: () => window.open('/api/export/sql', '_blank'),
  exportCsv: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    window.open(`/api/export/csv${qs ? '?' + qs : ''}`, '_blank');
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
  floorplans: () => request('/floorplans'),
  createFloorplan: (data) => request('/floorplans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  uploadFloorplanImage: (id, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return request(`/floorplans/${id}/image`, { method: 'POST', body: fd });
  },
  setFloorplanItems: (id, items) => request(`/floorplans/${id}/items`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  }),
  deleteFloorplan: (id) => request(`/floorplans/${id}`, { method: 'DELETE' })
};