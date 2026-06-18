export function renderAbout() {
  return `
    <h2 class="page-title">Help &amp; About</h2>
    <p class="page-subtitle">Studio Inventory v1.0 — Local music gear management</p>

    <div class="card">
      <h3 class="section-title">Getting Started</h3>
      <p style="margin-bottom:1rem;color:var(--text-secondary)">
        Studio Inventory runs locally on your studio computer (Intel NUC). All data is stored on your machine — no cloud, no internet required after the app loads.
      </p>
      <ul style="list-style:disc;padding-left:1.5rem;color:var(--text-secondary);line-height:2">
        <li><strong>Dashboard</strong> — Overview of total value, categories, and recent items.</li>
        <li><strong>Inventory</strong> — Browse, search, and filter all gear. Click any row to view details.</li>
        <li><strong>Add Item</strong> — Enter full details including serial numbers, values, and tags.</li>
        <li><strong>Manuals</strong> — Global searchable list of all uploaded PDF manuals.</li>
        <li><strong>Reports</strong> — Export PDF, CSV, or JSON reports for records.</li>
        <li><strong>Insurance</strong> — Formatted report with photos, serials, and values for claims.</li>
        <li><strong>Backup</strong> — Export and import your entire database.</li>
        <li><strong>Software Archive</strong> — Download and store drivers/firmware from manufacturer URLs.</li>
        <li><strong>Auto-Estimate</strong> — Search Reverb/eBay for current replacement values.</li>
      </ul>
      <p style="margin-top:1rem;color:var(--text-muted)">This app tracks <strong>physical hardware only</strong> — not sample libraries or sound assets.</p>
    </div>

    <div class="card">
      <h3 class="section-title">Keyboard Shortcuts</h3>
      <div class="detail-grid">
        <div class="detail-field"><div class="field-label">Ctrl + N</div><div class="field-value">Add new item</div></div>
        <div class="detail-field"><div class="field-label">Ctrl + F</div><div class="field-value">Focus search (on Inventory)</div></div>
        <div class="detail-field"><div class="field-label">Ctrl + S</div><div class="field-value">Save item (on form)</div></div>
        <div class="detail-field"><div class="field-label">Escape</div><div class="field-value">Close modal / go back</div></div>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Backup Procedures (Important!)</h3>
      <p style="color:var(--text-secondary);margin-bottom:1rem">
        Regular backups protect your inventory data for insurance purposes. We recommend backing up monthly or after adding valuable items.
      </p>
      <ol style="list-style:decimal;padding-left:1.5rem;color:var(--text-secondary);line-height:2">
        <li>Go to <strong>Backup</strong> in the sidebar.</li>
        <li>Click <strong>Export JSON</strong> — saves a complete copy of all items and tags.</li>
        <li>Optionally export <strong>SQL Dump</strong> for database-level backup.</li>
        <li>Store backups on an external drive, NAS, or cloud storage you control.</li>
        <li>Copy <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">data/inventory.db</code> and the entire <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">data/uploads/</code> folder for a complete backup including photos and archived software.</li>
      </ol>
    </div>

    <div class="card">
      <h3 class="section-title">Updating Replacement Values</h3>
      <p style="color:var(--text-secondary);line-height:1.8">
        Replacement values should be updated periodically to reflect current market prices. Edit any item and update the <strong>Replacement Value</strong> field.
        Use the <strong>Replacement Value Note</strong> to record your source (e.g., manufacturer MSRP, Reverb average, insurance appraisal date).
        For insurance reports, accurate serial numbers and photos are especially important.
      </p>
    </div>

    <div class="card">
      <h3 class="section-title">Running on Your NUC</h3>
      <p style="color:var(--text-secondary);line-height:1.8">
        Start the server with <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">npm start</code> from the project folder.
        Open <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">http://localhost:3847</code> in your browser.
        For TV display, connect the NUC via HDMI and use full-screen mode (F11).
        The interface is optimized for large 4K screens with large fonts and touch-friendly controls.
      </p>
    </div>
  `;
}

export function renderBackup() {
  return `
    <h2 class="page-title">Backup &amp; Restore</h2>
    <p class="page-subtitle">Protect your inventory data</p>

    <div class="card" style="border-left:4px solid var(--warning)">
      <h3 class="section-title">⚠ Backup Reminder</h3>
      <p style="color:var(--text-secondary)">
        Your inventory data is stored locally. Regular backups are essential for insurance documentation.
        Export your data at least once a month.
      </p>
    </div>

    <div class="card">
      <h3 class="section-title">Export Data</h3>
      <p style="color:var(--text-secondary);margin-bottom:1rem">Download a complete copy of your inventory.</p>
      <div class="btn-group">
        <button type="button" class="btn btn-primary" id="backup-export-json">Export JSON</button>
        <button type="button" class="btn btn-secondary" id="backup-export-sql">Export SQL Dump</button>
        <button type="button" class="btn btn-secondary" id="backup-export-csv">Export CSV</button>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Import Data</h3>
      <p style="color:var(--text-secondary);margin-bottom:1rem">
        Restore from a previously exported JSON file. Choose whether to merge or replace all existing data.
      </p>
      <div class="form-group" style="margin-bottom:1rem">
        <label>
          <input type="checkbox" id="import-replace"> Replace all existing data (destructive)
        </label>
      </div>
      <label class="btn btn-secondary" style="cursor:pointer">
        Choose JSON File
        <input type="file" id="import-file" accept=".json,application/json" hidden>
      </label>
      <p id="import-status" style="margin-top:1rem;color:var(--text-muted)"></p>
    </div>

    <div class="card">
      <h3 class="section-title">Database Location</h3>
      <p style="color:var(--text-secondary)">
        The SQLite database file is stored at <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">data/inventory.db</code>.
        Uploaded photos and manuals are in <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">data/uploads/</code>.
        You can copy these folders directly for a full backup.
      </p>
    </div>
  `;
}