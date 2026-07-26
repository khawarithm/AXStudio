# /libs — Third-Party Libraries

By default `index.html` loads three libraries from the **cdnjs** CDN so the
app works immediately with zero setup:

| Library      | CDN URL used in index.html                                                         | Used for                     |
|--------------|--------------------------------------------------------------------------------------|-------------------------------|
| PDF.js       | `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js`                   | Rendering & parsing PDF       |
| pdf-lib      | `https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js`               | Merge/split/rotate/watermark  |
| Tesseract.js | `https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js`         | OCR on scanned PDFs           |

## Running 100% offline (no CDN)

If you need the app to work with **zero external network calls** (e.g. for an
intranet, a locked-down device, or a stricter PWA offline story):

1. Download the three files above and save them here as:
   - `/libs/pdf.min.js`
   - `/libs/pdf-lib.min.js`
   - `/libs/tesseract.min.js`
2. Also download the PDF.js worker file `pdf.worker.min.js` (same version) into
   `/libs/pdf.worker.min.js`.
3. In `index.html`, change the three `<script src="https://cdnjs...">` tags at
   the bottom of `<body>` to:
   ```html
   <script src="libs/pdf.min.js"></script>
   <script src="libs/pdf-lib.min.js"></script>
   <script src="libs/tesseract.min.js"></script>
   ```
4. In `js/modules/pdfEngine.js`, change the worker source line:
   ```js
   pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
   ```
5. In `service-worker.js`, add the four local paths to `PRECACHE_ASSETS` so
   they're cached for offline use (they are already listed there as CDN URLs;
   just swap to the local paths).

Everything else in the codebase (`js/modules/*`, `js/components/*`) already
references these libraries only through their public globals
(`pdfjsLib`, `PDFLib`, `Tesseract`), so no other code changes are required.
