import { escapeHtml, fileUrl, mapMarkerLogoHtml, forwardWheelScroll } from '../utils.js';
import { formatFeet, wallLengthFt } from './floorplan-geometry.js';
import { warpWallPhotoToCanvas, isWallPhotoCalibrated } from './wall-perspective.js';
import { openWallCalibrator } from './wall-calibrator.js';

const TAP_MOVE_PX = 12;
const BROWSE_MAX_ZOOM = 8;
const BROWSE_PX_PER_FT_CAP = 512;
const BROWSE_WARP_MAX_PX = 1600;
const EDIT_MAX_ZOOM = 3;
const EDIT_PX_PER_FT_CAP = 72;
const ZOOM_LOCK_KEY = 'studio-zoom-lock';

function warpedRasterSize(wPx, hPx) {
  const maxSide = Math.max(wPx, hPx);
  if (maxSide <= BROWSE_WARP_MAX_PX) {
    return { w: Math.max(1, Math.round(wPx)), h: Math.max(1, Math.round(hPx)) };
  }
  const scale = BROWSE_WARP_MAX_PX / maxSide;
  return {
    w: Math.max(1, Math.round(wPx * scale)),
    h: Math.max(1, Math.round(hPx * scale))
  };
}

function isWallVisible(pin) {
  return pin.wall_display !== false && pin.studio_status !== 'loaned';
}

function getWallPhotoEntry(wallPhotos, wallEdge) {
  return wallPhotos[String(wallEdge)] || wallPhotos[wallEdge] || null;
}

function pointerDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function dismissWallItemPopover() {
  document.querySelector('.we-item-popover-backdrop')?.remove();
}

function positionPopover(popover, anchorEl) {
  const ar = anchorEl.getBoundingClientRect();
  const pw = popover.offsetWidth;
  const ph = popover.offsetHeight;
  let left = ar.left + ar.width / 2 - pw / 2;
  let top = ar.top - ph - 10;
  if (top < 10) top = ar.bottom + 10;
  left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
  top = Math.max(10, Math.min(top, window.innerHeight - ph - 10));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

export async function showItemQuickMenu({ itemId, itemName, anchorEl, fetchItem }) {
  dismissWallItemPopover();

  const backdrop = document.createElement('div');
  backdrop.className = 'we-item-popover-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismissWallItemPopover();
  });

  const popover = document.createElement('div');
  popover.className = 'we-item-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', `${itemName} options`);
  popover.innerHTML = `
    <p class="we-item-popover-name">${escapeHtml(itemName)}</p>
    <p class="we-item-popover-prompt text-muted-sm">See info on this instrument?</p>
    <div class="we-item-popover-actions">
      <a href="/?view=item-detail&id=${itemId}" class="btn btn-primary btn-sm we-item-popover-btn">View item info</a>
      <p class="text-muted-sm we-item-popover-loading">Loading manuals…</p>
    </div>
  `;
  popover.addEventListener('click', (e) => e.stopPropagation());

  backdrop.appendChild(popover);
  document.body.appendChild(backdrop);
  positionPopover(popover, anchorEl);

  const actions = popover.querySelector('.we-item-popover-actions');
  const loading = popover.querySelector('.we-item-popover-loading');

  let manuals = [];
  try {
    const item = await fetchItem?.(itemId);
    manuals = item?.manuals || [];
  } catch {
    /* keep item-info link even if fetch fails */
  }

  loading?.remove();

  if (!manuals.length) {
    const note = document.createElement('p');
    note.className = 'text-muted-sm we-item-popover-empty';
    note.textContent = 'No manuals on file';
    actions.appendChild(note);
  } else if (manuals.length === 1) {
    const m = manuals[0];
    const btn = document.createElement('a');
    btn.href = fileUrl(m.relative_path);
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.className = 'btn btn-secondary btn-sm we-item-popover-btn';
    btn.textContent = 'Manuals';
    actions.appendChild(btn);
  } else {
    const label = document.createElement('p');
    label.className = 'we-item-popover-manuals-label text-muted-sm';
    label.textContent = 'Manuals';
    actions.appendChild(label);
    manuals.forEach(m => {
      const link = document.createElement('a');
      link.href = fileUrl(m.relative_path);
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'btn btn-secondary btn-sm we-item-popover-btn we-item-popover-manual-link';
      link.textContent = m.original_name || 'Manual';
      actions.appendChild(link);
    });
  }

  positionPopover(popover, anchorEl);
}

