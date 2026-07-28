/**
 * printManager.js
 * Handles print preview generation and dispatch to:
 *  - System print dialog (window.print) — also what Android's native
 *    "Print API" hooks into when the PWA is opened inside Chrome/WebView,
 *    since Android exposes the print flow via the browser's print dialog.
 *  - Bluetooth printers via the Web Bluetooth API (ESC/POS raw raster).
 *  - USB / USB-OTG printers via the WebUSB API (ESC/POS raw raster).
 *
 * Renders pages to images first (via exporter.renderPageToDataUrl) so the
 * print output is 100% consistent between preview, system print, and raw
 * printer protocols.
 */

import { renderPageToDataUrl } from './exporter.js';
import { showSnackbar } from './notifications.js';

export const PAPER_SIZES = {
  a4: { widthMm: 210, heightMm: 297, label: 'A4' },
  a5: { widthMm: 148, heightMm: 210, label: 'A5' },
  letter: { widthMm: 215.9, heightMm: 279.4, label: 'Letter' },
  thermal58: { widthMm: 58, heightMm: 210, label: 'Thermal 58mm' }, // roll: height is "max", grows with content
  thermal80: { widthMm: 80, heightMm: 297, label: 'Thermal 80mm' },
};

// ESC/POS raw-printing (Bluetooth/USB) targets thermal receipt printers,
// which almost always run at ~203 DPI. Convert the selected paper width to
// the printer's dot width so raster output matches the roll actually loaded,
// instead of a hardcoded guess.
function dotsWidthForPaper(paperSize) {
  const size = PAPER_SIZES[paperSize] || PAPER_SIZES.thermal58;
  const dpi = 203;
  const dots = Math.round((size.widthMm / 25.4) * dpi);
  // Clamp to common thermal printer head widths so we never send a raster
  // wider than the physical print head supports.
  if (dots <= 384) return 384; // 58mm heads
  return 576; // 80mm heads
}

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
   Shared ESC/POS helpers
   ========================================================================== */

const ESC_INIT = new Uint8Array([0x1b, 0x40]); // ESC @ — reset printer to a known state
const FEED_AND_CUT = new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]); // feed + full cut (GS V 0), ignored harmlessly by printers without a cutter

/**
 * Convert an image data URL into a minimal ESC/POS raster print command
 * (GS v 0), suitable for most thermal printers. Downsamples to 1-bit
 * monochrome using a simple threshold.
 * @param {string} dataUrl
 * @param {number} dotsWidth target raster width in printer dots (matched to paper size)
 * @returns {Promise<Uint8Array>}
 */
