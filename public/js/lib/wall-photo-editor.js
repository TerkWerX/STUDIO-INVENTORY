import { escapeHtml } from '../utils.js';
import { api } from '../api.js';
import {
  formatLengthInput, lengthStep, lengthUnitLabel, lengthUnitOptions,
  normalizeLengthUnit, toFeet
} from './measurement.js';

/**
 * Wall photo workflow: capture → crop → chroma key → calibrate scale → hang on wall.
 */
export function openWallPhotoEditor({ item, pin, unit = 'ft', mode = 'placement', onSave, onToast }) {
  const inventoryMode = mode === 'inventory';
  const overlay = document.getElementById('wall-photo-overlay')
    || createPhotoOverlay();

  const editor = {
    sourceImage: null,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    chroma: { enabled: false, r: 0, g: 177, b: 64, tolerance: 42 },
    calPoints: [],
    calDistanceFt: 2,
    photoWidthFt: pin?.photo_width_ft || 2,
    photoHeightFt: pin?.photo_height_ft || 3,
    processedBlob: null,
    wallPhotoPath: pin?.wall_photo_path || ''
  };
  let scaleUnit = normalizeLengthUnit(unit, 'in');

  overlay.innerHTML = `
    <div class="wall-photo-modal" role="dialog" aria-modal="true">
      <div class="wall-photo-header">
        <h2>${inventoryMode ? 'Wall cutout photo' : 'Hang on wall'} — ${escapeHtml(item.name || pin?.name || 'Item')}</h2>
        <button type="button" class="btn btn-ghost wall-photo-close" aria-label="Close">&times;</button>
      </div>

      <div class="wall-photo-tip card">
        <strong>${inventoryMode ? 'Virtual wall only:' : 'Best results:'}</strong>
        ${inventoryMode
    ? 'This cutout is used when the item hangs on your studio wall — not for inventory records. Photograph on a plain backdrop, crop, and key out the background.'
    : 'Photograph the instrument on a <em>plain, contrasting background</em> (green screen, white sheet, or solid wall). Crop and optionally remove the backdrop so the gear hangs in its real shape — not a rectangle.'}
      </div>

      <div class="wall-photo-steps btn-group">
        <button type="button" class="btn btn-secondary btn-sm wp-step active" data-step="capture">1. Photo</button>
        <button type="button" class="btn btn-secondary btn-sm wp-step" data-step="crop">2. Crop</button>
        <button type="button" class="btn btn-secondary btn-sm wp-step" data-step="chroma">3. Cut out</button>
        <button type="button" class="btn btn-secondary btn-sm wp-step" data-step="scale">4. Scale</button>
      </div>

      <div class="wall-photo-panel" data-panel="capture">
        <div class="wall-photo-capture-row">
          <label class="btn btn-primary" style="cursor:pointer">
            Take photo (camera)
            <input type="file" accept="image/*" capture="environment" id="wp-camera-input" hidden>
          </label>
          <label class="btn btn-secondary" style="cursor:pointer">
            Upload image
            <input type="file" accept="image/*" id="wp-file-input" hidden>
          </label>
        </div>
        <canvas id="wp-preview-canvas" class="wall-photo-canvas"></canvas>
      </div>

      <div class="wall-photo-panel hidden" data-panel="crop">
        <p class="text-muted-sm">Use the full image if it is already cropped. Drag the crop box or use the mouse wheel only when you need to trim extra backdrop.</p>
        <button type="button" class="btn btn-ghost btn-sm" id="wp-crop-reset">Use full image</button>
        <canvas id="wp-crop-canvas" class="wall-photo-canvas"></canvas>
      </div>

      <div class="wall-photo-panel hidden" data-panel="chroma">
        <p class="text-muted-sm">Remove the plain backdrop from the cutout. The tool auto-samples the image corners; click the backdrop if you need a different sample.</p>
        <div class="wall-photo-chroma-controls">
          <label><input type="checkbox" id="wp-chroma-enable"> Remove backdrop</label>
          <label>Tolerance <input type="range" id="wp-chroma-tol" min="5" max="120" value="42"></label>
          <button type="button" class="btn btn-ghost btn-sm" id="wp-chroma-auto">Auto backdrop</button>
          <span class="wp-chroma-swatch" id="wp-chroma-swatch" title="Backdrop color"></span>
        </div>
        <canvas id="wp-chroma-canvas" class="wall-photo-canvas"></canvas>
      </div>

      <div class="wall-photo-panel hidden" data-panel="scale">
        <p class="text-muted-sm">Click <strong>two points</strong> on the instrument (e.g. top and bottom), then enter the real distance between them.</p>
        <div class="form-grid wall-photo-scale-grid">
          <div class="form-group">
            <label for="wp-scale-unit">Measurement unit</label>
            <select id="wp-scale-unit">${lengthUnitOptions(scaleUnit)}</select>
          </div>
          <div class="form-group">
            <label>Distance between points (<span class="wp-scale-unit-label">${lengthUnitLabel(scaleUnit)}</span>)</label>
            <input type="number" id="wp-cal-distance" min="0" step="${lengthStep(scaleUnit)}" value="${formatLengthInput(editor.calDistanceFt, scaleUnit)}">
          </div>
          <div class="form-group">
            <label>Item width (<span class="wp-scale-unit-label">${lengthUnitLabel(scaleUnit)}</span>)</label>
            <input type="number" id="wp-width-ft" min="0" step="${lengthStep(scaleUnit)}" value="${formatLengthInput(editor.photoWidthFt, scaleUnit)}">
          </div>
          <div class="form-group">
            <label>Item height (<span class="wp-scale-unit-label">${lengthUnitLabel(scaleUnit)}</span>)</label>
            <input type="number" id="wp-height-ft" min="0" step="${lengthStep(scaleUnit)}" value="${formatLengthInput(editor.photoHeightFt, scaleUnit)}">
          </div>
        </div>
        <canvas id="wp-scale-canvas" class="wall-photo-canvas wp-scale-canvas"></canvas>
        <button type="button" class="btn btn-ghost btn-sm" id="wp-cal-reset">Reset calibration points</button>
      </div>

      <div class="wall-photo-footer">
        <button type="button" class="btn btn-primary" id="wp-save">${inventoryMode ? 'Save cutout' : 'Save &amp; hang on wall'}</button>
        <button type="button" class="btn btn-secondary wall-photo-close">Cancel</button>
      </div>
    </div>
  `;

  const previewCanvas = overlay.querySelector('#wp-preview-canvas');
  const cropCanvas = overlay.querySelector('#wp-crop-canvas');
  const chromaCanvas = overlay.querySelector('#wp-chroma-canvas');
  const scaleCanvas = overlay.querySelector('#wp-scale-canvas');
  let currentStep = 'capture';
  let scalePointer = null;

  function setStep(step) {
    currentStep = step;
    if (step !== 'scale') scalePointer = null;
    overlay.querySelectorAll('.wp-step').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.step === step);
      btn.classList.toggle('btn-secondary', btn.dataset.step !== step);
      btn.classList.toggle('active', btn.dataset.step === step);
    });
    overlay.querySelectorAll('.wall-photo-panel').forEach(p => {
      p.classList.toggle('hidden', p.dataset.panel !== step);
    });
    if (step === 'crop') drawCrop();
    if (step === 'chroma') drawChroma();
    if (step === 'scale') drawScale();
  }

  async function loadFile(file) {
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    editor.sourceImage = img;
    resetCrop();
    editor.calPoints = [];
    drawPreview();
    setStep('crop');
    onToast?.('Photo loaded — crop next', 'success');
  }

  overlay.querySelector('#wp-camera-input')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
    e.target.value = '';
  });
  overlay.querySelector('#wp-file-input')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
    e.target.value = '';
  });

  overlay.querySelectorAll('.wp-step').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!editor.sourceImage && btn.dataset.step !== 'capture') {
        onToast?.('Add a photo first', 'error');
        return;
      }
      setStep(btn.dataset.step);
    });
  });

  overlay.querySelector('#wp-chroma-enable')?.addEventListener('change', (e) => {
    editor.chroma.enabled = e.target.checked;
    if (editor.chroma.enabled) autoSampleBackdrop();
    drawChroma();
  });
  overlay.querySelector('#wp-chroma-tol')?.addEventListener('input', (e) => {
    editor.chroma.tolerance = Number(e.target.value);
    drawChroma();
  });

  chromaCanvas?.addEventListener('click', (e) => {
    if (!editor.sourceImage) return;
    const { x, y } = canvasCoords(chromaCanvas, e);
    const ctx = chromaCanvas.getContext('2d');
    const p = ctx.getImageData(x, y, 1, 1).data;
    editor.chroma.r = p[0];
    editor.chroma.g = p[1];
    editor.chroma.b = p[2];
    updateChromaSwatch();
    drawChroma();
  });
  overlay.querySelector('#wp-chroma-auto')?.addEventListener('click', () => {
    autoSampleBackdrop();
    drawChroma();
  });

  scaleCanvas?.addEventListener('click', (e) => {
    if (!editor.sourceImage) return;
    const { x, y } = canvasCoords(scaleCanvas, e);
    if (editor.calPoints.length >= 2) editor.calPoints = [];
    editor.calPoints.push({ x, y });
    drawScale();
    if (editor.calPoints.length === 2) applyCalibration();
  });
  scaleCanvas?.addEventListener('pointermove', (e) => {
    if (!editor.sourceImage || currentStep !== 'scale') return;
    scalePointer = canvasCoords(scaleCanvas, e);
    drawScale();
  });
  scaleCanvas?.addEventListener('pointerleave', () => {
    scalePointer = null;
    if (currentStep === 'scale') drawScale();
  });

  overlay.querySelector('#wp-cal-distance')?.addEventListener('change', (e) => {
    editor.calDistanceFt = toFeet(e.target.value, scaleUnit) || editor.calDistanceFt || 2;
    e.target.value = formatLengthInput(editor.calDistanceFt, scaleUnit);
    if (editor.calPoints.length === 2) applyCalibration();
  });
  overlay.querySelector('#wp-scale-unit')?.addEventListener('change', (e) => {
    scaleUnit = normalizeLengthUnit(e.target.value, scaleUnit);
    syncScaleInputsFromFeet();
  });
  overlay.querySelector('#wp-cal-reset')?.addEventListener('click', () => {
    editor.calPoints = [];
    drawScale();
  });
  overlay.querySelector('#wp-crop-reset')?.addEventListener('click', () => {
    resetCrop();
    drawCrop();
  });
  overlay.querySelector('#wp-width-ft')?.addEventListener('change', (e) => {
    editor.photoWidthFt = toFeet(e.target.value, scaleUnit) || editor.photoWidthFt || 2;
    e.target.value = formatLengthInput(editor.photoWidthFt, scaleUnit);
  });
  overlay.querySelector('#wp-height-ft')?.addEventListener('change', (e) => {
    editor.photoHeightFt = toFeet(e.target.value, scaleUnit) || editor.photoHeightFt || 3;
    e.target.value = formatLengthInput(editor.photoHeightFt, scaleUnit);
  });

  overlay.querySelector('#wp-save')?.addEventListener('click', async () => {
    try {
      const blob = await renderProcessedBlob();
      if (!blob) throw new Error('Add and process a photo first');
      const fd = new FormData();
      fd.append('image', blob, 'wall-hang.png');
      const uploaded = await api.uploadWallPhoto(item.id, fd);
      editor.wallPhotoPath = uploaded.wall_photo_path;
      editor.photoWidthFt = toFeet(overlay.querySelector('#wp-width-ft')?.value, scaleUnit) || editor.photoWidthFt;
      editor.photoHeightFt = toFeet(overlay.querySelector('#wp-height-ft')?.value, scaleUnit) || editor.photoHeightFt;
      await onSave?.({
        icon_mode: 'photo',
        wall_photo_path: editor.wallPhotoPath,
        photo_width_ft: editor.photoWidthFt,
        photo_height_ft: editor.photoHeightFt,
        photo_calibration: {
          chroma: editor.chroma,
          crop: editor.crop,
          calPoints: editor.calPoints,
          calDistanceFt: editor.calDistanceFt
        }
      });
      onToast?.(inventoryMode ? 'Wall cutout saved' : 'Instrument hung on wall', 'success');
      close();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  });

  overlay.querySelectorAll('.wall-photo-close').forEach(btn => btn.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function close() {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  overlay.classList.remove('hidden');
  setStep('capture');

  if (pin?.wall_photo_path) {
    loadImage(`/uploads/${pin.wall_photo_path.split('/').map(encodeURIComponent).join('/')}`)
      .then(img => {
        editor.sourceImage = img;
        drawPreview();
      }).catch(() => {});
  }

  return { close };

  function drawPreview() {
    if (!editor.sourceImage || !previewCanvas) return;
    fitCanvas(previewCanvas, editor.sourceImage);
    previewCanvas.getContext('2d').drawImage(editor.sourceImage, 0, 0, previewCanvas.width, previewCanvas.height);
  }

  function resetCrop() {
    editor.crop = { x: 0, y: 0, w: 1, h: 1 };
  }

  function drawCrop() {
    if (!editor.sourceImage || !cropCanvas) return;
    fitCanvas(cropCanvas, editor.sourceImage);
    const ctx = cropCanvas.getContext('2d');
    ctx.drawImage(editor.sourceImage, 0, 0, cropCanvas.width, cropCanvas.height);
    const c = editor.crop;
    const rx = c.x * cropCanvas.width;
    const ry = c.y * cropCanvas.height;
    const rw = c.w * cropCanvas.width;
    const rh = c.h * cropCanvas.height;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.clearRect(rx, ry, rw, rh);
    ctx.drawImage(editor.sourceImage, c.x * editor.sourceImage.width, c.y * editor.sourceImage.height,
      c.w * editor.sourceImage.width, c.h * editor.sourceImage.height, rx, ry, rw, rh);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);
  }

  function drawChroma() {
    if (!editor.sourceImage || !chromaCanvas) return;
    const cropped = getCroppedImageData();
    fitCanvas(chromaCanvas, { width: cropped.width, height: cropped.height });
    const ctx = chromaCanvas.getContext('2d');
    drawImageDataScaled(ctx, cropped, chromaCanvas.width, chromaCanvas.height);
    if (editor.chroma.enabled) {
      const img = ctx.getImageData(0, 0, chromaCanvas.width, chromaCanvas.height);
      chromaKey(img.data, editor.chroma);
      ctx.putImageData(img, 0, 0);
    }
  }

  function autoSampleBackdrop() {
    if (!editor.sourceImage) return;
    const cropped = getCroppedImageData();
    const color = averageCornerColor(cropped);
    editor.chroma.r = color.r;
    editor.chroma.g = color.g;
    editor.chroma.b = color.b;
    updateChromaSwatch();
  }

  function updateChromaSwatch() {
    const sw = overlay.querySelector('#wp-chroma-swatch');
    if (sw) sw.style.background = `rgb(${editor.chroma.r},${editor.chroma.g},${editor.chroma.b})`;
  }

  function drawScale() {
    if (!editor.sourceImage || !scaleCanvas) return;
    const cropped = getCroppedImageData();
    if (editor.chroma.enabled) chromaKey(cropped.data, editor.chroma);
    fitCanvas(scaleCanvas, { width: cropped.width, height: cropped.height });
    const ctx = scaleCanvas.getContext('2d');
    drawImageDataScaled(ctx, cropped, scaleCanvas.width, scaleCanvas.height);
    if (editor.calPoints.length === 2) {
      const [a, b] = editor.calPoints;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (scalePointer) drawScaleCrosshair(ctx, scalePointer);
    editor.calPoints.forEach((p, i) => drawScaleMarker(ctx, p, i));
  }

  function applyCalibration() {
    if (editor.calPoints.length !== 2) return;
    const [a, b] = editor.calPoints;
    const pxDist = Math.hypot(b.x - a.x, b.y - a.y);
    if (!pxDist) return;
    const ftPerPx = editor.calDistanceFt / pxDist;
    editor.photoHeightFt = roundFeet(scaleCanvas.height * ftPerPx);
    editor.photoWidthFt = roundFeet(scaleCanvas.width * ftPerPx);
    syncScaleInputsFromFeet();
  }

  function syncScaleInputsFromFeet() {
    const step = String(lengthStep(scaleUnit));
    overlay.querySelectorAll('.wp-scale-unit-label').forEach(el => {
      el.textContent = lengthUnitLabel(scaleUnit);
    });
    const distIn = overlay.querySelector('#wp-cal-distance');
    const wIn = overlay.querySelector('#wp-width-ft');
    const hIn = overlay.querySelector('#wp-height-ft');
    [distIn, wIn, hIn].forEach(input => {
      if (input) input.step = step;
    });
    if (distIn) distIn.value = formatLengthInput(editor.calDistanceFt, scaleUnit);
    if (wIn) wIn.value = formatLengthInput(editor.photoWidthFt, scaleUnit);
    if (hIn) hIn.value = formatLengthInput(editor.photoHeightFt, scaleUnit);
  }

  function drawImageDataScaled(ctx, imageData, width, height) {
    const off = document.createElement('canvas');
    off.width = imageData.width;
    off.height = imageData.height;
    off.getContext('2d').putImageData(imageData, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(off, 0, 0, width, height);
  }

  function drawScaleCrosshair(ctx, p) {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    drawCrosshairLines(ctx, p, 9);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    drawCrosshairLines(ctx, p, 9);
    ctx.restore();
  }

  function drawScaleMarker(ctx, p, index) {
    const color = index === 0 ? '#00e5ff' : '#ffb000';
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    drawCrosshairLines(ctx, p, 7);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    drawCrosshairLines(ctx, p, 7);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawCrosshairLines(ctx, p, size) {
    ctx.beginPath();
    ctx.moveTo(p.x - size, p.y);
    ctx.lineTo(p.x - 3, p.y);
    ctx.moveTo(p.x + 3, p.y);
    ctx.lineTo(p.x + size, p.y);
    ctx.moveTo(p.x, p.y - size);
    ctx.lineTo(p.x, p.y - 3);
    ctx.moveTo(p.x, p.y + 3);
    ctx.lineTo(p.x, p.y + size);
    ctx.stroke();
  }

  function getCroppedImageData() {
    const img = editor.sourceImage;
    const c = editor.crop;
    const sw = Math.round(c.w * img.width);
    const sh = Math.round(c.h * img.height);
    const off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    off.getContext('2d').drawImage(img, c.x * img.width, c.y * img.height, sw, sh, 0, 0, sw, sh);
    return off.getContext('2d').getImageData(0, 0, sw, sh);
  }

  async function renderProcessedBlob() {
    const cropped = getCroppedImageData();
    if (editor.chroma.enabled) chromaKey(cropped.data, editor.chroma);
    const off = document.createElement('canvas');
    off.width = cropped.width;
    off.height = cropped.height;
    off.getContext('2d').putImageData(cropped, 0, 0);
    return new Promise(resolve => off.toBlob(resolve, 'image/png'));
  }

  // Simple crop drag on crop canvas
  let cropDrag = null;
  cropCanvas?.addEventListener('pointerdown', (e) => {
    if (!editor.sourceImage) return;
    const { x, y } = canvasCoords(cropCanvas, e);
    cropDrag = { startX: x, startY: y, crop: { ...editor.crop } };
    cropCanvas.setPointerCapture(e.pointerId);
  });
  cropCanvas?.addEventListener('pointermove', (e) => {
    if (!cropDrag) return;
    const { x, y } = canvasCoords(cropCanvas, e);
    const dx = (x - cropDrag.startX) / cropCanvas.width;
    const dy = (y - cropDrag.startY) / cropCanvas.height;
    editor.crop.x = Math.min(0.95, Math.max(0, cropDrag.crop.x + dx));
    editor.crop.y = Math.min(0.95, Math.max(0, cropDrag.crop.y + dy));
    editor.crop.w = Math.min(1 - editor.crop.x, cropDrag.crop.w);
    editor.crop.h = Math.min(1 - editor.crop.y, cropDrag.crop.h);
    drawCrop();
  });
  cropCanvas?.addEventListener('pointerup', () => { cropDrag = null; });
  cropCanvas?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.02 : -0.02;
    editor.crop.w = Math.min(1 - editor.crop.x, Math.max(0.1, editor.crop.w + delta));
    editor.crop.h = Math.min(1 - editor.crop.y, Math.max(0.1, editor.crop.h + delta));
    drawCrop();
  }, { passive: false });
}

function chromaKey(data, { r, g, b, tolerance }) {
  const tol = tolerance * 2.5;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - r;
    const dg = data[i + 1] - g;
    const db = data[i + 2] - b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < tol) {
      const alpha = Math.min(1, dist / tol);
      data[i + 3] = Math.round(alpha * data[i + 3]);
    }
  }
}

function averageCornerColor(imageData) {
  const { width, height, data } = imageData;
  const sample = Math.max(3, Math.min(16, Math.round(Math.min(width, height) * 0.04)));
  const points = [
    [0, 0],
    [Math.max(0, width - sample), 0],
    [0, Math.max(0, height - sample)],
    [Math.max(0, width - sample), Math.max(0, height - sample)]
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const [sx, sy] of points) {
    for (let y = sy; y < Math.min(height, sy + sample); y++) {
      for (let x = sx; x < Math.min(width, sx + sample); x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 12) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
    }
  }
  if (!count) return { r: 255, g: 255, b: 255 };
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };
}

function fitCanvas(canvas, img) {
  const maxW = Math.min(640, window.innerWidth - 80);
  const maxH = 400;
  const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
}

function roundFeet(value) {
  return Math.round(value * 1000) / 1000;
}

function canvasCoords(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function createPhotoOverlay() {
  const el = document.createElement('div');
  el.id = 'wall-photo-overlay';
  el.className = 'wall-photo-overlay hidden';
  document.body.appendChild(el);
  return el;
}
