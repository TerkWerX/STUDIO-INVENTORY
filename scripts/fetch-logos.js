/**
 * Fetch high-quality scalable logos for every brand that has inventory items.
 * Replaces small favicons and text-placeholder SVGs.
 *
 *   npm run fetch-logos          # only missing / low-quality
 *   npm run fetch-logos -- --force   # re-fetch all non-custom
 */

const { initSchema } = require('../db');
const { fetchAllInventoryBrandLogos } = require('../lib/fetch-brand-logo');

const force = process.argv.includes('--force');

initSchema();

fetchAllInventoryBrandLogos({ force }).then(r => {
  console.log(`\nBrand logos: ${r.fetched} fetched, ${r.skipped} skipped, ${r.failed} not found`);
  if (r.failed > 0) console.log('Upload custom PNGs on the Brands page for any that failed.');
}).catch(err => {
  console.error(err);
  process.exit(1);
});