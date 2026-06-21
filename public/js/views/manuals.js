import { escapeHtml, formatDate, fileUrl } from '../utils.js';

export function renderManuals(manuals, {
  searchQuery = '',
  ftsQuery = '',
  ftsResults = null,
  pdfSearchEnabled = true,
  items = [],
  finder = {},
  inbox = { dir: '', files: [] }
} = {}) {
  const q = searchQuery.toLowerCase();
  const itemMatches = (item) => {
    const haystack = [item.name, item.common_name, item.brand, item.model, item.category, item.serial_number, item.year]
      .map(v => String(v ?? '').toLowerCase())
      .join(' ');
    return !q || haystack.includes(q);
  };
  const filtered = manuals.filter(m =>
    !q || String(m.original_name || '').toLowerCase().includes(q) || String(m.item_name || '').toLowerCase().includes(q)
  );
  const missingManualItems = items.filter(item => !(item.manuals || []).length);
  const missingFiltered = missingManualItems.filter(itemMatches);

  return `
    <h2 class="page-title">Manuals &amp; Documents</h2>
    <p class="page-subtitle">${filtered.length} uploaded document${filtered.length !== 1 ? 's' : ''} across all gear${missingManualItems.length ? ` · ${missingManualItems.length} item${missingManualItems.length !== 1 ? 's' : ''} need manual lookup` : ''}</p>

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

    ${items.length ? `
      <div class="card manual-finder-card">
        <div class="card-header">
          <h3 class="section-title">Find Manuals Online</h3>
        </div>
        <p class="text-muted-sm manual-finder-help">Curated online results are shown here inside Studio Inventory. Direct PDF/manual links can be saved straight to the selected item.</p>
        ${renderManualInboxPanel(inbox)}
        ${missingFiltered.length ? `
          <div class="manual-finder-list">
            ${missingFiltered.map(item => `
              <div class="manual-finder-row">
                <div class="manual-finder-info">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span class="text-muted-sm">${escapeHtml([item.brand, item.model, item.year].filter(Boolean).join(' · ') || item.category || 'Inventory item')}</span>
                </div>
                <div class="btn-group">
                  <button type="button" class="btn btn-sm btn-primary" data-action="manual-web-search" data-id="${item.id}" data-name="${escapeHtml(item.name)}">Find Online</button>
                  <button type="button" class="btn btn-sm btn-secondary" data-action="manual-inbox-import" data-id="${item.id}" data-name="${escapeHtml(item.name)}">Import from Inbox</button>
                  <button type="button" class="btn btn-sm btn-secondary" data-action="archive-manual-url" data-id="${item.id}" data-name="${escapeHtml(item.name)}">Save from URL</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-action="view-item" data-id="${item.id}">View Item</button>
                </div>
              </div>
            `).join('')}
          </div>
          ${renderManualFinderResults(items, finder)}
        ` : `
          <p class="text-muted">${q ? 'No manual lookup candidates match this search.' : 'Every item already has a manual or document attached.'}</p>
        `}
      </div>
    ` : ''}

    ${filtered.length === 0 ? `
      <div class="empty-state">
        <h3>No documents found</h3>
        <p>Upload PDF manuals from any item's detail page, or use the online lookup buttons above to find them first.</p>
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

function renderManualInboxPanel(inbox = {}) {
  const files = Array.isArray(inbox.files) ? inbox.files : [];
  return `
    <div class="manual-inbox-panel">
      <div class="manual-inbox-main">
        <strong>Manual Inbox</strong>
        <span class="text-muted-sm">When an outside browser is unavoidable, save PDFs here, then import them to the matching item.</span>
        <code>${escapeHtml(inbox.dir || 'data/manual-inbox')}</code>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm btn-secondary" data-action="open-manual-inbox">Open Folder</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="refresh-manual-inbox">Refresh</button>
      </div>
      ${files.length ? `
        <div class="manual-inbox-files">
          ${files.slice(0, 6).map(file => `<span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`).join('')}
          ${files.length > 6 ? `<span class="text-muted-sm">+${files.length - 6} more</span>` : ''}
        </div>
      ` : `<p class="text-muted-sm manual-inbox-empty">Inbox is empty.</p>`}
    </div>
  `;
}

function renderManualFinderResults(items, finder = {}) {
  if (!finder.itemId) return '';
  const item = items.find(i => String(i.id) === String(finder.itemId));
  if (!item) return '';
  const results = Array.isArray(finder.results) ? finder.results : [];
  const scans = finder.scans || {};
  return `
    <div class="manual-web-results" id="manual-web-results">
      <div class="manual-web-header">
        <div>
          <h4>Results for ${escapeHtml(item.name)}</h4>
          <p class="text-muted-sm">${escapeHtml(finder.query || [item.brand, item.model, item.name].filter(Boolean).join(' '))}</p>
        </div>
        <div class="manual-web-search-row">
          <input type="search" id="manual-web-query" value="${escapeHtml(finder.query || '')}" placeholder="Refine manual search">
          <button type="button" class="btn btn-sm btn-primary" data-action="manual-web-search-go" data-id="${item.id}" data-name="${escapeHtml(item.name)}">Search</button>
        </div>
      </div>
      ${finder.error ? `<p class="status-off">${escapeHtml(finder.error)}</p>` : ''}
      ${results.length ? `
        <div class="manual-web-list">
          ${results.map(result => {
    const candidates = scans[result.url];
    return `
              <div class="manual-web-result">
                <div class="manual-web-result-main">
                  <strong>${escapeHtml(result.title || result.url)}</strong>
                  <span class="text-muted-sm">${escapeHtml(result.displayUrl || result.url)}</span>
                  ${result.snippet ? `<p class="text-muted-sm">${escapeHtml(result.snippet)}</p>` : ''}
                </div>
                <div class="btn-group">
                  ${result.isPdf
        ? `<button type="button" class="btn btn-sm btn-primary" data-action="archive-manual-result" data-id="${finder.itemId}" data-url="${escapeHtml(result.url)}">Save to Item</button>`
        : `<button type="button" class="btn btn-sm btn-secondary" data-action="scan-manual-result" data-id="${finder.itemId}" data-url="${escapeHtml(result.url)}">Scan for PDFs</button>`}
                </div>
                ${Array.isArray(candidates) ? renderManualCandidates(finder.itemId, candidates) : ''}
              </div>
            `;
  }).join('')}
        </div>
      ` : `<p class="text-muted">${finder.searched ? 'No search results found. Try a shorter model number or manufacturer name.' : 'Choose Find Online on an item above.'}</p>`}
    </div>
  `;
}

function renderManualCandidates(itemId, candidates) {
  if (!candidates.length) {
    return '<p class="text-muted-sm manual-web-candidates-empty">No PDF/manual links found on that page.</p>';
  }
  return `
    <div class="manual-web-candidates">
      ${candidates.map(c => `
        <div class="manual-web-candidate">
          <span>${escapeHtml(c.title || c.displayUrl || c.url)}</span>
          <button type="button" class="btn btn-sm btn-primary" data-action="archive-manual-result" data-id="${itemId}" data-url="${escapeHtml(c.url)}">Save to Item</button>
        </div>
      `).join('')}
    </div>
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
