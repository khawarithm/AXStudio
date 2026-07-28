/**
 * editorPanel.js
 * Wires the "Edit PDF" view: loads a chosen page as a background image,
 * lets the user draw text/freehand/shapes/images on an overlay <canvas>,
 * select and reposition ("geser") any element precisely by pixels or by
 * dragging, adjust font/bold/underline/color/size, resize images, and
 * bakes the result into the actual PDF page via pdfEditor.js.
 */

import { qs, qsa } from '../modules/utils.js';
import { getOriginalBytes, getPageCount, getCurrentFileName, reloadFromBytes } from '../modules/pdfEngine.js';
import { renderPageToDataUrl } from '../modules/exporter.js';
import { applyEditsToPage } from '../modules/pdfEditor.js';
import { showSnackbar, setLoading } from '../modules/notifications.js';
import { initViewerForDocument } from './viewerController.js';

const FONT_FAMILY_CSS = {
  helvetica: 'Arial, Helvetica, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

let currentTool = 'text';
let currentPage = 1;
let elements = [];
let selectedIndex = -1;

let isDrawing = false;
let drawStart = null;
let currentPathPoints = null;

let isDraggingSelected = false;
let lastDragPos = null;

let pendingImageDataUrl = null;
let pendingImageMime = null;

// Default style applied to newly-created elements when nothing is selected.
const styleState = {
  color: '#e53935',
  size: 16,
  fontFamily: 'helvetica',
  bold: false,
  underline: false,
};

export function wireEditorPanel() {
  wireToolbar();
  wireStyleControls();
  wireContextToolbar();
  wireCanvasInteractions();
  wireLoadPage();
  wireImageInsert();
  wireApply();
}

/* ==========================================================================
   Toolbar wiring
   ========================================================================== */

function wireToolbar() {
  qsa('.tool-btn', qs('#editor-tools')).forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.tool-btn', qs('#editor-tools')).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      selectedIndex = -1;
      syncControlsToSelection();
      redrawCanvas();
      qs('#editor-stage').classList.toggle('select-mode', currentTool === 'select');
      if (currentTool === 'image') {
        qs('#editor-image-input').click();
      }
    });
  });

  qs('#btn-editor-undo').addEventListener('click', () => {
    elements.pop();
    if (selectedIndex >= elements.length) selectedIndex = -1;
    syncControlsToSelection();
    redrawCanvas();
  });

  qs('#btn-editor-clear').addEventListener('click', () => {
    if (elements.length === 0) return;
    elements = [];
    selectedIndex = -1;
    syncControlsToSelection();
    redrawCanvas();
  });

  qs('#btn-editor-add-header').addEventListener('click', () => {
    if (getPageCount() === 0) {
      showSnackbar('Buka file PDF terlebih dahulu.');
      return;
    }
    const canvas = qs('#editor-canvas');
    if (canvas.width === 0) {
      showSnackbar('Muat halaman terlebih dahulu.');
      return;
    }
    // Place a bold, larger header roughly centered near the top of the page.
    const pos = { x: canvas.width * 0.5 - 90, y: 28 };
    openTextInput(pos, { forceBold: true, forceFontSize: 28 });
  });
}

function wireStyleControls() {
  const fontFamilySel = qs('#editor-font-family');
  const boldBtn = qs('#editor-bold-toggle');
  const underlineBtn = qs('#editor-underline-toggle');
  const colorInput = qs('#editor-color');
  const sizeInput = qs('#editor-size');

  fontFamilySel.addEventListener('change', (e) => {
    styleState.fontFamily = e.target.value;
    if (selectedIndex !== -1 && elements[selectedIndex].type === 'text') {
      elements[selectedIndex].fontFamily = e.target.value;
      redrawCanvas();
    }
  });

  boldBtn.addEventListener('click', () => {
    styleState.bold = !styleState.bold;
    boldBtn.classList.toggle('active', styleState.bold);
    if (selectedIndex !== -1 && elements[selectedIndex].type === 'text') {
      elements[selectedIndex].bold = styleState.bold;
      redrawCanvas();
    }
  });

  underlineBtn.addEventListener('click', () => {
    styleState.underline = !styleState.underline;
    underlineBtn.classList.toggle('active', styleState.underline);
    if (selectedIndex !== -1 && elements[selectedIndex].type === 'text') {
      elements[selectedIndex].underline = styleState.underline;
      redrawCanvas();
    }
  });

  colorInput.addEventListener('input', (e) => {
    styleState.color = e.target.value;
    if (selectedIndex !== -1 && 'color' in (elements[selectedIndex] || {})) {
      elements[selectedIndex].color = e.target.value;
      redrawCanvas();
    }
  });

  sizeInput.addEventListener('input', (e) => {
    styleState.size = parseInt(e.target.value, 10);
    const el = elements[selectedIndex];
    if (selectedIndex !== -1 && el) {
      if (el.type === 'text') el.fontSize = styleState.size;
      else if ('lineWidth' in el) el.lineWidth = styleState.size;
      redrawCanvas();
    }
  });
}