async function imageToEscPosRaster(dataUrl, dotsWidth) {
  const img = await loadImage(dataUrl);
  const scale = dotsWidth / img.width;
  const w = dotsWidth;
  const h = Math.max(1, Math.round(img.height * scale));

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

  const out = new Uint8Array(header.length + raster.length);
  out.set(header, 0);
  out.set(raster, header.length);
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

/** Concatenate an array of Uint8Arrays into one. */
function concatBytes(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Build the full byte stream to send to the printer for a print job:
 * init -> raster for each page -> feed + cut.
 */
async function buildEscPosJob(dataUrls, dotsWidth) {
  const parts = [ESC_INIT];
  for (const url of dataUrls) {
    parts.push(await imageToEscPosRaster(url, dotsWidth));
    parts.push(new Uint8Array([0x0a, 0x0a])); // small gap between pages
  }
  parts.push(FEED_AND_CUT);
  return concatBytes(parts);
}

/* ==========================================================================
   Bluetooth Printer Support (Web Bluetooth API)
   Targets common ESC/POS thermal printers exposing a serial-like GATT
   characteristic (widely used pattern: Serial Port Profile over BLE).
   ========================================================================== */

const BLE_PRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb'; // common thermal printer service UUID
const BLE_PRINTER_CHARACTERISTIC = '00002af1-0000-1000-8000-00805f9b34fb';
const BLE_CHUNK_SIZE = 180; // conservative: many BLE characteristics cap writes well below 512 bytes in practice

/**
 * Request and connect to a nearby Bluetooth printer, then send raw ESC/POS
 * commands to print each page as a raster image.
 * @param {string[]} dataUrls
 * @param {string} [paperSize] used to match raster width to the paper loaded
 */
export async function printViaBluetooth(dataUrls, paperSize = 'thermal58') {
  if (!navigator.bluetooth) {
    showSnackbar('Web Bluetooth tidak didukung di browser ini. Gunakan Chrome/Edge di Android atau desktop.');
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

    const dotsWidth = dotsWidthForPaper(paperSize);
    const job = await buildEscPosJob(dataUrls, dotsWidth);

    for (let i = 0; i < job.length; i += BLE_CHUNK_SIZE) {
      const chunk = job.slice(i, i + BLE_CHUNK_SIZE);
      // writeValue rejects on failure, so a resolved promise here is a
      // genuine confirmation the chunk was accepted by the OS Bluetooth stack.
      await characteristic.writeValue(chunk);
    }

    showSnackbar('Berhasil dikirim ke printer Bluetooth.');
  } catch (err) {
    console.error(err);
    showSnackbar(`Gagal mencetak via Bluetooth: ${err.message}`);
  }
}

/* ==========================================================================
   USB / USB-OTG Printer Support (WebUSB API)
   ========================================================================== */

const USB_CHUNK_SIZE = 4096; // stay well under common USB transfer/packet limits

/**
 * Find the first interface (and its currently-active alternate) exposing a
 * bulk OUT endpoint — this is the actual "print data" pipe on virtually all
 * USB thermal printers. Earlier code blindly used interfaces[0], which is
 * NOT always the printer's data interface on composite/multi-interface
 * devices, and silently sent bytes nowhere.
 * @param {USBDevice} device
 * @returns {{interfaceNumber:number, endpointNumber:number} | null}
 */
function findBulkOutEndpoint(device) {
  const config = device.configuration;
  if (!config) return null;

  for (const iface of config.interfaces) {
    const alt = iface.alternate;
    if (!alt || !alt.endpoints) continue;
    const outEndpoint = alt.endpoints.find(
      (e) => e.direction === 'out' && e.type === 'bulk'
    );
    if (outEndpoint) {
      return { interfaceNumber: iface.interfaceNumber, endpointNumber: outEndpoint.endpointNumber };
    }
  }
  return null;
}

/**
 * Request and connect to a nearby USB printer (including USB-OTG on Android
 * Chrome), then send raw ESC/POS image data.
 *
 * Fixes over the previous implementation:
 *  - Actually searches every interface/alternate for a bulk OUT endpoint
 *    instead of assuming interfaces[0] is the printer's data pipe.
 *  - Sends an ESC/POS init command before the raster data so the printer
 *    starts from a known state.
 *  - Chunks the transfer and checks `result.status === 'ok'` on every
 *    chunk, so a silent/failed transfer is reported as an error instead of
 *    a false "success".
 *  - Uses a raster width matched to the selected paper size.
 *
 * @param {string[]} dataUrls
 * @param {string} [paperSize]
 */
export async function printViaUsb(dataUrls, paperSize = 'thermal58') {
  if (!navigator.usb) {
    showSnackbar('WebUSB tidak didukung di browser ini. Gunakan Chrome/Edge (Android mendukung USB-OTG).');
    return;
  }

  let device;
  try {
    device = await navigator.usb.requestDevice({ filters: [] });
  } catch (err) {
    // User cancelled the device picker, or no device matched.
    showSnackbar('Tidak ada printer USB yang dipilih.');
    return;
  }

  try {
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const endpointInfo = findBulkOutEndpoint(device);
    if (!endpointInfo) {
      throw new Error(
        'Tidak ditemukan endpoint data (bulk OUT) pada perangkat ini. ' +
        'Pastikan perangkat yang dipilih benar-benar printer thermal ESC/POS.'
      );
    }

    try {
      await device.claimInterface(endpointInfo.interfaceNumber);
    } catch (claimErr) {
      throw new Error(
        'Gagal mengklaim interface USB printer. Kemungkinan interface sudah ' +
        'dipakai oleh driver sistem operasi (umum terjadi di Windows/macOS/Linux ' +
        'untuk printer yang sudah terpasang driver bawaan). WebUSB umumnya hanya ' +
        'bekerja untuk printer thermal mentah tanpa driver OS, atau melalui ' +
        'USB-OTG di Android. Detail: ' + claimErr.message
      );
    }

    const dotsWidth = dotsWidthForPaper(paperSize);
    const job = await buildEscPosJob(dataUrls, dotsWidth);

    for (let i = 0; i < job.length; i += USB_CHUNK_SIZE) {
      const chunk = job.slice(i, i + USB_CHUNK_SIZE);
      const result = await device.transferOut(endpointInfo.endpointNumber, chunk);
      if (result.status !== 'ok') {
        throw new Error(`Transfer USB gagal dengan status "${result.status}".`);
      }
    }

    try {
      await device.releaseInterface(endpointInfo.interfaceNumber);
    } catch {
      // Non-fatal — device may already be releasing/closing.
    }
    await device.close();

    showSnackbar('Berhasil dikirim ke printer USB.');
  } catch (err) {
    console.error(err);
    showSnackbar(`Gagal mencetak via USB: ${err.message}`);
    try { await device.close(); } catch { /* already closed */ }
  }
}
