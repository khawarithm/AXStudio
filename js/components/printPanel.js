/**
 * printPanel.js
 * Wires the "Print" view UI: source (PDF document or uploaded PNG/JPG
 * images), paper size, orientation, margin, method (system/Bluetooth/USB),
 * page range, preview dialog, and dispatch.
 */

import { qs, qsa, parsePageRange } from '../modules/utils.js';
import { getPageCount } from '../modules/pdfEngine.js';
import { renderPagesForPrint, printViaSystem, printViaBluetooth, printViaUsb } from '../modules/printManager.js';
import { showSnackbar, setLoading } from '../modules/notifications.js';

let printImages = []; // { file, dataUrl }

export function wirePrintPanel() {
  wireSegmented('#print-orientation');
  wireSourceMode();
  wireImagePicker();

  qs('#print-method').addEventListener('change', (e) => {
    qs('#print-method-hint').hidden = e.target.value === 'system';
  });

  qs('#print-margin').addEventListener('input', (e) => {
    qs('#print-margin-val').textContent = `${e.target.value}mm`;
  });

  qsa('input[name="print-range"]').forEach(radio => {
    radio.addEventListener('change', () => {
      qs('#print-page-range').disabled = radio.value !== 'custom' || !radio.checked;
    });
  });

  qs('#btn-print-preview').addEventListener('click', async () => {
    const dataUrls = await getPrintDataUrls();
    if (!dataUrls) return;
    await showPreview(dataUrls);
  });

  qs('#btn-print-now').addEventListener('click', async () => {
    const dataUrls = await getPrintDataUrls();
    if (!dataUrls) return;
    await dispatchPrint(dataUrls);
  });

  qs('#btn-close-print-preview').addEventListener('click', () => { qs('#print-preview-overlay').hidden = true; });
  qs('#btn-cancel-print-preview').addEventListener('click', () => { qs('#print-preview-overlay').hidden = true; });

  qs('#btn-confirm-print').addEventListener('click', async () => {
    const dataUrls = await getPrintDataUrls();
    qs('#print-preview-overlay').hidden = true;
    if (!dataUrls) return;
    await dispatchPrint(dataUrls);
  });
}

function wireSegmented(selector) {
  const el = qs(selector);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    qsa('.segment', el).forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
  });
}

function wireSourceMode() {
  const seg = qs('#print-source');
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    qsa('.segment', seg).forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const isImage = btn.dataset.value === 'image';
    qs('#print-image-row').hidden = !isImage;
    qs('#print-range-row').hidden = isImage;
  });
}

function wireImagePicker() {
  const input = qs('#print-image-input');
  qs('#btn-print-add-images').addEventListener('click', () => input.click());

  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const dataUrl = await readAsDataUrl(file);
      printImages.push({ file, dataUrl });
    }
    renderImageList();
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

function renderImageList() {
  const list = qs('#print-image-list');
  list.innerHTML = '';
  printImages.forEach((item, index) => {
    const chip = document.createElement('div');
    chip.className = 'print-image-chip';
    const img = document.createElement('img');
    img.src = item.dataUrl;
    const label = document.createElement('span');
    label.textContent = item.file.name;
    const removeBtn = document.createElement('button');
    removeBtn.innerHTML = '<span class="material-icon">close</span>';
    removeBtn.addEventListener('click', () => {
      printImages.splice(index, 1);
      renderImageList();
    });
    chip.appendChild(img);
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    list.appendChild(chip);
  });
}

function isImageMode() {
  return qs('.segment.active', qs('#print-source')).dataset.value === 'image';
}

/** Resolve the list of data URLs to print/preview, based on the current source mode. */
async function getPrintDataUrls() {
  if (isImageMode()) {
    if (printImages.length === 0) {
      showSnackbar('Tambahkan minimal satu gambar untuk dicetak.');
      return null;
    }
    return printImages.map(p => p.dataUrl);
  }

  const pageCount = getPageCount();
  if (pageCount === 0) {
    showSnackbar('Tidak ada dokumen yang dimuat.');
    return null;
  }
  const rangeMode = qsa('input[name="print-range"]').find(r => r.checked).value;
  let pages;
  if (rangeMode === 'all') {
    pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  } else {
    pages = parsePageRange(qs('#print-page-range').value, pageCount);
    if (pages.length === 0) {
      showSnackbar('Rentang halaman tidak valid.');
      return null;
    }
  }

  setLoading(true, 'Menyiapkan halaman…');
  try {
    return await renderPagesForPrint(pages);
  } finally {
    setLoading(false);
  }
}

function getPrintSettings() {
  return {
    paperSize: qs('#print-paper-size').value,
    orientation: qs('.segment.active', qs('#print-orientation')).dataset.value,
    marginMm: parseInt(qs('#print-margin').value, 10),
    method: qs('#print-method').value,
  };
}

async function showPreview(dataUrls) {
  const body = qs('#print-preview-body');
  body.innerHTML = '';
  for (const url of dataUrls) {
    const wrap = document.createElement('div');
    wrap.className = 'print-preview-page';
    const img = document.createElement('img');
    img.src = url;
    wrap.appendChild(img);
    body.appendChild(wrap);
  }
  qs('#print-preview-overlay').hidden = false;
}

async function dispatchPrint(dataUrls) {
  const settings = getPrintSettings();
  try {
    switch (settings.method) {
      case 'bluetooth':
        setLoading(true, 'Menghubungkan ke printer Bluetooth…');
        await printViaBluetooth(dataUrls, settings.paperSize);
        break;
      case 'usb':
        setLoading(true, 'Menghubungkan ke printer USB…');
        await printViaUsb(dataUrls, settings.paperSize);
        break;
      default:
        printViaSystem(dataUrls, settings);
        break;
    }
  } catch (err) {
    console.error(err);
    showSnackbar('Gagal mencetak dokumen.');
  } finally {
    setLoading(false);
  }
}
