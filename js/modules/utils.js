/**
 * utils.js
 * Generic, dependency-free helper functions shared across AXStudio modules.
 */

/**
 * Parse a human page-range string like "1-3,5,7-9" into a sorted, de-duplicated
 * array of 1-based page numbers, clamped to [1, maxPage].
 * @param {string} input
 * @param {number} maxPage
 * @returns {number[]}
 */
export function parsePageRange(input, maxPage) {
  if (!input || !input.trim()) return [];
  const result = new Set();
  const parts = input.split(',').map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(n => parseInt(n.trim(), 10));
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const start = Math.max(1, Math.min(a, b));
      const end = Math.min(maxPage, Math.max(a, b));
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= maxPage) result.add(n);
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

/**
 * Debounce a function call.
 * @param {Function} fn
 * @param {number} delay ms
 */
export function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Format bytes into a human-readable string. */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Convert a Uint8Array/ArrayBuffer to a Blob with the given mime type. */
export function toBlob(data, mime) {
  return new Blob([data], { type: mime });
}

/** Simple query-selector shorthand. */
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Read a File object as ArrayBuffer (Promise-based). */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Clamp a number between min and max. */
export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/** Generate a short unique id (not cryptographically secure, fine for DOM keys). */
export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** Sleep helper for artificial delays / batching UI updates. */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
