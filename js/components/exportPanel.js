/**
 * exportPanel.js
 * Wires the "Export" view UI to the exporter.js module.
 */

import { qs, qsa, parsePageRange } from '../modules/utils.js';
import { getPageCount, getCurrentFileName } from '../modules/pdfEngine.js';
import { exportPagesAsImages } from '../modules/exporter.js';
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
      rangeInput.disabled = radio.value !== 'custom' || !radio.checked;
      qsa('input[name="export-range"]').forEach(r => {
        if (r.value === 'custom') rangeInput.disabled = !r.checked;
      });
    });
  });

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
      showSnackbar(`${pages.length} gambar berhasil diexport.`);
    } catch (err) {
      console.error(err);
      showSnackbar('Terjadi kesalahan saat export gambar.');
    } finally {
      hideInlineProgress('export-progress');
    }
  });
}
