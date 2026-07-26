/**
 * pdfEngine.js
 * Thin, focused wrapper around PDF.js (global `pdfjsLib`) responsible for:
 *  - loading a PDF from File / ArrayBuffer
 *  - rendering pages to <canvas> with a text layer overlay
 *  - rendering thumbnails
 *  - zoom / rotate state
 *  - full-text search across all pages
 *  - extracting all text (for the Extract Text feature)
 *
 * This module holds no DOM references beyond what callers pass in; it is
 * intentionally UI-agnostic so it can be reused by viewer.js, exporter.js,
 * textExtractor.js, and printManager.js.
 */

// PDF.js worker configuration (must run once, before any getDocument call).
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/** @type {import('pdfjs-dist').PDFDocumentProxy | null} */
let currentPdfDoc = null;
let currentFileName = 'AXStudio';
let currentArrayBuffer = null;

export const viewState = {
  scale: 1.0,
  rotation: 0, // 0, 90, 180, 270
  currentPage: 1,
};

/**
 * Load a PDF document from a File object.
 * @param {File} file
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export async function loadPdfFromFile(file) {
  const buffer = await file.arrayBuffer();
  return loadPdfFromArrayBuffer(buffer, file.name);
}

/**
 * Load a PDF document from raw bytes (ArrayBuffer / Uint8Array).
 * @param {ArrayBuffer|Uint8Array} data
 * @param {string} name
 */
export async function loadPdfFromArrayBuffer(data, name = 'AXStudio') {
  // pdf.js detaches/consumes the buffer, so keep our own copy for re-use
  // (export, utilities, printing all need fresh bytes).
  const bufferCopy = data instanceof Uint8Array ? data.slice().buffer : data.slice(0);
  currentArrayBuffer = bufferCopy;

  const loadingTask = pdfjsLib.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data) });
  currentPdfDoc = await loadingTask.promise;
  currentFileName = name;
  viewState.scale = 1.0;
  viewState.rotation = 0;
  viewState.currentPage = 1;
  return currentPdfDoc;
}

/** Get the currently loaded PDFDocumentProxy (or null). */
export function getCurrentDoc() {
  return currentPdfDoc;
}

/** Get the display file name of the currently loaded PDF. */
export function getCurrentFileName() {
  return currentFileName;
}

/** Get a *fresh copy* of the original file bytes (safe to pass to pdf-lib, which mutates). */
export function getOriginalBytes() {
  if (!currentArrayBuffer) return null;
  return currentArrayBuffer.slice(0);
}

/** Replace the in-memory bytes after a pdf-lib mutation (merge/split/rotate/etc.), and reload. */
export async function reloadFromBytes(bytes, name) {
  return loadPdfFromArrayBuffer(bytes, name || currentFileName);
}

export function getPageCount() {
  return currentPdfDoc ? currentPdfDoc.numPages : 0;
}

/**
 * Render a single page onto a canvas element, including a selectable text layer
 * inside `textLayerContainer` (an absolutely-positioned div overlay).
 * @param {number} pageNum 1-based
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} textLayerContainer
 * @param {number} [scaleOverride]
 * @param {number} [rotationOverride]
 */
export async function renderPage(pageNum, canvas, textLayerContainer, scaleOverride, rotationOverride) {
  if (!currentPdfDoc) return null;
  const page = await currentPdfDoc.getPage(pageNum);
  const scale = scaleOverride ?? viewState.scale;
  const rotation = rotationOverride ?? viewState.rotation;
  const viewport = page.getViewport({ scale, rotation });

  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvasContext: context, viewport }).promise;

  if (textLayerContainer) {
    textLayerContainer.innerHTML = '';
    textLayerContainer.style.width = `${viewport.width}px`;
    textLayerContainer.style.height = `${viewport.height}px`;

    const textContent = await page.getTextContent();
    renderTextLayer(textContent, viewport, textLayerContainer);
  }

  return { width: viewport.width, height: viewport.height, page };
}

/**
 * Manually build a lightweight text layer (avoids depending on pdf.js's
 * separate text_layer_builder bundle so this stays a single-file module).
 */
function renderTextLayer(textContent, viewport, container) {
  const frag = document.createDocumentFragment();
  for (const item of textContent.items) {
    const tx = pdfjsLib.Util.transform(
      pdfjsLib.Util.transform(viewport.transform, item.transform),
      [1, 0, 0, -1, 0, 0]
    );
    const span = document.createElement('span');
    const fontHeight = Math.hypot(tx[2], tx[3]);
    span.textContent = item.str;
    span.dataset.text = item.str;
    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontHeight}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = 'sans-serif';
    frag.appendChild(span);
  }
  container.appendChild(frag);
}

/**
 * Render a small thumbnail for a page onto the given canvas.
 * @param {number} pageNum
 * @param {HTMLCanvasElement} canvas
 * @param {number} [maxWidth=140]
 */
export async function renderThumbnail(pageNum, canvas, maxWidth = 140) {
  if (!currentPdfDoc) return;
  const page = await currentPdfDoc.getPage(pageNum);
  const baseViewport = page.getViewport({ scale: 1, rotation: viewState.rotation });
  const scale = maxWidth / baseViewport.width;
  const viewport = page.getViewport({ scale, rotation: viewState.rotation });

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
}

/**
 * Extract all text from the document (used for Extract Text feature and search index).
 * @returns {Promise<string[]>} array of page texts (index 0 = page 1)
 */
export async function extractAllText(onProgress) {
  if (!currentPdfDoc) return [];
  const pages = [];
  const total = currentPdfDoc.numPages;
  for (let i = 1; i <= total; i++) {
    const page = await currentPdfDoc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str).join(' ');
    pages.push(text);
    if (onProgress) onProgress(i, total);
  }
  return pages;
}

/**
 * Search across all pages of the document for a query string (case-insensitive).
 * @param {string} query
 * @returns {Promise<{page:number, index:number, snippet:string}[]>}
 */
export async function searchDocument(query) {
  if (!currentPdfDoc || !query.trim()) return [];
  const results = [];
  const lowerQuery = query.toLowerCase();
  const total = currentPdfDoc.numPages;

  for (let i = 1; i <= total; i++) {
    const page = await currentPdfDoc.getPage(i);
    const content = await page.getTextContent();
    const fullText = content.items.map(it => it.str).join(' ');
    const lowerText = fullText.toLowerCase();
    let idx = lowerText.indexOf(lowerQuery);
    while (idx !== -1) {
      const start = Math.max(0, idx - 20);
      const end = Math.min(fullText.length, idx + query.length + 20);
      results.push({ page: i, index: idx, snippet: fullText.slice(start, end) });
      idx = lowerText.indexOf(lowerQuery, idx + query.length);
    }
  }
  return results;
}

/** Adjust zoom scale, clamped between 0.25x and 4x. */
export function setZoom(scale) {
  viewState.scale = Math.max(0.25, Math.min(4, scale));
  return viewState.scale;
}

export function zoomIn() { return setZoom(viewState.scale + 0.25); }
export function zoomOut() { return setZoom(viewState.scale - 0.25); }

/** Rotate viewport by +90 degrees (wraps at 360). */
export function rotateNext() {
  viewState.rotation = (viewState.rotation + 90) % 360;
  return viewState.rotation;
}
