/**
 * Syncs brand records from inventory items (no logo files created here).
 * Logos are fetched automatically from the web when a user adds an item
 * for that manufacturer — see lib/fetch-brand-logo.js
 *
 * To manually fetch logos for brands that already have items:
 *   npm run fetch-logos
 */

const { initSchema, syncBrandsFromItems } = require('../db');

initSchema();
syncBrandsFromItems();
console.log('Brands synced from inventory items. Logos fetch on item add or via npm run fetch-logos');