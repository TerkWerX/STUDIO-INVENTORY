# Website update releases

Studio Inventory checks `https://www.terkwerx.com/downloads/studio-inventory/latest.json` on startup. Help & About has a **Check for Updates** button that bypasses the six-hour success cache. Failed checks show an error instead of reporting that the app is current. The inventory remains usable offline.

The download is selected by the server's operating system and Node architecture, not the browser device. Available packages are Windows x64, macOS Apple Silicon, and Linux x64. Unsupported architectures get the website link without an incompatible installer. Update links must use HTTPS on terkwerx.com. Downloads are initiated by the browser; the app does not execute installers or replace itself.

## Publishing the next release

1. Set the new version in package.json and package-lock.json, build and test all native packages, and copy them to the website's `downloads/studio-inventory` directory.
2. Update the webpage's download links, labels, sizes, and checksums.
3. Generate the manifest only after the release files are ready:

   ```powershell
   npm run publish:update-manifest -- "J:\TerkWerX page" 2.8.1 "Describe the changes in this release."
   ```

   The script requires all six release downloads and records their sizes and SHA-256 hashes. The Mac packages currently target arm64. Update the target table if introducing Intel Mac or Linux ARM builds.

4. Deploy the download files and webpage to the web host first, then deploy `latest.json` last. Configure the host/CDN to avoid caching `latest.json` for long periods. Verify all HTTPS download URLs before announcing the release.
5. In an older installed copy with this feature, use Help & About → Check for Updates. Test the installer on a separate test catalog before publishing broadly.

Version 2.9.0 includes website update checking. Older 2.8.0 packages still check GitHub; users should download and install 2.9.0 from the website once to switch to the website update channel. Do not announce an unbuilt version in the manifest.

## Guided update

The update dialog offers **Back Up First**, **Download Installer**, and **Portable Downloads & Instructions**. The user stops the server and runs the downloaded installer. Closing the browser alone does not stop the server. Existing catalog data is preserved by the installer; users with portable or custom catalog paths should follow the Help & About instructions.

Checksums are published for verification; this browser-download flow does not automatically verify the downloaded file or install it.

## Verification

Run `npm run test:updates`. Tests cover version ordering, platform selection, invalid feeds and URLs, HTTP failures, cache bypass, update endpoint authorization, and the browser's guided update flow using an isolated catalog.