function wireContextToolbar() {
  qs('#editor-nudge-up').addEventListener('click', () => nudgeSelected(0, -getNudgeStep()));
  qs('#editor-nudge-down').addEventListener('click', () => nudgeSelected(0, getNudgeStep()));
  qs('#editor-nudge-left').addEventListener('click', () => nudgeSelected(-getNudgeStep(), 0));
  qs('#editor-nudge-right').addEventListener('click', () => nudgeSelected(getNudgeStep(), 0));

  qs('#editor-img-width').addEventListener('input', (e) => {
    const el = elements[selectedIndex];
    if (selectedIndex === -1 || !el || el.type !== 'image') return;
    el.width = Math.max(10, parseInt(e.target.value, 10) || 10);
    redrawCanvas();
  });
  qs('#editor-img-height').addEventListener('input', (e) => {
    const el = elements[selectedIndex];
    if (selectedIndex === -1 || !el || el.type !== 'image') return;
    el.height = Math.max(10, parseInt(e.target.value, 10) || 10);
    redrawCanvas();
  });

  qs('#btn-editor-delete-selected').addEventListener('click', () => {
    if (selectedIndex === -1) return;
    elements.splice(selectedIndex, 1);
    selectedIndex = -1;
    syncControlsToSelection();
    redrawCanvas();
  });
}

function getNudgeStep() {
  return parseInt(qs('#editor-nudge-step').value, 10) || 5;
}

/** Move the currently-selected element by (dx, dy) canvas pixels. Reused by both the nudge buttons and freeform dragging. */
function nudgeSelected(dx, dy) {
  if (selectedIndex === -1) return;
  const el = elements[selectedIndex];
  switch (el.type) {
    case 'text':
    case 'image':
      el.x += dx;
      el.y += dy;
      break;
    case 'rect':
    case 'ellipse':
      el.x1 += dx; el.x2 += dx;
      el.y1 += dy; el.y2 += dy;
      break;
    case 'draw':
      el.points = el.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      break;
    default:
      break;
  }
  redrawCanvas();
}

/** Sync the toolbar's style controls + contextual toolbar to reflect (or stop reflecting) the current selection. */
function syncControlsToSelection() {
  const contextToolbar = qs('#editor-context-toolbar');
  const imageResizeGroup = qs('#editor-image-resize-group');

  if (selectedIndex === -1) {
    contextToolbar.hidden = true;
    return;
  }

  contextToolbar.hidden = false;
  const el = elements[selectedIndex];
  imageResizeGroup.hidden = el.type !== 'image';

  if (el.type === 'image') {
    qs('#editor-img-width').value = Math.round(el.width);
    qs('#editor-img-height').value = Math.round(el.height);
  }

  if (el.type === 'text') {
    qs('#editor-font-family').value = el.fontFamily || 'helvetica';
    qs('#editor-bold-toggle').classList.toggle('active', !!el.bold);
    qs('#editor-underline-toggle').classList.toggle('active', !!el.underline);
    qs('#editor-color').value = el.color;
    qs('#editor-size').value = el.fontSize;
  } else if ('color' in el) {
    qs('#editor-color').value = el.color;
    if ('lineWidth' in el) qs('#editor-size').value = el.lineWidth;
  }
}

/* ==========================================================================
   Page loading
   ========================================================================== */

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
    selectedIndex = -1;
    syncControlsToSelection();
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

/* ==========================================================================
   Canvas pointer interactions
   ========================================================================== */

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

    if (currentTool === 'select') {
      const idx = hitTest(pos);
      selectedIndex = idx;
      syncControlsToSelection();
      redrawCanvas();
      if (idx !== -1) {
        isDraggingSelected = true;
        lastDragPos = pos;
      }
      return;
    }

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
    if (currentTool === 'select') {
      if (!isDraggingSelected || selectedIndex === -1) return;
      evt.preventDefault();
      const pos = getCanvasPos(evt);
      nudgeSelected(pos.x - lastDragPos.x, pos.y - lastDragPos.y);
      lastDragPos = pos;
      return;
    }

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
    if (currentTool === 'select') {
      isDraggingSelected = false;
      lastDragPos = null;
      return;
    }

    if (!isDrawing) return;
    isDrawing = false;
    const pos = getCanvasPos(evt.changedTouches ? evt.changedTouches[0] : evt);
    const color = styleState.color;
    const size = styleState.size;

    if (currentTool === 'draw' && currentPathPoints && currentPathPoints.length > 1) {
      elements.push({ type: 'draw', points: currentPathPoints, color, lineWidth: size });
      selectedIndex = elements.length - 1;
    } else if (currentTool === 'rect') {
      elements.push({ type: 'rect', x1: drawStart.x, y1: drawStart.y, x2: pos.x, y2: pos.y, color, lineWidth: size });
      selectedIndex = elements.length - 1;
    } else if (currentTool === 'ellipse') {
      elements.push({ type: 'ellipse', x1: drawStart.x, y1: drawStart.y, x2: pos.x, y2: pos.y, color, lineWidth: size });
      selectedIndex = elements.length - 1;
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

/* ==========================================================================
   Text tool
   ========================================================================== */

function openTextInput(pos, preset = {}) {
  const input = qs('#editor-text-input');
  const fontSize = preset.forceFontSize || styleState.size;
  const bold = preset.forceBold ?? styleState.bold;
  const underline = preset.forceUnderline ?? styleState.underline;
  const fontFamily = styleState.fontFamily;
  const color = styleState.color;

  input.style.left = `${pos.x}px`;
  input.style.top = `${pos.y}px`;
  input.style.fontSize = `${fontSize}px`;
  input.style.fontWeight = bold ? 'bold' : 'normal';
  input.style.textDecoration = underline ? 'underline' : 'none';
  input.style.fontFamily = FONT_FAMILY_CSS[fontFamily] || FONT_FAMILY_CSS.helvetica;
  input.style.color = color;
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
        color,
        fontFamily,
        bold,
        underline,
      });
      selectedIndex = elements.length - 1;
      syncControlsToSelection();
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

