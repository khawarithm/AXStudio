/**
 * textExtractor.js
 * Extracts text from the loaded PDF either via PDF.js's native text layer
 * (fast, works for real text-based PDFs) or via Tesseract.js OCR (for
 * scanned / image-only PDFs).
 */

import { getCurrentDoc } from './pdfEngine.js';
import { downloadBlob } from './utils.js';
import { ZipWriter } from './zipWriter.js';

/**
 * Extract text natively using PDF.js text content API.
 * @param {(done:number,total:number)=>void} onProgress
 * @returns {Promise<string>} combined text, pages separated by form-feed markers
 */
export async function extractNativeText(onProgress) {
  const doc = getCurrentDoc();
  if (!doc) return '';
  const total = doc.numPages;
  const parts = [];

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');
    parts.push(`----- Halaman ${i} -----\n${pageText}\n`);
    if (onProgress) onProgress(i, total);
  }
  return parts.join('\n');
}

/**
 * Extract text via OCR using Tesseract.js. Renders each page to a canvas
 * at high resolution first (OCR accuracy depends heavily on image DPI).
 * @param {string} lang Tesseract language code, e.g. 'eng', 'ind', 'eng+ind'
 * @param {(done:number,total:number,status:string)=>void} onProgress
 * @returns {Promise<string>}
 */
export async function extractOcrText(lang, onProgress) {
  const doc = getCurrentDoc();
  if (!doc) return '';
  const total = doc.numPages;
  const parts = [];

  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      if (onProgress && m.status && typeof m.progress === 'number') {
        onProgress(null, null, `${m.status} (${Math.round(m.progress * 100)}%)`);
      }
    },
  });

  try {
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      // Higher scale = better OCR accuracy at the cost of speed.
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const { data } = await worker.recognize(canvas);
      parts.push(`----- Halaman ${i} (OCR) -----\n${data.text}\n`);
      if (onProgress) onProgress(i, total, 'Mengenali teks');
    }
  } finally {
    await worker.terminate();
  }

  return parts.join('\n');
}

/** Trigger download of extracted text as a .txt file. */
export function exportAsTxt(text, filename = 'extracted-text.txt') {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, filename);
}

/**
 * Export extracted text as a minimal valid .docx file.
 * Builds the OOXML package manually (no external docx library needed),
 * keeping paragraphs split on blank lines / page markers.
 */
export async function exportAsDocx(text, filename = 'extracted-text.docx') {
  const paragraphs = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const escaped = escapeXml(line);
      return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
    })
    .join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zip = new ZipWriter();
  zip.addFile('[Content_Types].xml', contentTypesXml);
  zip.addFile('_rels/.rels', relsXml);
  zip.addFile('word/document.xml', documentXml);
  const blob = await zip.generateBlob('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  downloadBlob(blob, filename);
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
