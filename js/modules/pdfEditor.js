/**
 * pdfEditor.js
 * Bakes a list of canvas-space annotation "elements" (text, freehand paths,
 * rectangles, ellipses, images) into a specific page of a PDF using pdf-lib,
 * translating the editor's on-screen canvas coordinates into the page's PDF
 * point coordinate space (which is bottom-left-origin, unlike canvas's
 * top-left-origin).
 */

const { PDFDocument, rgb, StandardFonts } = window.PDFLib || {};

/** Maps the editor's font-family keys to pdf-lib StandardFonts (normal + bold variants). */
const FONT_MAP = {
  helvetica: { normal: StandardFonts?.Helvetica, bold: StandardFonts?.HelveticaBold },
  times: { normal: StandardFonts?.TimesRoman, bold: StandardFonts?.TimesRomanBold },
  courier: { normal: StandardFonts?.Courier, bold: StandardFonts?.CourierBold },
};

/** Convert a "#rrggbb" hex color string into a pdf-lib rgb() color. */
export function hexToRgb(hex) {
  const clean = (hex || '#000000').replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/**
 * Embed every font/weight combination the editor can produce, once per
 * document, and return a small lookup helper. Embedding is cheap for
 * StandardFonts (no font file to parse), so doing all 6 upfront is fine.
 * @param {import('pdf-lib').PDFDocument} doc
 */
export async function buildFontCache(doc) {
  const cache = {};
  for (const family of Object.keys(FONT_MAP)) {
    cache[family] = {
      normal: await doc.embedFont(FONT_MAP[family].normal),
      bold: await doc.embedFont(FONT_MAP[family].bold),
    };
  }
  return cache;
}

function getFont(cache, family, bold) {
  const entry = cache[family] || cache.helvetica;
  return bold ? entry.bold : entry.normal;
}

/**
 * Draw a full list of annotation elements (created in canvas/CSS-pixel
 * space) onto a single pdf-lib page, given the CSS size the editor canvas
 * was displayed at (for coordinate scaling).
 * @param {import('pdf-lib').PDFPage} page
 * @param {Array<object>} elements
 * @param {number} canvasCssWidth
 * @param {number} canvasCssHeight
 * @param {object} fontCache result of buildFontCache()
 */
export function drawElementsOnPage(page, elements, canvasCssWidth, canvasCssHeight, fontCache) {
  const { width: pdfWidth, height: pdfHeight } = page.getSize();
  const scaleX = pdfWidth / canvasCssWidth;
  const scaleY = pdfHeight / canvasCssHeight;
  const avgScale = (scaleX + scaleY) / 2;

  // Canvas Y grows downward; PDF Y grows upward. Flip accordingly.
  const toPdfX = (x) => x * scaleX;
  const toPdfY = (y) => pdfHeight - y * scaleY;

  for (const el of elements) {
    switch (el.type) {
      case 'text': {
        const pdfFontSize = el.fontSize * avgScale;
        const font = getFont(fontCache, el.fontFamily || 'helvetica', !!el.bold);
        const color = hexToRgb(el.color);
        const x = toPdfX(el.x);
        const y = toPdfY(el.y) - pdfFontSize;

        page.drawText(el.text, { x, y, size: pdfFontSize, font, color });

        if (el.underline) {
          const textWidth = font.widthOfTextAtSize(el.text, pdfFontSize);
          const underlineY = y - pdfFontSize * 0.08;
          page.drawLine({
            start: { x, y: underlineY },
            end: { x: x + textWidth, y: underlineY },
            thickness: Math.max(0.6, pdfFontSize * 0.05),
            color,
          });
        }
        break;
      }
      case 'draw': {
        const width = Math.max(0.5, el.lineWidth * avgScale);
        for (let i = 1; i < el.points.length; i++) {
          const a = el.points[i - 1];
          const b = el.points[i];
          page.drawLine({
            start: { x: toPdfX(a.x), y: toPdfY(a.y) },
            end: { x: toPdfX(b.x), y: toPdfY(b.y) },
            thickness: width,
            color: hexToRgb(el.color),
          });
        }
        break;
      }
      case 'rect': {
        const x0 = toPdfX(Math.min(el.x1, el.x2));
        const y0 = toPdfY(Math.max(el.y1, el.y2));
        const w = Math.abs(el.x2 - el.x1) * scaleX;
        const h = Math.abs(el.y2 - el.y1) * scaleY;
        page.drawRectangle({
          x: x0,
          y: y0,
          width: w,
          height: h,
          borderColor: hexToRgb(el.color),
          borderWidth: Math.max(0.5, el.lineWidth * avgScale),
        });
        break;
      }
      case 'ellipse': {
        const cx = toPdfX((el.x1 + el.x2) / 2);
        const cy = toPdfY((el.y1 + el.y2) / 2);
        const xScale = Math.abs(el.x2 - el.x1) / 2 * scaleX;
        const yScale = Math.abs(el.y2 - el.y1) / 2 * scaleY;
        page.drawEllipse({
          x: cx,
          y: cy,
          xScale,
          yScale,
          borderColor: hexToRgb(el.color),
          borderWidth: Math.max(0.5, el.lineWidth * avgScale),
        });
        break;
      }
      case 'image': {
        // Images are embedded asynchronously elsewhere (applyEditsToPage),
        // this synchronous drawing pass expects el.__embedded to already be set.
        if (el.__embedded) {
          const w = el.width * scaleX;
          const h = el.height * scaleY;
          page.drawImage(el.__embedded, {
            x: toPdfX(el.x),
            y: toPdfY(el.y) - h,
            width: w,
            height: h,
          });
        }
        break;
      }
      default:
        break;
    }
  }
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Apply a list of annotation elements (created in canvas/CSS-pixel space)
 * onto a single page of the given PDF, then return the mutated document's
 * bytes.
 *
 * @param {ArrayBuffer} buffer original PDF bytes
 * @param {number} pageNum 1-based page index to edit
 * @param {number} canvasCssWidth width (in CSS px) the editor canvas was displayed at
 * @param {number} canvasCssHeight height (in CSS px) the editor canvas was displayed at
 * @param {Array<object>} elements annotation elements, see editorPanel.js for shapes
 * @returns {Promise<Uint8Array>}
 */
export async function applyEditsToPage(buffer, pageNum, canvasCssWidth, canvasCssHeight, elements) {
  const doc = await PDFDocument.load(buffer);
  const page = doc.getPages()[pageNum - 1];
  if (!page) throw new Error('Halaman tidak ditemukan.');

  const fontCache = await buildFontCache(doc);

  // Pre-embed any image elements (async), storing the embedded image object
  // directly on the element so drawElementsOnPage can stay synchronous.
  for (const el of elements) {
    if (el.type === 'image' && !el.__embedded) {
      const isPng = el.mimeType === 'image/png';
      const bytes = dataUrlToBytes(el.dataUrl);
      el.__embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    }
  }

  drawElementsOnPage(page, elements, canvasCssWidth, canvasCssHeight, fontCache);

  return doc.save();
}
