## Studio Inventory v2.9.1

A security and reliability release. Nothing about how you catalog gear has changed, but several things around it are safer, and a few defaults are stricter. Please read **Behavior changes** before updating.

### Before you update

1. In the app, open **Backup** and make a **Full Backup ZIP**.
2. Close Studio Inventory. Closing the browser tab is not enough: stop the server (close its window, or let the Windows setup close it for you).
3. Run the installer for your platform. Your `data/` folder (catalog, photos, manuals, receipts, wall photos, software, Manual Inbox) is kept.

Running from source? `git pull`, then `npm ci` (or `npm install`). **Node.js 22 or newer is now required.**

The first time you open the app after updating, the page reloads once to pick up the new files.

### Security

- Other websites can no longer make changes to your catalog through a browser on the studio computer, and look-alike host names are refused.
- Requests that arrive through a reverse proxy are treated as remote and need the owner PIN.
- Uploads check the record they belong to before anything is written, and file paths can't leave the app's own folders.
- Text you or others type (names, notes, manual snippets) is always shown as text, never run as page code. A Content Security Policy now blocks inline scripts as a second layer.
- A QR label only opens its own item's photos, manuals and software.
- Guest links show less: no purchase prices, receipts, private notes or borrower details.
- Downloading a manual or installer "from a URL" refuses addresses on your own computer or local network, follows redirects carefully, and enforces size limits and timeouts.
- PDF manuals are indexed in a separate worker with memory and time limits, so a broken or hostile PDF can't stall the app.
- Dependencies updated (Express 4.22, Multer 2). PDF text extraction moved to `unpdf`. `npm audit` reports no known vulnerabilities.

### Reliability

- **Updates can no longer lose your catalog.** Earlier installers copied `data/` to a temporary folder, deleted the install, and deleted that temporary copy even if the update failed part way. All installers (Windows setup, Windows ZIP, macOS, Linux) now move `data/` into the new version with a single rename, and put the previous version back if any step fails.
- **Backups stream to disk.** Full backups and restores no longer load the whole library into memory, so large photo and manual collections back up without freezing the app. Restores accept backups up to 64 GB. Encrypted backups use the same format as before, and older backups still restore.
- **CSV export** keeps multi-line notes, quotes, commas and accented characters in the right cells, opens correctly in Excel, and guards against spreadsheet formulas hidden in text. CSV import reads these files back unchanged.
- **Settings are saved safely.** Settings files are written atomically with a backup copy, and a damaged file is restored from that copy automatically instead of being replaced with defaults.
- **PDF export works again.** The PDF library was loaded from a CDN link that no longer existed; it now ships with the app (jsPDF 4.2.1), so exports also work offline.
- **A brand-new catalog works on its first start.** Before, the first launch created the room tables without their newer columns, so adding the first piece of gear showed an error (and saved it anyway) until the app was restarted.
- **One failing request can no longer stop the server.** An error inside any request now comes back as an error message; before, some errors (a brand name containing "%", a damaged settings file) shut the whole app down.
- **Saves are all-or-nothing.** Creating or editing gear, CSV rows, imports and deletes either finish completely or change nothing. Bad input (tags that aren't words, "Infinity" as a price, loan dates like 1/5/2027) gets a clear message instead of half-saved records.
- **Files follow their records.** Uploads are removed if the record can't be saved, replaced room photos are cleaned up, and deleting gear removes its files after the record. Items copied by a JSON import get their own copies of photos and manuals, so deleting one never removes the other's files.
- **No more double saves.** Double-clicking Save, Upload, Print or Back Up does the job once. A second backup or restore can't start while one is running.
- **The app keeps your place.** A slow page no longer replaces the one you moved to, search keeps your typing, Escape cancels a question instead of leaving it stuck, and leaving a form with unsaved changes asks first.
- **Phone uploads** no longer send photos twice or drop a photo taken during an upload. The camera turns off as soon as a code is scanned.
- **Clean start and stop.** Starting a second copy explains that the port is in use. There is now a proper way to stop the app on every platform: **Help & About → Stop Studio Inventory**, or on Windows **Stop Studio Inventory** in the Start menu. The installer and uninstaller also ask the app to stop instead of ending it abruptly, so it finishes what it is doing and closes the catalog properly. It is only forced if it doesn't respond.
- **A server log on every computer.** What the app does on the studio computer (start-ups, backups, errors) is kept in `data/logs/studio-inventory.log`, viewable in **Help & About → Server Log**. On Windows, where the app runs without a window, this is the only place error details appear. Share links and PINs are hidden in the log.

### Behavior changes

| What | Before | Now |
|---|---|---|
| Custom host names | Any host name was accepted | Local names (`localhost`, IP addresses, `*.local`, `*.lan`, the computer's name) work as before. Others must be listed in `STUDIO_ALLOWED_HOSTS` (comma-separated). |
| Reverse proxy access | Could count as "this computer" | Always needs the owner PIN |
| Guest links | Included purchase details and notes | Show gear details, photos, location and replacement value only |
| Brand logos | Looked up online automatically | Off by default. Turn on in **Brands → Look up logos online for new brands**. Clearbit removed. |
| Download from a local address (NAS, router) | Allowed | Refused. Set `STUDIO_ALLOW_PRIVATE_DOWNLOADS=1` to allow. |
| Running from source | Node.js 18+ | Node.js 22+ (release downloads include the right runtime) |

### macOS

The app isn't notarized by Apple yet. On macOS Sequoia (15) and later, Control-click → Open no longer bypasses the warning: click **Done**, then **System Settings → Privacy & Security → Open Anyway**. See [MAC.md](https://github.com/TerkWerX/STUDIO-INVENTORY/blob/main/MAC.md#if-macos-blocks-it-the-first-time). The macOS download is built for Apple Silicon Macs.

### For maintainers

- CI and release builds run on Node 22. `npm test` passes on a clean Ubuntu runner, and now includes installer failure tests.
- The packager copies `node_modules` verbatim (it used to drop every folder named `dist`, which would have shipped a build that crashes at startup) and refuses to finish if any production dependency fails to load from the package. CI runs this check on every push.
- Release smoke tests install twice on Windows and Linux and fail if the second install loses a file in `data/`.
- After the release assets are built and uploaded, publish the website manifest last, as described in [docs/website-updates.md](website-updates.md).
