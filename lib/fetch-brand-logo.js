const fs = require('fs');
const path = require('path');
const { db, LOGOS_DIR, brandSlug, ensureBrand } = require('../db');
const { resolveDomain } = require('./brand-domains');
const { generateBrandSvg } = require('./brand-svg');
const { safeFetch } = require('./safe-fetch');

const inFlight = new Set();

function logoFilePath(logoPath) {
  if (!logoPath) return null;
  return path.join(LOGOS_DIR, logoPath.replace(/^logos[/\\]/, ''));
}

function isLowQualityLogo(brand) {
  if (!brand?.logo_path) return true;
  if (brand.is_custom) return false;
  const fp = logoFilePath(brand.logo_path);
  if (!fp || !fs.existsSync(fp)) return true;

  if (brand.logo_path.endsWith('.svg')) {
    const content = fs.readFileSync(fp, 'utf8');
    // SVG-wrapped raster images do not render in <img> tags — re-fetch as PNG
    if (content.includes('data:image')) return true;
    // Generated text badge — prefer a real web logo when available
    if (content.includes('viewBox="0 0 800 400"') && content.includes('<text') && !content.includes('data:image')) {
      return true;
    }
    // Other TV-optimized vector logos
    if (content.includes('viewBox="0 0 800 400"')) return false;
    // Legacy tiny text placeholders
    if (content.includes('Placeholder Photo') || content.length < 400) return true;
    return !content.includes('viewBox');
  }

  if (brand.logo_path.endsWith('.png') || brand.logo_path.endsWith('.jpg')) {
    return fs.statSync(fp).size < 800;
  }

  return false;
}

function needsLogoFetch(brand, force = false) {
  if (!brand) return false;
  if (brand.is_custom && !force) return false;
  if (force) return !brand.is_custom;
  return isLowQualityLogo(brand);
}

async function tryDownload(url, minBytes = 500) {
  const res = await safeFetch(url, { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 });
  if (!res.ok) {
    res.cancel();
    return null;
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('image') && !ct.includes('svg') && !ct.includes('octet-stream')) {
    res.cancel();
    return null;
  }

  const buf = await res.buffer();
  if (buf.length < minBytes) return null;

  return { buf, ct };
}

function normalizeSvg(buf) {
  let svg = buf.toString('utf8');
  if (!svg.includes('viewBox')) {
    svg = svg.replace('<svg', '<svg viewBox="0 0 24 24"');
  }
  if (!svg.includes('width=')) {
    svg = svg.replace('<svg', '<svg width="800" height="400"');
  }
  return svg;
}

function saveLogoFile(brandName, data, ext = '.svg') {
  if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });
  const slug = brandSlug(brandName);
  for (const old of fs.readdirSync(LOGOS_DIR)) {
    if (old.startsWith(slug + '.')) {
      try { fs.unlinkSync(path.join(LOGOS_DIR, old)); } catch { /* ignore */ }
    }
  }
  const filename = `${slug}${ext}`;
  fs.writeFileSync(path.join(LOGOS_DIR, filename), data);
  return `logos/${filename}`;
}

function saveFromBuffer(brandName, buf, contentType) {
  const head = buf.toString('utf8', 0, 200).trimStart();
  if (contentType.includes('svg') || head.startsWith('<svg')) {
    const svg = buf.toString('utf8');
    // Native vector SVG only — raster-in-SVG breaks <img> display in browsers
    if (!svg.includes('data:image')) {
      return saveLogoFile(brandName, normalizeSvg(buf), '.svg');
    }
  }
  const ext = contentType.includes('png') || buf[0] === 0x89 ? '.png' : '.jpg';
  return saveLogoFile(brandName, buf, ext);
}

/**
 * Give a brand a logo. With offline: true nothing leaves this computer: a
 * brand without a logo just gets a generated text badge. Otherwise the brand's
 * website domain is sent to unavatar.io, Google and DuckDuckGo icon services.
 */
async function fetchBrandLogoFromWeb(brandName, options = {}) {
  const { force = false, offline = false } = options;
  const name = String(brandName || '').trim().slice(0, 150);
  if (!name) return { ok: false, reason: 'empty' };

  const key = `${name.toLowerCase()}:${force}:${offline}`;
  if (inFlight.has(key)) return { ok: false, reason: 'in_progress' };
  inFlight.add(key);

  try {
    const brand = ensureBrand(name);
    if (!needsLogoFetch(brand, force)) {
      return { ok: true, logo_path: brand.logo_path, cached: true };
    }

    if (offline && brand.logo_path) {
      return { ok: true, logo_path: brand.logo_path, cached: true };
    }

    const domain = offline ? null : resolveDomain(name);
    const sources = [];

    // (Clearbit's free logo API shut down on 1 December 2025.)
    if (domain) {
      sources.push({ name: 'unavatar', url: `https://unavatar.io/${encodeURIComponent(domain)}`, minBytes: 400 });
      sources.push({ name: 'google-favicon', url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, minBytes: 400 });
      sources.push({ name: 'duckduckgo', url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`, minBytes: 400 });
    }

    for (const src of sources) {
      try {
        const result = await tryDownload(src.url, src.minBytes);
        if (!result) continue;

        const logoPath = saveFromBuffer(name, result.buf, result.ct);
        db.prepare(`UPDATE brands SET logo_path = ?, is_custom = 0 WHERE name = ? COLLATE NOCASE`).run(logoPath, name);

        console.log(`  Logo fetched for ${name} [${src.name}] -> ${logoPath}`);
        return { ok: true, logo_path: logoPath, domain, source: src.name };
      } catch (err) {
        console.warn(`  ${src.name} failed for ${name}: ${err.message}`);
      }
    }

    // Guaranteed fallback: scalable SVG badge for crisp rendering at any size.
    const svg = generateBrandSvg(name);
    const logoPath = saveLogoFile(name, svg, '.svg');
    db.prepare(`UPDATE brands SET logo_path = ?, is_custom = 0 WHERE name = ? COLLATE NOCASE`).run(logoPath, name);

    console.log(`  Logo generated for ${name} [svg-badge] -> ${logoPath}`);
    return { ok: true, logo_path: logoPath, source: 'svg-badge', generated: true };
  } finally {
    inFlight.delete(key);
  }
}

async function fetchAllInventoryBrandLogos(options = {}) {
  const { force = false, offline = false } = options;
  const brands = db.prepare(`
    SELECT DISTINCT b.* FROM brands b
    JOIN items i ON i.brand = b.name COLLATE NOCASE
    WHERE i.brand != ''
  `).all();

  const results = { fetched: 0, skipped: 0, failed: 0, generated: 0 };

  for (const brand of brands) {
    if (!needsLogoFetch(brand, force)) {
      results.skipped++;
      continue;
    }
    const r = await fetchBrandLogoFromWeb(brand.name, { force, offline });
    if (r.ok && r.logo_path && !r.cached) {
      results.fetched++;
      if (r.generated) results.generated++;
    } else if (!r.ok) results.failed++;
    else results.skipped++;
    if (!offline) await new Promise(res => setTimeout(res, 300));
  }

  return results;
}

module.exports = {
  fetchBrandLogoFromWeb,
  fetchAllInventoryBrandLogos,
  needsLogoFetch,
  isLowQualityLogo
};
