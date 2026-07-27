/**
 * editorPanel.js
 * Wires the "Edit PDF" view: loads a chosen page as a background image,
 * lets the user draw text/freehand/shapes/images on an overlay <canvas>,
 * and bakes the result into the actual PDF page via pdfEditor.js.
 */

import { qs, qsa } from '../modules/utils.js';
import { getOriginalBytes, getPageCount, getCurrentFileName, reloadFromBytes } from '../modules/pdfEngine.js';
import { renderPageToDataUrl } from '../modules/exporter.js';
import { applyEditsToPage } from '../modules/pdfEditor.js';
import { showSnackbar, setLoading } from '../modules/notifications.js';
import { initViewerForDocument } from './viewerController.js';

let currentTool = 'text';
let currentPage = 1;
let elements = [];
let isDrawing = false;
let drawStart = null;
let currentPathPoints = null;
let pendingImageDataUrl = null;
let pendingImageMime = null;

export function wireEditorPanel() {
  wireToolbar();
  wireCanvasInteractions();
  wireLoadPage();
  wireImageInsert();
  wireApply();
}

function wireToolbar() {
  qsa('.tool-btn', qs('#editor-tools')).forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.tool-btn', qs('#editor-tools')).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      if (currentTool === 'image') {
        qs('#editor-image-input').click();
      }
    });
  });

  qs('#btn-editor-undo').addEventListener('click', () => {
    elements.pop();
    redrawCanvas();
  });

  qs('#btn-editor-clear').addEventListener('click', () => {
    if (elements.length === 0) return;
    elements = [];
    redrawCanvas();
  });
}

function wireLoadPage() {
  qs('#btn-editor-load-page').addEventListener('click', async () => {
    if (getPageCount() === 0) {
      showSnackbar('Buka file PDF terlebih dahulu.');
      return;
    }
    const num = parseInt(qs('#editor-page-input').value, 10);
    const max = getPageCount();
    if (Number.isNaN(num) || num < 1 || num > max) {
      showSnackbar('Nomor halaman tidak valid.');
      return;
    }
    await loadPageIntoEditor(num);
  });
}

async function loadPageIntoEditor(pageNum) {
  setLoading(true, 'Memuat halaman…');
  try {
    currentPage = pageNum;
    elements = [];
    qs('#editor-page-count').textContent = getPageCount();
    qs('#editor-page-input').value = pageNum;

    const dataUrl = await renderPageToDataUrl(pageNum, 2);
    const img = qs('#editor-bg-image');
    const canvas = qs('#editor-canvas');

    await new Promise((resolve) => {
      img.onload = resolve;
      img.src = dataUrl;
    });

    // Match the overlay canvas's CSS size to the rendered background image's
    // *displayed* size (which may be scaled down to fit the viewport by
    // max-width:100% in CSS), so coordinate math stays consistent.
    const rect = img.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    redrawCanvas();
  } catch (err) {
    console.error(err);
    showSnackbar('Gagal memuat halaman untuk diedit.');
  } finally {
    setLoading(false);
  }
}

function getCanvasPos(evt) {
  const canvas = qs('#editor-canvas');
  const rect = canvas.getBoundingClientRect();
  const point = evt.touches ? evt.touches[0] : evt;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
}

function wireCanvasInteractions() {
  const canvas = qs('#editor-canvas');

  const onDown = (evt) => {
    if (getPageCount() === 0) return;
    const pos = getCanvasPos(evt);

    if (currentTool === 'text') {
      openTextInput(pos);
      return;
    }
    if (currentTool === 'image') {
      if (!pendingImageDataUrl) {
        showSnackbar('Pilih gambar terlebih dahulu.');
        return;
      }
      placeImage(pos);
      return;
    }

    isDrawing = true;
    drawStart = pos;
    if (currentTool === 'draw') {
      currentPathPoints = [pos];
    }
  };

  const onMove = (evt) => {
    if (!isDrawing) return;
    evt.preventDefault();
    const pos = getCanvasPos(evt);

    if (currentTool === 'draw') {
      currentPathPoints.push(pos);
      redrawCanvas();
      drawPathPreview(currentPathPoints);
    } else if (currentTool === 'rect' || currentTool === 'ellipse') {
      redrawCanvas();
      drawShapePreview(currentTool, drawStart, pos);
    }
  };

  const onUp = (evt) => {
    if (!isDrawing) return;
    isDrawing = false;
    const pos = getCanvasPos(evt.changedTouches ? evt.changedTouches[0] : evt);
    const color = qs('#editor-color').value;
    const size = parseInt(qs('#editor-size').value, 10);

    if (currentTool === 'draw' && currentPathPoints && currentPathPoints.length > 1) {
      elements.push({ type: 'draw', points: currentPathPoints, color, lineWidth: size });
    } else if (currentTool === 'rect') {
      elements.push({ type: 'rect', x1: drawStart.x, y1: drawStart.y, x2: pos.x, y2: pos.y, color, lineWidth: size });
    } else if (currentTool === 'ellipse') {
      elements.push({ type: 'ellipse', x1: drawStart.x, y1: drawStart.y, x2: pos.x, y2: pos.y, color, lineWidth: size });
    }
    currentPathPoints = null;
    drawStart = null;
    redrawCanvas();
  };

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  canvas.addEventListener('touchstart', onDown, { passive: true });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);
}

