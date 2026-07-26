/**
 * utilitiesPanel.js
 * Wires the "Utilities" view — merge, split, rotate, delete, rearrange,
 * compress, watermark, and password protect — to pdfUtilities.js, and
 * reloads the active document into the viewer after in-place edits.
 */

import { qs, qsa, parsePageRange, readFileAsArrayBuffer, downloadBlob, toBlob, formatBytes } from '../modules/utils.js';
import {
  getOriginalBytes, getPageCount, getCurrentFileName, reloadFromBytes, renderThumbnail,
} from '../modules/pdfEngine.js';
import * as pdfUtil from '../modules/pdfUtilities.js';
import { showSnackbar, setLoading } from '../modules/notifications.js';
import { initViewerForDocument } from './viewerController.js';

export function wireUtilitiesPanel() {
  wireSegmented('#compress-level');
  wireMerge();
  wireSplit();
  wireRotate();
  wireDelete();
  wireRearrange();
  wireCompress();
  wireWatermark();
  wirePassword();
}

function wireSegmented(selector) {
  const el = qs(selector);
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    qsa('.segment', el).forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
  });
}

/** Re-load the mutated bytes back into the live viewer + refresh page count UI. */
async function applyMutatedBytes(bytes, successMessage) {
  const name = getCurrentFileName();
  await reloadFromBytes(bytes, name);
  await initViewerForDocument(bytes.byteLength ?? bytes.length);
  showSnackbar(successMessage);
}

function requireDocOrWarn() {
  if (getPageCount() === 0) {
    showSnackbar('Buka file PDF terlebih dahulu.');
    return false;
  }
  return true;
}

/* ---------------------------- Merge ---------------------------- */
function wireMerge() {
  const input = qs('.util-file-input[data-tool="merge"]');
  const trigger = qs('.util-trigger[data-tool="merge"]');

  trigger.addEventListener('click', () => input.click());

  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length < 1) return;

    setLoading(true, 'Menggabungkan PDF…');
    try {
      const buffers = [];
      // Include the currently open document first, if any, so "merge" feels
      // like "append these files to what I have open".
      const current = getOriginalBytes();
      if (current) buffers.push(current);
      for (const f of files) buffers.push(await readFileAsArrayBuffer(f));

      const merged = await pdfUtil.mergePdfs(buffers);
      await applyMutatedBytes(merged, `${files.length} file berhasil digabungkan.`);
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal menggabungkan PDF.');
    } finally {
      setLoading(false);
      input.value = '';
    }
  });
}

/* ---------------------------- Split ---------------------------- */
function wireSplit() {
  qs('.util-trigger[data-tool="split"]').addEventListener('click', async () => {
    if (!requireDocOrWarn()) return;
    const rangeStr = qs('#split-range').value;
    const pageCount = getPageCount();
    const pages = parsePageRange(rangeStr, pageCount);
    if (pages.length === 0) {
      showSnackbar('Masukkan rentang halaman yang valid, mis. 1-2,3.');
      return;
    }

    setLoading(true, 'Memisahkan halaman…');
    try {
      const buffer = getOriginalBytes();
      const baseName = getCurrentFileName().replace(/\.pdf$/i, '');
      // Treat comma-separated groups as separate output files; ranges within
      // a group ("1-2") stay together in one file.
      const groups = rangeStr.split(',').map(part => parsePageRange(part.trim(), pageCount)).filter(g => g.length);
      await pdfUtil.splitAndDownload(buffer, groups, baseName);
      showSnackbar(`${groups.length} file PDF berhasil dibuat.`);
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal memisahkan PDF.');
    } finally {
      setLoading(false);
    }
  });
}

/* ---------------------------- Rotate ---------------------------- */
function wireRotate() {
  qs('.util-trigger[data-tool="rotate"]').addEventListener('click', async () => {
    if (!requireDocOrWarn()) return;
    const pageCount = getPageCount();
    const pages = parsePageRange(qs('#rotate-range').value, pageCount);
    if (pages.length === 0) {
      showSnackbar('Masukkan nomor halaman yang valid.');
      return;
    }
    const deg = parseInt(qs('#rotate-degree').value, 10);

    setLoading(true, 'Memutar halaman…');
    try {
      const buffer = getOriginalBytes();
      const bytes = await pdfUtil.rotatePages(buffer, pages, deg);
      await applyMutatedBytes(bytes, `${pages.length} halaman berhasil diputar.`);
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal memutar halaman.');
    } finally {
      setLoading(false);
    }
  });
}

/* ---------------------------- Delete ---------------------------- */
function wireDelete() {
  qs('.util-trigger[data-tool="delete"]').addEventListener('click', async () => {
    if (!requireDocOrWarn()) return;
    const pageCount = getPageCount();
    const pages = parsePageRange(qs('#delete-range').value, pageCount);
    if (pages.length === 0) {
      showSnackbar('Masukkan nomor halaman yang valid.');
      return;
    }
    if (pages.length >= pageCount) {
      showSnackbar('Tidak bisa menghapus semua halaman.');
      return;
    }

    setLoading(true, 'Menghapus halaman…');
    try {
      const buffer = getOriginalBytes();
      const bytes = await pdfUtil.deletePages(buffer, pages);
      await applyMutatedBytes(bytes, `${pages.length} halaman berhasil dihapus.`);
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal menghapus halaman.');
    } finally {
      setLoading(false);
    }
  });
}

