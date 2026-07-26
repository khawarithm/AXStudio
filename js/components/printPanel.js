/**
 * printPanel.js
 * Wires the "Print" view UI: paper size, orientation, margin, method
 * (system/Bluetooth/USB), page range, preview dialog, and dispatch.
 */

import { qs, qsa, parsePageRange } from '../modules/utils.js';
import { getPageCount } from '../modules/pdfEngine.js';
import { renderPagesForPrint, printViaSystem, printViaBluetooth, printViaUsb } from '../modules/printManager.js';
import { showSnackbar, setLoading } from '../modules/notifications.js';

export function wirePrintPanel() {
  wireSegmented('#print-orientation');

  qs('#print-margin').addEventListener('input', (e) => {
    qs('#print-margin-val').textContent = `${e.target.value}mm`;
  });

  qsa('input[name="print-range"]').forEach(radio => {
    radio.addEventListener('change', () => {
      qs('#print-page-range').disabled = radio.value !== 'custom' || !radio.checked;
    });
  });

  qs('#btn-print-preview').addEventListener('click', async () => {
    const pages = getSelectedPages();
    if (!pages) return;
    await showPreview(pages);
  });

  qs('#btn-print-now').addEventListener('click', async () => {
    const pages = getSelectedPages();
    if (!pages) return;
    await dispatchPrint(pages);
  });

  qs('#btn-close-print-preview').addEventListener('click', () => { qs('#print-preview-overlay').hidden = true; });
  qs('#btn-cancel-print-preview').addEventListener('click', () => { qs('#print-preview-overlay').hidden = true; });

  qs('#btn-confirm-print').addEventListener('click', async () => {
    const pages = getSelectedPages();
    qs('#print-preview-overlay').hidden = true;
    if (!pages) return;
    await dispatchPrint(pages);
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

function getSelectedPages() {
  const pageCount = getPageCount();
  if (pageCount === 0) {
    showSnackbar('Tidak ada dokumen yang dimuat.');
    return null;
  }
  const rangeMode = qsa('input[name="print-range"]').find(r => r.checked).value;
  if (rangeMode === 'all') {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const pages = parsePageRange(qs('#print-page-range').value, pageCount);
  if (pages.length === 0) {
    showSnackbar('Rentang halaman tidak valid.');
    return null;
  }
  return pages;
}

function getPrintSettings() {
  return {
    paperSize: qs('#print-paper-size').value,
    orientation: qs('.segment.active', qs('#print-orientation')).dataset.value,
    marginMm: parseInt(qs('#print-margin').value, 10),
    method: qs('#print-method').value,
  };
}

async function showPreview(pages) {
  setLoading(true, 'Menyiapkan preview…');
  try {
    const dataUrls = await renderPagesForPrint(pages);
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
  } catch (err) {
    console.error(err);
    showSnackbar('Gagal membuat preview.');
  } finally {
    setLoading(false);
  }
}

async function dispatchPrint(pages) {
  const settings = getPrintSettings();
  setLoading(true, 'Menyiapkan dokumen untuk dicetak…');
  try {
    const dataUrls = await renderPagesForPrint(pages);
    setLoading(false);

    switch (settings.method) {
      case 'bluetooth':
        setLoading(true, 'Menghubungkan ke printer Bluetooth…');
        await printViaBluetooth(dataUrls);
        break;
      case 'usb':
        setLoading(true, 'Menghubungkan ke printer USB…');
        await printViaUsb(dataUrls);
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