export function openWallElevation({
  fp, wallEdge, items, onSave, onPhotoEdit, onUploadWallPhoto,
  onSaveWallCalibration, onToast, browseMode = false, fetchItem,
  mountEl = null, setupMode = false, pendingItem = null, onClose
}) {
  const useInline = Boolean(mountEl);
  const overlay = useInline
    ? mountEl
    : (document.getElementById('wall-elevation-overlay') || createElevationOverlay());
  const widthFt = wallLengthFt(fp, wallEdge) || fp.bounds_width || 12;
  const heightFt = fp.ceiling_height || 9.5;
  const unit = fp.unit || 'ft';
  const wallPhotos = fp.wall_photos || {};
  let wallEntry = getWallPhotoEntry(wallPhotos, wallEdge);
  let bgPath = wallEntry?.path || '';
  const maxZoom = browseMode ? BROWSE_MAX_ZOOM : EDIT_MAX_ZOOM;

  const wallItems = (items || []).filter(
    p => p.placement === 'wall' && Number(p.wall_edge) === Number(wallEdge)
  );
  const visibleItems = wallItems.filter(isWallVisible);
  const awayItems = wallItems.filter(p => !isWallVisible(p));

  const state = visibleItems.map(p => ({
    item_id: p.id,
    wall_t: p.wall_t ?? 0.5,
    height_ft: p.height_ft ?? 5,
    icon_mode: p.icon_mode || 'logo',
    wall_photo_path: p.wall_photo_path || '',
    photo_width_ft: p.photo_width_ft || 0,
    photo_height_ft: p.photo_height_ft || 0,
    rotation_deg: p.rotation_deg || 0,
    pin: p
  }));

  if (pendingItem && !browseMode && !state.some(s => s.item_id === pendingItem.id)) {
    const existing = wallItems.find(p => p.id === pendingItem.id);
    const savedCutout = pendingItem.wall_cutout?.path ? {
      icon_mode: 'photo',
      wall_photo_path: pendingItem.wall_cutout.path,
      photo_width_ft: pendingItem.wall_cutout.width_ft || 0,
      photo_height_ft: pendingItem.wall_cutout.height_ft || 0,
      photo_calibration: pendingItem.wall_cutout.calibration
    } : null;
    state.push({
      item_id: pendingItem.id,
      wall_t: existing?.wall_t ?? 0.5,
      height_ft: existing?.height_ft ?? 5,
      icon_mode: existing?.icon_mode || savedCutout?.icon_mode || 'logo',
      wall_photo_path: existing?.wall_photo_path || savedCutout?.wall_photo_path || '',
      photo_width_ft: existing?.photo_width_ft || savedCutout?.photo_width_ft || 0,
      photo_height_ft: existing?.photo_height_ft || savedCutout?.photo_height_ft || 0,
      rotation_deg: existing?.rotation_deg || 0,
      pin: { ...pendingItem, ...existing, ...savedCutout, name: pendingItem.name || existing?.name }
    });
  }

  const placingItem = Boolean(pendingItem);
  const fillViewport = browseMode || placingItem;
  const photoSetup = setupMode && !placingItem;

  let zoom = 1;
  let panX = 16;
  let panY = 16;
  let zoomLocked = localStorage.getItem(ZOOM_LOCK_KEY) === '1';
  let pxPerFt = 48;
  let warpCache = { key: '', canvas: null };
  let renderGen = 0;

  const calibrated = () => isWallPhotoCalibrated(wallEntry);

  const editControls = browseMode ? '' : `
    <label class="btn btn-secondary btn-sm" style="cursor:pointer">
      ${bgPath ? 'Replace photo' : 'Add wall photo'}
      <input type="file" accept="image/*" capture="environment" id="we-wall-photo-input" hidden>
    </label>
    ${bgPath ? `<button type="button" class="btn btn-secondary btn-sm" data-action="we-align-wall">${calibrated() ? 'Re-align' : 'Align wall'}</button>` : ''}
  `;

  const modalClass = [
    'wall-elevation-modal',
    fillViewport ? 'wall-elevation-browse' : '',
    useInline ? 'wall-elevation-inline-panel' : '',
    photoSetup ? 'wall-elevation-setup' : ''
  ].filter(Boolean).join(' ');

  const hintText = browseMode
    ? 'Pinch to zoom · drag to pan · tap an instrument for details'
    : photoSetup
      ? `Photograph this wall face-on, then <strong>Align wall</strong> — mark four corners to match the ${formatFeet(widthFt, unit)} × ${formatFeet(heightFt, unit)} frame. Lens curve corrects phone wide-angle bow.`
      : placingItem
        ? `Drag <strong>${escapeHtml(pendingItem.name)}</strong> to its spot. Brand logo or life-size photo hangs <em>in front of</em> the wall image.`
        : 'Photograph the empty wall, then <strong>Align wall</strong> — mark four corners so floor, ceiling, and side walls are cropped out. Lens curve corrects phone wide-angle bow.';

  const closeLabel = useInline && photoSetup ? '← Room overview' : '×';
  const closeClass = useInline && photoSetup ? 'btn btn-secondary btn-sm wall-elevation-close' : 'btn btn-ghost btn-sm wall-elevation-close';
  const placingState = placingItem && pendingItem
    ? state.find(s => s.item_id === pendingItem.id)
    : null;
  const placingRotation = Math.max(-45, Math.min(45, parseFloat(placingState?.rotation_deg) || 0));
  const rotatePanel = placingState ? `
    <div class="we-rotation-panel" aria-label="Fine tune rotation">
      <span class="we-rotation-label">Rotation</span>
      <button type="button" class="we-rotation-nudge" data-action="we-rotation-step" data-delta="-1" title="Rotate left 1 degree">−1°</button>
      <button type="button" class="we-rotation-nudge" data-action="we-rotation-step" data-delta="-0.1" title="Rotate left 0.1 degree">−0.1°</button>
      <input type="range" id="we-rotation-range" min="-45" max="45" step="0.1" value="${placingRotation}">
      <input type="number" id="we-rotation-number" min="-45" max="45" step="0.1" value="${placingRotation.toFixed(1)}" aria-label="Rotation degrees">
      <button type="button" class="we-rotation-nudge" data-action="we-rotation-step" data-delta="0.1" title="Rotate right 0.1 degree">+0.1°</button>
      <button type="button" class="we-rotation-nudge" data-action="we-rotation-step" data-delta="1" title="Rotate right 1 degree">+1°</button>
      <button type="button" class="we-rotation-reset" data-action="we-rotation-reset">0°</button>
    </div>
  ` : '';

  overlay.innerHTML = `
    <div class="${modalClass}" role="dialog" aria-modal="true" aria-label="Wall elevation view">
      <div class="wall-elevation-header">
        <div>
          <h2>Wall ${wallEdge + 1}${browseMode ? '' : ' — face view'}</h2>
          <p class="text-muted-sm">${formatFeet(widthFt, unit)} wide × ${formatFeet(heightFt, unit)} tall</p>
        </div>
        <div class="btn-group">
          ${editControls}
          <button type="button" class="btn btn-secondary btn-sm" data-action="we-zoom-out">−</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="we-zoom-in">+</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="we-fit">Fit</button>
          <label class="we-zoom-lock-label" title="Keeps zoom fixed so mouse wheel scrolls the page instead of zooming the wall">
            <input type="checkbox" id="we-zoom-lock"> Lock zoom
          </label>
          <button type="button" class="${closeClass}" aria-label="Close">${closeLabel}</button>
        </div>
      </div>
      <p class="text-muted-sm wall-elevation-hint">${hintText}</p>
      <div class="wall-elevation-viewport" id="we-viewport">
        <div class="wall-elevation-stage" id="we-stage"></div>
      </div>
      ${!browseMode && !photoSetup && awayItems.length ? `
        <div class="we-away-panel card">
          <h4 class="subsection-title">Away from wall (${awayItems.length})</h4>
          <ul class="we-away-list">
            ${awayItems.map(p => `
              <li>
                <strong>${escapeHtml(p.name)}</strong>
                <span class="text-muted-sm">${p.studio_status === 'loaned' ? 'On loan' : 'Hidden'}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      ` : ''}
      ${browseMode ? '' : photoSetup ? `
        <div class="wall-elevation-footer">
          <button type="button" class="btn btn-primary wall-elevation-close">Done — back to room</button>
        </div>
      ` : `
        <div class="wall-elevation-footer">
          ${rotatePanel}
          <div class="we-footer-actions">
            <button type="button" class="btn btn-primary" data-action="we-save">${placingItem ? 'Save on wall' : 'Save wall positions'}</button>
            <button type="button" class="btn btn-secondary wall-elevation-close">Cancel</button>
          </div>
        </div>
      `}
    </div>
  `;

  const stage = overlay.querySelector('#we-stage');
  const viewport = overlay.querySelector('#we-viewport');

  async function openAligner() {
    if (!bgPath || !onSaveWallCalibration) return;
    openWallCalibrator({
      imageUrl: fileUrl(bgPath),
      widthFt,
      heightFt,
      unit,
      calibration: wallEntry || {},
      onSave: async (data) => {
        const updated = await onSaveWallCalibration(data);
        wallEntry = getWallPhotoEntry(updated?.wall_photos || {}, wallEdge) || { ...wallEntry, ...data };
        warpCache = { key: '', canvas: null };
        renderStage();
        return updated;
      },
      onToast
    });
  }

  overlay.querySelector('[data-action="we-align-wall"]')?.addEventListener('click', openAligner);

  overlay.querySelector('#we-wall-photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadWallPhoto) return;
    try {
      const updated = await onUploadWallPhoto(file);
      wallEntry = getWallPhotoEntry(updated?.wall_photos || {}, wallEdge);
      bgPath = wallEntry?.path || '';
      warpCache = { key: '', canvas: null };
      const alignBtn = overlay.querySelector('[data-action="we-align-wall"]');
      if (alignBtn) alignBtn.textContent = 'Align wall';
      if (!alignBtn && bgPath) {
        const hdr = overlay.querySelector('.wall-elevation-header .btn-group');
        const lbl = document.createElement('button');
        lbl.type = 'button';
        lbl.className = 'btn btn-secondary btn-sm';
        lbl.dataset.action = 'we-align-wall';
        lbl.textContent = 'Align wall';
        lbl.addEventListener('click', openAligner);
        hdr?.insertBefore(lbl, hdr.querySelector('[data-action="we-zoom-out"]'));
      }
      renderStage();
      onToast?.('Wall photo added — align corners next', 'success');
      if (bgPath) setTimeout(openAligner, 300);
    } catch (err) {
      onToast?.(err.message, 'error');
    }
    e.target.value = '';
  });

  function scaledPxPerFt() {
    return pxPerFt * zoom;
  }

  function updateZoomLockUi() {
    const lockCb = overlay.querySelector('#we-zoom-lock');
    if (lockCb) lockCb.checked = zoomLocked;
    overlay.querySelectorAll('[data-action="we-zoom-in"], [data-action="we-zoom-out"], [data-action="we-fit"]').forEach(btn => {
      btn.disabled = zoomLocked;
    });
    viewport?.classList.toggle('wall-elevation-zoom-locked', zoomLocked);
  }

  function setZoomAt(newZoom, focalX, focalY) {
    if (zoomLocked) return;
    const clamped = Math.min(maxZoom, Math.max(0.35, newZoom));
    const rect = viewport.getBoundingClientRect();
    const fx = focalX - rect.left;
    const fy = focalY - rect.top;
    const scale = clamped / zoom;
    panX = fx - scale * (fx - panX);
    panY = fy - scale * (fy - panY);
    zoom = clamped;
    renderStage();
  }

  async function drawWarpedBackground(wPx, hPx) {
    if (!bgPath || !calibrated()) return null;
    const key = `${bgPath}|${JSON.stringify(wallEntry.corners)}|${wallEntry.lens_k}|${wPx}x${hPx}`;
    if (warpCache.key === key && warpCache.canvas) return warpCache.canvas;
    try {
      const canvas = await warpWallPhotoToCanvas(
        fileUrl(bgPath),
        wallEntry.corners,
        wPx,
        hPx,
        { lensK: wallEntry.lens_k || 0 }
      );
      warpCache = { key, canvas };
      return canvas;
    } catch {
      return null;
    }
  }

  function clampedRotation(value) {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-45, Math.min(45, n));
  }

  function placingRotationRow() {
    return placingItem && pendingItem
      ? state.find(s => s.item_id === pendingItem.id)
      : null;
  }

  function updateRotationPanel(value) {
    const rotation = clampedRotation(value);
    const range = overlay.querySelector('#we-rotation-range');
    const number = overlay.querySelector('#we-rotation-number');
    if (range) range.value = String(rotation);
    if (number) number.value = rotation.toFixed(1);
  }

  function setPlacementRotation(value) {
    const row = placingRotationRow();
    if (!row) return;
    const rotation = clampedRotation(value);
    row.rotation_deg = rotation;
    updateRotationPanel(rotation);
    renderStage();
  }

  function renderStage() {
    const gen = ++renderGen;
    const spf = scaledPxPerFt();
    const wPx = widthFt * spf;
    const hPx = heightFt * spf;
    stage.style.width = `${wPx}px`;
    stage.style.height = `${hPx}px`;
    stage.style.transform = `translate(${panX}px, ${panY}px)`;

    const needsAlign = bgPath && !calibrated() && !browseMode;
    const flatBgUrl = bgPath ? fileUrl(bgPath) : '';
    const showsAlignedWarp = calibrated() && flatBgUrl;
    const wallPhotoUnderlay = flatBgUrl
      ? `<img class="we-wall-bg-flat we-wall-bg-underlay ${!calibrated() ? 'we-wall-bg-browse' : ''}" src="${flatBgUrl}" alt="Wall photo" draggable="false" decoding="async">`
      : '';
    const warpedDisplayImg = showsAlignedWarp
      ? `<img class="we-wall-bg-flat we-wall-bg-warped hidden" alt="Wall photo" draggable="false" decoding="async">`
      : '';
    const warpLoading = showsAlignedWarp
      ? `<div class="we-wall-bg-loading" aria-live="polite"><p>Preparing aligned wall view…</p></div>`
      : '';
    const wallFaceStyle = `width:${wPx}px;height:${hPx}px`;
    const bgPlaceholder = needsAlign
      ? `<div class="we-wall-needs-align">
          <p>Photo needs alignment</p>
          <button type="button" class="btn btn-primary btn-sm" data-action="we-align-inline">Align wall corners</button>
        </div>`
      : (!bgPath ? `<div class="we-wall-no-photo"><p>No wall photo yet — add one in Studio Setup</p></div>` : '');

    stage.innerHTML = `
      <div class="we-wall-face ${calibrated() ? 'we-wall-face-warped' : ''}${fillViewport ? ' we-wall-face-browse' : ''}"
        style="${wallFaceStyle}" data-spf="${spf}">
        ${wallPhotoUnderlay}
        ${warpedDisplayImg}
        ${warpLoading}
        ${flatBgUrl ? '<div class="we-wall-bg-error hidden" aria-live="polite"><p>Wall photo could not load — open Studio Setup to re-align corners</p></div>' : ''}
        ${bgPlaceholder}
        ${!calibrated() && !bgPath ? `
          <div class="we-floor-line"></div>
          <div class="we-ceiling-line"></div>
          ${[0, 0.25, 0.5, 0.75, 1].map(t => `
            <div class="we-height-tick" style="bottom:${t * hPx}px">
              <span>${formatFeet(t * heightFt, unit)}</span>
            </div>
          `).join('')}
        ` : ''}
        ${state.map(s => renderWallItem(
          s,
          wPx,
          spf,
          browseMode,
          placingItem && pendingItem && s.item_id !== pendingItem.id
        )).join('')}
      </div>
    `;

    stage.querySelector('[data-action="we-align-inline"]')?.addEventListener('click', openAligner);

    if (flatBgUrl) {
      const browseImg = stage.querySelector('.we-wall-bg-underlay');
      const browseErr = stage.querySelector('.we-wall-bg-error');
      if (browseImg) {
        browseImg.addEventListener('error', () => {
          browseErr?.classList.remove('hidden');
          browseImg.classList.add('hidden');
        });
        browseImg.addEventListener('load', () => {
          browseErr?.classList.add('hidden');
          browseImg.classList.remove('hidden');
        });
        if (browseImg.complete && browseImg.naturalWidth < 1) {
          browseErr?.classList.remove('hidden');
          browseImg.classList.add('hidden');
        }
      }
    }

    if (showsAlignedWarp) {
      const warpedImg = stage.querySelector('.we-wall-bg-warped');
      const loading = stage.querySelector('.we-wall-bg-loading');
      const warpErr = stage.querySelector('.we-wall-bg-error');
      const raster = warpedRasterSize(wPx, hPx);
      drawWarpedBackground(raster.w, raster.h).then(warped => {
        if (gen !== renderGen || !warpedImg) return;
        loading?.classList.add('hidden');
        if (!warped || !canvasHasVisiblePixels(warped)) {
          warpErr?.classList.remove('hidden');
          warpedImg.classList.add('hidden');
          return;
        }
        try {
          warpedImg.onload = () => {
            if (gen !== renderGen) return;
            warpErr?.classList.add('hidden');
            warpedImg.classList.remove('hidden');
          };
          warpedImg.onerror = () => {
            warpErr?.classList.remove('hidden');
            warpedImg.classList.add('hidden');
          };
          warpedImg.src = warped.toDataURL('image/jpeg', 0.9);
          if (warpedImg.complete && warpedImg.naturalWidth > 0) {
            warpErr?.classList.add('hidden');
            warpedImg.classList.remove('hidden');
          }
        } catch {
          warpErr?.classList.remove('hidden');
          warpedImg.classList.add('hidden');
        }
      }).catch(() => {
        if (gen !== renderGen) return;
        loading?.classList.add('hidden');
        warpErr?.classList.remove('hidden');
        warpedImg?.classList.add('hidden');
      });
    }

    if (browseMode) {
      stage.querySelectorAll('.we-wall-item').forEach(el => bindItemTap(el, state));
    } else {
      stage.querySelectorAll('.we-wall-item').forEach(el => {
        const id = Number(el.dataset.itemId);
        if (placingItem && id !== pendingItem.id) {
          el.classList.add('we-wall-item-ref');
          return;
        }
        bindDrag(el, state, widthFt, heightFt);
      });
      stage.querySelectorAll('[data-action="we-hang-photo"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = Number(btn.dataset.itemId);
          const row = state.find(x => x.item_id === id);
          if (row && onPhotoEdit) onPhotoEdit(row.pin, row);
        });
      });
      stage.querySelectorAll('[data-action="we-rotate-left"], [data-action="we-rotate-right"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const row = state.find(x => x.item_id === Number(btn.dataset.itemId));
          if (!row) return;
          const delta = btn.dataset.action === 'we-rotate-left' ? -0.5 : 0.5;
          if (placingItem && pendingItem && row.item_id === pendingItem.id) {
            setPlacementRotation((parseFloat(row.rotation_deg) || 0) + delta);
          } else {
            row.rotation_deg = clampedRotation((parseFloat(row.rotation_deg) || 0) + delta);
            renderStage();
          }
        });
      });
    }
  }

  function fitToViewport({ force = false } = {}) {
    if (zoomLocked && !force) return;
    const rect = viewport.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    const pad = fillViewport ? 12 : 20;
    const cap = fillViewport ? BROWSE_PX_PER_FT_CAP : EDIT_PX_PER_FT_CAP;
    pxPerFt = Math.min((rect.width - pad * 2) / widthFt, (rect.height - pad * 2) / heightFt, cap);
    zoom = 1;
    const wPx = widthFt * pxPerFt;
    const hPx = heightFt * pxPerFt;
    if (fillViewport) {
      panX = Math.max(pad, (rect.width - wPx) / 2);
      panY = Math.max(pad, (rect.height - hPx) / 2);
    } else {
      panX = pad;
      panY = pad;
    }
    renderStage();
  }

  overlay.querySelector('[data-action="we-zoom-in"]')?.addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    setZoomAt(zoom * 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  overlay.querySelector('[data-action="we-zoom-out"]')?.addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    setZoomAt(zoom / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  overlay.querySelector('[data-action="we-fit"]')?.addEventListener('click', fitToViewport);

  overlay.querySelector('#we-zoom-lock')?.addEventListener('change', (e) => {
    zoomLocked = e.target.checked;
    localStorage.setItem(ZOOM_LOCK_KEY, zoomLocked ? '1' : '0');
    updateZoomLockUi();
  });

  ['input', 'change'].forEach(eventName => {
    overlay.querySelector('#we-rotation-range')?.addEventListener(eventName, (e) => {
      setPlacementRotation(e.target.value);
    });
    overlay.querySelector('#we-rotation-number')?.addEventListener(eventName, (e) => {
      setPlacementRotation(e.target.value);
    });
  });
  overlay.querySelectorAll('[data-action="we-rotation-step"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = placingRotationRow();
      const current = parseFloat(row?.rotation_deg) || 0;
      setPlacementRotation(current + (parseFloat(btn.dataset.delta) || 0));
    });
  });
  overlay.querySelector('[data-action="we-rotation-reset"]')?.addEventListener('click', () => {
    setPlacementRotation(0);
  });

  overlay.querySelector('[data-action="we-save"]')?.addEventListener('click', async () => {
    try {
      await onSave?.(state.map(s => ({
        item_id: s.item_id,
        wall_t: s.wall_t,
        height_ft: s.height_ft,
        icon_mode: s.icon_mode,
        wall_photo_path: s.wall_photo_path,
        photo_width_ft: s.photo_width_ft,
        photo_height_ft: s.photo_height_ft,
        rotation_deg: s.rotation_deg || 0,
        wall_display: true,
        placement: 'wall',
        wall_edge: wallEdge
      })));
      onToast?.(placingItem ? 'Item saved on wall' : 'Wall positions saved', 'success');
      close();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  });

  overlay.querySelectorAll('.wall-elevation-close').forEach(btn => btn.addEventListener('click', close));
  if (!useInline) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  const pointers = new Map();
  let panning = false;
  let panStart = { x: 0, y: 0 };
  let pinchStart = null;
  let tapCandidate = null;
  const photoHitCanvas = document.createElement('canvas');

  function updatePointer(id, x, y) {
    const p = pointers.get(id);
    if (p) pointers.set(id, { ...p, x, y });
  }

  function itemHitScore(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    if (
      clientX < rect.left || clientX > rect.right ||
      clientY < rect.top || clientY > rect.bottom ||
      rect.width < 1 || rect.height < 1
    ) return null;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const centerDist = Math.hypot(clientX - cx, clientY - cy);
    const img = el.matches('.we-wall-item-photo') ? el.querySelector('img') : null;
    if (!img || !img.complete || img.naturalWidth < 1 || img.naturalHeight < 1) {
      return { el, opaque: false, score: 100000 + centerDist };
    }

    try {
      const x = Math.floor(((clientX - rect.left) / rect.width) * img.naturalWidth);
      const y = Math.floor(((clientY - rect.top) / rect.height) * img.naturalHeight);
      photoHitCanvas.width = img.naturalWidth;
      photoHitCanvas.height = img.naturalHeight;
      const ctx = photoHitCanvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, photoHitCanvas.width, photoHitCanvas.height);
      ctx.drawImage(img, 0, 0);
      const sample = (px, py) => ctx.getImageData(
        Math.max(0, Math.min(photoHitCanvas.width - 1, px)),
        Math.max(0, Math.min(photoHitCanvas.height - 1, py)),
        1,
        1
      ).data;
      const rgbaDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const clicked = sample(x, y);
      const bgSamples = [
        sample(0, 0),
        sample(photoHitCanvas.width - 1, 0),
        sample(photoHitCanvas.width - 1, photoHitCanvas.height - 1),
        sample(0, photoHitCanvas.height - 1),
        sample(Math.floor(photoHitCanvas.width / 2), 0),
        sample(Math.floor(photoHitCanvas.width / 2), photoHitCanvas.height - 1),
        sample(0, Math.floor(photoHitCanvas.height / 2)),
        sample(photoHitCanvas.width - 1, Math.floor(photoHitCanvas.height / 2))
      ].filter(px => px[3] > 32);
      const backdropLike = clicked[3] > 32 && bgSamples.some(bg =>
        Math.abs(clicked[3] - bg[3]) < 80 && rgbaDistance(clicked, bg) < 64
      );
      if (backdropLike) return { el, opaque: false, score: 100000 + centerDist };

      let strongPixels = 0;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const px = sample(x + ox, y + oy);
          const alpha = px[3];
          if (alpha > 140) strongPixels++;
        }
      }
      if (strongPixels >= 2) return { el, opaque: true, score: centerDist };
      return { el, opaque: false, score: 100000 + centerDist };
    } catch {
      return { el, opaque: false, score: 100000 + centerDist };
    }
  }

  function pickWallItemAt(clientX, clientY) {
    const hits = [...stage.querySelectorAll('.we-wall-item-browse')]
      .map(el => itemHitScore(el, clientX, clientY))
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);
    return hits[0]?.el || null;
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.we-hang-edit')) return;
    if (browseMode) e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);

    if (browseMode && pointers.size === 2) {
      const pts = [...pointers.values()];
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      pinchStart = {
        distance: pointerDistance(pts[0], pts[1]),
        zoom,
        panX,
        panY,
        midX,
        midY
      };
      panning = false;
      tapCandidate = null;
      return;
    }

    if (browseMode && pointers.size === 1) {
      const itemEl = pickWallItemAt(e.clientX, e.clientY);
      if (itemEl) {
        tapCandidate = {
          el: itemEl,
          itemId: Number(itemEl.dataset.itemId),
          startX: e.clientX,
          startY: e.clientY,
          moved: false
        };
      } else {
        panning = true;
        panStart = { x: e.clientX - panX, y: e.clientY - panY };
      }
      return;
    }

    if (!browseMode) {
      if (e.target.closest('.we-wall-item')) return;
      panning = true;
      panStart = { x: e.clientX - panX, y: e.clientY - panY };
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    updatePointer(e.pointerId, e.clientX, e.clientY);

    if (browseMode && pointers.size === 2 && pinchStart && !zoomLocked) {
      const pts = [...pointers.values()];
      const dist = pointerDistance(pts[0], pts[1]);
      const ratio = dist / pinchStart.distance;
      const newZoom = pinchStart.zoom * ratio;
      const scale = newZoom / pinchStart.zoom;
      const rect = viewport.getBoundingClientRect();
      const fx = pinchStart.midX - rect.left;
      const fy = pinchStart.midY - rect.top;
      const clamped = Math.min(maxZoom, Math.max(0.35, newZoom));
      const applied = clamped / pinchStart.zoom;
      panX = fx - applied * (fx - pinchStart.panX);
      panY = fy - applied * (fy - pinchStart.panY);
      zoom = clamped;
      renderStage();
      return;
    }

    if (tapCandidate) {
      const dx = e.clientX - tapCandidate.startX;
      const dy = e.clientY - tapCandidate.startY;
      if (Math.hypot(dx, dy) > TAP_MOVE_PX) {
        tapCandidate.moved = true;
        panning = true;
        panStart = { x: e.clientX - panX, y: e.clientY - panY };
        tapCandidate = null;
      }
    }

    if (panning) {
      panX = e.clientX - panStart.x;
      panY = e.clientY - panStart.y;
      stage.style.transform = `translate(${panX}px, ${panY}px)`;
    }
  });

  function finishPointer(e) {
    const pendingTap = tapCandidate && !tapCandidate.moved ? { ...tapCandidate } : null;

    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;

    if (browseMode && pendingTap && pointers.size === 0) {
      const pickedEl = pickWallItemAt(e.clientX, e.clientY);
      if (!pickedEl) return;
      const itemId = Number(pickedEl.dataset.itemId || pendingTap.itemId);
      const row = state.find(s => s.item_id === itemId);
      showItemQuickMenu({
        itemId,
        itemName: row?.pin?.name || 'Instrument',
        anchorEl: pickedEl,
        fetchItem
      });
    }

    if (pointers.size === 0) {
      panning = false;
      tapCandidate = null;
    }
  }

  viewport.addEventListener('pointerup', finishPointer);
  viewport.addEventListener('pointercancel', finishPointer);
  viewport.addEventListener('dragstart', (e) => e.preventDefault());

  viewport.addEventListener('wheel', (e) => {
    if (zoomLocked) {
      forwardWheelScroll(e);
      return;
    }
    e.preventDefault();
    setZoomAt(zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY);
  }, { passive: false });

  function close() {
    dismissWallItemPopover();
    resizeObserver?.disconnect();
    if (useInline) {
      overlay.innerHTML = '';
      onClose?.();
    } else {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    }
  }

  let resizeObserver = null;
  if (fillViewport && viewport && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (zoom === 1 && !zoomLocked) fitToViewport();
    });
    resizeObserver.observe(viewport);
  }

  if (!useInline) overlay.classList.remove('hidden');
  fitToViewport({ force: true });
  if (fillViewport) {
    requestAnimationFrame(() => fitToViewport({ force: true }));
  }
  updateZoomLockUi();

  if (!browseMode && bgPath && !calibrated()) {
    setTimeout(openAligner, 400);
  }

  return { close };
}

function estimatedWallFootprintFt(pin = {}) {
  const category = String(pin.category || '').toLowerCase();
  if (category.includes('bass')) return { w: 1.4, h: 3.8 };
  if (category.includes('guitar')) return { w: 1.35, h: 3.7 };
  if (category.includes('keyboard')) return { w: 4.2, h: 1.1 };
  if (category.includes('drum')) return { w: 5.0, h: 3.5 };
  if (category.includes('microphone')) return { w: 0.55, h: 1.1 };
  if (category.includes('amplifier')) return { w: 2.2, h: 2.0 };
  if (category.includes('speaker') || category.includes('monitor')) return { w: 1.4, h: 2.2 };
  if (category.includes('mixer') || category.includes('control surface')) return { w: 3.0, h: 1.3 };
  if (category.includes('audio interface')) return { w: 1.6, h: 0.7 };
  if (category.includes('pedal')) return { w: 0.8, h: 0.55 };
  return { w: 1.2, h: 1.2 };
}

function renderWallItem(s, wPx, spf, browseMode = false, referenceMode = false) {
  const x = s.wall_t * wPx;
  const bottomPx = (s.height_ft || 0) * spf;
  const name = escapeHtml(s.pin?.name || '');
  const isPhoto = s.icon_mode === 'photo' && s.wall_photo_path;
  const photoW = Math.max(12, (s.photo_width_ft || 1) * spf);
  const photoH = Math.max(12, (s.photo_height_ft || 1.5) * spf);
  const logoFootprint = estimatedWallFootprintFt(s.pin);
  const logoW = Math.max(34, (s.photo_width_ft || logoFootprint.w) * spf);
  const logoH = Math.max(34, (s.photo_height_ft || logoFootprint.h) * spf);
  const rotation = Math.max(-180, Math.min(180, parseFloat(s.rotation_deg) || 0));
  const showControls = !browseMode && !referenceMode;
  const itemClasses = [
    'we-wall-item',
    isPhoto ? 'we-wall-item-photo' : 'we-wall-item-logo',
    browseMode ? 'we-wall-item-browse' : '',
    referenceMode ? 'we-wall-item-ref' : ''
  ].filter(Boolean).join(' ');
  const editBtn = !showControls ? '' : `
    <button type="button" class="btn btn-ghost btn-sm we-hang-edit" data-action="we-hang-photo" data-item-id="${s.item_id}">Edit</button>
  `;
  const rotateControls = !showControls ? '' : `
    <span class="we-rotate-controls" aria-label="Rotate ${name}">
      <button type="button" class="we-rotate-btn" data-action="we-rotate-left" data-item-id="${s.item_id}" title="Rotate left">↶</button>
      <button type="button" class="we-rotate-btn" data-action="we-rotate-right" data-item-id="${s.item_id}" title="Rotate right">↷</button>
    </span>
  `;
  const hangBtn = !showControls ? '' : `
    <button type="button" class="btn btn-ghost btn-sm we-hang-edit" data-action="we-hang-photo" data-item-id="${s.item_id}">Hang photo</button>
  `;
  const label = browseMode ? '' : `<span class="we-wall-item-label">${name}</span>`;

  if (isPhoto) {
    return `
      <div class="${itemClasses}" data-item-id="${s.item_id}"
        style="left:${x}px;bottom:${bottomPx}px;width:${photoW}px;height:${photoH}px;--we-rotation:${rotation}deg"
        title="${name}">
        <img src="${fileUrl(s.wall_photo_path)}" alt="${name}" draggable="false">
        ${label}${rotateControls}${editBtn}
      </div>
    `;
  }

  return `
    <div class="${itemClasses}" data-item-id="${s.item_id}"
      style="left:${x}px;bottom:${bottomPx}px;width:${logoW}px;height:${logoH}px;--we-rotation:${rotation}deg" title="${name}">
      <div class="we-wall-logo-footprint">
        ${mapMarkerLogoHtml(s.pin, 'we-marker-logo')}
      </div>
      ${label}${rotateControls}${hangBtn}
    </div>
  `;
}

function bindItemTap(el, state) {
  /* pointer handling is on the viewport — item only needs to be tappable */
  el.style.cursor = 'pointer';
}

function bindDrag(el, state, widthFt, heightFt) {
  const itemId = Number(el.dataset.itemId);
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-action="we-hang-photo"], .we-rotate-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const wall = el.closest('.we-wall-face');
    const spf = parseFloat(wall?.dataset.spf) || 48;
    const wPx = widthFt * spf;
    const hPx = heightFt * spf;

    const onMove = (ev) => {
      const rect = wall.getBoundingClientRect();
      const x = Math.min(wPx, Math.max(0, ev.clientX - rect.left));
      const bottom = Math.min(hPx, Math.max(0, rect.bottom - ev.clientY));
      el.style.left = `${x}px`;
      el.style.bottom = `${bottom}px`;
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      const x = parseFloat(el.style.left) || 0;
      const bottom = parseFloat(el.style.bottom) || 0;
      const row = state.find(s => s.item_id === itemId);
      if (row) {
        row.wall_t = wPx ? Math.min(1, Math.max(0, x / wPx)) : 0.5;
        row.height_ft = spf ? bottom / spf : 0;
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
}

function canvasHasVisiblePixels(canvas) {
  if (!canvas || canvas.width < 1 || canvas.height < 1) return false;
  try {
    const ctx = canvas.getContext('2d');
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const sample = ctx.getImageData(cx, cy, 1, 1).data;
    if (sample[3] > 12) return true;
    const corner = ctx.getImageData(2, 2, 1, 1).data;
    return corner[3] > 12;
  } catch {
    return false;
  }
}

function loadWallFlatImage(canvas, bgPath, wPx, hPx) {
  const img = new Image();
  const src = fileUrl(bgPath);
  const sameOrigin = !src || src.startsWith('/') || (() => {
    try { return new URL(src, window.location.href).origin === window.location.origin; }
    catch { return true; }
  })();
  if (!sameOrigin) img.crossOrigin = 'anonymous';
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    const ir = img.width / img.height;
    const wr = wPx / hPx;
    let dw = wPx;
    let dh = hPx;
    let dx = 0;
    let dy = 0;
    if (ir > wr) {
      dh = hPx;
      dw = hPx * ir;
      dx = (wPx - dw) / 2;
    } else {
      dw = wPx;
      dh = wPx / ir;
      dy = (hPx - dh) / 2;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, dx, dy, dw, dh);
  };
  img.onerror = () => { /* underlay img may still be visible */ };
  img.src = src;
}

function createElevationOverlay() {
  const el = document.createElement('div');
  el.id = 'wall-elevation-overlay';
  el.className = 'wall-elevation-overlay hidden';
  document.body.appendChild(el);
  return el;
}
