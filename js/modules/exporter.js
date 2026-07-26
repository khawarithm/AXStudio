/**
 * exporter.js
 * Converts PDF pages into raster images (PNG/JPG) with configurable
 * resolution scale and JPG quality, then packages them for download.
 *
 * For a single page, downloads the image directly.
 * For multiple pages, downloads each as a separate file in quick succession
 * (avoids needing an extra zip dependency, keeping the "no framework / lean
 * deps" requirement while still giving the user every requested page).
 */

import { getCurrentDoc } from './pdfEngine.js';
import { downloadBlob, sleep } from './utils.js';

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

/**
 * Export the given page numbers as images.
 * @param {number[]} pageNumbers 1-based page numbers
 * @param {{format:'png'|'jpg', quality:number, scale:number, baseName:string}} options
 * @param {(done:number, total:number)=>void} onProgress
 */
export async function exportPagesAsImages(pageNumbers, options, onProgress) {
  const { format, quality, scale, baseName } = options;
  const total = pageNumbers.length;

  for (let i = 0; i < total; i++) {
    const pageNum = pageNumbers[i];
    const canvas = await renderPageToCanvas(pageNum, scale);
    const blob = await canvasToBlob(canvas, format, quality);
    const ext = format === 'jpg' ? 'jpg' : 'png';
    downloadBlob(blob, `${baseName}_page${pageNum}.${ext}`);
    if (onProgress) onProgress(i + 1, total);
    // small delay so browsers don't block rapid-fire downloads as popups
    await sleep(180);
  }
}

/**
 * Render a single page to a data URL — used by the Print module for previews.
 * @param {number} pageNum
 * @param {number} scale
 * @returns {Promise<string>}
 */
export async function renderPageToDataUrl(pageNum, scale = 2) {
  const canvas = await renderPageToCanvas(pageNum, scale);
  return canvas.toDataURL('image/png');
}
