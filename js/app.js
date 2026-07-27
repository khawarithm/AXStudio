/**
 * app.js
 * AXStudio application entry point. Bootstraps theme, navigation, the PDF
 * engine wiring, all feature panels, and the service worker registration.
 *
 * Architecture:
 *   js/modules/    -> pure logic, no direct DOM ownership beyond what's passed in
 *                      (pdfEngine, exporter, textExtractor, pdfUtilities,
 *                       printManager, bookmarks, theme, notifications, utils)
 *   js/components/ -> DOM controllers that wire a specific view's UI to modules
 *                      (viewerController, fileLoader, navigation, exportPanel,
 *                       extractPanel, utilitiesPanel, printPanel)
 *   js/app.js      -> composition root
 */

import { initTheme, toggleTheme } from './modules/theme.js';
import { qs } from './modules/utils.js';
import { showSnackbar } from './modules/notifications.js';

import { wireNavigation, switchView } from './components/navigation.js';
import { wireFileLoader, setOnFileLoaded } from './components/fileLoader.js';
import { wireViewerToolbar } from './components/viewerController.js';
import { wireExportPanel, refreshExportPreviewOnLoad } from './components/exportPanel.js';
import { wireExtractPanel } from './components/extractPanel.js';
import { wireUtilitiesPanel } from './components/utilitiesPanel.js';
import { wirePrintPanel } from './components/printPanel.js';
import { wireMakerPanel } from './components/makerPanel.js';
import { wireEditorPanel, refreshEditorPageCount } from './components/editorPanel.js';

function init() {
  initTheme();

  wireNavigation();
  wireFileLoader();
  wireViewerToolbar();
  wireExportPanel();
  wireExtractPanel();
  wireUtilitiesPanel();
  wirePrintPanel();
  wireMakerPanel();
  wireEditorPanel();

  setOnFileLoaded(() => {
    refreshEditorPageCount();
    refreshExportPreviewOnLoad();
  });

  qs('#btn-theme-toggle').addEventListener('click', toggleTheme);

  wireMoreMenu();
  revealApp();
  registerServiceWorker();
}

/**
 * The "more" (⋮) button in the top app bar. Kept intentionally simple —
 * a native-feeling quick action rather than a full menu component, since
 * AXStudio's primary actions already live in the sidebar / bottom nav.
 */
function wireMoreMenu() {
  qs('#btn-more').addEventListener('click', () => {
    showSnackbar('AXStudio v1.0 — PDF Viewer, Editor & Print Toolkit', {
      actionLabel: 'Tutup',
      onAction: () => {},
    });
  });
}

function revealApp() {
  const splash = qs('#splash-screen');
  const app = qs('#app');
  app.hidden = false;
  requestAnimationFrame(() => {
    splash.classList.add('fade-out');
    setTimeout(() => splash.remove(), 500);
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
}

// Kick off once DOM is ready (module scripts are deferred by default, so DOM is already parsed).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
