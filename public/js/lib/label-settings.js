const STORAGE_KEY = 'studio-inventory-label-settings';

export const LABEL_SIZES = {
  '30252': {
    id: '30252',
    name: '30252 Address (1-1/8" × 3-1/2")',
    labelName: 'Address',
    widthIn: 3.5,
    heightIn: 1.125,
    description: 'Best for QR + name + serial — recommended for gear'
  },
  '30336': {
    id: '30336',
    name: '30336 Multipurpose (1" × 2-1/8")',
    labelName: '30336',
    widthIn: 2.125,
    heightIn: 1,
    description: 'Compact — QR + short name'
  },
  '30323': {
    id: '30323',
    name: '30323 Shipping (2-1/8" × 4")',
    labelName: '30323',
    widthIn: 4,
    heightIn: 2.125,
    description: 'Large — full details + QR'
  }
};

export function defaultLabelSettings() {
  return {
    studioName: 'Studio Inventory',
    baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
    labelSize: '30252',
    printerName: ''
  };
}

export function loadLabelSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { ...defaultLabelSettings(), ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return defaultLabelSettings();
  }
}

export function saveLabelSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadLabelSettings(), ...settings }));
}

export function getScanUrl(itemId, baseUrl = loadLabelSettings().baseUrl) {
  const base = (baseUrl || '').replace(/\/$/, '');
  return `${base}/scan/${encodeURIComponent(itemId)}`;
}

export function getQrImageUrl(itemId, baseUrl = loadLabelSettings().baseUrl) {
  const base = (baseUrl || '').replace(/\/$/, '');
  return `${base}/api/items/${encodeURIComponent(itemId)}/qr`;
}