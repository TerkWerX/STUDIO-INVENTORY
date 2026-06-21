/**
 * Perspective warp + mild barrel/pincushion correction for real wall photos.
 * Maps a 4-corner quad in the source image to a face-on rectangle (wall W×H).
 */

import { fileUrl } from '../utils.js';

const CORNER_LABELS = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
const PREVIEW_MAX_PX = 1600;

export function defaultWallCorners() {
  return [
    { x: 0.1, y: 0.12 },
    { x: 0.9, y: 0.12 },
    { x: 0.9, y: 0.88 },
    { x: 0.1, y: 0.88 }
  ];
}

export function normalizeCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return defaultWallCorners();
  return corners.map(p => ({
    x: Math.min(1, Math.max(0, parseFloat(p.x) || 0)),
    y: Math.min(1, Math.max(0, parseFloat(p.y) || 0))
  }));
}

/** Solve 3×3 homography mapping src → dst (4 point pairs). */
export function homographyFromPoints(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: xp, y: yp } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -xp * x, -xp * y]);
    b.push(xp);
    A.push([0, 0, 0, x, y, 1, -yp * x, -yp * y]);
    b.push(yp);
  }
  const h = solveLinear8(A, b);
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1]
  ];
}

function solveLinear8(A, b) {
  const n = 8;
  const m = [...A.map((row, i) => [...row, b[i]])];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col] || 1e-12;
    for (let j = col; j <= n; j++) m[col][j] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j <= n; j++) m[row][j] -= factor * m[col][j];
    }
  }
  return m.map(row => row[n]);
}

export function invertHomography(H) {
  const a = H[0][0], b = H[0][1], c = H[0][2];
  const d = H[1][0], e = H[1][1], f = H[1][2];
  const g = H[2][0], h = H[2][1], i = H[2][2];
  const A = e * i - f * h;
  const B = -(b * i - c * h);
  const C = b * f - c * e;
  const D = -(d * i - f * g);
  const E = a * i - c * g;
  const F = -(a * f - c * d);
  const G = d * h - e * g;
  const Hh = -(a * h - b * g);
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const s = 1 / det;
  return [
    [A * s, B * s, C * s],
    [D * s, E * s, F * s],
    [G * s, Hh * s, I * s]
  ];
}

function applyH(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(w) < 1e-9) return [x, y];
  return [
    (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    (H[1][0] * x + H[1][1] * y + H[1][2]) / w
  ];
}

/** Inverse radial distortion — map display coords back to distorted source. */
function distortInverse(nx, ny, k, cx = 0.5, cy = 0.5) {
  if (!k) return [nx, ny];
  let x = nx - cx;
  let y = ny - cy;
  for (let iter = 0; iter < 6; iter++) {
    const r2 = x * x + y * y;
    const scale = 1 + k * r2;
    x = (nx - cx) / scale;
    y = (ny - cy) / scale;
  }
  return [x + cx, y + cy];
}

function sampleBilinear(data, w, h, x, y) {
  const px = x * (w - 1);
  const py = y * (h - 1);
  if (px < 0 || py < 0 || px > w - 1 || py > h - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = px - x0;
  const ty = py - y0;
  const i = (xi, yi) => (yi * w + xi) * 4;
  const out = [0, 0, 0, 0];
  for (const [ox, oy, wt] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]]) {
    const idx = i(ox, oy);
    for (let c = 0; c < 4; c++) out[c] += data[idx + c] * wt;
  }
  return out;
}

/**
 * Warp source image quad → rectangle. Returns canvas.
 * corners: normalized TL, TR, BR, BL in source image.
 */
export async function warpWallPhotoToCanvas(imageSrc, corners, outW, outH, { lensK = 0 } = {}) {
  const img = await loadImage(imageSrc);
  const src = normalizeCorners(corners).map(p => ({ x: p.x * img.width, y: p.y * img.height }));
  const dst = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH }
  ];
  const Hinv = invertHomography(homographyFromPoints(
    src.map(p => ({ x: p.x / img.width, y: p.y / img.height })),
    dst.map(p => ({ x: p.x / outW, y: p.y / outH }))
  ));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  srcCanvas.getContext('2d').drawImage(img, 0, 0);
  const srcData = srcCanvas.getContext('2d').getImageData(0, 0, img.width, img.height).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = Math.max(1, Math.round(outW));
  outCanvas.height = Math.max(1, Math.round(outH));
  const out = outCanvas.getContext('2d').createImageData(outCanvas.width, outCanvas.height);

  for (let py = 0; py < outCanvas.height; py++) {
    for (let px = 0; px < outCanvas.width; px++) {
      const u = px / outCanvas.width;
      const v = py / outCanvas.height;
      let [sx, sy] = applyH(Hinv, u, v);
      [sx, sy] = distortInverse(sx, sy, lensK);
      const rgba = sampleBilinear(srcData, img.width, img.height, sx, sy);
      const oi = (py * outCanvas.width + px) * 4;
      out.data[oi] = rgba[0];
      out.data[oi + 1] = rgba[1];
      out.data[oi + 2] = rgba[2];
      out.data[oi + 3] = rgba[3];
    }
  }
  outCanvas.getContext('2d').putImageData(out, 0, 0);
  return outCanvas;
}

export function isWallPhotoCalibrated(entry) {
  return !!(entry?.corners?.length === 4 && entry?.calibrated);
}

/** Aligned wall face as a JPEG data URL — reliable for lightbox / TV browsers. */
export async function warpedWallPreviewDataUrl(relativePath, entry, widthFt, heightFt, maxPx = PREVIEW_MAX_PX) {
  const aspect = (widthFt || 12) / (heightFt || 9.5);
  let outW = maxPx;
  let outH = Math.max(1, Math.round(outW / aspect));
  if (outH > maxPx) {
    outH = maxPx;
    outW = Math.max(1, Math.round(outH * aspect));
  }
  const canvas = await warpWallPhotoToCanvas(
    fileUrl(relativePath),
    entry.corners,
    outW,
    outH,
    { lensK: entry.lens_k || 0 }
  );
  return canvas.toDataURL('image/jpeg', 0.9);
}

function isSameOriginImageSrc(src) {
  if (!src || src.startsWith('/')) return true;
  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return true;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!isSameOriginImageSrc(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = src;
  });
}

export { CORNER_LABELS };