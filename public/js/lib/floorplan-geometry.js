/** Floorplan math — polygon room outline in 0–100% canvas space with real-world scale. */
import { formatLength } from './measurement.js';

export function parsePolygon(raw) {
  if (Array.isArray(raw)) return raw.filter(v => v && Number.isFinite(v.x) && Number.isFinite(v.y));
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  } catch {
    return [];
  }
}

/** Room outline has enough corners to form a closed shape (saved / finalized maps). */
export function polygonHasMinVertices(vertices, min = 3) {
  return vertices.length >= min;
}

/** True when a room outline is complete (≥3 corners). Used for saved floorplans. */
export function polygonClosed(vertices) {
  return polygonHasMinVertices(vertices);
}

export function polygonPointsAttr(vertices) {
  return vertices.map(v => `${v.x},${v.y}`).join(' ');
}

export function floorImageViewFromFp(fp = {}) {
  return {
    scale: Math.min(4, Math.max(1, parseFloat(fp.floor_image_scale) || 1)),
    focusX: Math.min(1, Math.max(0, parseFloat(fp.floor_image_x ?? 0.5) || 0.5)),
    focusY: Math.min(1, Math.max(0, parseFloat(fp.floor_image_y ?? 0.5) || 0.5)),
    fit: fp.floor_image_fit === 'contain' ? 'contain' : 'cover'
  };
}

export function floorTextureImageAttrs(view = {}) {
  const scale = Math.min(4, Math.max(1, parseFloat(view.scale) || 1));
  const focusX = Math.min(1, Math.max(0, parseFloat(view.focusX ?? 0.5) || 0.5));
  const focusY = Math.min(1, Math.max(0, parseFloat(view.focusY ?? 0.5) || 0.5));
  const fit = view.fit === 'contain' ? 'contain' : 'cover';
  const size = 100 * scale;
  return {
    x: 50 - focusX * size,
    y: 50 - focusY * size,
    width: size,
    height: size,
    preserveAspectRatio: fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'
  };
}

