import { formatCurrency } from '../utils.js';
import { renderBrandCarousel } from './brands.js';

export function renderDashboard(stats, brands = []) {
  const { totals, byCategory, byLocation, recent, highValue } = stats;

  return `
    <h2 class="page-title">Dashboard</h2>
    <p class="page-subtitle">Studio inventory at a glance</p>

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