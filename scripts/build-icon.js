#!/usr/bin/env node
/**
 * Builds branding/icon.ico from public/icons/icon.svg.
 *
 * Windows embeds the icon into the launcher EXEs at compile time (csc
 * /win32icon:), so this runs before packaging, not at runtime. Chromium
 * rasterises the SVG at each size Explorer asks for: 16 and 32 for the
 * taskbar and list views, 48 for medium icons, 256 for the preview pane.
 * Below 32px the mark is only three bars and two rails, which is why it
 * survives at all.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'public', 'icons', 'icon.svg');
const OUT = path.join(ROOT, 'branding', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** ICO container holding PNG payloads (supported by Windows Vista and newer). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);  // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);                       // palette colours
    e.writeUInt8(0, 3);                       // reserved
    e.writeUInt16LE(1, 4);                    // colour planes
    e.writeUInt16LE(32, 6);                   // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.png)]);
}

async function main() {
  const { chromium } = require('playwright');
  const svg = fs.readFileSync(SVG, 'utf8');
  const browser = await chromium.launch();
  const images = [];
  try {
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<body style="margin:0;width:${size}px;height:${size}px">` +
        svg.replace('<svg', `<svg width="${size}" height="${size}"`) +
        `</body>`
      );
      images.push({ size, png: await page.screenshot({ omitBackground: true }) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buildIco(images));
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${SIZES.join(', ')} px, ${fs.statSync(OUT).size} bytes)`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
