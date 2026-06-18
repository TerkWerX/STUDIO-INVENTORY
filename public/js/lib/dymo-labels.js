import { LABEL_SIZES, getScanUrl, getQrImageUrl } from './label-settings.js';

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textObject(name, text, bounds) {
  return `
    <ObjectInfo>
      <TextObject>
        <Name>${escapeXml(name)}</Name>
        <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
        <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
        <LinkedObjectName></LinkedObjectName>
        <Rotation>Rotation0</Rotation>
        <IsMirrored>False</IsMirrored>
        <IsVariable>True</IsVariable>
        <HorizontalAlignment>Left</HorizontalAlignment>
        <VerticalAlignment>Top</VerticalAlignment>
        <TextFitMode>ShrinkToFit</TextFitMode>
        <UseFullFontHeight>True</UseFullFontHeight>
        <Verticalized>False</Verticalized>
        <StyledText>
          <Element>
            <String>${escapeXml(text)}</String>
            <Attributes>
              <Font Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False" />
              <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
            </Attributes>
          </Element>
        </StyledText>
      </TextObject>
      <Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.w}" Height="${bounds.h}" />
    </ObjectInfo>`;
}

function qrObject(url, bounds) {
  return `
    <ObjectInfo>
      <BarcodeObject>
        <Name>QR</Name>
        <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
        <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
        <LinkedObjectName></LinkedObjectName>
        <Rotation>Rotation0</Rotation>
        <IsMirrored>False</IsMirrored>
        <IsVariable>True</IsVariable>
        <Text>${escapeXml(url)}</Text>
        <Type>QRCode</Type>
        <Size>Medium</Size>
        <TextPosition>None</TextPosition>
        <TextFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False" />
        <CheckSumFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False" />
        <TextEmbedding>None</TextEmbedding>
        <ECLevel>0</ECLevel>
        <HorizontalAlignment>Center</HorizontalAlignment>
        <QuietZonesPadding Left="0" Top="0" Right="0" Bottom="0" />
      </BarcodeObject>
      <Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.w}" Height="${bounds.h}" />
    </ObjectInfo>`;
}

/**
 * Build DYMO label XML for owner/gear labels (30252, 30336, 30323).
 */
