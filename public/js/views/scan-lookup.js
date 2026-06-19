import { escapeHtml } from '../utils.js';

export function renderScanLookup() {
  return `
    <h2 class="page-title">Scan &amp; Lookup</h2>
    <p class="page-subtitle">USB barcode scanner, camera, or type a serial number — find gear instantly</p>

    <div class="card scan-lookup-card">
      <h3 class="section-title">USB / Bluetooth Scanner</h3>
      <p class="text-muted-sm">Focus the field below and scan — most scanners type the code and press Enter.</p>
      <div class="scan-wedge-row">
        <input type="text" id="scan-wedge-input" class="scan-wedge-input" placeholder="Click here, then scan barcode or QR…" autocomplete="off" autofocus>
        <button type="button" class="btn btn-primary" id="scan-wedge-go">Look Up</button>
      </div>
    </div>

    <div class="card scan-lookup-card">
      <div class="card-header">
        <h3 class="section-title">Camera Scan</h3>
        <button type="button" class="btn btn-secondary btn-sm" id="scan-camera-toggle">Start Camera</button>
      </div>
      <p class="text-muted-sm" id="scan-camera-hint">Uses your device camera for QR codes and barcodes (Chrome / Edge recommended).</p>
      <div id="scan-camera-wrap" class="scan-camera-wrap hidden">
        <video id="scan-camera-video" class="scan-camera-video" playsinline muted></video>
        <canvas id="scan-camera-canvas" class="hidden" hidden></canvas>
      </div>
    </div>

    <div id="scan-results" class="scan-results hidden"></div>
  `;
}

export function renderScanResult(result) {
  if (result.match === 'multiple') {
    return `
      <div class="card scan-result-card">
        <h3 class="section-title">Multiple matches</h3>
        <p class="text-muted-sm">Several items share that serial pattern — pick one:</p>
        <ul class="scan-candidate-list">
          ${result.candidates.map(c => `
            <li>
              <button type="button" class="scan-candidate-btn" data-action="scan-pick" data-id="${c.id}">
                <strong>${escapeHtml(c.name)}</strong>
                <span class="text-muted-sm">${escapeHtml(c.serial_number)} · ${escapeHtml(c.location)}</span>
              </button>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  const item = result.item;
  return `
    <div class="card scan-result-card scan-result-found">
      <div class="scan-result-header">
        <div>
          <h3 class="section-title" style="margin:0">${escapeHtml(item.name)}</h3>
          <p class="text-muted-sm">${escapeHtml(item.brand)} ${escapeHtml(item.model)} · ${escapeHtml(item.location)}</p>
          ${item.serial_number ? `<p class="text-muted-sm">Serial: ${escapeHtml(item.serial_number)}</p>` : ''}
        </div>
        <span class="scan-match-badge">Matched by ${result.match}</span>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-primary" data-action="view-item" data-id="${item.id}">Open Item</button>
        <button type="button" class="btn btn-secondary" id="scan-another">Scan Another</button>
      </div>
    </div>
  `;
}

export async function startCameraScan(onCode, onError) {
  if (!('BarcodeDetector' in window)) {
    onError('Camera barcode scanning needs Chrome or Edge. USB scanner and manual entry still work.');
    return null;
  }

  const video = document.getElementById('scan-camera-video');
  const wrap = document.getElementById('scan-camera-wrap');
  if (!video) return null;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
  } catch (err) {
    onError(err.message || 'Camera access denied');
    return null;
  }

  video.srcObject = stream;
  await video.play();
  wrap?.classList.remove('hidden');

  const detector = new BarcodeDetector({
    formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e']
  });

  let active = true;
  const tick = async () => {
    if (!active || video.readyState < 2) {
      if (active) requestAnimationFrame(tick);
      return;
    }
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        active = false;
        onCode(codes[0].rawValue);
        return;
      }
    } catch { /* frame skip */ }
    if (active) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return () => {
    active = false;
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    wrap?.classList.add('hidden');
  };
}