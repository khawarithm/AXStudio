/**
 * fileLoader.js
 * Handles all entry points for opening a PDF: file picker, drag & drop,
 * and the sidebar/FAB "open" buttons. Delegates actual parsing to pdfEngine
 * and kicks off viewer initialization once loaded.
 */

import { loadPdfFromFile, getPageCount } from '../modules/pdfEngine.js';
import { initViewerForDocument } from './viewerController.js';
import { qs } from '../modules/utils.js';
import { setLoading, showSnackbar } from '../modules/notifications.js';
import { switchView } from './navigation.js';

/** @type {(file: File) => void} */
let onFileLoadedCallback = null;

export function setOnFileLoaded(callback) {
  onFileLoadedCallback = callback;
}

export async function handleFileSelected(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showSnackbar('File yang dipilih bukan PDF.');
    return;
  }

  setLoading(true, 'Membuka PDF…');
  try {
    await loadPdfFromFile(file);
    qs('#current-doc-name').textContent = file.name;
    qs('#view-empty').classList.remove('active');
    qs('#view-viewer').classList.add('active');
    switchView('viewer');

    await initViewerForDocument(file.size);

    showSnackbar(`${file.name} berhasil dimuat (${getPageCount()} halaman)`);
    if (onFileLoadedCallback) onFileLoadedCallback(file);
  } catch (err) {
    console.error(err);
    showSnackbar('Gagal membuka file PDF. Pastikan file tidak rusak.');
  } finally {
    setLoading(false);
  }
}

export function wireFileLoader() {
  const fileInput = qs('#file-input');
  const dropZone = qs('#drop-zone');

  const openPicker = () => fileInput.click();

  qs('#btn-open-file').addEventListener('click', openPicker);
  qs('#btn-open-file-sidebar').addEventListener('click', openPicker);
  qs('#fab-open-file').addEventListener('click', openPicker);

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleFileSelected(file);
    fileInput.value = '';
  });

  // Drag & drop on the drop zone (empty state)
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    handleFileSelected(file);
  });

  // Global drag & drop (allow dropping anywhere in the app once a doc is loaded)
  ['dragenter', 'dragover'].forEach(evt => {
    document.body.addEventListener(evt, (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    });
  });
  document.body.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });
}
