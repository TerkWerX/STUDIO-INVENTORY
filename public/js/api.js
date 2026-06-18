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
  })
};