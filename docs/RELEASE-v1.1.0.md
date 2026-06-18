## Studio Inventory v1.1.0

Platform downloads for **Windows** and **macOS** — no Node.js or `npm install` required.

### Downloads

| Platform | File | What to do |
|----------|------|------------|
| **Windows** | `Studio-Inventory-v1.1.0-Windows.zip` | Extract anywhere → **Start Studio Inventory.bat** |
| **macOS** | `Studio-Inventory-v1.1.0-macOS.dmg` or `.zip` | Open → **Start Studio Inventory.command** |

Optional installers inside each package:
- **Windows:** `Install Studio Inventory.bat` — copies to `%LOCALAPPDATA%\Studio Inventory` + Desktop shortcut
- **macOS:** `Install Studio Inventory.command` — copies to `~/Applications/Studio Inventory` + Desktop shortcut

### Also in this release

- Digital receipts and warranty countdown on items
- Drag-and-drop and clipboard paste for photos
- Brand logo banner on item detail
- Owner labels (QR + DYMO)
- **[MAC.md](https://github.com/TerkWerX/STUDIO-INVENTORY/blob/main/MAC.md)** — full Mac musician guide

### v1.0.0 note

The earlier v1.0.0 release was **source code only** (git tag, no download files). It works on both Windows and Mac after `npm install`, but had no platform-specific installer. Use **v1.1.0** downloads for musician friends who want a double-click experience.

### Developers

```bash
git clone https://github.com/TerkWerX/STUDIO-INVENTORY.git
cd STUDIO-INVENTORY
npm install
npm start
```

Your data stays in the `data/` folder next to the app.