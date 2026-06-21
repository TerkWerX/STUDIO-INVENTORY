import { escapeHtml } from '../utils.js';
import {
  defaultWallCorners, normalizeCorners, warpWallPhotoToCanvas, CORNER_LABELS
} from './wall-perspective.js';

/**
 * Place 4 corners on a real wall photo, adjust lens curve, preview face-on warp.
 */
export function openWallCalibrator({
  imageUrl,
  widthFt,
  heightFt,
  unit = 'ft',
  calibration = {},
  onSave,
  onToast
}) {
  const overlay = document.getElementById('wall-calibrator-overlay')
    || createOverlay();

  let corners = normalizeCorners(calibration.corners || defaultWallCorners());
  let lensK = parseFloat(calibration.lens_k) || 0;
  let dragIdx = null;
  let previewTimer = null;
  const CORNER_HIT_PX = 26;

  overlay.innerHTML = `
    <div class="wall-calibrator-modal wall-calibrator-focused" role="dialog" aria-modal="true">
      <div class="wall-calibrator-header">
        <div>
          <h2>Align wall photo</h2>
          <p class="text-muted-sm wall-calibrator-hint">
            Click a crosshair, drag to each wall corner (ceiling, floor, sides). Wall face only —
            snaps to ${widthFt}×${heightFt} ${unit === 'm' ? 'm' : 'ft'}.
          </p>
        </div>
        <button type="button" class="btn btn-ghost wall-calibrator-close" aria-label="Close">&times;</button>
      </div>

      <div class="wall-calibrator-workspace">
        <div class="wall-calibrator-canvas-wrap" id="wc-source-wrap">
          <img src="${imageUrl}" alt="Wall source" class="wall-calibrator-img" id="wc-source-img" draggable="false">
          <svg class="wall-calibrator-svg" id="wc-source-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon class="wc-quad-fill" id="wc-quad" points=""/>
            ${corners.map((_, i) => `
              <g class="wc-corner-handle" data-corner="${i}">
                <line class="wc-corner-arm" x1="-3.5" y1="0" x2="3.5" y2="0"/>
                <line class="wc-corner-arm" x1="0" y1="-3.5" x2="0" y2="3.5"/>
              </g>
            `).join('')}
          </svg>
        </div>
        <div class="wall-calibrator-labels">
          ${CORNER_LABELS.map((l, i) => `<span class="wc-corner-label">${i + 1}. ${l}</span>`).join('')}
        </div>
      </div>

      <div class="wall-calibrator-bottom">
        <div class="wall-calibrator-controls">
          <label class="wall-calibrator-lens">
            Lens curve
            <input type="range" id="wc-lens" min="-0.35" max="0.35" step="0.01" value="${lensK}">
            <span id="wc-lens-val">${lensK.toFixed(2)}</span>
          </label>
          <button type="button" class="btn btn-ghost btn-sm" id="wc-reset-corners">Reset corners</button>
        </div>
        <div class="wall-calibrator-preview-wrap">
          <span class="subsection-title">Face-on preview</span>
          <canvas id="wc-preview" class="wall-calibrator-preview"></canvas>
        </div>
      </div>

      <div class="wall-calibrator-footer">
        <button type="button" class="btn btn-primary" id="wc-save">Save alignment</button>
        <button type="button" class="btn btn-secondary wall-calibrator-close">Cancel</button>
      </div>
    </div>
  `;

  const imgEl = overlay.querySelector('#wc-source-img');
  const svg = overlay.querySelector('#wc-source-svg');
  const wrap = overlay.querySelector('#wc-source-wrap');
  const preview = overlay.querySelector('#wc-preview');
  const lensInput = overlay.querySelector('#wc-lens');
  const lensVal = overlay.querySelector('#wc-lens-val');

  function imageDisplayRect() {
    const wrapRect = wrap.getBoundingClientRect();
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (!nw || !nh) {
      return { left: 0, top: 0, width: wrapRect.width, height: wrapRect.height, wrapRect };
    }
    const wrapAspect = wrapRect.width / wrapRect.height;
    const imgAspect = nw / nh;
    let width;
    let height;
    let left;
    let top;
    if (imgAspect > wrapAspect) {
      width = wrapRect.width;
      height = wrapRect.width / imgAspect;
      left = 0;
      top = (wrapRect.height - height) / 2;
    } else {
      height = wrapRect.height;
      width = wrapRect.height * imgAspect;
      left = (wrapRect.width - width) / 2;
      top = 0;
    }
    return { left, top, width, height, wrapRect };
  }

  function syncSvgToImage() {
    const disp = imageDisplayRect();
    svg.style.left = `${disp.left}px`;
    svg.style.top = `${disp.top}px`;
    svg.style.width = `${disp.width}px`;
    svg.style.height = `${disp.height}px`;
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (nw && nh) {
      wrap.style.aspectRatio = `${nw} / ${nh}`;
    }
  }

  function pointerToNormalized(clientX, clientY) {
    const disp = imageDisplayRect();
    const x = (clientX - disp.wrapRect.left - disp.left) / disp.width;
    const y = (clientY - disp.wrapRect.top - disp.top) / disp.height;
    return {
      x: Math.min(0.995, Math.max(0.005, x)),
      y: Math.min(0.995, Math.max(0.005, y))
    };
  }

  function nearestCornerIndex(clientX, clientY) {
    const disp = imageDisplayRect();
    let best = { idx: -1, dist: Infinity };
    corners.forEach((c, i) => {
      const px = disp.wrapRect.left + disp.left + c.x * disp.width;
      const py = disp.wrapRect.top + disp.top + c.y * disp.height;
      const d = Math.hypot(clientX - px, clientY - py);
      if (d < best.dist) best = { idx: i, dist: d };
    });
    return best.dist <= CORNER_HIT_PX ? best.idx : -1;
  }

  function updateSvg() {
    const pts = corners.map(c => `${c.x * 100},${c.y * 100}`).join(' ');
    overlay.querySelector('#wc-quad')?.setAttribute('points', pts);
    svg.querySelectorAll('.wc-corner-handle').forEach((el, i) => {
      el.setAttribute('transform', `translate(${corners[i].x * 100} ${corners[i].y * 100})`);
      el.classList.toggle('wc-corner-active', dragIdx === i);
    });
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(drawPreview, 120);
  }

  async function drawPreview() {
    if (!imgEl?.complete) return;
    const aspect = widthFt / heightFt;
    const maxW = 280;
    const pw = maxW;
    const ph = Math.round(maxW / aspect);
    try {
      const warped = await warpWallPhotoToCanvas(imageUrl, corners, pw, ph, { lensK });
      preview.width = pw;
      preview.height = ph;
      preview.getContext('2d').drawImage(warped, 0, 0);
    } catch { /* retry on next move */ }
  }

  function bindCornerDragging() {
    wrap.addEventListener('pointerdown', (e) => {
      const idx = nearestCornerIndex(e.clientX, e.clientY);
      if (idx < 0) return;
      e.preventDefault();
      dragIdx = idx;
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add('wc-dragging');
      updateSvg();
    });

    wrap.addEventListener('pointermove', (e) => {
      if (dragIdx != null) {
        corners[dragIdx] = pointerToNormalized(e.clientX, e.clientY);
        updateSvg();
        schedulePreview();
        return;
      }
      wrap.classList.toggle('wc-near-corner', nearestCornerIndex(e.clientX, e.clientY) >= 0);
    });

    const endDrag = () => {
      dragIdx = null;
      wrap.classList.remove('wc-dragging', 'wc-near-corner');
      updateSvg();
    };

    wrap.addEventListener('pointerleave', () => {
      if (dragIdx == null) wrap.classList.remove('wc-near-corner');
    });
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
  }

  bindCornerDragging();

  lensInput?.addEventListener('input', (e) => {
    lensK = parseFloat(e.target.value) || 0;
    if (lensVal) lensVal.textContent = lensK.toFixed(2);
    schedulePreview();
  });

  overlay.querySelector('#wc-reset-corners')?.addEventListener('click', () => {
    corners = defaultWallCorners();
    lensK = 0;
    if (lensInput) lensInput.value = '0';
    if (lensVal) lensVal.textContent = '0.00';
    updateSvg();
    schedulePreview();
  });

  overlay.querySelector('#wc-save')?.addEventListener('click', async () => {
    try {
      await onSave?.({ corners, lens_k: lensK, calibrated: true });
      onToast?.('Wall photo aligned to real dimensions', 'success');
      close();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  });

  overlay.querySelectorAll('.wall-calibrator-close').forEach(btn => btn.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function close() {
    overlay.dispatchEvent(new Event('wall-calibrator-close'));
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  const onLayout = () => {
    syncSvgToImage();
    updateSvg();
  };

  imgEl?.addEventListener('load', () => {
    onLayout();
    drawPreview();
  });
  if (imgEl?.complete) {
    onLayout();
    drawPreview();
  }

  window.addEventListener('resize', onLayout);
  overlay.addEventListener('wall-calibrator-close', () => {
    window.removeEventListener('resize', onLayout);
  });

  overlay.classList.remove('hidden');
  requestAnimationFrame(onLayout);
  return { close };
}

function createOverlay() {
  const el = document.createElement('div');
  el.id = 'wall-calibrator-overlay';
  el.className = 'wall-calibrator-overlay hidden';
  document.body.appendChild(el);
  return el;
}