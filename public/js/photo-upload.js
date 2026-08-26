const params = new URLSearchParams(window.location.search);
const itemId = params.get('id');
const pending = [];

const itemNameEl = document.getElementById('item-name');
const authCard = document.getElementById('auth-card');
const uploadCard = document.getElementById('upload-card');
const doneCard = document.getElementById('done-card');
const errorCard = document.getElementById('error-card');
const previewList = document.getElementById('preview-list');
const uploadBtn = document.getElementById('upload-btn');
const statusEl = document.getElementById('status');
const authStatusEl = document.getElementById('auth-status');

function setAuthStatus(msg, type = '') {
  authStatusEl.textContent = msg;
  authStatusEl.className = `status ${type}`.trim();
}

function showAuth() {
  uploadCard.classList.add('hidden');
  doneCard.classList.add('hidden');
  authCard.classList.remove('hidden');
  document.getElementById('owner-pin')?.focus();
}

function showUpload() {
  authCard.classList.add('hidden');
  uploadCard.classList.remove('hidden');
}

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`.trim();
}

function refreshPreview() {
  previewList.innerHTML = pending.map((file, i) => {
    const url = URL.createObjectURL(file);
    return `<img src="${url}" alt="Preview ${i + 1}">`;
  }).join('');
  uploadBtn.disabled = pending.length === 0;
  setStatus(pending.length ? `${pending.length} photo(s) ready` : '');
}

function queueFiles(fileList) {
  for (const file of fileList) {
    if (file.type.startsWith('image/')) pending.push(file);
  }
  refreshPreview();
}

async function loadItem() {
  if (!itemId) throw new Error('Missing item ID in URL');
  const res = await fetch(`/api/items/${encodeURIComponent(itemId)}`);
  if (res.status === 401 || res.status === 403) {
    showAuth();
    throw new Error('Owner PIN required');
  }
  if (!res.ok) throw new Error('Item not found on this server');
  const item = await res.json();
  itemNameEl.textContent = item.common_name || item.name;
  return item;
}

async function ensureAccess() {
  const res = await fetch('/api/auth/status');
  if (!res.ok) throw new Error('Could not check owner access');
  const auth = await res.json();
  if (auth.local || auth.authenticated) return true;
  if (!auth.ownerPinSet) {
    throw new Error('Set an owner PIN from Backup & Restore on the studio computer before using phone uploads.');
  }
  showAuth();
  return false;
}

async function unlockWithPin(pin) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Could not unlock photo upload');
  showUpload();
  await loadItem();
}

async function uploadPhotos() {
  if (!pending.length) return;
  uploadBtn.disabled = true;
  setStatus('Uploading…');

  const fd = new FormData();
  for (const file of pending) fd.append('files', file);

  try {
    const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/photos`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) showAuth();
      throw new Error(err.error || 'Upload failed');
    }
    const created = await res.json();
    uploadCard.classList.add('hidden');
    doneCard.classList.remove('hidden');
    document.getElementById('done-message').textContent =
      `${created.length} photo${created.length !== 1 ? 's' : ''} added to ${itemNameEl.textContent}.`;
    pending.length = 0;
  } catch (err) {
    setStatus(err.message, 'error');
    uploadBtn.disabled = false;
  }
}

document.getElementById('camera-input')?.addEventListener('change', (e) => {
  queueFiles(e.target.files);
  e.target.value = '';
});

document.getElementById('gallery-input')?.addEventListener('change', (e) => {
  queueFiles(e.target.files);
  e.target.value = '';
});

uploadBtn?.addEventListener('click', uploadPhotos);

authCard?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('owner-pin');
  const pin = input?.value || '';
  if (!pin) return setAuthStatus('Enter the owner PIN.', 'error');
  const button = document.getElementById('unlock-btn');
  button.disabled = true;
  setAuthStatus('Unlocking…');
  try {
    await unlockWithPin(pin);
    input.value = '';
    setAuthStatus('');
  } catch (err) {
    setAuthStatus(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('add-more-btn')?.addEventListener('click', () => {
  doneCard.classList.add('hidden');
  uploadCard.classList.remove('hidden');
  refreshPreview();
});

async function init() {
  try {
    if (!(await ensureAccess())) return;
    showUpload();
    await loadItem();
  } catch (err) {
    authCard.classList.add('hidden');
    uploadCard.classList.add('hidden');
    errorCard.classList.remove('hidden');
    document.getElementById('error-message').textContent = err.message;
  }
}

init();