/* ---------------------------- Rearrange ---------------------------- */
function wireRearrange() {
  const overlay = qs('#rearrange-overlay');
  const grid = qs('#rearrange-grid');
  let order = [];
  let draggedEl = null;

  qs('.util-trigger[data-tool="rearrange"]').addEventListener('click', async () => {
    if (!requireDocOrWarn()) return;
    const pageCount = getPageCount();
    order = Array.from({ length: pageCount }, (_, i) => i + 1);
    await renderRearrangeGrid();
    overlay.hidden = false;
  });

  async function renderRearrangeGrid() {
    grid.innerHTML = '';
    for (const pageNum of order) {
      const item = document.createElement('div');
      item.className = 'rearrange-item';
      item.draggable = true;
      item.dataset.page = pageNum;

      const canvas = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = `Hal. ${pageNum}`;

      item.appendChild(canvas);
      item.appendChild(label);
      grid.appendChild(item);
      renderThumbnail(pageNum, canvas, 100).catch(() => {});

      item.addEventListener('dragstart', () => {
        draggedEl = item;
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        draggedEl = null;
        syncOrderFromDom();
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        if (draggedEl && draggedEl !== item) {
          const items = Array.from(grid.children);
          const draggedIdx = items.indexOf(draggedEl);
          const targetIdx = items.indexOf(item);
          if (draggedIdx < targetIdx) {
            item.after(draggedEl);
          } else {
            item.before(draggedEl);
          }
        }
      });
    }
  }

  function syncOrderFromDom() {
    order = qsa('.rearrange-item', grid).map(el => parseInt(el.dataset.page, 10));
  }

  qs('#btn-close-rearrange').addEventListener('click', () => { overlay.hidden = true; });
  qs('#btn-cancel-rearrange').addEventListener('click', () => { overlay.hidden = true; });

  qs('#btn-apply-rearrange').addEventListener('click', async () => {
    syncOrderFromDom();
    setLoading(true, 'Menyusun ulang halaman…');
    try {
      const buffer = getOriginalBytes();
      const bytes = await pdfUtil.rearrangePages(buffer, order);
      overlay.hidden = true;
      await applyMutatedBytes(bytes, 'Urutan halaman berhasil diperbarui.');
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal menyusun ulang halaman.');
    } finally {
      setLoading(false);
    }
  });
}

/* ---------------------------- Compress ---------------------------- */
function wireCompress() {
  qs('.util-trigger[data-tool="compress"]').addEventListener('click', async () => {
    if (!requireDocOrWarn()) return;
    const level = qs('.segment.active', qs('#compress-level')).dataset.value;

    setLoading(true, 'Mengompres PDF…');
    try {
      const buffer = getOriginalBytes();
      const originalSize = buffer.byteLength;
      const bytes = await pdfUtil.compressPdf(buffer, level);
      const newSize = bytes.byteLength;
      await applyMutatedBytes(
        bytes,
        `Kompresi selesai: ${formatBytes(originalSize)} → ${formatBytes(newSize)}.`
      );
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal mengompres PDF.');
    } finally {
      setLoading(false);
    }
  });
}

/* ---------------------------- Watermark ---------------------------- */
function wireWatermark() {
  qs('.util-trigger[data-tool="watermark"]').addEventListener('click', async () => {
    if (!requireDocOrWarn()) return;
    const text = qs('#watermark-text').value.trim();
    if (!text) {
      showSnackbar('Masukkan teks watermark terlebih dahulu.');
      return;
    }
    const opacity = parseInt(qs('#watermark-opacity').value, 10);

    setLoading(true, 'Menambahkan watermark…');
    try {
      const buffer = getOriginalBytes();
      const bytes = await pdfUtil.addWatermark(buffer, text, opacity);
      await applyMutatedBytes(bytes, 'Watermark berhasil ditambahkan.');
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal menambahkan watermark.');
    } finally {
      setLoading(false);
    }
  });
}

/* ---------------------------- Password ---------------------------- */
function wirePassword() {
  qs('.util-trigger[data-tool="password"]').addEventListener('click', async () => {
    if (!requireDocOrWarn()) return;
    const password = qs('#password-input').value;
    if (!password || password.length < 4) {
      showSnackbar('Password minimal 4 karakter.');
      return;
    }

    setLoading(true, 'Menerapkan password…');
    try {
      const buffer = getOriginalBytes();
      const bytes = await pdfUtil.protectWithPassword(buffer, password);
      const baseName = getCurrentFileName().replace(/\.pdf$/i, '');
      downloadBlob(toBlob(bytes, 'application/pdf'), `${baseName}_protected.pdf`);
      showSnackbar('PDF terproteksi berhasil diunduh.');
    } catch (err) {
      console.error(err);
      showSnackbar(err.message || 'Gagal menerapkan password.');
    } finally {
      setLoading(false);
    }
  });
}
