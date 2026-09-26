# Studio Inventory on Linux

Studio Inventory is distributed as a self-contained Linux x64 archive. It includes Node.js and production dependencies, so a separate Node installation is not required.

## Download

Open the [GitHub Releases](https://github.com/TerkWerX/STUDIO-INVENTORY/releases) page and download either:

- `Studio-Inventory-v…-Linux-x64.tar.gz` — recommended for Linux
- `Studio-Inventory-v…-Linux-x64.zip` — alternative archive format

## Portable use

```bash
tar -xzf Studio-Inventory-v…-Linux-x64.tar.gz
cd studio-inventory-linux
./Start\ Studio\ Inventory.sh
```

The launcher opens `http://localhost:3847` with `xdg-open` when available. To stop the app, use **Help & About → Stop Studio Inventory** in the app, which closes the catalog cleanly, or press `Ctrl+C` in the terminal.

## Install for your user

From the extracted release folder:

```bash
./Install\ Studio\ Inventory.sh
```

The installer:

- installs to `~/.local/share/studio-inventory`;
- creates the `studio-inventory` command under `~/.local/bin`;
- adds a desktop/application-menu entry;
- preserves the installed `data/` folder during updates.

If `~/.local/bin` is not already on your `PATH`, start the app from the applications menu or run:

```bash
~/.local/share/studio-inventory/Start\ Studio\ Inventory.sh
```

## Updating

Download and extract the newer release, stop any running Studio Inventory server (**Help & About → Stop Studio Inventory**), and run its installer again. The installer backs up and restores the existing `data/` directory while replacing application files.

For an additional safety copy, use **Backup & Restore → Full Backup ZIP** before updating.

## Local-network access

The server listens on port `3847`. From another device on the same trusted network, open:

```text
http://<linux-computer-ip>:3847
```

Set an owner PIN of at least 6 characters under **Backup & Restore** before using remote administrative access. Android Chrome/Edge and iPad Safari can use the photo-capture and label-photo flows. Live barcode video requires HTTPS; use **Take a Label Photo** on the normal HTTP LAN address.

If a firewall is enabled, allow TCP port `3847` only on trusted local networks. Do not forward the port to the internet: the owner PIN protects access, but the default HTTP connection is not encrypted.

## Developer installation

To run from a Git clone instead of a release archive:

```bash
git clone https://github.com/TerkWerX/STUDIO-INVENTORY.git
cd STUDIO-INVENTORY
npm install
npm start
```

Node.js 22 or newer is required for a developer installation.
