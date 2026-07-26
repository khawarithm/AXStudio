/**
 * extractPanel.js
 * Wires the "Extract Text" view UI to textExtractor.js, including the OCR
 * toggle and language picker for scanned PDFs.
 */

import { qs } from '../modules/utils.js';
import { getCurrentFileName, getPageCount } from '../modules/pdfEngine.js';
import { extractNativeText, extractOcrText, exportAsTxt, exportAsDocx } from '../modules/textExtractor.js';
import { showSnackbar, setInlineProgress, hideInlineProgress } from '../modules/notifications.js';

let lastExtractedText = '';

export function wireExtractPanel() {
  const ocrToggle = qs('#extract-ocr-toggle');
  const ocrLangRow = qs('#ocr-lang-row');

  ocrToggle.addEventListener('change', () => {
    ocrLangRow.hidden = !ocrToggle.checked;
  });

  qs('#btn-extract-text').addEventListener('click', async () => {
    if (getPageCount() === 0) {
      showSnackbar('Tidak ada dokumen yang dimuat.');
      return;
    }

    const useOcr = ocrToggle.checked;
    const lang = qs('#ocr-lang').value;

    setInlineProgress('extract-progress', 0, useOcr ? 'Mempersiapkan OCR…' : 'Memproses…');
    qs('#extract-result').hidden = true;

    try {
      let text;
      if (useOcr) {
        text = await extractOcrText(lang, (done, total, status) => {
          if (done && total) {
            setInlineProgress('extract-progress', (done / total) * 100, `Halaman ${done}/${total} — ${status || ''}`);
          } else if (status) {
            setInlineProgress('extract-progress', 0, status);
          }
        });
      } else {
        text = await extractNativeText((done, total) => {
          setInlineProgress('extract-progress', (done / total) * 100, `Halaman ${done}/${total}`);
        });
      }

      lastExtractedText = text;
      qs('#extract-textarea').value = text;
      qs('#extract-result').hidden = false;

      if (!useOcr && text.replace(/-----.*?-----/g, '').trim().length < 20) {
        showSnackbar('Teks minim terdeteksi — PDF ini mungkin hasil scan. Coba aktifkan OCR.', {
          actionLabel: 'Aktifkan OCR',
          onAction: () => { ocrToggle.checked = true; ocrLangRow.hidden = false; },
        });
      } else {
        showSnackbar('Ekstraksi teks selesai.');
      }
    } catch (err) {
      console.error(err);
      showSnackbar('Gagal mengekstrak teks.');
    } finally {
      hideInlineProgress('extract-progress');
    }
  });

  qs('#btn-copy-text').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastExtractedText);
      showSnackbar('Teks disalin ke clipboard.');
    } catch {
      // Fallback for browsers without Clipboard API permission
      const textarea = qs('#extract-textarea');
      textarea.select();
      document.execCommand('copy');
      showSnackbar('Teks disalin ke clipboard.');
    }
  });

  qs('#btn-export-txt').addEventListener('click', () => {
    const baseName = getCurrentFileName().replace(/\.pdf$/i, '');
    exportAsTxt(lastExtractedText, `${baseName}.txt`);
  });

  qs('#btn-export-docx').addEventListener('click', async () => {
    const baseName = getCurrentFileName().replace(/\.pdf$/i, '');
    await exportAsDocx(lastExtractedText, `${baseName}.docx`);
  });
}
