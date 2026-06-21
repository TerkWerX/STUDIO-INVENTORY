# Studio Inventory

**Local-first inventory, documentation, and virtual studio planning for musical instruments and audio hardware** — built for home studios, optimized for fullscreen use on large displays and local network access.

**Works on Windows, macOS, and Linux** — same app, same features. Your data stays on your machine.

[![CI](https://github.com/TerkWerX/STUDIO-INVENTORY/actions/workflows/ci.yml/badge.svg)](https://github.com/TerkWerX/STUDIO-INVENTORY/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)

> **Mac musician?** Start here → **[MAC.md](MAC.md)** — full setup guide (Node, Terminal, iPhone access, DYMO, troubleshooting).

> Tracks guitars, basses, mics, interfaces, mixers, control surfaces, monitors, pedals, amps, rack gear, accessories, manuals, receipts, loans, and wall placement — **not** sample libraries, loops, or software sound assets.

<p align="center">
  <img src="docs/images/dashboard.png" alt="Studio Inventory dashboard with stats, brand carousel, and category breakdown" width="800">
</p>

<p align="center">
  <em>Dashboard — totals, brand carousel, and studio breakdowns at a glance</em>
</p>

<p align="center">
  <img src="docs/images/brands.png" alt="Browse by Brand page with manufacturer logos" width="800">
</p>

<p align="center">
  <em>Brands page — tap any logo to filter your gear by manufacturer</em>
</p>

---

## Why Studio Inventory?

Home studios accumulate serious gear fast. Studio Inventory gives you one place to document what you own, what it's worth, where it lives, who borrowed it, and the paperwork that matters for insurance, resale, service, and day-to-day studio use.

- **Touch-friendly dark UI** — large fonts and 56px+ tap targets for an 86" 4K TV
- **Runs entirely on your LAN** — no cloud account, no subscription
- **Insurance-ready exports** — PDF reports with photos and serial numbers
- **Virtual studio wall planning** — place life-size gear cutouts onto calibrated room wall photos
- **Manuals stay organized** — search online, save from URL, or import through a dedicated Manual Inbox
- **Brand browsing** — logo carousel and grid to filter gear by manufacturer

---

## Features

| Area | What you get |
|------|----------------|
| **Inventory** | Full CRUD with serials, values, condition, warranty, location, tags, accessories, insurance notes, and quantity |
| **Photos & receipts** | Multi-photo gallery, fullscreen lightbox, receipt upload, warranty notes, and documentation checklist |
| **Manuals & documents** | Upload PDFs/docs, search inside indexed PDFs, find manuals online, save from URL, and import from Manual Inbox |
| **Manual Inbox** | Dedicated `data/manual-inbox/` folder for browser downloads that need to be attached to a specific gear record |
| **Virtual studio** | Draw rooms, calibrate wall photos with corner points, place gear on walls/floors/racks, and browse room wall views |
| **Wall cutouts** | Crop/key/scale instrument photos for life-size virtual wall placement, with metric/imperial measurements |
| **Loans** | Check gear out, track borrowers/due dates, hide loaned wall gear, and rehang it when returned |
| **Software catalog** | Track plugins, licenses, activations, renewals, screenshots, and host hardware |
| **Driver/software archive** | Paste manufacturer download URLs; server archives versioned drivers/firmware locally |
| **Search & filters** | Full-text inventory search, category, location, condition, tags, value range, sorting, and accessory visibility |
| **Dashboard** | Totals, documentation progress, software renewals, recent additions, high-value items, and brand carousel |
| **Brands** | Auto-fetched logos, custom uploads, tap-to-filter item cards |
| **Owner Labels** | QR labels for DYMO LabelWriter — scan to open manuals, software, loans, and item details |
| **Binder print** | Print gear pages, index pages, and selected PDFs for a physical insurance/owner binder |
| **Reports & backup** | PDF, CSV, JSON, SQL export, guest read-only sharing, and local folder backup |
| **PWA** | Installable local web app with offline shell caching |

---

## Download (Windows & Mac — no Node required)

Pre-built packages are on the **[Releases](https://github.com/TerkWerX/STUDIO-INVENTORY/releases)** page:

| Platform | Download | How to run |
|----------|----------|------------|
| **Windows** | `Studio-Inventory-v…-Windows.zip` | Extract → double-click **Start Studio Inventory.bat** (or **Install Studio Inventory.bat** for Desktop shortcut) |
| **macOS** | `Studio-Inventory-v…-macOS.zip` or `.dmg` | Extract / open DMG → double-click **Start Studio Inventory.command** (or **Install Studio Inventory.command** to copy to Applications) |

These bundles include Node dependencies — your friends do **not** need to install Node.js or run `npm install`.

### Updating without losing data

Your inventory lives in the `data/` folder (database + photos + manuals + receipts). It is **never** included in release downloads.

| How you installed | How to update |
|-------------------|---------------|
| **Windows/Mac package** | Download the newer release → run **Install Studio Inventory** again — your `data/` folder is backed up and restored automatically |
| **Git clone** | `git pull && npm install` — `data/` is gitignored and stays put |

The app checks GitHub at startup and shows an **update available** banner when a newer release is published.

---

## Quick Start (developers / git clone)

**Requirements:** [Node.js](https://nodejs.org/) 18+

```bash
git clone https://github.com/TerkWerX/STUDIO-INVENTORY.git
cd STUDIO-INVENTORY
npm install
npm run reseed    # optional: load 15 sample gear items (~$15k value)
npm start         # http://localhost:3847
```

Open **http://localhost:3847** — press **F11** (or **Cmd+Ctrl+F** on Mac) for fullscreen.

From another device on your network: `http://<your-computer-ip>:3847`

---

## Manual Finder + Manual Inbox

Manuals are meant to end up attached to the correct item record, not scattered around Downloads.

### Best path: save directly from the app

1. Open **Manuals & Documents**
2. Under **Find Manuals Online**, choose an item and click **Find Online**
3. Review the curated online results inside Studio Inventory
4. If a result is a direct manual/PDF, click **Save to Item**
5. If a result is a support page, click **Scan for PDFs**, then save the right candidate

The server downloads the file into `data/uploads/manuals/{item id}/`, stores the source URL, and attaches it to that gear record.

### Fallback path: outside browser downloads

Some manufacturer sites force normal browser downloads. For those cases:

1. Click **Open Folder** in the **Manual Inbox** panel
2. Save downloaded PDFs/manuals into `data/manual-inbox/`
3. Back in Studio Inventory, click **Refresh**
4. Click **Import from Inbox** on the matching item
5. Choose the file; Studio Inventory moves it into that item's managed manual folder

The Manual Inbox folder is created automatically at startup and again whenever the inbox is opened or refreshed.

---

## Studio View + Virtual Walls

Studio Inventory can model a room and let you hang gear on calibrated wall photos.

1. Open **Studio Setup**
2. Create a room and draw its outline
3. Enter wall dimensions in imperial or metric units
4. Add wall photos and mark the four wall corners for perspective alignment
5. Open an item and choose **Add cutout** or **Place in studio**
6. Crop/key the cutout, set scale from two precise points, then place it on a wall

Wall browse mode shows the wall photo plus every instrument/logo already placed there, so you can avoid overlapping real wall space. Placed wall items can be rotated and fine-tuned for straight hanging.

Loaned items are automatically hidden from wall display while checked out, and the app prompts you to rehang them when returned.

---

## Mac users

Studio Inventory runs natively on macOS — same features as Windows.

**→ [MAC.md — complete Mac setup guide](MAC.md)** (install Node, clone or ZIP download, iPhone scanning, DYMO labels, backups, troubleshooting)

Quick version:

```bash
git clone https://github.com/TerkWerX/STUDIO-INVENTORY.git
cd STUDIO-INVENTORY
npm install
npm start
```

Open **http://localhost:3847** · Use **⌘** for keyboard shortcuts · Skip `npm run reseed` unless you want demo sample gear.

---

## Project Structure

```
STUDIO-INVENTORY/
├── server.js              # Express API + static file serving
├── db.js                  # SQLite schema and helpers
├── seed.js                # Sample inventory data
├── lib/
│   ├── pdf-index.js
│   ├── fetch-brand-logo.js
│   ├── brand-domains.js
│   └── brand-svg.js
├── public/                # Frontend (vanilla JS, dark theme)
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── views/
│       └── lib/           # Floorplan, wall, measurement, label, and print helpers
├── scripts/
│   ├── fetch-logos.js
│   ├── populate-logos.js
│   └── browser-smoke-test.js
└── data/                  # Created at runtime (gitignored)
    ├── inventory.db
    ├── manual-inbox/
    └── uploads/
        ├── photos/
        ├── manuals/
        ├── receipts/
        ├── software/
        ├── software-licenses/
        ├── floorplans/
        ├── wall-photos/
        └── logos/
```

---

## Data Storage

| Path | Contents |
|------|----------|
| `data/inventory.db` | SQLite database |
| `data/manual-inbox/` | Safe landing zone for PDFs downloaded through an outside browser before import |
| `data/uploads/photos/{id}/` | Item photos |
| `data/uploads/manuals/{id}/` | PDFs and documents |
| `data/uploads/receipts/{id}/` | Purchase receipts and proof-of-ownership documents |
| `data/uploads/software/{id}/` | Archived drivers/firmware (all versions kept) |
| `data/uploads/software-licenses/{id}/` | Software license screenshots |
| `data/uploads/floorplans/` | Room/floor images |
| `data/uploads/floorplans/walls/{floorplan id}/` | Wall photos used for calibrated studio wall views |
| `data/uploads/wall-photos/{id}/` | Life-size wall cutout images for gear placement |
| `data/uploads/logos/` | Brand logos (cached locally after fetch) |
| `data/backups/` | Recommended export destination |

Your database and uploads are **local only** and excluded from git. Back them up regularly.

### Full backup

1. **Backup** page → Export JSON + SQL dump
2. Copy the entire `data/uploads/` folder
3. Copy `data/manual-inbox/` if you have unimported downloaded manuals waiting there
4. Or copy the whole `data/` directory

---

## Owner Labels (QR + DYMO)

Print owner labels with QR codes for each piece of gear. Scanning with any phone opens a quick page with manuals, archived software, full details, and an edit link.

1. Install **DYMO Connect** and connect your LabelWriter 450 Turbo
2. Open **Owner Labels** in the sidebar
3. Set **QR Base URL** to your NUC's LAN IP (e.g. `http://192.168.1.50:3847`) so phones on Wi‑Fi can reach the server
4. Select items → **Print Selected (DYMO)** (30252 address labels recommended)
5. Affix labels to gear

**Browser fallback:** Use **Print Selected (Browser)** if DYMO Connect isn't detected — choose your label printer in the system print dialog (Windows or Mac).

From any item's detail page, click **Print Owner Label** for a one-off print.

## Brand Logos

Logos are fetched automatically when you add an item with a brand name.

1. Enter a **Brand** (e.g. `Fender`, `Shure`) when creating or editing an item
2. On save, the server fetches a logo from the web and caches it under `data/uploads/logos/`
3. Sources (in order): Clearbit → Unavatar → Google/DuckDuckGo favicons → generated SVG badge
4. On server start, missing logos are fetched for all brands in your inventory

Custom uploads via **Brands → Custom Brand Logo** are never overwritten.

```bash
npm run fetch-logos         # fetch missing logos only
npm run fetch-logos:force   # re-fetch all non-custom logos
```

Unknown brand? Add its domain to `lib/brand-domains.js`, or upload your own PNG.

---

## Software & Driver Archive

For interfaces, mixers, control surfaces, keyboards, and any gear with drivers or firmware:

1. Open item detail → **Software & Drivers Archive**
2. Paste a manufacturer download URL → **Download & Archive**
3. Or upload a local installer file directly
4. Use **Check for Updates** to search for newer drivers (manual, on-demand)

Disable update checks for end-of-life gear with the **Driver/Software Update Checks** toggle when editing an item.

For plugins, subscriptions, iLok/serial licenses, and studio software, use the **Software** page. It tracks license keys, activation method, plugin format, renewal dates, seats, host gear, screenshots, and replacement value separately from physical inventory.

---

## Auto-Start

### Windows

Double-click `start-studio-inventory.bat`, or add a shortcut to your Startup folder:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

**Task Scheduler alternative:** trigger at startup, run `node.exe` with `server.js`, start in your project folder.

### macOS

```bash
chmod +x start-studio-inventory.sh
```

Then add `start-studio-inventory.sh` via **System Settings → General → Login Items**, or create a Launch Agent if you prefer it always running in the background.

---

## Keyboard Shortcuts

Works with **Ctrl** (Windows/Linux) or **⌘ Cmd** (Mac).

| Shortcut | Action |
|----------|--------|
| `Ctrl/⌘ + N` | New item |
| `Ctrl/⌘ + F` | Focus search (Inventory) |
| `Ctrl/⌘ + S` | Save item (form) |
| `Escape` | Close modal / lightbox |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start server (port 3847) |
| `npm run seed` | Load sample data (skips if DB has items) |
| `npm run reseed` | Clear and reload sample data |
| `npm run fetch-logos` | Fetch missing brand logos |
| `npm run fetch-logos:force` | Re-fetch all non-custom logos |
| `npm run sync-brands` | Sync brand records from inventory items |
| `npm test` | Run API + browser smoke tests with isolated temp databases |
| `npm run test:api` | Run server/API smoke tests |
| `npm run test:browser` | Run Playwright browser smoke test |
| `npm run screenshots` | Capture README screenshots (server must be running) |

---

## Sample Data

`npm run reseed` loads 15 physical gear items — guitars, bass, mics, interfaces, control surface, mixer, monitors, piano, drums, amp, and pedals — with placeholder photos and ~$15,000+ total replacement value. Delete them when you're ready to enter your real studio.

---

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3
- **Frontend:** Vanilla JavaScript (ES modules), no build step
- **Storage:** SQLite + local filesystem uploads
- **PDF export:** jsPDF (CDN)
- **PDF indexing:** `pdf-parse` for searchable uploaded manuals
- **Labels/QR:** QRCode + DYMO/browser print fallback
- **Testing:** Node smoke tests + Playwright browser tests

---

## License

[MIT](LICENSE) — Copyright (c) 2026 TerkWerX
