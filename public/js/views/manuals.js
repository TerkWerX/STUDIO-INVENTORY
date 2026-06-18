import { escapeHtml, formatDate, fileUrl } from '../utils.js';

export function renderManuals(manuals, searchQuery = '') {
  const q = searchQuery.toLowerCase();
  const filtered = manuals.filter(m =>
    !q || m.original_name.toLowerCase().includes(q) || m.item_name.toLowerCase().includes(q)
  );

  return `
    <h2 class="page-title">Manuals &amp; Documents</h2>
    <p class="page-subtitle">${filtered.length} document${filtered.length !== 1 ? 's' : ''} across all gear</p>

    <div class="toolbar">
      <div class="form-group search-box">
        <label for="manual-search">Search</label>
        <input type="search" id="manual-search" placeholder="Search by filename or item name..." value="${escapeHtml(searchQuery)}">
      </div>
    </div>

    ${filtered.length === 0 ? `
      <div class="empty-state">
        <h3>No documents found</h3>
        <p>Upload PDF manuals from any item's detail page.</p>
      </div>
    ` : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Document</th><th>Item</th><th>Uploaded</th><th>Actions</th></tr></thead>
          <tbody>
            ${filtered.map(m => `
              <tr>
                <td><span class="doc-icon-inline">📄</span> <strong>${escapeHtml(m.original_name)}</strong></td>
                <td><button type="button" class="btn btn-ghost btn-sm" data-action="view-item" data-id="${m.item_id}">${escapeHtml(m.item_name)}</button></td>
                <td>${formatDate(m.created_at?.split(' ')[0])}</td>
                <td>
                  <div class="btn-group">
                    <a href="${fileUrl(m.relative_path)}" target="_blank" class="btn btn-sm btn-primary">Open</a>
                    ${(m.mime_type === 'application/pdf' || (m.original_name || '').toLowerCase().endsWith('.pdf'))
                      ? `<button type="button" class="btn btn-sm btn-ghost" data-action="print-manual-pdf" data-path="${escapeHtml(m.relative_path)}" data-name="${escapeHtml(m.original_name)}">Print PDF</button>`
                      : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}