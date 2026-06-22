import { escapeHtml } from '../utils.js';

export function renderAbout() {
  return `
    <h2 class="page-title">Help &amp; About</h2>
    <p class="page-subtitle">Studio Inventory v2.2 — Local music gear management</p>

    <div class="card">
      <h3 class="section-title">Getting Started</h3>
      <p style="margin-bottom:1rem;color:var(--text-secondary)">
        Studio Inventory runs locally on your studio computer (Windows, Mac, or Linux). All data is stored on your machine — no cloud, no internet required after the app loads.
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
        <li><strong>Owner Labels</strong> — Print QR labels on your DYMO LabelWriter. Scan with any phone to open manuals, software, and item details.</li>
        <li><strong>Binder Print</strong> — Print a complete 3-ring binder (cover, index, one page per item) or single gear pages as you add equipment. Manual PDFs print only when you choose.</li>
        <li><strong>Documentation checklist</strong> — Dashboard and each item show what's still missing (photo, serial, receipt, manual, current value).</li>
        <li><strong>Maintenance log</strong> — Service history per item (repairs, tubes, calibration).</li>
        <li><strong>Studio status</strong> — Mark gear as loaned, in repair, storage, or away.</li>
        <li><strong>Phone photo upload</strong> — Scan QR on an item to add photos from your phone on the same Wi‑Fi.</li>
        <li><strong>CSV bulk import</strong> — Import dozens of items from a spreadsheet on the Backup page.</li>
        <li><strong>Studio View</strong> — Full-screen room map and wall elevations; tap gear for item info or manuals.</li>
        <li><strong>Studio Setup</strong> — Draw rooms, floor textures, wall photos, racks, and signal chains.</li>
        <li><strong>Guest link</strong> — Read-only LAN sharing for bandmates (Backup page).</li>
        <li><strong>Depreciation &amp; insurance flags</strong> — Track depreciated value and policy-listed items.</li>
        <li><strong>Accessories</strong> — Link cases, cables, and spare parts to parent gear.</li>
        <li><strong>PDF manual search</strong> — Full-text search inside uploaded PDF manuals.</li>
        <li><strong>Loan tracking</strong> — Check gear out to bandmates, set due dates, mark returned, full history.</li>
        <li><strong>Scan &amp; lookup</strong> — USB barcode scanner, camera QR/barcode, or serial number → open item.</li>
        <li><strong>Item placement</strong> — From each item page, place on wall (with other gear visible), floor, rack, or another room.</li>
        <li><strong>Software &amp; plugins</strong> — Catalog DAWs and VSTs with license keys, renewal dates, and interface screenshots.</li>
      </ul>
      <p style="margin-top:1rem;color:var(--text-muted)">Tracks <strong>physical hardware</strong> and <strong>software licenses</strong> — not individual sample libraries or sound packs.</p>
    </div>

    <div class="card">
      <h3 class="section-title">Keyboard Shortcuts</h3>
      <div class="detail-grid">
        <div class="detail-field"><div class="field-label">Ctrl / ⌘ + N</div><div class="field-value">Add new item</div></div>
        <div class="detail-field"><div class="field-label">Ctrl / ⌘ + F</div><div class="field-value">Focus search (on Inventory)</div></div>
        <div class="detail-field"><div class="field-label">Ctrl / ⌘ + S</div><div class="field-value">Save item (on form)</div></div>
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
      <h3 class="section-title">Owner Labels &amp; QR Codes</h3>
      <ol style="list-style:decimal;padding-left:1.5rem;color:var(--text-secondary);line-height:2">
        <li>Install <strong>DYMO Connect</strong> and connect your LabelWriter 450 Turbo.</li>
        <li>Open <strong>Owner Labels</strong> in the sidebar.</li>
        <li>Set <strong>QR Base URL</strong> to your NUC's LAN address (e.g. <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">http://192.168.1.50:3847</code>) so phones on Wi‑Fi can scan labels.</li>
        <li>Select gear and click <strong>Print Selected (DYMO)</strong>. Use 30252 address labels for best results.</li>
        <li>Affix labels to gear. Scanning opens a quick page with manuals, drivers, edit link, and full details.</li>
      </ol>
      <p style="margin-top:1rem;color:var(--text-muted)">If DYMO software isn't available, use <strong>Print Selected (Browser)</strong> and choose your label printer in the system print dialog.</p>
    </div>

    <div class="card">
      <h3 class="section-title">Updates</h3>
      <p style="color:var(--text-secondary);line-height:1.8">
        Studio Inventory checks <a href="https://github.com/TerkWerX/STUDIO-INVENTORY/releases" target="_blank" rel="noopener" style="color:var(--accent)">GitHub Releases</a> at startup.
        When a newer version is available, a banner appears at the top of the app with a download link.
      </p>
      <p style="color:var(--text-secondary);line-height:1.8;margin-top:0.75rem">
        <strong>Your inventory is safe when updating.</strong> Gear, photos, manuals, receipts, and warranty data live in the <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">data/</code> folder.
        Re-run <strong>Install Studio Inventory</strong> from the new download — your <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">data/</code> folder is preserved automatically.
        Developers using git: <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">git pull && npm install</code> — <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">data/</code> is never touched.
      </p>
    </div>

    <div class="card">
      <h3 class="section-title">Running the Server</h3>
      <p style="color:var(--text-secondary);line-height:1.8">
        <strong>Windows:</strong> <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">npm start</code> or double-click <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">start-studio-inventory.bat</code><br>
        <strong>Mac:</strong> <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">npm start</code> or run <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">start-studio-inventory.sh</code> in Terminal — full guide on GitHub: <a href="https://github.com/TerkWerX/STUDIO-INVENTORY/blob/main/MAC.md" target="_blank" rel="noopener" style="color:var(--accent)">MAC.md</a><br>
        Open <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">http://localhost:3847</code> in any browser.
        From phones on the same Wi‑Fi, use <code style="background:var(--bg-tertiary);padding:0.2rem 0.5rem;border-radius:4px">http://&lt;your-computer-ip&gt;:3847</code>.
        Keyboard shortcuts use Ctrl on Windows or ⌘ Cmd on Mac.
      </p>
    </div>
  `;
}