function openTextInput(pos) {
  const input = qs('#editor-text-input');
  const fontSize = parseInt(qs('#editor-size').value, 10) + 6; // keep text readable regardless of "size" slider min
  input.style.left = `${pos.x}px`;
  input.style.top = `${pos.y}px`;
  input.style.fontSize = `${fontSize}px`;
  input.style.color = qs('#editor-color').value;
  input.value = '';
  input.hidden = false;
  input.focus();

  const commit = () => {
    const text = input.value.trim();
    if (text) {
      elements.push({
        type: 'text',
        x: pos.x,
        y: pos.y,
        text,
        fontSize,
        color: qs('#editor-color').value,
      });
      redrawCanvas();
    }
    input.hidden = true;
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', commit);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      input.value = '';
      commit();
    }
  };

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', commit, { once: true });
}

function wireImageInsert() {
  qs('#editor-image-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImageMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    pendingImageDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    showSnackbar('Klik pada halaman untuk menempatkan gambar.');
    e.target.value = '';
  });
}

function placeImage(pos) {
  const defaultWidth = 150;
  const img = new Image();
  img.onload = () => {
    const aspect = img.naturalHeight / img.naturalWidth;
    const width = defaultWidth;
    const height = defaultWidth * aspect;
    elements.push({
      type: 'image',
      x: pos.x - width / 2,
      y: pos.y - height / 2,
      width,
      height,
      dataUrl: pendingImageDataUrl,
      mimeType: pendingImageMime,
    });
    redrawCanvas();
    pendingImageDataUrl = null;
  };
  img.src = pendingImageDataUrl;
}

/** Redraw every committed element onto the overlay canvas from scratch. */
function redrawCanvas() {
  const canvas = qs('#editor-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const el of elements) {
    switch (el.type) {
      case 'text':
        ctx.fillStyle = el.color;
        ctx.font = `${el.fontSize}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(el.text, el.x, el.y);
        break;
      case 'draw':
        drawPathPreview(el.points, el.color, el.lineWidth);
        break;
      case 'rect':
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.lineWidth;
        ctx.strokeRect(
          Math.min(el.x1, el.x2), Math.min(el.y1, el.y2),
          Math.abs(el.x2 - el.x1), Math.abs(el.y2 - el.y1)
        );
        break;
      case 'ellipse':
        drawEllipsePreview(el);
        break;
      case 'image':
        if (el.__imgEl) {
          ctx.drawImage(el.__imgEl, el.x, el.y, el.width, el.height);
        } else {
          const imgEl = new Image();
          imgEl.onload = () => { el.__imgEl = imgEl; redrawCanvas(); };
          imgEl.src = el.dataUrl;
        }
        break;
      default:
        break;
    }
  }
}

function drawPathPreview(points, color, lineWidth) {
  const canvas = qs('#editor-canvas');
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = color || qs('#editor-color').value;
  ctx.lineWidth = lineWidth || parseInt(qs('#editor-size').value, 10);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function drawShapePreview(tool, start, end) {
  const canvas = qs('#editor-canvas');
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = qs('#editor-color').value;
  ctx.lineWidth = parseInt(qs('#editor-size').value, 10);

  if (tool === 'rect') {
    ctx.strokeRect(
      Math.min(start.x, end.x), Math.min(start.y, end.y),
      Math.abs(end.x - start.x), Math.abs(end.y - start.y)
    );
  } else if (tool === 'ellipse') {
    drawEllipsePreview({ x1: start.x, y1: start.y, x2: end.x, y2: end.y, color: qs('#editor-color').value, lineWidth: parseInt(qs('#editor-size').value, 10) });
  }
}

function drawEllipsePreview(el) {
  const canvas = qs('#editor-canvas');
  const ctx = canvas.getContext('2d');
  const cx = (el.x1 + el.x2) / 2;
  const cy = (el.y1 + el.y2) / 2;
  const rx = Math.abs(el.x2 - el.x1) / 2;
  const ry = Math.abs(el.y2 - el.y1) / 2;
  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.lineWidth;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function wireApply() {
  qs('#btn-editor-apply').addEventListener('click', async () => {
    if (getPageCount() === 0) {
      showSnackbar('Tidak ada dokumen yang dimuat.');
      return;
    }
    if (elements.length === 0) {
      showSnackbar('Belum ada perubahan untuk diterapkan.');
      return;
    }

    const canvas = qs('#editor-canvas');
    setLoading(true, 'Menerapkan perubahan ke halaman…');
    try {
      const buffer = getOriginalBytes();
      const bytes = await applyEditsToPage(buffer, currentPage, canvas.width, canvas.height, elements);
      const name = getCurrentFileName();
      await reloadFromBytes(bytes, name);
      await initViewerForDocument(bytes.byteLength ?? bytes.length);
      elements = [];
      await loadPageIntoEditor(currentPage);
      showSnackbar(`Perubahan pada halaman ${currentPage} berhasil disimpan.`);
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal menerapkan perubahan ke halaman.');
    } finally {
      setLoading(false);
    }
  });
}

/** Called by navigation/fileLoader when a document is (re)loaded, to reset the editor's page-count display. */
export function refreshEditorPageCount() {
  const countEl = qs('#editor-page-count');
  if (countEl) countEl.textContent = getPageCount();
}
