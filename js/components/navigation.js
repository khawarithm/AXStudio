/**
 * navigation.js
 * Controls which "view" (section) is active, keeps sidebar nav + bottom nav
 * in sync, and handles the mobile drawer open/close + scrim.
 */

import { qs, qsa } from '../modules/utils.js';
import { getCurrentDoc } from '../modules/pdfEngine.js';
import { showSnackbar } from '../modules/notifications.js';

const VIEW_TITLES = {
  viewer: null, // uses doc name instead
  export: 'Export ke Gambar',
  extract: 'Ekstrak Teks',
  utilities: 'Utilitas PDF',
  print: 'Print',
};

let currentView = 'viewer';

export function switchView(viewName) {
  const requiresDoc = ['viewer', 'export', 'extract', 'utilities', 'print'];
  if (requiresDoc.includes(viewName) && !getCurrentDoc()) {
    showSnackbar('Buka file PDF terlebih dahulu.');
    viewName = 'viewer';
    if (!getCurrentDoc()) {
      qsa('.view').forEach(v => v.classList.remove('active'));
      qs('#view-empty').classList.add('active');
      syncNavHighlight('viewer');
      closeDrawer();
      return;
    }
  }

  currentView = viewName;
  qsa('.view').forEach(v => v.classList.remove('active'));
  const target = qs(`#view-${viewName}`);
  if (target) target.classList.add('active');

  const titleEl = qs('#current-doc-name');
  if (VIEW_TITLES[viewName]) {
    titleEl.textContent = VIEW_TITLES[viewName];
  } else if (getCurrentDoc()) {
    titleEl.textContent = qs('#current-doc-name').dataset.fileName || 'AXStudio';
  }

  syncNavHighlight(viewName);
  closeDrawer();
}

function syncNavHighlight(viewName) {
  qsa('.nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });
  qsa('.bottom-nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });
}

function openDrawer() {
  qs('#sidebar').classList.add('open');
  qs('#scrim').classList.add('visible');
}
function closeDrawer() {
  qs('#sidebar').classList.remove('open');
  qs('#scrim').classList.remove('visible');
}

export function wireNavigation() {
  qsa('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.view));
  });
  qsa('.bottom-nav-item[data-view]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.view));
  });

  qs('#btn-menu').addEventListener('click', openDrawer);
  qs('#scrim').addEventListener('click', closeDrawer);
}

export function getCurrentView() {
  return currentView;
}
