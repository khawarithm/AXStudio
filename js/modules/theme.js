/**
 * theme.js
 * Handles Light / Dark theme switching + persistence in localStorage.
 */

import { qs } from './utils.js';

const STORAGE_KEY = 'axstudio_theme';

/** Initialize theme based on saved preference or system preference. */
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

/** Apply a given theme ('light' | 'dark') to the document + update icon. */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
  const icon = qs('#theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';

  const metaTheme = qs('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#1C1B1F' : '#6750A4');
  }
}

/** Toggle between light and dark theme. */
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}
