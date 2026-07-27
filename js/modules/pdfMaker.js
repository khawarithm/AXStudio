/**
 * pdfMaker.js
 * Builds brand-new PDF documents from scratch, either from plain text
 * (with automatic word-wrap + pagination) or from a set of images (one
 * image per page). Built on pdf-lib (global `PDFLib`).
 */

const { PDFDocument, StandardFonts, rgb } = window.PDFLib || {};

export const PAGE_SIZES_PT = {
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
  letter: { width: 612, height: 792 },
};

/**
 * Create a PDF from plain text, automatically word-wrapping and paginating.
 * @param {string} text
 * @param {{pageSize:'a4'|'a5'|'letter', fontSize:number, marginPt:number}} options
 * @returns {Promise<Uint8Array>}
 */
export async function createPdfFromText(text, options) {
  const { pageSize = 'a4', fontSize = 12, marginPt = 56 } = options;
  const { width: pageWidth, height: pageHeight } = PAGE_SIZES_PT[pageSize] || PAGE_SIZES_PT.a4;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lineHeight = fontSize * 1.4;
  const maxWidth = pageWidth - marginPt * 2;
  const maxLinesPerPage = Math.floor((pageHeight - marginPt * 2) / lineHeight);

  // Split on explicit newlines first so paragraph breaks are respected,
  // then word-wrap each paragraph to fit the page width.
  const rawParagraphs = text.split(/\r?\n/);
  const lines = [];
  for (const paragraph of rawParagraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const candidateWidth = font.widthOfTextAtSize(candidate, fontSize);
      if (candidateWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  if (lines.length === 0) lines.push('');

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - marginPt;
  let lineCount = 0;

  for (const line of lines) {
    if (lineCount >= maxLinesPerPage) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - marginPt;
      lineCount = 0;
    }
    page.drawText(line, {
      x: marginPt,
      y: y - fontSize,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= lineHeight;
    lineCount++;
  }

  return doc.save();
}

/**
 * Create a PDF from a list of images, one image per page.
 * @param {File[]} imageFiles
 * @param {{pageSize:'original'|'a4'|'a5'|'letter'}} options
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<Uint8Array>}
 */
export async function createPdfFromImages(imageFiles, options, onProgress) {
  const { pageSize = 'original' } = options;
  const doc = await PDFDocument.create();
  const total = imageFiles.length;

  for (let i = 0; i < total; i++) {
    const file = imageFiles[i];
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);

    let embedded;
    try {
      embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch (err) {
      // Fall back to trying the other format in case the MIME/extension lied.
      embedded = isPng ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    }

    const imgWidth = embedded.width;
    const imgHeight = embedded.height;

    if (pageSize === 'original') {
      const page = doc.addPage([imgWidth, imgHeight]);
      page.drawImage(embedded, { x: 0, y: 0, width: imgWidth, height: imgHeight });
    } else {
      const { width: pageWidth, height: pageHeight } = PAGE_SIZES_PT[pageSize] || PAGE_SIZES_PT.a4;
      const page = doc.addPage([pageWidth, pageHeight]);
      // Fit the image within the page, preserving aspect ratio, centered.
      const scale = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
      const drawWidth = imgWidth * scale;
      const drawHeight = imgHeight * scale;
      page.drawImage(embedded, {
        x: (pageWidth - drawWidth) / 2,
        y: (pageHeight - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
    }

    if (onProgress) onProgress(i + 1, total);
  }

  return doc.save();
}
