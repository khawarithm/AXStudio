/**
 * pdfEditor.js
 * Bakes a list of canvas-space annotation "elements" (text, freehand paths,
 * rectangles, ellipses, images) into a specific page of a PDF using pdf-lib,
 * translating the editor's on-screen canvas coordinates into the page's PDF
 * point coordinate space (which is bottom-left-origin, unlike canvas's
 * top-left-origin).
 */

const { PDFDocument, rgb, StandardFonts } = window.PDFLib || {};

/** Convert a "#rrggbb" hex color string into a pdf-lib rgb() color. */
export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
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

  const { width: pdfWidth, height: pdfHeight } = page.getSize();
  const scaleX = pdfWidth / canvasCssWidth;
  const scaleY = pdfHeight / canvasCssHeight;

  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Canvas Y grows downward; PDF Y grows upward. Flip accordingly.
  const toPdfX = (x) => x * scaleX;
  const toPdfY = (y) => pdfHeight - y * scaleY;

  for (const el of elements) {
    switch (el.type) {
      case 'text': {
        const pdfFontSize = el.fontSize * ((scaleX + scaleY) / 2);
        page.drawText(el.text, {
          x: toPdfX(el.x),
          y: toPdfY(el.y) - pdfFontSize,
          size: pdfFontSize,
          font,
          color: hexToRgb(el.color),
        });
        break;
      }
      case 'draw': {
        const width = Math.max(0.5, el.lineWidth * ((scaleX + scaleY) / 2));
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
          borderWidth: Math.max(0.5, el.lineWidth * ((scaleX + scaleY) / 2)),
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
          borderWidth: Math.max(0.5, el.lineWidth * ((scaleX + scaleY) / 2)),
        });
        break;
      }
      case 'image': {
        const isPng = el.mimeType === 'image/png';
        const bytes = dataUrlToBytes(el.dataUrl);
        const embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const w = el.width * scaleX;
        const h = el.height * scaleY;
        page.drawImage(embedded, {
          x: toPdfX(el.x),
          y: toPdfY(el.y) - h,
          width: w,
          height: h,
        });
        break;
      }
      default:
        break;
    }
  }

  return doc.save();
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
