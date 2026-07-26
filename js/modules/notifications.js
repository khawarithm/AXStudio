/**
 * notifications.js
 * Snackbar + global loading overlay controller (Material Design 3 style).
 */

import { qs } from './utils.js';

let snackbarTimer = null;

/**
 * Show a Material 3 snackbar message.
 * @param {string} message
 * @param {{ actionLabel?: string, onAction?: Function, duration?: number }} [opts]
 */
export function showSnackbar(message, opts = {}) {
  const { actionLabel, onAction, duration = 3500 } = opts;
  const snackbar = qs('#snackbar');
  const msgEl = qs('#snackbar-message');
  const actionEl = qs('#snackbar-action');

  msgEl.textContent = message;

  if (actionLabel && onAction) {
    actionEl.textContent = actionLabel;
    actionEl.hidden = false;
    actionEl.onclick = () => {
      onAction();
      hideSnackbar();
    };
  } else {
    actionEl.hidden = true;
    actionEl.onclick = null;
  }

  snackbar.classList.add('visible');
  clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(hideSnackbar, duration);
}

export function hideSnackbar() {
  qs('#snackbar').classList.remove('visible');
}

/**
 * Show/hide the full-screen loading overlay with a label.
 * @param {boolean} visible
 * @param {string} [label]
 */
export function setLoading(visible, label = 'Memuat…') {
  const overlay = qs('#loading-overlay');
  qs('#loading-label').textContent = label;
  overlay.hidden = !visible;
}

/**
 * Update an inline linear progress bar + label (used in Export/Extract panels).
 * @param {string} containerId  e.g. 'export-progress'
 * @param {number} percent 0-100
 * @param {string} label
 */
export function setInlineProgress(containerId, percent, label) {
  const container = qs(`#${containerId}`);
  if (!container) return;
  container.hidden = false;
  const bar = container.querySelector('.linear-progress-bar');
  if (bar) bar.style.width = `${Math.round(percent)}%`;
  const labelEl = container.querySelector('span[id$="-label"]');
  if (labelEl && label) labelEl.textContent = label;
}

export function hideInlineProgress(containerId) {
  const container = qs(`#${containerId}`);
  if (container) container.hidden = true;
}