export function renderBackup(guest = {}, ownerAuth = {}) {
  const guestOn = !!guest.guestEnabled;
  const guestUrl = guest.guestUrl || '';
  const pinSet = !!ownerAuth.ownerPinSet;
  const isLocal = ownerAuth.local !== false;
  return `
    <h2 class="page-title">Backup &amp; Restore</h2>
    <p class="page-subtitle">Protect your inventory data</p>

    <div class="card guest-settings-card">
      <h3 class="section-title">LAN Guest Link (Read-Only)</h3>
      <p class="text-muted-sm" style="margin-bottom:1rem">
        Share a read-only browser link with bandmates or family on the same Wi‑Fi. They can browse gear and values but cannot edit anything.
      </p>
      <label class="toggle-label guest-toggle">
        <input type="checkbox" id="guest-enabled" ${guestOn ? 'checked' : ''}>
        <span>Enable guest link</span>
      </label>
      <div class="guest-url-row ${guestOn ? '' : 'guest-url-disabled'}" id="guest-url-section">
        <input type="text" id="guest-url" class="guest-url-input" readonly value="${escapeHtml(guestUrl)}">
        <button type="button" class="btn btn-secondary btn-sm" id="guest-copy-url">Copy Link</button>
        <button type="button" class="btn btn-ghost btn-sm" id="guest-regenerate">Regenerate Token</button>
      </div>
      <p class="text-muted-sm guest-url-hint">Anyone with this URL can view inventory while guest access is enabled. Disable when not needed.</p>
    </div>

    <div class="card">
      <h3 class="section-title">Owner Access on Wi-Fi</h3>
      <p class="text-muted-sm" style="margin-bottom:1rem">
        Localhost access on this studio computer stays unlocked. Browser sessions from other devices on the same Wi-Fi require an owner PIN before they can edit inventory, backups, manuals, or wall placements.
      </p>
      <div class="btn-group">
        <button type="button" class="btn btn-secondary" id="owner-pin-set" ${isLocal ? '' : 'disabled'}>${pinSet ? 'Change Owner PIN' : 'Set Owner PIN'}</button>
      </div>
      <p class="text-muted-sm" style="margin-top:0.75rem">
        Status: ${pinSet ? 'Owner PIN set for remote admin access.' : 'Remote owner access is locked until a PIN is set on this computer.'}
      </p>
    </div>

    <div class="card" style="border-left:4px solid var(--warning)">
      <h3 class="section-title">⚠ Backup Reminder</h3>
      <p style="color:var(--text-secondary)">
        Your inventory data is stored locally. Regular backups are essential for insurance documentation.
        Export your data at least once a month.
      </p>
    </div>

    <div class="card">
      <h3 class="section-title">Export Data</h3>
      <p style="color:var(--text-secondary);margin-bottom:1rem">Download a complete ZIP backup, or export lighter report formats.</p>
      <div class="btn-group">
        <button type="button" class="btn btn-primary" id="backup-export-full">Full Backup ZIP</button>
        <button type="button" class="btn btn-primary" id="backup-export-json">Export JSON</button>
        <button type="button" class="btn btn-secondary" id="backup-export-sql">Export SQL Dump</button>
        <button type="button" class="btn btn-secondary" id="backup-export-csv">Export CSV</button>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Restore Full Backup</h3>
      <p style="color:var(--text-secondary);margin-bottom:1rem">
        Restore a Full Backup ZIP created by Studio Inventory. This replaces the database tables and managed upload folders with the backup contents.
      </p>
      <label class="btn btn-secondary" style="cursor:pointer">
        Choose Backup ZIP
        <input type="file" id="import-full-backup-file" accept=".zip,application/zip,application/x-zip-compressed" hidden>
      </label>
      <p id="import-full-backup-status" style="margin-top:1rem;color:var(--text-muted)"></p>
    </div>

    <div class="card">
      <h3 class="section-title">Bulk Import (CSV)</h3>
      <p style="color:var(--text-secondary);margin-bottom:1rem">
        Import many items at once from a spreadsheet. First row must be headers. Supported columns:
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">name</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">brand</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">model</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">serial_number</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">category</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">location</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">replacement_value</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">requires_power</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">power_adapter_voltage</code>,
        <code style="background:var(--bg-tertiary);padding:0.15rem 0.4rem;border-radius:4px">tags</code> (semicolon-separated), and more.
      </p>
      <label class="btn btn-primary" style="cursor:pointer;margin-bottom:1rem">
        Import CSV File
        <input type="file" id="import-csv-file" accept=".csv,text/csv" hidden>
      </label>
      <p id="import-csv-status" style="color:var(--text-muted)"></p>
      <button type="button" class="btn btn-ghost btn-sm" id="download-csv-template">Download CSV Template</button>
    </div>

    <div class="card">
      <h3 class="section-title">Import Data (JSON)</h3>
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
        The Full Backup ZIP includes inventory tables, wall/studio placements, manuals, photos, receipts, software assets, and the manual inbox.
      </p>
    </div>
  `;
}
