/**
 * textExtractor.js
 * Extracts text from the loaded PDF either via PDF.js's native text layer
 * (fast, works for real text-based PDFs) or via Tesseract.js OCR (for
 * scanned / image-only PDFs).
 */

import { getCurrentDoc } from './pdfEngine.js';
import { downloadBlob } from './utils.js';

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

  const zip = new MiniZip();
  zip.addFile('[Content_Types].xml', contentTypesXml);
  zip.addFile('_rels/.rels', relsXml);
  zip.addFile('word/document.xml', documentXml);
  const blob = await zip.generateBlob();
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

/**
 * MiniZip: a tiny dependency-free ZIP (store-only, no compression) writer,
 * sufficient for producing a valid, Word-openable .docx package without
 * pulling in a full zip library.
 */
class MiniZip {
  constructor() {
    this.files = [];
  }

  addFile(name, content) {
    this.files.push({ name, data: new TextEncoder().encode(content) });
  }

  async generateBlob() {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of this.files) {
      const nameBytes = encoder.encode(file.name);
      const crc = crc32(file.data);
      const size = file.data.length;

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, 0, true); // no compression
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, file.data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);

      centralParts.push(centralHeader);
      offset += localHeader.length + file.data.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const part of centralParts) centralSize += part.length;

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.files.length, true);
    ev.setUint16(10, this.files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    ev.setUint16(20, 0, true);

    const blobParts = [...localParts, ...centralParts, end];
    return new Blob(blobParts, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
}

// Standard CRC-32 implementation (needed for valid ZIP local/central headers).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