/** SVG floor texture clipped to the room outline (bottom layer in room setup and tablet map). */
export function floorTextureSvgMarkup(floorplanId, imageHref, vertices, closed, floorView = {}) {
  if (!imageHref || !closed || !polygonClosed(vertices)) return '';
  const clipId = `fp-floor-clip-${floorplanId}`;
  const safeHref = String(imageHref).replace(/"/g, '&quot;');
  const attrs = floorTextureImageAttrs(floorView);
  return `
    <defs>
      <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">
        <polygon class="floorplan-floor-clip" points="${polygonPointsAttr(vertices)}"/>
      </clipPath>
    </defs>
    <image class="floorplan-floor-texture" href="${safeHref}" x="${attrs.x}" y="${attrs.y}"
      width="${attrs.width}" height="${attrs.height}" preserveAspectRatio="${attrs.preserveAspectRatio}"
      clip-path="url(#${clipId})"/>
  `;
}

/** Polyline points — repeats first vertex when closed so the last wall segment draws. */
export function polygonOutlinePointsAttr(vertices, closed) {
  if (!vertices.length) return '';
  if (closed && vertices.length >= 3) {
    return polygonPointsAttr([...vertices, vertices[0]]);
  }
  return polygonPointsAttr(vertices);
}

function unitVector(dx, dy) {
  const len = Math.hypot(dx, dy);
  return len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
}

/** SVG corner brackets — two arms aligned with adjacent walls. */
export function cornerMarkerSvg(v, prev, next, i, armLen = 2.4, closed = false, n = 0) {
  const arms = [];
  if (prev) {
    const u = unitVector(v.x - prev.x, v.y - prev.y);
    arms.push(`<line class="floorplan-corner-arm" x1="${v.x - u.x * armLen}" y1="${v.y - u.y * armLen}" x2="${v.x}" y2="${v.y}"/>`);
  }
  if (next) {
    const u = unitVector(next.x - v.x, next.y - v.y);
    arms.push(`<line class="floorplan-corner-arm" x1="${v.x}" y1="${v.y}" x2="${v.x + u.x * armLen}" y2="${v.y + u.y * armLen}"/>`);
  }
  if (!arms.length) {
    arms.push(`<line class="floorplan-corner-arm" x1="${v.x - armLen}" y1="${v.y}" x2="${v.x + armLen}" y2="${v.y}"/>`);
  }
  const closeRing = i === 0 && !closed && n >= 3
    ? `<circle class="floorplan-close-target" cx="${v.x}" cy="${v.y}" r="5"/>`
    : '';
  return `
    <g class="floorplan-corner" data-vertex="${i}">
      ${closeRing}
      ${arms.join('')}
    </g>
  `;
}

export function cornerMarkersForVertices(vertices, closed) {
  const n = vertices.length;
  return vertices.map((v, i) => {
    const prev = i > 0 ? vertices[i - 1] : (closed && n > 2 ? vertices[n - 1] : null);
    const next = i < n - 1 ? vertices[i + 1] : (closed && n > 2 ? vertices[0] : null);
    return cornerMarkerSvg(v, prev, next, i, 2.4, closed, n);
  }).join('');
}

export function edgeCount(vertices) {
  return polygonClosed(vertices) ? vertices.length : 0;
}

export function edgeVertices(vertices, edgeIndex) {
  const n = vertices.length;
  const i = ((edgeIndex % n) + n) % n;
  return [vertices[i], vertices[(i + 1) % n]];
}

export function edgeLengthPct(vertices, edgeIndex) {
  const [a, b] = edgeVertices(vertices, edgeIndex);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polygonBounds(vertices) {
  if (!vertices.length) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Map drawn outline into the full 0–100% measure box (width × depth). */
export function transformPointWithFit(point, bounds, padding = 0) {
  const w = bounds.maxX - bounds.minX || 1;
  const h = bounds.maxY - bounds.minY || 1;
  const inner = 100 - padding * 2;
  return {
    x: Math.min(100, Math.max(0, padding + ((point.x - bounds.minX) / w) * inner)),
    y: Math.min(100, Math.max(0, padding + ((point.y - bounds.minY) / h) * inner))
  };
}

export function fitPolygonToMeasureBox(vertices, padding = 0) {
  if (!vertices.length) return [];
  const bounds = polygonBounds(vertices);
  return vertices.map(v => transformPointWithFit(v, bounds, padding));
}

/** Real-world wall length using width on X and depth on Y. */
export function edgeLengthFt(vertices, edgeIndex, boundsWidth, boundsDepth) {
  const [a, b] = edgeVertices(vertices, edgeIndex);
  const dx_ft = ((b.x - a.x) / 100) * (boundsWidth || 0);
  const dy_ft = ((b.y - a.y) / 100) * (boundsDepth || 0);
  return Math.hypot(dx_ft, dy_ft);
}

export function autoWallLengths(vertices, boundsWidth, boundsDepth) {
  return vertices.map((_, i) => edgeLengthFt(vertices, i, boundsWidth, boundsDepth));
}

/** Room proportions in SVG — viewport size stays fixed so zoom/pan can explore it. */
export function applyRoomDisplay(viewportEl, boundsWidth, boundsDepth) {
  if (!viewportEl) return;
  const svg = viewportEl.querySelector('.floorplan-svg');
  const pad = 8;
  if (boundsWidth > 0 && boundsDepth > 0) {
    viewportEl.classList.add('floorplan-svg-scaled');
    viewportEl.style.setProperty('--fp-ratio', String(boundsWidth / boundsDepth));
    svg?.setAttribute('viewBox', `${-pad} ${-pad} ${100 + pad * 2} ${100 + pad * 2}`);
    svg?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  } else {
    viewportEl.classList.remove('floorplan-svg-scaled');
    viewportEl.style.removeProperty('--fp-ratio');
    svg?.setAttribute('viewBox', '0 0 100 100');
    svg?.setAttribute('preserveAspectRatio', 'none');
  }
}

export const applyMeasureAspect = applyRoomDisplay;

export function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function pctToFeet(xPct, yPct, boundsWidth, boundsDepth) {
  return {
    x: (xPct / 100) * (boundsWidth || 0),
    y: (yPct / 100) * (boundsDepth || 0)
  };
}

export function formatFeet(n, unit = 'ft') {
  return formatLength(n, unit);
}

export function wallLengthFt(fp, edgeIndex) {
  const walls = fp.wall_lengths || [];
  if (walls[edgeIndex] > 0) return walls[edgeIndex];
  const verts = fp.polygon || [];
  if (!fp.bounds_width || !fp.bounds_depth) return 0;
  return edgeLengthFt(verts, edgeIndex, fp.bounds_width, fp.bounds_depth);
}

export function polygonCentroid(vertices) {
  if (!vertices.length) return { x: 50, y: 50 };
  let x = 0;
  let y = 0;
  for (const v of vertices) {
    x += v.x;
    y += v.y;
  }
  return { x: x / vertices.length, y: y / vertices.length };
}

/** Degrees to rotate label text parallel to edge, kept upright for reading. */
export function edgeParallelAngleDeg(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

/** Label anchor offset outward from the room interior. */
export function edgeOutwardPoint(a, b, vertices, offset = 3.5) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const c = polygonCentroid(vertices);
  let nx = -dy / len;
  let ny = dx / len;
  const vx = c.x - mid.x;
  const vy = c.y - mid.y;
  if (nx * vx + ny * vy > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: mid.x + nx * offset, y: mid.y + ny * offset };
}

export function wallEdgeLabelText(edgeIndex, fp) {
  const len = wallLengthFt(fp, edgeIndex);
  const wallNum = edgeIndex + 1;
  if (len > 0) return `Wall ${wallNum} · ${formatFeet(len, fp.unit)}`;
  return `Wall ${wallNum}`;
}

export function wallEdgeLabelMarkup(vertices, edgeIndex, fp, { offset = 3.5 } = {}) {
  const [a, b] = edgeVertices(vertices, edgeIndex);
  const pos = edgeOutwardPoint(a, b, vertices, offset);
  const angle = edgeParallelAngleDeg(a, b);
  const text = wallEdgeLabelText(edgeIndex, fp);
  return `<text class="floorplan-wall-label" x="${pos.x}" y="${pos.y}"
    transform="rotate(${angle} ${pos.x} ${pos.y})" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
}

export function wallEdgeLabelsMarkup(vertices, fp, options = {}) {
  if (!polygonClosed(vertices)) return '';
  return [...Array(edgeCount(vertices))].map((_, i) => wallEdgeLabelMarkup(vertices, i, fp, options)).join('');
}

export function positionAlongWallFt(fp, edgeIndex, t) {
  const len = wallLengthFt(fp, edgeIndex);
  return len * Math.min(1, Math.max(0, t || 0));
}

export function nearestEdge(point, vertices) {
  if (!polygonClosed(vertices)) return { edge: 0, t: 0, x: point.x, y: point.y, dist: Infinity };
  let best = { edge: 0, t: 0, x: point.x, y: point.y, dist: Infinity };
  for (let i = 0; i < vertices.length; i++) {
    const [a, b] = edgeVertices(vertices, i);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)) : 0;
    const proj = lerpPoint(a, b, t);
    const dist = Math.hypot(point.x - proj.x, point.y - proj.y);
    if (dist < best.dist) best = { edge: i, t, x: proj.x, y: proj.y, dist };
  }
  return best;
}

export function pinPositionLabel(pin, fp) {
  const unit = fp.unit || 'ft';
  if (pin.placement === 'wall' && pin.wall_edge != null) {
    const along = positionAlongWallFt(fp, pin.wall_edge, pin.wall_t);
    const ht = pin.height_ft != null ? ` · ${formatFeet(pin.height_ft, unit)} up` : '';
    return `Wall ${pin.wall_edge + 1} · ${formatFeet(along, unit)} along${ht}`;
  }
  const ft = pctToFeet(pin.x_pct, pin.y_pct, fp.bounds_width, fp.bounds_depth);
  if (!fp.bounds_width && !fp.bounds_depth) return `${pin.x_pct.toFixed(0)}% · ${pin.y_pct.toFixed(0)}%`;
  return `${formatFeet(ft.x, unit)} from left · ${formatFeet(ft.y, unit)} from front`;
}

export function snapPointerToCanvas(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 50, y: 50 };
  const loc = pt.matrixTransform(ctm.inverse());
  return {
    x: Math.min(100, Math.max(0, loc.x)),
    y: Math.min(100, Math.max(0, loc.y))
  };
}

const DRAW_ALIGN_SNAP = 1.4;
export const CLOSE_SNAP_RADIUS = 6;

/**
 * Snap a draw cursor to horizontal/vertical alignment with existing corners,
 * and ortho (90°) from the last placed corner for straight walls.
 */
export function snapDrawPoint(raw, vertices, { excludeIndex = -1, orthoFromLast = true, allowCloseSnap = true } = {}) {
  if (allowCloseSnap && excludeIndex === -1 && vertices.length >= 3) {
    const first = vertices[0];
    if (Math.hypot(raw.x - first.x, raw.y - first.y) <= CLOSE_SNAP_RADIUS) {
      return {
        x: first.x,
        y: first.y,
        guideX: first.x,
        guideY: first.y,
        closing: true
      };
    }
  }

  let x = raw.x;
  let y = raw.y;
  let guideX = null;
  let guideY = null;

  const refs = vertices.filter((_, i) => i !== excludeIndex);
  let snapX = false;
  let snapY = false;

  for (const v of refs) {
    if (!snapX && Math.abs(raw.x - v.x) <= DRAW_ALIGN_SNAP) {
      x = v.x;
      guideX = v.x;
      snapX = true;
    }
    if (!snapY && Math.abs(raw.y - v.y) <= DRAW_ALIGN_SNAP) {
      y = v.y;
      guideY = v.y;
      snapY = true;
    }
  }

  const last = excludeIndex === -1 && vertices.length ? vertices[vertices.length - 1] : null;
  if (orthoFromLast && last && excludeIndex === -1) {
    if (!snapX && !snapY) {
      if (Math.abs(raw.x - last.x) <= Math.abs(raw.y - last.y)) {
        x = last.x;
        guideX = last.x;
        snapX = true;
      } else {
        y = last.y;
        guideY = last.y;
        snapY = true;
      }
    }
  }

  return {
    x: Math.min(100, Math.max(0, x)),
    y: Math.min(100, Math.max(0, y)),
    guideX,
    guideY,
    closing: false
  };
}

/** Live crosshair, alignment guides, and rubber-band while drawing. */
export function drawGuidesMarkup(snap, vertices) {
  if (!snap) return '';
  const parts = [];
  const { x, y, guideX, guideY, closing } = snap;

  if (guideY != null) {
    parts.push(`<line class="floorplan-guide-h" x1="0" y1="${guideY}" x2="100" y2="${guideY}"/>`);
  }
  if (guideX != null) {
    parts.push(`<line class="floorplan-guide-v" x1="${guideX}" y1="0" x2="${guideX}" y2="100"/>`);
  }

  const last = vertices[vertices.length - 1];
  if (last) {
    const rubberClass = closing ? 'floorplan-guide-rubber floorplan-guide-rubber-close' : 'floorplan-guide-rubber';
    parts.push(`<line class="${rubberClass}" x1="${last.x}" y1="${last.y}" x2="${x}" y2="${y}"/>`);
  }

  if (closing && vertices[0]) {
    const f = vertices[0];
    parts.push(`<circle class="floorplan-guide-close-ring" cx="${f.x}" cy="${f.y}" r="5.5"/>`);
  }

  const crossClass = closing ? 'floorplan-guide-cross floorplan-guide-cross-close' : 'floorplan-guide-cross';
  parts.push(`
    <g class="floorplan-guide-crosshair" transform="translate(${x},${y})">
      <line class="${crossClass}" x1="-2.2" y1="0" x2="2.2" y2="0"/>
      <line class="${crossClass}" x1="0" y1="-2.2" x2="0" y2="2.2"/>
    </g>
  `);

  return parts.join('');
}
