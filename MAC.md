# Studio Inventory on Mac

**A step-by-step guide for Mac musicians** — inventory your guitars, mics, interfaces, pedals, and studio gear locally. No cloud account. Your data stays on your Mac.

[← Back to main README](README.md) · [Report an issue](https://github.com/TerkWerX/STUDIO-INVENTORY/issues)

---

## What you get

- Catalog gear with photos, serial numbers, values, and locations
- Upload manuals, receipts, warranty info, and proof-of-ownership files
- Find manuals online inside Studio Inventory, save direct PDF links, or import browser downloads from the Manual Inbox
- Build virtual studio room/wall views with calibrated wall photos and life-size gear cutouts
- Track loans and temporarily remove loaned gear from wall views
- Track studio software licenses, renewals, activations, and screenshots
- Export PDF/CSV reports for insurance
- Print QR owner labels (DYMO or browser print)
- Scan labels from your iPhone on the same Wi‑Fi

Everything runs in your browser at **http://localhost:3847** after a one-time setup.

---

## Before you start

| Requirement | Details |
|-------------|---------|
| **macOS** | Any recent version (Monterey, Ventura, Sonoma, Sequoia, etc.) |
| **Disk space** | A few hundred MB for the app; more for photos and PDFs |

You do **not** need Xcode, Homebrew, or a paid developer account.

---

## Easiest install — download the Mac release (recommended)

No Terminal or Node.js required.

1. Go to **[GitHub Releases](https://github.com/TerkWerX/STUDIO-INVENTORY/releases)**
2. Download **`Studio-Inventory-v…-macOS.dmg`** (or the `.zip`)
3. Open the DMG or extract the ZIP
4. Double-click **`Start Studio Inventory.command`**
5. If macOS says it can't verify the developer, allow it once (see below)

**Optional:** run **`Install Studio Inventory.command`** to copy the app to `~/Applications/Studio Inventory` and add a Desktop shortcut.

Your browser opens at **http://localhost:3847** automatically.

### If macOS blocks it the first time

Studio Inventory isn't signed with an Apple Developer ID yet, so macOS asks you to confirm it once.

**macOS Sequoia (15) and later:**

1. Double-click the `.command` file, then click **Done** on the warning (not *Move to Trash*)
2. Open **System Settings → Privacy & Security**
3. Scroll to **Security**; next to the message about *Studio Inventory*, click **Open Anyway**
4. Enter your Mac password, then double-click the file again and choose **Open**

The **Open Anyway** button only appears for about an hour after the blocked attempt. If it's gone, double-click the file again.

**macOS Sonoma (14) and earlier:** Control-click (or right-click) the file, choose **Open**, then click **Open** in the dialog.

Running **`Install Studio Inventory.command`** after you've allowed it means the installed copy won't ask again.

### Updating (your gear stays put)

When the app shows an **update available** banner, or you see a new release on GitHub:

1. Download the latest **macOS .dmg** or `.zip`
2. Run **`Install Studio Inventory.command`** from the new package
3. Your existing `data/` folder (inventory, photos, manuals, receipts, wall photos, software, and Manual Inbox) is **preserved automatically**. The installer never copies or deletes it: it's moved into the new version, and if anything goes wrong part way the previous version is put back as it was.

Close Studio Inventory (its Terminal window) before updating. Making a **Full Backup ZIP** first is still a good habit.

You do not need to re-enter your gear.

---

## Developer install (git clone + Node.js)

Use this path if you want the latest `main` branch or plan to contribute.

### Step 1 — Install Node.js

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** macOS installer (`.pkg`)
3. Run the installer and accept the defaults
4. Quit and reopen Terminal, then verify:

```bash
node --version
```

You should see `v22.x.x` or higher. Studio Inventory needs Node.js 22 or newer.

### Step 2 — Get Studio Inventory

**Option A — Git (recommended if you have git)**

```bash
git clone https://github.com/TerkWerX/STUDIO-INVENTORY.git
cd STUDIO-INVENTORY
```

**Option B — Download ZIP (no git needed)**

1. Open [github.com/TerkWerX/STUDIO-INVENTORY](https://github.com/TerkWerX/STUDIO-INVENTORY)
2. Click the green **Code** button → **Download ZIP**
3. Unzip the file (usually in Downloads)
4. In Terminal, go into the folder:

```bash
cd ~/Downloads/STUDIO-INVENTORY-main
```

(Adjust the path if you moved the folder elsewhere.)

### Step 3 — Install dependencies

From inside the project folder:

```bash
npm install
```

This downloads the packages the server needs. It only runs once (or after updates).

### Step 4 — Start the server

```bash
npm start
```

You should see something like:

```
Studio Inventory running at http://localhost:3847
```

Leave this Terminal window **open** while you use the app. Press **Ctrl+C** in Terminal to stop the server.

### Step 5 — Open the app

In **Safari**, **Chrome**, or **Firefox**, go to:

**http://localhost:3847**

Bookmark that address for daily use.

---

## Optional: one-click start script

After the first setup, you can use the included shell script:

```bash
chmod +x start-studio-inventory.sh   # only needed once
./start-studio-inventory.sh
```

---

## Daily use

| Task | How |
|------|-----|
| **Start** | Open Terminal → `cd` to project folder → `npm start` |
| **Stop** | Press **Ctrl+C** in the Terminal window running the server |
| **Fullscreen** | **Control+Command+F** in Safari, or browser fullscreen |
| **New item** | **⌘N** |
| **Search inventory** | **⌘F** (on Inventory page) |
| **Save item** | **⌘S** (on item form) |

Your inventory is stored in the `data/` folder next to the app — not in iCloud unless you put the project there on purpose.

Manuals downloaded outside the app should be saved into `data/manual-inbox/`, then imported from **Manuals & Documents → Import from Inbox** so they attach to the right gear record.

---

## Use from iPhone or iPad (same Wi‑Fi)

Great for scanning QR labels on gear without walking back to the Mac.

1. Make sure the server is running (`npm start`)
2. On your Mac, find your local IP:
   - **System Settings → Network → Wi‑Fi → Details**, or
   - In Terminal: `ipconfig getifaddr en0`
3. On your phone, open Safari and go to: `http://192.168.x.x:3847` (use your Mac’s IP)

4. Enter the owner PIN when Safari asks. The Mac must set the PIN first under **Backup & Restore**.

In **Owner Labels**, set **QR Base URL** to that same address so printed QR codes work from your phone. v2.6.0 QR labels are signed; reprint labels created by older releases.

Safari supports the phone/tablet photo page and the **Take a Label Photo** scanning fallback. Continuous live camera barcode detection requires HTTPS and compatible browser support, so it is not expected on the normal `http://` LAN link. The native iPhone/iPad Camera app can still scan Studio Inventory QR labels directly.

Keep port `3847` limited to a trusted local network. The owner PIN prevents casual LAN access, but the normal HTTP connection is not encrypted and should never be exposed directly to the internet.

---

## Owner labels (DYMO on Mac)

1. Install [DYMO Connect for Mac](https://www.dymo.com)
2. Connect your LabelWriter (30252 address labels work well)
3. In Studio Inventory → **Owner Labels** → set QR Base URL to your Mac’s LAN IP
4. Select items → **Print Selected (DYMO)**

If direct DYMO printing isn’t available, use **Print Selected (Browser)** and pick your printer in the macOS print dialog.

---

## Demo data vs. your real gear

| Command | What it does |
|---------|----------------|
| `npm start` | Start with **your** inventory (empty on first run) |
| `npm run reseed` | **Wipes and reloads 15 sample items** — only for trying the app |

**Musicians setting up for real:** skip `reseed`. Add your own gear from **Add Item**.

---

## Backup (important for insurance)

1. In the app, open **Backup** in the sidebar
2. Export **JSON** and optionally **SQL Dump**
3. Copy the whole `data/` folder to an external drive, NAS, or cloud storage you control

Back up after adding valuable gear or uploading receipts.

---

## Auto-start when you log in (optional)

1. Run once: `chmod +x start-studio-inventory.sh`
2. **System Settings → General → Login Items**
3. Click **+** and add `start-studio-inventory.sh`, or add Terminal with a command that runs the script

The server will start in the background each time you sign in to your Mac.

---

## Troubleshooting

### `command not found: node` or `npm`

Node.js isn’t installed or Terminal needs a restart. Reinstall from [nodejs.org](https://nodejs.org), quit Terminal, and open it again.

### `command not found: git`

Use **Option B (Download ZIP)** above, or install git via Xcode Command Line Tools:

```bash
xcode-select --install
```

### Port 3847 already in use

Another copy of the server may already be running. Check Terminal windows, or find and quit the process:

```bash
lsof -i :3847
```

### Browser says “can’t connect”

- Confirm Terminal still shows the server running (no error after `npm start`)
- Use exactly **http://localhost:3847** (not `https`)
- If accessing from a phone, confirm both devices are on the **same Wi‑Fi**

### `npm install` errors on Apple Silicon (M1/M2/M3)

Usually resolves on its own. If `better-sqlite3` fails, try:

```bash
npm install
```

again after a full Node LTS install. If it still fails, [open an issue](https://github.com/TerkWerX/STUDIO-INVENTORY/issues) with the error text.

### Photos or uploads not showing on another device

Uploads live on **your** Mac in `data/uploads/`. Other devices only see them when connected to your Mac’s server over the network — there is no cloud sync between friends’ installs.

---

## Updating to a new version

```bash
cd STUDIO-INVENTORY
git pull          # if you used git clone
npm install       # in case dependencies changed
npm start
```

If you used ZIP download, download the new ZIP and copy your `data/` folder into the new project directory.

---

## Privacy

- Data stays **local on your Mac**
- No account, no subscription, no telemetry
- Internet is only used for optional features (brand logos, archiving driver URLs you paste)

Each person runs their own copy with their own `data/` folder.

---

## Need help?

- In-app: **Help & About** in the sidebar
- GitHub: [open an issue](https://github.com/TerkWerX/STUDIO-INVENTORY/issues)
- Main docs: [README.md](README.md)

---

**Made for home studios.** Start with the hardware you can touch, then keep the manuals, receipts, software licenses, and wall placement organized around it.