export function buildOwnerLabelXml(item, options = {}) {
  const sizeKey = options.labelSize || '30252';
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES['30252'];
  const scanUrl = options.scanUrl || getScanUrl(item.id, options.baseUrl);
  const studioName = options.studioName || 'Studio Inventory';

  const title = item.name || 'Studio Gear';
  const line2 = [item.brand, item.model].filter(Boolean).join(' ');
  const line3 = item.serial_number ? `S/N: ${item.serial_number}` : '';
  const line4 = item.location ? `Loc: ${item.location}` : '';

  let objects = '';
  if (sizeKey === '30336') {
    objects += textObject('TITLE', title, { x: 0.08, y: 0.08, w: 1.35, h: 0.28 });
    if (line2) objects += textObject('LINE2', line2, { x: 0.08, y: 0.34, w: 1.35, h: 0.22 });
    objects += qrObject(scanUrl, { x: 1.35, y: 0.1, w: 0.72, h: 0.72 });
  } else if (sizeKey === '30323') {
    objects += textObject('STUDIO', studioName, { x: 0.12, y: 0.1, w: 2.4, h: 0.22 });
    objects += textObject('TITLE', title, { x: 0.12, y: 0.32, w: 2.4, h: 0.3 });
    if (line2) objects += textObject('LINE2', line2, { x: 0.12, y: 0.6, w: 2.4, h: 0.24 });
    if (line3) objects += textObject('LINE3', line3, { x: 0.12, y: 0.82, w: 2.4, h: 0.2 });
    if (line4) objects += textObject('LINE4', line4, { x: 0.12, y: 1.0, w: 2.4, h: 0.2 });
    objects += qrObject(scanUrl, { x: 2.85, y: 0.55, w: 1.0, h: 1.0 });
  } else {
    objects += textObject('STUDIO', studioName, { x: 0.1, y: 0.06, w: 2.0, h: 0.18 });
    objects += textObject('TITLE', title, { x: 0.1, y: 0.24, w: 2.0, h: 0.28 });
    if (line2) objects += textObject('LINE2', line2, { x: 0.1, y: 0.5, w: 2.0, h: 0.2 });
    if (line3) objects += textObject('LINE3', line3, { x: 0.1, y: 0.68, w: 2.0, h: 0.18 });
    if (line4) objects += textObject('LINE4', line4, { x: 0.1, y: 0.84, w: 2.0, h: 0.18 });
    objects += qrObject(scanUrl, { x: 2.45, y: 0.12, w: 0.88, h: 0.88 });
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<DesktopLabel Version="1">
  <DYMOLabel Version="3">
    <Description>StudioInventoryOwnerLabel</Description>
    <Orientation>Landscape</Orientation>
    <LabelName>${escapeXml(size.labelName)}</LabelName>
    <InitialLength>0</InitialLength>
    <HorizontalMargin>0</HorizontalMargin>
    <VerticalMargin>0</VerticalMargin>
    <HorizontalGap>0</HorizontalGap>
    <VerticalGap>0</VerticalGap>
    ${objects}
  </DYMOLabel>
</DesktopLabel>`;
}

let dymoLoadPromise = null;

export function loadDymoFramework() {
  if (window.dymo?.label?.framework) return Promise.resolve(window.dymo.label.framework);
  if (dymoLoadPromise) return dymoLoadPromise;

  dymoLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://qajavascriptsdktests.azurewebsites.net/JavaScript/dymo.connect.framework.js';
    script.onload = () => {
      const fw = window.dymo?.label?.framework;
      if (!fw) return reject(new Error('DYMO framework loaded but unavailable'));
      try { fw.init(); } catch { /* may already be initialized */ }
      resolve(fw);
    };
    script.onerror = () => reject(new Error('Failed to load DYMO Connect framework'));
    document.head.appendChild(script);
  });

  return dymoLoadPromise;
}

export async function getDymoStatus() {
  try {
    const fw = await loadDymoFramework();
    const env = fw.checkEnvironment?.() || {};
    const printers = fw.getPrinters?.() || [];
    const names = [];
    for (let i = 0; i < printers.length; i++) {
      const p = printers[i];
      names.push(typeof p === 'string' ? p : p.name);
    }
    return {
      available: true,
      isBrowserSupported: env.isBrowserSupported !== false,
      isFrameworkInstalled: env.isFrameworkInstalled !== false,
      isWebServicePresent: env.isWebServicePresent !== false,
      printers: names.filter(Boolean)
    };
  } catch (err) {
    return { available: false, error: err.message, printers: [] };
  }
}

export async function printOwnerLabel(item, options = {}) {
  const fw = await loadDymoFramework();
  const labelXml = buildOwnerLabelXml(item, options);
  const label = fw.openLabelXml(labelXml);
  if (!label) throw new Error('Invalid label XML');

  const printers = fw.getPrinters() || [];
  let printerName = options.printerName;
  if (!printerName) {
    for (let i = 0; i < printers.length; i++) {
      const p = printers[i];
      const name = typeof p === 'string' ? p : p.name;
      if (/labelwriter|dymo/i.test(name || '')) { printerName = name; break; }
    }
    if (!printerName && printers.length) {
      const p = printers[0];
      printerName = typeof p === 'string' ? p : p.name;
    }
  }
  if (!printerName) throw new Error('No DYMO printer found. Install DYMO Connect and connect your LabelWriter 450 Turbo.');

  const params = fw.createLabelWriterPrintParamsXml?.() || '<LabelWriterPrintParams><Copies>1</Copies></LabelWriterPrintParams>';
  fw.printLabel(printerName, params, labelXml, '');
  return { printerName, labelXml };
}

export async function renderLabelPreview(item, options = {}) {
  const fw = await loadDymoFramework();
  const labelXml = buildOwnerLabelXml(item, options);
  const printers = fw.getPrinters() || [];
  const printerName = options.printerName || (printers[0]?.name || printers[0] || '');
  const pngBase64 = fw.renderLabel(labelXml, '', printerName);
  return `data:image/png;base64,${pngBase64}`;
}

export function printLabelFallback(item, options = {}) {
  const sizeKey = options.labelSize || '30252';
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES['30252'];
  const scanUrl = options.scanUrl || getScanUrl(item.id, options.baseUrl);
  const studioName = options.studioName || 'Studio Inventory';
  const w = size.widthIn;
  const h = size.heightIn;

  const win = window.open('', '_blank', 'width=520,height=360');
  if (!win) throw new Error('Pop-up blocked — allow pop-ups to print labels');

  win.document.write(`<!DOCTYPE html><html><head><title>Print Label</title>
<style>
@page { size: ${w}in ${h}in; margin: 0; }
html, body { margin: 0; padding: 0; }
.label {
  width: ${w}in; height: ${h}in; box-sizing: border-box;
  font-family: Arial, sans-serif; display: flex; align-items: stretch;
  padding: 0.08in; gap: 0.08in;
}
.text { flex: 1; min-width: 0; font-size: 9pt; line-height: 1.25; }
.text strong { display: block; font-size: 10pt; margin-bottom: 0.04in; }
.studio { font-size: 7pt; color: #444; margin-bottom: 0.06in; }
.qr img { width: 0.85in; height: 0.85in; display: block; }
</style></head><body>
<div class="label">
  <div class="text">
    <div class="studio">${studioName.replace(/</g, '')}</div>
    <strong>${(item.name || '').replace(/</g, '')}</strong>
    ${[item.brand, item.model].filter(Boolean).join(' ').replace(/</g, '')}<br>
    ${item.serial_number ? `S/N: ${item.serial_number.replace(/</g, '')}<br>` : ''}
    ${item.location ? `Loc: ${item.location.replace(/</g, '')}` : ''}
  </div>
  <div class="qr"><img src="${getQrImageUrl(item.id, options.baseUrl)}" alt="QR"></div>
</div>
<script>window.onload=()=>{window.print(); setTimeout(()=>window.close(), 500);}</script>
</body></html>`);
  win.document.close();
}