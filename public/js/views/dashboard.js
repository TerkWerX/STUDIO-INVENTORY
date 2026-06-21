import { formatCurrency, formatDate } from '../utils.js';
import { renderBrandCarousel } from './brands.js';
import { STUDIO_STATUS_LABELS } from '../lib/completeness-ui.js';

function backupAgeLabel() {
  const last = localStorage.getItem('lastBackup');
  if (!last) return { text: 'No backup recorded', warn: true };
  const days = Math.floor((Date.now() - parseInt(last, 10)) / 86400000);
  if (days > 30) return { text: `Last backup ${days} days ago`, warn: true };
  if (days > 7) return { text: `Last backup ${days} days ago`, warn: false };
  return { text: days === 0 ? 'Backed up today' : `Backed up ${days} day${days !== 1 ? 's' : ''} ago`, warn: false };
}

export function renderDashboard(stats, brands = []) {
  const {
    totals, byCategory, byLocation, recent, highValue, completeness,
    warrantyExpiring, awayItems, activeLoans, overdueLoanCount, activeLoanCount,
    softwareTotals, softwareRenewals, softwareRenewalCount, softwareOverdueCount
  } = stats;
  const backup = backupAgeLabel();
  const gaps = completeness?.gaps || {};

  return `
    <h2 class="page-title">Dashboard</h2>
    <p class="page-subtitle">Studio inventory at a glance</p>

    <div class="reminder-grid">
      <div class="reminder-card ${backup.warn ? 'reminder-warn' : ''}">
        <div class="reminder-label">Backup</div>
        <div class="reminder-value">${backup.text}</div>
        <button type="button" class="btn btn-sm btn-secondary" data-nav="backup">Backup Now</button>
      </div>
      <div class="reminder-card ${(completeness?.averageScore || 100) < 80 ? 'reminder-warn' : ''}">
        <div class="reminder-label">Documentation</div>
        <div class="reminder-value">${completeness?.averageScore ?? 100}% avg complete</div>
        <div class="reminder-sub">${completeness?.completeCount ?? 0} of ${completeness?.totalItems ?? 0} fully documented</div>
      </div>
      <div class="reminder-card ${warrantyExpiring?.length ? 'reminder-warn' : ''}">
        <div class="reminder-label">Warranty (30 days)</div>
        <div class="reminder-value">${warrantyExpiring?.length || 0} expiring soon</div>
      </div>
      <div class="reminder-card ${awayItems?.length ? 'reminder-info' : ''}">
        <div class="reminder-label">Away from studio</div>
        <div class="reminder-value">${awayItems?.length || 0} item${awayItems?.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="reminder-card ${overdueLoanCount ? 'reminder-warn' : activeLoanCount ? 'reminder-info' : ''}">
        <div class="reminder-label">On loan</div>
        <div class="reminder-value">${activeLoanCount || 0} out${overdueLoanCount ? ` · ${overdueLoanCount} overdue` : ''}</div>
        <button type="button" class="btn btn-sm btn-secondary" data-nav="loans">View Loans</button>
      </div>
      <div class="reminder-card ${softwareOverdueCount ? 'reminder-warn' : softwareRenewalCount ? 'reminder-info' : ''}">
        <div class="reminder-label">Software</div>
        <div class="reminder-value">${softwareTotals?.count || 0} plugins &amp; DAWs</div>
        <div class="reminder-sub">${softwareRenewalCount ? `${softwareRenewalCount} renewal${softwareRenewalCount !== 1 ? 's' : ''} soon` : formatCurrency(softwareTotals?.total_value || 0) + ' value'}</div>
        <button type="button" class="btn btn-sm btn-secondary" data-nav="software">View Catalog</button>
      </div>
    </div>

    ${softwareRenewals?.length ? `
    <div class="card">
      <div class="card-header">
        <h3 class="section-title">Software Renewals (30 days)</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-nav="software">All Software</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Software</th><th>Publisher</th><th>Renews</th><th>Value</th></tr></thead>
          <tbody>
            ${softwareRenewals.slice(0, 8).map(sw => `
              <tr data-action="view-software" data-id="${sw.id}" style="cursor:pointer" class="${sw.overdue ? 'loan-row-overdue' : ''}">
                <td><strong>${sw.name}</strong></td>
                <td>${sw.publisher || '—'}</td>
                <td>${sw.overdue ? '<span class="loan-overdue-badge">Overdue</span> ' : ''}${sw.renewal_date ? formatDate(sw.renewal_date) : '—'}</td>
                <td class="value-cell">${formatCurrency(sw.replacement_value)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    ${activeLoans?.length ? `
    <div class="card">
      <div class="card-header">
        <h3 class="section-title">Checked Out</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-nav="loans">All Loans</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Borrower</th><th>Due</th></tr></thead>
          <tbody>
            ${activeLoans.slice(0, 8).map(loan => `
              <tr data-action="view-item" data-id="${loan.item_id}" class="${loan.overdue ? 'loan-row-overdue' : ''}" style="cursor:pointer">
                <td><strong>${loan.item_name}</strong></td>
                <td>${loan.borrower_name}</td>
                <td>${loan.overdue ? '<span class="loan-overdue-badge">Overdue</span> ' : ''}${loan.due_date ? formatDate(loan.due_date) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    ${completeness?.totalItems ? `
    <div class="card documentation-card">
      <div class="card-header">
        <h3 class="section-title">Documentation Gaps</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-nav="inventory">View Inventory</button>
      </div>
      <div class="gap-grid">
        ${Object.entries(gaps).map(([key, count]) => count > 0 ? `
          <div class="gap-item">
            <span class="gap-count">${count}</span>
            <span class="gap-label">missing ${completeness.gapLabels?.[key] || key}</span>
          </div>
        ` : '').join('') || '<p class="text-muted">All items fully documented.</p>'}
      </div>
      ${completeness.needsAttention?.length ? `
        <div class="table-wrap" style="margin-top:1rem">
          <table>
            <thead><tr><th>Item</th><th>Score</th><th>Still needed</th></tr></thead>
            <tbody>
              ${completeness.needsAttention.map(row => `
                <tr data-action="view-item" data-id="${row.id}">
                  <td><strong>${row.name}</strong><br><span class="text-muted-sm">${row.category}</span></td>
                  <td><span class="completeness-badge completeness-${row.status}">${row.score}%</span></td>
                  <td class="text-muted-sm">${row.missing.join(', ')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
    ` : ''}

    ${warrantyExpiring?.length ? `
    <div class="card">
      <div class="card-header"><h3 class="section-title">Warranty Expiring Soon</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Ends</th><th>Note</th></tr></thead>
          <tbody>
            ${warrantyExpiring.map(w => `
              <tr data-action="view-item" data-id="${w.id}">
                <td>${w.name}</td>
                <td>${formatDate(w.warranty_end_date)}</td>
                <td class="text-muted-sm">${w.warranty_note || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    ${awayItems?.length ? `
    <div class="card">
      <div class="card-header"><h3 class="section-title">Not In Studio</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            ${awayItems.map(a => `
              <tr data-action="view-item" data-id="${a.id}">
                <td>${a.name}</td>
                <td><span class="studio-status-badge status-${a.studio_status}">${STUDIO_STATUS_LABELS[a.studio_status] || a.studio_status}</span></td>
                <td class="text-muted-sm">${a.studio_status_note || a.location || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Items</div>
        <div class="stat-value">${totals.item_count}</div>
        <div class="stat-sub">${totals.total_quantity} units total</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Purchase Value</div>
        <div class="stat-value">${formatCurrency(totals.total_purchase)}</div>
        <div class="stat-sub">Original investment</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Replacement Value</div>
        <div class="stat-value">${formatCurrency(totals.total_replacement)}</div>
        <div class="stat-sub">Current estimated total</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Value Change</div>
        <div class="stat-value">${formatCurrency(totals.total_replacement - totals.total_purchase)}</div>
        <div class="stat-sub">Replacement minus purchase</div>
      </div>
    </div>

    ${brands.length ? `
    <div class="card brand-dashboard-card">
      <div class="card-header">
        <h3 class="section-title">Browse by Brand</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-nav="brands">View All Brands</button>
      </div>
      ${renderBrandCarousel(brands, { compact: true })}
    </div>
    ` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:1.5rem">
      <div class="card">
        <div class="card-header"><h3 class="section-title">By Category</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Category</th><th>Items</th><th>Value</th></tr></thead>
            <tbody>
              ${byCategory.map(c => `
                <tr>
                  <td><span class="category-pill">${c.category || 'Uncategorized'}</span></td>
                  <td>${c.count}</td>
                  <td class="value-cell">${formatCurrency(c.total_value)}</td>
                </tr>
              `).join('') || '<tr><td colspan="3">No data</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="section-title">By Location</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Location</th><th>Items</th><th>Value</th></tr></thead>
            <tbody>
              ${byLocation.map(l => `
                <tr>
                  <td>${l.location || 'Unassigned'}</td>
                  <td>${l.count}</td>
                  <td class="value-cell">${formatCurrency(l.total_value)}</td>
                </tr>
              `).join('') || '<tr><td colspan="3">No data</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:1.5rem;margin-top:1.5rem">
      <div class="card">
        <div class="card-header"><h3 class="section-title">Recent Additions</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Category</th><th>Value</th></tr></thead>
            <tbody>
              ${recent.map(r => `
                <tr data-action="view-item" data-id="${r.id}">
                  <td>${r.name}</td>
                  <td>${r.category}</td>
                  <td class="value-cell">${formatCurrency(r.replacement_value)}</td>
                </tr>
              `).join('') || '<tr><td colspan="3">No items yet</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="section-title">High-Value Items</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Category</th><th>Value</th></tr></thead>
            <tbody>
              ${highValue.map(h => `
                <tr data-action="view-item" data-id="${h.id}">
                  <td>${h.name}</td>
                  <td>${h.category}</td>
                  <td class="value-cell">${formatCurrency(h.replacement_value)}</td>
                </tr>
              `).join('') || '<tr><td colspan="3">No high-value items</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}