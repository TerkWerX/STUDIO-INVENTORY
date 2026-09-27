## Studio Inventory v2.9.2

A small follow-up to 2.9.1. Nothing about your catalog changes, and there are no behavior changes to read before updating.

### Before you update

1. In the app, open **Backup** and make a **Full Backup ZIP**.
2. Stop Studio Inventory — **Help & About → Stop Studio Inventory**, or the **Stop Studio Inventory** entry in the Windows Start menu.
3. Run the installer for your platform. Your `data/` folder is kept.

Running from source? `git pull`, then `npm ci`.

### What changed

- **The app has its own icon.** The Windows launcher, the installer and the setup program were all built without one, so the desktop and Start menu shortcuts showed the default Windows program icon. They now use a Studio Inventory mark — three rack units — which also replaces the browser tab icon, the installed web-app icon and the logo in the sidebar.
- **Stopping the app is easier to find.** The **Stop Studio Inventory** button was at the bottom of a section about running the server, seven cards down the Help page. It is now the first thing on **Help & About**, in a section of its own that explains why closing the browser tab is not enough.
- **The sidebar entry is now called Help & About**, matching the page it opens and the instructions in the release notes and platform guides. It was previously just "Help".

### For maintainers

- `npm run build:icon` regenerates `branding/icon.ico` from `public/icons/icon.svg` at 16–256 px. `branding/` is outside the packager's copy list, so the icon is a build input and is not shipped.
- Both `csc` invocations pass `/win32icon` when the icon file is present, and still build without it.
- After the release assets are built and uploaded, publish the website manifest last, as described in [docs/website-updates.md](website-updates.md).
