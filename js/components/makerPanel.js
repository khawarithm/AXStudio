/**
 * makerPanel.js
 * Wires the "Buat PDF" (PDF Maker) view: text-to-PDF, images-to-PDF, a
 * reorderable image list, and a post-generation preview with download /
 * "open in viewer" actions.
 */

import { qs, qsa, downloadBlob, toBlob } from '../modules/utils.js';
import { createPdfFromText, createPdfFromImages } from '../modules/pdfMaker.js';
import { showSnackbar, setInlineProgress, hideInlineProgress } from '../modules/notifications.js';
import { loadPdfFromArrayBuffer } from '../modules/pdfEngine.js';
import { initViewerForDocument } from './viewerController.js';
import { switchView } from './navigation.js';

let pendingImages = []; // { file, dataUrl }
let lastGeneratedBytes = null;

export function wireMakerPanel() {
  wireModeToggle();
  wireImagePicker();
  wireGenerate();
  wireResultActions();
}

function wireModeToggle() {
  const modeSeg = qs('#maker-mode');
  const textPanel = qs('#maker-text-panel');
  const imagePanel = qs('#maker-image-panel');

  modeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    qsa('.segment', modeSeg).forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const isText = btn.dataset.value === 'text';
    textPanel.hidden = !isText;
    imagePanel.hidden = isText;
  });

  qs('#maker-fontsize').addEventListener('input', (e) => {
    qs('#maker-fontsize-val').textContent = `${e.target.value}pt`;
  });
}

function wireImagePicker() {
  const input = qs('#maker-image-input');
  qs('#btn-maker-add-images').addEventListener('click', () => input.click());

  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const dataUrl = await readAsDataUrl(file);
      pendingImages.push({ file, dataUrl });
    }
    renderImageGrid();
    input.value = '';
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderImageGrid() {
  const grid = qs('#maker-image-grid');
  grid.innerHTML = '';
  let draggedEl = null;

  pendingImages.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = 'rearrange-item';
    el.draggable = true;
    el.dataset.index = index;

    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.style.width = '100%';
    img.style.borderRadius = '6px';

    const label = document.createElement('span');
    label.textContent = `${index + 1}. ${item.file.name}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-image-btn';
    removeBtn.innerHTML = '<span class="material-icon">close</span>';
    removeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      pendingImages.splice(index, 1);
      renderImageGrid();
    });

    el.appendChild(img);
    el.appendChild(label);
    el.appendChild(removeBtn);
    grid.appendChild(el);

    el.addEventListener('dragstart', () => {
      draggedEl = el;
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      draggedEl = null;
      syncImageOrderFromDom();
    });
    el.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      el.classList.remove('drag-over');
      if (draggedEl && draggedEl !== el) {
        const items = Array.from(grid.children);
        const draggedIdx = items.indexOf(draggedEl);
        const targetIdx = items.indexOf(el);
        if (draggedIdx < targetIdx) el.after(draggedEl);
        else el.before(draggedEl);
      }
    });
  });
}

function syncImageOrderFromDom() {
  const grid = qs('#maker-image-grid');
  const order = qsa('.rearrange-item', grid).map(el => parseInt(el.dataset.index, 10));
  pendingImages = order.map(i => pendingImages[i]);
  renderImageGrid();
}

function wireGenerate() {
  qs('#btn-maker-generate').addEventListener('click', async () => {
    const mode = qs('.segment.active', qs('#maker-mode')).dataset.value;

    if (mode === 'text') {
      const text = qs('#maker-text-input').value;
      if (!text.trim()) {
        showSnackbar('Ketik teks terlebih dahulu.');
        return;
      }
      const pageSize = qs('#maker-text-pagesize').value;
      const fontSize = parseInt(qs('#maker-fontsize').value, 10);

      setInlineProgress('maker-progress', 30, 'Membuat PDF dari teks…');
      try {
        const bytes = await createPdfFromText(text, { pageSize, fontSize, marginPt: 56 });
        lastGeneratedBytes = bytes;
        setInlineProgress('maker-progress', 100, 'Selesai');
        await showResultPreview(bytes);
        showSnackbar('PDF berhasil dibuat.');
      } catch (err) {
        console.error(err);
        showSnackbar('Gagal membuat PDF dari teks.');
      } finally {
        hideInlineProgress('maker-progress');
      }
    } else {
      if (pendingImages.length === 0) {
        showSnackbar('Tambahkan minimal satu gambar.');
        return;
      }
      const pageSize = qs('#maker-image-pagesize').value;
      const files = pendingImages.map(p => p.file);

      setInlineProgress('maker-progress', 0, `Memproses 0/${files.length}`);
      try {
        const bytes = await createPdfFromImages(files, { pageSize }, (done, total) => {
          setInlineProgress('maker-progress', (done / total) * 100, `Memproses ${done}/${total}`);
        });
        lastGeneratedBytes = bytes;
        await showResultPreview(bytes);
        showSnackbar('PDF berhasil dibuat dari gambar.');
      } catch (err) {
        console.error(err);
        showSnackbar('Gagal membuat PDF dari gambar.');
      } finally {
        hideInlineProgress('maker-progress');
      }
    }
  });
}

/**
 * Render a preview strip for freshly-generated PDF bytes, using an
 * independent pdf.js document instance (does not touch the main viewer's
 * loaded document/state).
 */
async function showResultPreview(bytes) {
  const resultBox = qs('#maker-result');
  const strip = qs('#maker-preview-strip');
  strip.innerHTML = '';
  resultBox.hidden = false;

  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  const maxPreviewPages = Math.min(doc.numPages, 12);

  for (let i = 1; i <= maxPreviewPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 0.7 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const wrap = document.createElement('div');
    wrap.className = 'preview-thumb';
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    const label = document.createElement('span');
    label.className = 'preview-thumb-label';
    label.textContent = `Hal. ${i}`;
    wrap.appendChild(img);
    wrap.appendChild(label);
    strip.appendChild(wrap);
  }

  if (doc.numPages > maxPreviewPages) {
    const more = document.createElement('div');
    more.className = 'preview-thumb';
    more.innerHTML = `<span class="preview-thumb-label">+${doc.numPages - maxPreviewPages} halaman lagi</span>`;
    strip.appendChild(more);
  }
}

function wireResultActions() {
  qs('#btn-maker-download').addEventListener('click', () => {
    if (!lastGeneratedBytes) return;
    downloadBlob(toBlob(lastGeneratedBytes, 'application/pdf'), 'AXStudio_Buatan.pdf');
  });

  qs('#btn-maker-open-viewer').addEventListener('click', async () => {
    if (!lastGeneratedBytes) return;
    await loadPdfFromArrayBuffer(lastGeneratedBytes.slice(), 'AXStudio_Buatan.pdf');
    qs('#current-doc-name').textContent = 'AXStudio_Buatan.pdf';
    qs('#view-empty').classList.remove('active');
    await initViewerForDocument(lastGeneratedBytes.byteLength);
    switchView('viewer');
    showSnackbar('PDF dimuat ke Viewer.');
  });
}
