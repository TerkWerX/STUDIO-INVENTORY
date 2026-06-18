import { escapeHtml, formatDate, fileUrl } from '../utils.js';

export function renderManuals(manuals, { searchQuery = '', ftsQuery = '', ftsResults = null, pdfSearchEnabled = true } = {}) {
  const q = searchQuery.toLowerCase();
  const filtered = manuals.filter(m =>
    !q || m.original_name.toLowerCase().includes(q) || m.item_name.toLowerCase().includes(q)
  );

  return `
    <h2 class="page-title">Manuals &amp; Documents</h2>
    <p class="page-subtitle">${filtered.length} document${filtered.length !== 1 ? 's' : ''} across all gear</p>

    <div class="toolbar manuals-toolbar">
      <div class="form-group search-box">
        <label for="manual-search">Search by name</label>
        <input type="search" id="manual-search" placeholder="Filename or item name..." value="${escapeHtml(searchQuery)}">
      </div>
    </div>

    <div class="card manual-fts-card">
      <div class="card-header">
        <h3 class="section-title">Search Inside PDFs</h3>
        ${pdfSearchEnabled ? `
          <button type="button" class="btn btn-ghost btn-sm" id="manual-reindex">Reindex All Manuals</button>
        ` : ''}
      </div>
      ${pdfSearchEnabled ? `
        <p class="text-muted-sm" style="margin-bottom:0.75rem">Full-text search across uploaded PDF manuals — finds content inside the document.</p>
        <div class="manual-fts-search-row">
          <input type="search" id="manual-fts-search" placeholder="Search manual text (e.g. phantom power, MIDI channel)..." value="${escapeHtml(ftsQuery)}">
          <button type="button" class="btn btn-primary" id="manual-fts-go">Search PDFs</button>
        </div>
        <div id="manual-fts-results" class="manual-fts-results">
          ${renderFtsResults(ftsResults, ftsQuery)}
        </div>
      ` : `
        <p class="text-muted">PDF text search requires the <code>pdf-parse</code> package. Run <code>npm install</code> on the server.</p>
      `}
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

function renderFtsResults(results, query) {
  if (!query || query.length < 2) {
    return '<p class="text-muted-sm manual-fts-hint">Enter at least 2 characters to search PDF content.</p>';
  }
  if (results === null) return '';
  if (!results.length) {
    return '<p class="text-muted manual-fts-empty">No matches in indexed PDFs. Try different terms or reindex manuals.</p>';
  }
  return `
    <ul class="manual-fts-list">
      ${results.map(r => `
        <li class="manual-fts-hit">
          <div class="manual-fts-hit-header">
            <strong>${escapeHtml(r.file_name)}</strong>
            <span class="text-muted-sm">on ${escapeHtml(r.item_name)}</span>
          </div>
          <p class="manual-fts-snippet">${r.snippet}</p>
          <div class="btn-group">
            <button type="button" class="btn btn-sm btn-ghost" data-action="view-item" data-id="${r.item_id}">View Item</button>
            <a href="${fileUrl(r.relative_path)}" target="_blank" class="btn btn-sm btn-primary">Open PDF</a>
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}