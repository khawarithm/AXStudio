/**
 * exportPanel.js
 * Wires the "Export" view UI to the exporter.js module, including a live
 * preview that renders thumbnails of whichever pages the current page-range
 * input resolves to.
 */

import { qs, qsa, parsePageRange, debounce } from '../modules/utils.js';
import { getPageCount, getCurrentFileName } from '../modules/pdfEngine.js';
import { exportPagesAsImages, renderExportPreview } from '../modules/exporter.js';
import { showSnackbar, setInlineProgress, hideInlineProgress } from '../modules/notifications.js';

export function wireExportPanel() {
  const formatSeg = qs('#export-format');
  const rangeRadios = qsa('input[name="export-range"]');
  const rangeInput = qs('#export-page-range');
  const qualitySlider = qs('#export-quality');
  const scaleSlider = qs('#export-scale');

  formatSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    qsa('.segment', formatSeg).forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const isJpg = btn.dataset.value === 'jpg';
    qualitySlider.disabled = !isJpg;
  });
  qualitySlider.disabled = false; // PNG default active, but keep quality usable if user switches

  qualitySlider.addEventListener('input', () => {
    qs('#export-quality-val').textContent = `${qualitySlider.value}%`;
  });
  scaleSlider.addEventListener('input', () => {
    qs('#export-scale-val').textContent = `${scaleSlider.value}x`;
  });

  rangeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      qsa('input[name="export-range"]').forEach(r => {
        if (r.value === 'custom') rangeInput.disabled = !r.checked;
      });
      updatePreview();
    });
  });

  const updatePreview = debounce(async () => {
    const pageCount = getPageCount();
    const previewBox = qs('#export-preview');
    const strip = qs('#export-preview-strip');
    if (pageCount === 0) {
      previewBox.hidden = true;
      return;
    }

    const rangeMode = qsa('input[name="export-range"]').find(r => r.checked).value;
    let pages;
    if (rangeMode === 'all') {
      pages = Array.from({ length: pageCount }, (_, i) => i + 1);
    } else {
      pages = parsePageRange(rangeInput.value, pageCount);
    }

    if (pages.length === 0) {
      previewBox.hidden = true;
      return;
    }

    // Cap how many thumbnails we actually render live to keep this snappy
    // on documents with hundreds of pages.
    const cappedPages = pages.slice(0, 24);
    strip.innerHTML = '';
    previewBox.hidden = false;

    const rendered = await renderExportPreview(cappedPages);
    strip.innerHTML = '';
    for (const { page, dataUrl } of rendered) {
      const wrap = document.createElement('div');
      wrap.className = 'preview-thumb';
      const img = document.createElement('img');
      img.src = dataUrl;
      const label = document.createElement('span');
      label.className = 'preview-thumb-label';
      label.textContent = `Hal. ${page}`;
      wrap.appendChild(img);
      wrap.appendChild(label);
      strip.appendChild(wrap);
    }
    if (pages.length > cappedPages.length) {
      const more = document.createElement('div');
      more.className = 'preview-thumb';
      more.innerHTML = `<span class="preview-thumb-label">+${pages.length - cappedPages.length} lagi</span>`;
      strip.appendChild(more);
    }
  }, 400);

  rangeInput.addEventListener('input', updatePreview);

  qs('#btn-export-images').addEventListener('click', async () => {
    const pageCount = getPageCount();
    if (pageCount === 0) {
      showSnackbar('Tidak ada dokumen yang dimuat.');
      return;
    }

    const format = qs('.segment.active', formatSeg).dataset.value;
    const quality = parseInt(qualitySlider.value, 10);
    const scale = parseFloat(scaleSlider.value);
    const rangeMode = qsa('input[name="export-range"]').find(r => r.checked).value;

    let pages;
    if (rangeMode === 'all') {
      pages = Array.from({ length: pageCount }, (_, i) => i + 1);
    } else {
      pages = parsePageRange(rangeInput.value, pageCount);
      if (pages.length === 0) {
        showSnackbar('Rentang halaman tidak valid.');
        return;
      }
    }

    const baseName = getCurrentFileName().replace(/\.pdf$/i, '');
    setInlineProgress('export-progress', 0, `Memproses 0/${pages.length}`);

    try {
      await exportPagesAsImages(pages, { format, quality, scale, baseName }, (done, total) => {
        setInlineProgress('export-progress', (done / total) * 100, `Memproses ${done}/${total}`);
      });
      showSnackbar(
        pages.length === 1
          ? `Gambar "${pages[0]}.${format === 'jpg' ? 'jpg' : 'png'}" berhasil diunduh.`
          : `${pages.length} gambar berhasil diexport sebagai ZIP.`
      );
    } catch (err) {
      console.error(err);
      showSnackbar('Terjadi kesalahan saat export gambar.');
    } finally {
      hideInlineProgress('export-progress');
    }
  });
}

/** Called by fileLoader/navigation when a new doc is loaded, to refresh the preview if the panel is visible. */
export function refreshExportPreviewOnLoad() {
  const rangeInput = qs('#export-page-range');
  if (rangeInput) rangeInput.dispatchEvent(new Event('input'));
}
