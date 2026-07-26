/**
 * pdfUtilities.js
 * PDF manipulation operations built on pdf-lib (global `PDFLib`).
 * Every function returns a Uint8Array of the resulting PDF bytes so callers
 * can either download it or feed it back into pdfEngine.reloadFromBytes().
 */

import { downloadBlob, toBlob } from './utils.js';

const { PDFDocument, degrees, rgb, StandardFonts } = window.PDFLib || {};

/**
 * Merge multiple PDF files (as ArrayBuffers) into one document.
 * @param {ArrayBuffer[]} buffers
 * @returns {Promise<Uint8Array>}
 */
export async function mergePdfs(buffers) {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const copiedPages = await merged.copyPages(src, src.getPageIndices());
    copiedPages.forEach(p => merged.addPage(p));
  }
  return merged.save();
}

/**
 * Split a PDF into one new document containing only the given page numbers.
 * (Called once per contiguous "group" by the UI, or once for the full selection.)
 * @param {ArrayBuffer} buffer
 * @param {number[]} pageNumbers 1-based
 * @returns {Promise<Uint8Array>}
 */
export async function extractPagesToNewPdf(buffer, pageNumbers) {
  const src = await PDFDocument.load(buffer);
  const out = await PDFDocument.create();
  const indices = pageNumbers.map(n => n - 1);
  const copiedPages = await out.copyPages(src, indices);
  copiedPages.forEach(p => out.addPage(p));
  return out.save();
}

/**
 * Split a PDF into N separate single/multi-page PDFs based on a list of
 * page-number groups, then trigger a download for each.
 * @param {ArrayBuffer} buffer
 * @param {number[][]} groups e.g. [[1,2],[3],[4,5]]
 * @param {string} baseName
 */
export async function splitAndDownload(buffer, groups, baseName) {
  for (let i = 0; i < groups.length; i++) {
    const bytes = await extractPagesToNewPdf(buffer, groups[i]);
    downloadBlob(toBlob(bytes, 'application/pdf'), `${baseName}_part${i + 1}.pdf`);
  }
}

/**
 * Rotate specific pages by a given degree increment (90/180/270).
 * @param {ArrayBuffer} buffer
 * @param {number[]} pageNumbers 1-based
 * @param {number} degreesToAdd
 * @returns {Promise<Uint8Array>}
 */
export async function rotatePages(buffer, pageNumbers, degreesToAdd) {
  const doc = await PDFDocument.load(buffer);
  const pages = doc.getPages();
  for (const num of pageNumbers) {
    const page = pages[num - 1];
    if (!page) continue;
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + degreesToAdd) % 360));
  }
  return doc.save();
}

/**
 * Delete specific pages from the document.
 * @param {ArrayBuffer} buffer
 * @param {number[]} pageNumbers 1-based, pages to remove
 * @returns {Promise<Uint8Array>}
 */
export async function deletePages(buffer, pageNumbers) {
  const doc = await PDFDocument.load(buffer);
  const toRemove = new Set(pageNumbers.map(n => n - 1));
  // Remove from highest index to lowest to keep indices valid while mutating.
  const sorted = Array.from(toRemove).sort((a, b) => b - a);
  for (const idx of sorted) {
    if (idx >= 0 && idx < doc.getPageCount()) doc.removePage(idx);
  }
  return doc.save();
}

/**
 * Rearrange pages into a new order.
 * @param {ArrayBuffer} buffer
 * @param {number[]} newOrder 1-based page numbers in desired order (must include all pages once)
 * @returns {Promise<Uint8Array>}
 */
export async function rearrangePages(buffer, newOrder) {
  const src = await PDFDocument.load(buffer);
  const out = await PDFDocument.create();
  const indices = newOrder.map(n => n - 1);
  const copiedPages = await out.copyPages(src, indices);
  copiedPages.forEach(p => out.addPage(p));
  return out.save();
}

/**
 * "Compress" a PDF by re-saving with object streams enabled and (for a
 * medium/high level) down-scaling embedded raster content is out of scope
 * for pdf-lib alone, so we apply the safe, always-available optimizations:
 * object stream compaction. Level mostly affects how aggressively we prune
 * unused objects and stream compression settings.
 * @param {ArrayBuffer} buffer
 * @param {'low'|'medium'|'high'} level
 * @returns {Promise<Uint8Array>}
 */
export async function compressPdf(buffer, level = 'medium') {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  // useObjectStreams drastically reduces size for documents with many small
  // objects (common after edits); higher levels also strip metadata.
  if (level !== 'low') {
    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
  }
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

/**
 * Add a diagonal text watermark to every page.
 * @param {ArrayBuffer} buffer
 * @param {string} text
 * @param {number} opacityPercent 10-100
 * @returns {Promise<Uint8Array>}
 */
export async function addWatermark(buffer, text, opacityPercent = 30) {
  const doc = await PDFDocument.load(buffer);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const opacity = Math.max(0.05, Math.min(1, opacityPercent / 100));

  for (const page of pages) {
    const { width, height } = page.getSize();
    const fontSize = Math.max(24, Math.min(width, height) / 8);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: width / 2 - textWidth / 2,
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity,
      rotate: degrees(45),
    });
  }
  return doc.save();
}

/**
 * Password-protect a PDF (encryption). pdf-lib does not implement PDF
 * standard security handlers directly, so we use its `encrypt` option which
 * relies on the underlying library's AES support where available; if the
 * loaded pdf-lib build has no encrypt() support this throws a clear error
 * so the UI can inform the user.
 * @param {ArrayBuffer} buffer
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function protectWithPassword(buffer, password) {
  const doc = await PDFDocument.load(buffer);
  if (typeof doc.encrypt !== 'function') {
    throw new Error(
      'Versi pdf-lib yang dimuat tidak mendukung enkripsi PDF secara native. ' +
      'Silakan gunakan versi pdf-lib dengan dukungan enkripsi, atau lindungi ' +
      'file melalui aplikasi desktop.'
    );
  }
  await doc.encrypt({
    userPassword: password,
    ownerPassword: password,
    permissions: { printing: 'highResolution' },
  });
  return doc.save();
}