/* ==========================================================================
   Image tool
   ========================================================================== */

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
    selectedIndex = elements.length - 1;
    syncControlsToSelection();
    redrawCanvas();
    pendingImageDataUrl = null;
  };
  img.src = pendingImageDataUrl;
}

/* ==========================================================================
   Rendering
   ========================================================================== */

function buildFontString(el) {
  const family = FONT_FAMILY_CSS[el.fontFamily] || FONT_FAMILY_CSS.helvetica;
  return `${el.bold ? 'bold ' : ''}${el.fontSize}px ${family}`;
}

/** Redraw every committed element onto the overlay canvas from scratch. */
function redrawCanvas() {
  const canvas = qs('#editor-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  elements.forEach((el, idx) => {
    drawElement(ctx, el);
    if (idx === selectedIndex) drawSelectionOutline(ctx, el);
  });
}

function drawElement(ctx, el) {
  switch (el.type) {
    case 'text': {
      ctx.fillStyle = el.color;
      ctx.font = buildFontString(el);
      ctx.textBaseline = 'top';
      ctx.fillText(el.text, el.x, el.y);
      if (el.underline) {
        const metrics = ctx.measureText(el.text);
        const underlineY = el.y + el.fontSize * 1.05;
        ctx.strokeStyle = el.color;
        ctx.lineWidth = Math.max(1, el.fontSize * 0.06);
        ctx.beginPath();
        ctx.moveTo(el.x, underlineY);
        ctx.lineTo(el.x + metrics.width, underlineY);
        ctx.stroke();
      }
      break;
    }
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

function getElementBBox(el) {
  switch (el.type) {
    case 'text': {
      const canvas = qs('#editor-canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = buildFontString(el);
      const metrics = ctx.measureText(el.text);
      return { x: el.x, y: el.y, w: metrics.width, h: el.fontSize * 1.2 };
    }
    case 'image':
      return { x: el.x, y: el.y, w: el.width, h: el.height };
    case 'rect':
    case 'ellipse': {
      const x = Math.min(el.x1, el.x2);
      const y = Math.min(el.y1, el.y2);
      return { x, y, w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) };
    }
    case 'draw': {
      const xs = el.points.map(p => p.x);
      const ys = el.points.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return { x: minX - 5, y: minY - 5, w: (maxX - minX) + 10, h: (maxY - minY) + 10 };
    }
    default:
      return null;
  }
}

function drawSelectionOutline(ctx, el) {
  const bbox = getElementBBox(el);
  if (!bbox) return;
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#2196f3';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bbox.x - 4, bbox.y - 4, bbox.w + 8, bbox.h + 8);
  ctx.restore();
}

/** Find the topmost element whose bounding box contains the given point, or -1. */
function hitTest(pos) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const bbox = getElementBBox(elements[i]);
    if (!bbox) continue;
    if (pos.x >= bbox.x && pos.x <= bbox.x + bbox.w && pos.y >= bbox.y && pos.y <= bbox.y + bbox.h) {
      return i;
    }
  }
  return -1;
}

function drawPathPreview(points, color, lineWidth) {
  const canvas = qs('#editor-canvas');
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = color || styleState.color;
  ctx.lineWidth = lineWidth || styleState.size;
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
  ctx.strokeStyle = styleState.color;
  ctx.lineWidth = styleState.size;

  if (tool === 'rect') {
    ctx.strokeRect(
      Math.min(start.x, end.x), Math.min(start.y, end.y),
      Math.abs(end.x - start.x), Math.abs(end.y - start.y)
    );
  } else if (tool === 'ellipse') {
    drawEllipsePreview({ x1: start.x, y1: start.y, x2: end.x, y2: end.y, color: styleState.color, lineWidth: styleState.size });
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

/* ==========================================================================
   Apply changes to the PDF
   ========================================================================== */

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
      selectedIndex = -1;
      syncControlsToSelection();
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
