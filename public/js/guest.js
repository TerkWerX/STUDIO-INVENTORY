import { formatCurrency, escapeHtml } from './utils.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const root = document.getElementById('guest-content');
const subtitle = document.getElementById('guest-subtitle');

const API = `/api/guest/${encodeURIComponent(token)}`;

async function api(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Access denied');
  }
  return res.json();
}

function renderList(items) {
  if (!items.length) {
    root.innerHTML = '<div class="empty-state"><h3>No gear listed</h3></div>';
    return;
  }
  root.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Brand / Model</th><th>Location</th><th>Value</th></tr></thead>
        <tbody>
          ${items.filter(i => !i.parent_item_id).map(i => `
            <tr data-id="${i.id}" class="guest-row" style="cursor:pointer">
              <td><strong>${escapeHtml(i.name)}</strong></td>
              <td>${escapeHtml(i.category)}</td>
              <td>${escapeHtml(i.brand)} ${escapeHtml(i.model)}</td>
              <td>${escapeHtml(i.location)}</td>
              <td class="value-cell">${formatCurrency(i.replacement_value)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div id="guest-detail" class="card hidden" style="margin-top:1.5rem"></div>
  `;

  root.querySelectorAll('.guest-row').forEach(row => {
    row.addEventListener('click', async () => {
      const item = await api(`/items/${row.dataset.id}`);
      showDetail(item);
    });
  });
}

function showDetail(item) {
  const el = document.getElementById('guest-detail');
  el.classList.remove('hidden');
  const photo = item.photos?.[0];
  el.innerHTML = `
    <h3>${escapeHtml(item.name)}</h3>
    <p class="text-muted">${escapeHtml(item.brand)} ${escapeHtml(item.model)} · ${escapeHtml(item.category)}</p>
    ${photo ? `<img src="/uploads/${photo.relative_path}" alt="" style="max-width:320px;border-radius:8px;margin:1rem 0">` : ''}
    <div class="detail-grid">
      <div class="detail-field"><div class="field-label">Serial</div><div class="field-value">${escapeHtml(item.serial_number) || '—'}</div></div>
      <div class="detail-field"><div class="field-label">Location</div><div class="field-value">${escapeHtml(item.location) || '—'}</div></div>
      <div class="detail-field"><div class="field-label">Replacement</div><div class="field-value">${formatCurrency(item.replacement_value)}</div></div>
      <div class="detail-field"><div class="field-label">Condition</div><div class="field-value">${escapeHtml(item.condition)}</div></div>
    </div>
    <button type="button" class="btn btn-ghost btn-sm" id="guest-back">← Back to list</button>
  `;
  document.getElementById('guest-back')?.addEventListener('click', () => el.classList.add('hidden'));
  el.scrollIntoView({ behavior: 'smooth' });
}

async function init() {
  if (!token) {
    root.innerHTML = '<div class="empty-state"><h3>Invalid link</h3><p>Ask the studio owner for a guest URL.</p></div>';
    return;
  }
  try {
    const health = await api('/health');
    const stats = await api('/stats');
    subtitle.textContent = `${health.itemCount} items · ${formatCurrency(stats.totals.total_replacement)} total replacement value`;
    const items = await api('/items?sort=name');
    renderList(items);
  } catch (err) {
    subtitle.textContent = '';
    root.innerHTML = `<div class="empty-state"><h3>Cannot connect</h3><p>${escapeHtml(err.message)}</p><p class="text-muted-sm">Guest access may be disabled, or you must be on the same Wi‑Fi network.</p></div>`;
  }
}

init();