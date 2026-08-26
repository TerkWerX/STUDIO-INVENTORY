# Contributing

Thanks for helping Studio Inventory become more useful and welcoming.

## Good contributions

- Bug fixes with a clear reproduction
- New or improved smart equipment profiles
- Accessibility and responsive-layout improvements
- Documentation, tests, and platform-specific fixes
- Focused feature proposals that fit a local-first inventory app

## Development setup

```bash
git clone https://github.com/TerkWerX/STUDIO-INVENTORY.git
cd STUDIO-INVENTORY
npm install
npm test
npm start
```

Studio Inventory uses Node.js, Express, SQLite, and browser-native JavaScript modules. There is no frontend build step.

## Before opening a pull request

1. Search existing issues and discussions.
2. Keep the change focused and explain the user problem it solves.
3. Add or update tests when behavior changes.
4. Run `npm test`.
5. Do not commit a real `data/` folder, inventory database, photos, receipts, manuals, license keys, or other personal records.

Small pull requests are easier to review. Screenshots are welcome for visual changes.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
