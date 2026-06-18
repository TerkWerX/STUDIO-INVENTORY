## Studio Inventory v1.0.0

First public release — a local, browser-based inventory app for **physical** studio gear.

### Highlights

- Full inventory CRUD with photos, manuals, software/driver archive, and insurance PDF export
- Dashboard with stats, brand carousel, and category/location breakdowns
- **Browse by Brand** — auto-fetched logos, custom uploads, tap-to-filter item cards
- Dark theme optimized for 4K TV / touch (large fonts, 56px+ tap targets)
- PWA installable shell with offline caching
- Runs entirely on your LAN — no cloud account required

### Quick start

```bash
git clone https://github.com/TerkWerX/STUDIO-INVENTORY.git
cd STUDIO-INVENTORY
npm install
npm run reseed   # optional sample data
npm start        # http://localhost:3847
```

### What's included in CI

- Syntax checks on core modules
- Isolated smoke test (seed → server → health/brands/items APIs)
- Runs automatically on every push to `main`

### Your data stays local

The database (`data/inventory.db`) and all uploads are gitignored and never leave your machine.