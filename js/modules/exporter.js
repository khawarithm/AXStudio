/**
 * exporter.js
 * Converts PDF pages into raster images (PNG/JPG) with configurable
 * resolution scale and JPG quality, then packages them for download.
 *
 * - Single page selected  -> downloads that one image directly, named by
 *   its page number (e.g. "3.png").
 * - Multiple pages selected -> bundles all images into a single ZIP file
 *   (built with the dependency-free zipWriter.js), with each entry named
 *   by its page number (e.g. "1.png", "2.png", "3.png").
 */

import { getCurrentDoc } from './pdfEngine.js';
import { downloadBlob } from './utils.js';
import { ZipWriter } from './zipWriter.js';

/**
 * Render a single PDF page to a canvas at a given scale.
 * @param {number} pageNum
 * @param {number} scale
 * @returns {Promise<HTMLCanvasElement>}
 */
async function renderPageToCanvas(pageNum, scale) {
  const doc = getCurrentDoc();
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Convert a canvas to a Blob with the requested format/quality. */
function canvasToBlob(canvas, format, quality) {
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), mime, format === 'jpg' ? quality / 100 : undefined);
  });
}

/** Convert a canvas to raw bytes (Uint8Array) for zipping. */
async function canvasToBytes(canvas, format, quality) {
  const blob = await canvasToBlob(canvas, format, quality);
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Export the given page numbers as images. Single page -> direct download.
 * Multiple pages -> a single ZIP download containing one image per page,
 * each file named after its page number (e.g. "1.png").
 * @param {number[]} pageNumbers 1-based page numbers
 * @param {{format:'png'|'jpg', quality:number, scale:number, baseName:string}} options
 * @param {(done:number, total:number)=>void} onProgress
 */
export async function exportPagesAsImages(pageNumbers, options, onProgress) {
  const { format, quality, scale, baseName } = options;
  const total = pageNumbers.length;
  const ext = format === 'jpg' ? 'jpg' : 'png';

  if (total === 1) {
    const canvas = await renderPageToCanvas(pageNumbers[0], scale);
    const blob = await canvasToBlob(canvas, format, quality);
    downloadBlob(blob, `${pageNumbers[0]}.${ext}`);
    if (onProgress) onProgress(1, 1);
    return;
  }

  const zip = new ZipWriter();
  for (let i = 0; i < total; i++) {
    const pageNum = pageNumbers[i];
    const canvas = await renderPageToCanvas(pageNum, scale);
    const bytes = await canvasToBytes(canvas, format, quality);
    zip.addFile(`${pageNum}.${ext}`, bytes);
    if (onProgress) onProgress(i + 1, total);
  }

  const zipBlob = await zip.generateBlob();
  const safeName = (baseName || 'AXStudio').replace(/[\\/:*?"<>|]/g, '_');
  downloadBlob(zipBlob, `${safeName}_images.zip`);
}

/**
 * Render a single page to a data URL — used by the Print module for previews
 * and by the Export panel's live page-range preview.
 * @param {number} pageNum
 * @param {number} scale
 * @returns {Promise<string>}
 */
export async function renderPageToDataUrl(pageNum, scale = 2) {
  const canvas = await renderPageToCanvas(pageNum, scale);
  return canvas.toDataURL('image/png');
}

/**
 * Render lightweight preview thumbnails for a set of pages (used by the
 * Export panel to show the user which pages their range/number resolves to).
 * @param {number[]} pageNumbers
 * @param {number} [scale=0.6] small scale keeps this fast even for many pages
 * @returns {Promise<{page:number, dataUrl:string}[]>}
 */
export async function renderExportPreview(pageNumbers, scale = 0.6) {
  const results = [];
  for (const pageNum of pageNumbers) {
    const dataUrl = await renderPageToDataUrl(pageNum, scale);
    results.push({ page: pageNum, dataUrl });
  }
  return results;
}
