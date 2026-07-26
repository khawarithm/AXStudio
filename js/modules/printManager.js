/**
 * printManager.js
 * Handles print preview generation and dispatch to:
 *  - System print dialog (window.print) — also what Android's native
 *    "Print API" hooks into when the PWA is opened inside Chrome/WebView,
 *    since Android exposes the print flow via the browser's print dialog.
 *  - Bluetooth printers via the Web Bluetooth API (ESC/POS raw text/raster).
 *  - USB / USB-OTG printers via the WebUSB API (ESC/POS raw bytes).
 *
 * Renders pages to images first (via exporter.renderPageToDataUrl) so the
 * print output is 100% consistent between preview, system print, and raw
 * printer protocols.
 */

import { getPageCount } from './pdfEngine.js';
import { renderPageToDataUrl } from './exporter.js';
import { showSnackbar } from './notifications.js';

export const PAPER_SIZES = {
  a4: { widthMm: 210, heightMm: 297, label: 'A4' },
  a5: { widthMm: 148, heightMm: 210, label: 'A5' },
  letter: { widthMm: 215.9, heightMm: 279.4, label: 'Letter' },
  thermal58: { widthMm: 58, heightMm: 210, label: 'Thermal 58mm' }, // roll: height is "max", grows with content
  thermal80: { widthMm: 80, heightMm: 297, label: 'Thermal 80mm' },
};

/**
 * Build print-ready data URLs for the given pages at a resolution matched to
 * the chosen paper size (roughly 150 DPI equivalent for crisp thermal output).
 * @param {number[]} pageNumbers
 * @returns {Promise<string[]>}
 */
export async function renderPagesForPrint(pageNumbers) {
  const urls = [];
  for (const num of pageNumbers) {
    const url = await renderPageToDataUrl(num, 2.5);
    urls.push(url);
  }
  return urls;
}

/**
 * Open a hidden iframe containing correctly-sized @page CSS and the
 * rendered page images, then call window.print(). This is what both the
 * desktop system print dialog AND Android's in-browser Print API use,
 * since Android's print flow is triggered through the same window.print().
 * @param {string[]} dataUrls
 * @param {{paperSize:string, orientation:'portrait'|'landscape', marginMm:number}} settings
 */
export function printViaSystem(dataUrls, settings) {
  const { paperSize, orientation, marginMm } = settings;
  const size = PAPER_SIZES[paperSize] || PAPER_SIZES.a4;
  const w = orientation === 'landscape' ? size.heightMm : size.widthMm;
  const h = orientation === 'landscape' ? size.widthMm : size.heightMm;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const imagesHtml = dataUrls
    .map(url => `<div class="print-page"><img src="${url}"></div>`)
    .join('');

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page { size: ${w}mm ${h}mm; margin: ${marginMm}mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .print-page { page-break-after: always; width: 100%; display: flex; align-items: center; justify-content: center; }
        .print-page:last-child { page-break-after: auto; }
        .print-page img { width: 100%; height: auto; display: block; }
      </style>
    </head>
    <body>${imagesHtml}</body>
    </html>
  `);
  doc.close();

  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => iframe.remove(), 1000);
    }, 250);
  };
}

/* ==========================================================================
   Bluetooth Printer Support (Web Bluetooth API)
   Targets common ESC/POS thermal printers exposing a serial-like GATT
   characteristic (widely used pattern: Serial Port Profile over BLE).
   ========================================================================== */

const BLE_PRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb'; // common thermal printer service UUID
const BLE_PRINTER_CHARACTERISTIC = '00002af1-0000-1000-8000-00805f9b34fb';

/**
 * Request and connect to a nearby Bluetooth printer, then send raw ESC/POS
 * commands to print each page as a raster image.
 * @param {string[]} dataUrls
 */
export async function printViaBluetooth(dataUrls) {
  if (!navigator.bluetooth) {
    showSnackbar('Web Bluetooth tidak didukung di browser ini.');
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_PRINTER_SERVICE] }],
      optionalServices: [BLE_PRINTER_SERVICE],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_PRINTER_SERVICE);
    const characteristic = await service.getCharacteristic(BLE_PRINTER_CHARACTERISTIC);

    for (const url of dataUrls) {
      const escPosData = await imageToEscPos(url);
      // Send in chunks; most BLE characteristics cap writes around 512 bytes.
      const chunkSize = 500;
      for (let i = 0; i < escPosData.length; i += chunkSize) {
        await characteristic.writeValue(escPosData.slice(i, i + chunkSize));
      }
    }
    showSnackbar('Berhasil dikirim ke printer Bluetooth.');
  } catch (err) {
    showSnackbar(`Gagal mencetak via Bluetooth: ${err.message}`);
  }
}

/* ==========================================================================
   USB / USB-OTG Printer Support (WebUSB API)
   ========================================================================== */

/**
 * Request and connect to a nearby USB printer (including USB-OTG on Android
 * Chrome), then send raw ESC/POS image data.
 * @param {string[]} dataUrls
 */
export async function printViaUsb(dataUrls) {
  if (!navigator.usb) {
    showSnackbar('WebUSB tidak didukung di browser ini.');
    return;
  }
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    const iface = device.configuration.interfaces[0];
    await device.claimInterface(iface.interfaceNumber);
    const endpoint = iface.alternate.endpoints.find(e => e.direction === 'out');

    for (const url of dataUrls) {
      const escPosData = await imageToEscPos(url);
      await device.transferOut(endpoint.endpointNumber, escPosData);
    }
    await device.close();
    showSnackbar('Berhasil dikirim ke printer USB.');
  } catch (err) {
    showSnackbar(`Gagal mencetak via USB: ${err.message}`);
  }
}

/**
 * Convert an image data URL into a minimal ESC/POS raster print command
 * (GS v 0), suitable for most thermal printers. Downsamples to 1-bit
 * monochrome using a simple threshold.
 * @param {string} dataUrl
 * @param {number} maxWidthPx target raster width in printer dots
 * @returns {Promise<Uint8Array>}
 */
async function imageToEscPos(dataUrl, maxWidthPx = 384) {
  const img = await loadImage(dataUrl);
  const scale = maxWidthPx / img.width;
  const w = maxWidthPx;
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h).data;
  const widthBytes = Math.ceil(w / 8);
  const raster = new Uint8Array(widthBytes * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const gray = (imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3;
      const isBlack = gray < 160;
      if (isBlack) {
        const byteIndex = y * widthBytes + (x >> 3);
        raster[byteIndex] |= 0x80 >> (x % 8);
      }
    }
  }

  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00, // GS v 0 (print raster bit image), mode 0
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
  ]);

  const feed = new Uint8Array([0x0a, 0x0a, 0x0a]); // line feeds after each page
  const out = new Uint8Array(header.length + raster.length + feed.length);
  out.set(header, 0);
  out.set(raster, header.length);
  out.set(feed, header.length + raster.length);
  return out;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
