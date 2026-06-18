import { formatCurrency, escapeHtml, fileUrl, brandLogoHtml } from '../utils.js';

export function renderBrandCarousel(brands, { compact = false } = {}) {
  const owned = brands.filter(b => b.item_count > 0);
  const display = owned.length ? owned : brands;

  return `
    <div class="brand-carousel-wrap ${compact ? 'brand-carousel-compact' : ''}">
      <div class="brand-carousel" role="list" aria-label="Browse by brand">
        <button type="button" class="brand-tile brand-tile-all" data-action="filter-brand" data-brand="" title="Show all items">
          <div class="brand-tile-inner brand-tile-all-inner">
            <span class="brand-all-icon">&#9733;</span>
            <span class="brand-tile-name">All Brands</span>
            <span class="brand-tile-count">${brands.reduce((s, b) => s + b.item_count, 0)} items</span>
          </div>
        </button>
        ${display.map(b => renderBrandTile(b)).join('')}
      </div>
    </div>
  `;
}

export function renderBrandTile(brand) {
  return `
    <button type="button" class="brand-tile" data-action="filter-brand" data-brand="${escapeHtml(brand.name)}"
      title="${escapeHtml(brand.name)} — ${brand.item_count} item${brand.item_count !== 1 ? 's' : ''}"
      ${brand.item_count === 0 ? 'data-empty="true"' : ''}>
      <div class="brand-tile-inner">
        ${brandLogoHtml(brand, 'brand-logo')}
        <div class="brand-tile-overlay">
          <span class="brand-tile-name">${escapeHtml(brand.name)}</span>
          <span class="brand-tile-count">${brand.item_count} item${brand.item_count !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </button>
  `;
}

export function renderBrandsPage(brands) {
  const ownedCount = brands.filter(b => b.item_count > 0).length;
  return `
    <h2 class="page-title">Browse by Brand</h2>
    <p class="page-subtitle">${ownedCount} brands in your studio · ${brands.length} total available</p>

    <div class="card">
      <div class="card-header">
        <h3 class="section-title">Your Brands</h3>
        <div class="btn-group">
          <button type="button" class="btn btn-accent" data-action="fetch-all-logos">Fetch All Logos</button>
          <button type="button" class="btn btn-secondary" data-action="filter-brand" data-brand="">Show All Items</button>
        </div>
      </div>
      <div class="brand-grid">
        <button type="button" class="brand-card brand-card-all" data-action="filter-brand" data-brand="">
          <div class="brand-card-all-inner">
            <span class="brand-all-icon-lg">&#9733;</span>
            <strong>All Brands</strong>
            <span class="text-muted-sm">View entire inventory</span>
          </div>
        </button>
        ${brands.map(b => `
          <div class="brand-card ${b.item_count === 0 ? 'brand-card-empty' : ''}">
            <button type="button" class="brand-card-main" data-action="filter-brand" data-brand="${escapeHtml(b.name)}">
              ${brandLogoHtml(b, 'brand-card-logo', { large: true })}
              <div class="brand-card-info">
                <strong>${escapeHtml(b.name)}</strong>
                <span class="brand-item-badge">${b.item_count} item${b.item_count !== 1 ? 's' : ''}</span>
              </div>
            </button>
            ${b.item_count > 0 && !b.logo_path ? `
              <button type="button" class="btn btn-sm btn-accent brand-fetch-btn" data-action="fetch-logo" data-brand="${escapeHtml(b.name)}">Fetch Logo</button>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Custom Brand Logo</h3>
      <p class="text-muted" style="margin-bottom:1rem">Upload your own logo for any brand (transparent PNG recommended, 400×200px or similar).</p>
      <form id="brand-logo-form" class="form-grid" style="max-width:600px">
        <div class="form-group">
          <label for="custom-brand-name">Brand Name</label>
          <input type="text" id="custom-brand-name" list="brand-name-list" placeholder="e.g. Fender" required>
          <datalist id="brand-name-list">
            ${brands.map(b => `<option value="${escapeHtml(b.name)}">`).join('')}
          </datalist>
        </div>
        <div class="form-group">
          <label>Logo Image</label>
          <label class="btn btn-secondary" style="cursor:pointer">
            Choose PNG/SVG<input type="file" id="custom-brand-logo" accept="image/png,image/svg+xml,image/webp" hidden required>
          </label>
          <span id="custom-brand-file-label" class="text-muted-sm"></span>
        </div>
        <div class="form-group" style="align-self:end">
          <button type="submit" class="btn btn-primary">Upload Logo</button>
        </div>
      </form>
    </div>
  `;
}

export function renderBrandItems(brand, brandInfo, items) {
  const totalValue = items.reduce((s, i) => s + (i.replacement_value || 0) * (i.quantity || 1), 0);
  return `
    <div class="brand-items-header">
      <div class="brand-items-title">
        ${brandInfo ? brandLogoHtml(brandInfo, 'brand-items-logo') : ''}
        <div>
          <h2 class="page-title" style="margin:0">${escapeHtml(brand || 'All Brands')}</h2>
          <p class="page-subtitle" style="margin:0.25rem 0 0">${items.length} item${items.length !== 1 ? 's' : ''} · ${formatCurrency(totalValue)} total value</p>
        </div>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-secondary" data-nav="brands">All Brands</button>
        <button type="button" class="btn btn-ghost" data-nav="inventory">Table View</button>
      </div>
    </div>

    ${items.length === 0 ? `
      <div class="empty-state">
        <h3>No items for this brand</h3>
        <p>Add gear with brand "${escapeHtml(brand)}" or pick another brand.</p>
        <button type="button" class="btn btn-primary" data-nav="brands" style="margin-top:1rem">Browse Brands</button>
      </div>
    ` : `
      <div class="item-card-grid">
        ${items.map(item => {
          const photo = item.photos?.[0];
          return `
            <button type="button" class="item-card" data-action="view-item" data-id="${item.id}">
              <div class="item-card-photo">
                ${photo
                  ? `<img src="${fileUrl(photo.relative_path)}" alt="">`
                  : `<div class="item-card-photo-placeholder">${escapeHtml(item.category?.slice(0, 1) || '?')}</div>`
                }
              </div>
              <div class="item-card-body">
                <h3 class="item-card-name">${escapeHtml(item.name)}</h3>
                <p class="item-card-model text-muted-sm">${escapeHtml(item.brand)} ${escapeHtml(item.model)}</p>
                <div class="item-card-meta">
                  <span class="category-pill">${escapeHtml(item.category)}</span>
                  <span class="condition-badge condition-${item.condition}">${item.condition}</span>
                </div>
                <div class="item-card-footer">
                  <span class="text-muted-sm">${escapeHtml(item.location)}</span>
                  <span class="value-cell">${formatCurrency(item.replacement_value * item.quantity)}</span>
                </div>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `}
  `;
}