const params = new URLSearchParams(window.location.search);
const itemId = params.get('id');
const pending = [];

const itemNameEl = document.getElementById('item-name');
const uploadCard = document.getElementById('upload-card');
const doneCard = document.getElementById('done-card');
const errorCard = document.getElementById('error-card');
const previewList = document.getElementById('preview-list');
const uploadBtn = document.getElementById('upload-btn');
const statusEl = document.getElementById('status');

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
  const res = await fetch(`/api/items/${itemId}`);
  if (!res.ok) throw new Error('Item not found on this server');
  const item = await res.json();
  itemNameEl.textContent = item.common_name || item.name;
  return item;
}

async function uploadPhotos() {
  if (!pending.length) return;
  uploadBtn.disabled = true;
  setStatus('Uploading…');

  const fd = new FormData();
  for (const file of pending) fd.append('files', file);

  try {
    const res = await fetch(`/api/items/${itemId}/photos`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
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

document.getElementById('add-more-btn')?.addEventListener('click', () => {
  doneCard.classList.add('hidden');
  uploadCard.classList.remove('hidden');
  refreshPreview();
});

loadItem().catch((err) => {
  uploadCard.classList.add('hidden');
  errorCard.classList.remove('hidden');
  document.getElementById('error-message').textContent = err.message;
});