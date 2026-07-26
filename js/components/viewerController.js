/**
 * viewerController.js
 * Wires up the PDF Viewer UI: continuous scroll rendering, zoom, rotate,
 * thumbnails panel, text search with highlighting, and last-page bookmark.
 */

import {
  getCurrentDoc, getPageCount, renderPage, renderThumbnail,
  viewState, setZoom, zoomIn, zoomOut, rotateNext, searchDocument, getCurrentFileName,
} from '../modules/pdfEngine.js';
import { qs, qsa, debounce } from '../modules/utils.js';
import { showSnackbar } from '../modules/notifications.js';
import * as bookmarks from '../modules/bookmarks.js';

let docKey = null;
let searchResults = [];
let searchIndex = -1;
let renderedPages = new Map(); // pageNum -> { container, canvas, textLayer }

/** Called once after a new PDF is loaded — builds the full page list + thumbnails. */
export async function initViewerForDocument(fileSizeBytes) {
  const doc = getCurrentDoc();
  if (!doc) return;

  docKey = bookmarks.makeDocKey(getCurrentFileName(), fileSizeBytes);
  renderedPages.clear();
  qs('#pdf-pages').innerHTML = '';
  qs('#thumbnail-list').innerHTML = '';

  const pageCount = getPageCount();
  qs('#page-count').textContent = pageCount;
  qs('#page-input').max = pageCount;

  await renderAllPages();
  await buildThumbnails();
  updateZoomLabel();
  updateBookmarkIcon();

  // Resume from last bookmarked page, if any.
  const lastPage = bookmarks.getLastPage(docKey);
  if (lastPage && lastPage > 1 && lastPage <= pageCount) {
    scrollToPage(lastPage);
    showSnackbar(`Melanjutkan dari halaman ${lastPage}`, {
      actionLabel: 'Ke Awal',
      onAction: () => scrollToPage(1),
    });
  }

  setupScrollBookmarkTracking();
}

async function renderAllPages() {
  const container = qs('#pdf-pages');
  const pageCount = getPageCount();

  for (let i = 1; i <= pageCount; i++) {
    const pageWrap = document.createElement('div');
    pageWrap.className = 'pdf-page-container';
    pageWrap.dataset.page = i;

    const canvas = document.createElement('canvas');
    const textLayer = document.createElement('div');
    textLayer.className = 'text-layer';

    const tag = document.createElement('div');
    tag.className = 'pdf-page-number-tag';
    tag.textContent = `Halaman ${i} / ${pageCount}`;

    pageWrap.appendChild(canvas);
    pageWrap.appendChild(textLayer);
    pageWrap.appendChild(tag);
    container.appendChild(pageWrap);

    renderedPages.set(i, { container: pageWrap, canvas, textLayer });
  }

  // Render pages progressively (lazy-ish: render first 3 immediately, rest via IntersectionObserver).
  const priorityPages = Math.min(3, pageCount);
  for (let i = 1; i <= priorityPages; i++) {
    await renderPage(i, renderedPages.get(i).canvas, renderedPages.get(i).textLayer);
  }
  setupLazyRendering(priorityPages + 1, pageCount);
}

function setupLazyRendering(fromPage, toPage) {
  if (fromPage > toPage) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        const { canvas, textLayer } = renderedPages.get(pageNum);
        if (canvas.width === 0) {
          renderPage(pageNum, canvas, textLayer);
        }
      }
    }
  }, { root: qs('#viewer-canvas-wrap'), rootMargin: '600px 0px' });

  for (let i = fromPage; i <= toPage; i++) {
    observer.observe(renderedPages.get(i).container);
  }
}

async function rerenderVisiblePages() {
  // Re-render every already-rendered page at the new zoom/rotation.
  for (const [pageNum, { canvas, textLayer }] of renderedPages.entries()) {
    if (canvas.width > 0) {
      await renderPage(pageNum, canvas, textLayer);
    }
  }
}

async function buildThumbnails() {
  const list = qs('#thumbnail-list');
  const pageCount = getPageCount();

  for (let i = 1; i <= pageCount; i++) {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.dataset.page = i;

    const canvas = document.createElement('canvas');
    const label = document.createElement('span');
    label.className = 'thumb-label';
    label.textContent = i;

    item.appendChild(canvas);
    item.appendChild(label);
    list.appendChild(item);

    item.addEventListener('click', () => scrollToPage(i));

    // Render thumbnail lazily too, to avoid blocking on huge documents.
    renderThumbnail(i, canvas).catch(() => {});
  }
}

export function scrollToPage(pageNum) {
  const entry = renderedPages.get(pageNum);
  if (!entry) return;
  if (entry.canvas.width === 0) {
    renderPage(pageNum, entry.canvas, entry.textLayer);
  }
  entry.container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  qs('#page-input').value = pageNum;
  viewState.currentPage = pageNum;
  highlightActiveThumbnail(pageNum);
}

function highlightActiveThumbnail(pageNum) {
  qsa('.thumbnail-item').forEach(el => el.classList.remove('active'));
  const active = qs(`.thumbnail-item[data-page="${pageNum}"]`);
  if (active) active.classList.add('active');
}

function setupScrollBookmarkTracking() {
  const wrap = qs('#viewer-canvas-wrap');
  const onScroll = debounce(() => {
    const pages = qsa('.pdf-page-container');
    const wrapRect = wrap.getBoundingClientRect();
    let closestPage = 1;
    let closestDist = Infinity;
    for (const p of pages) {
      const rect = p.getBoundingClientRect();
      const dist = Math.abs(rect.top - wrapRect.top);
      if (dist < closestDist) {
        closestDist = dist;
        closestPage = parseInt(p.dataset.page, 10);
      }
    }
    viewState.currentPage = closestPage;
    qs('#page-input').value = closestPage;
    highlightActiveThumbnail(closestPage);
    if (docKey) bookmarks.setLastPage(docKey, closestPage);
    updateBookmarkIcon();
  }, 200);

  wrap.addEventListener('scroll', onScroll);
}

function updateZoomLabel() {
  qs('#zoom-label').textContent = `${Math.round(viewState.scale * 100)}%`;
}

function updateBookmarkIcon() {
  if (!docKey) return;
  const icon = qs('#btn-bookmark .material-icon');
  const marked = bookmarks.isBookmarked(docKey, viewState.currentPage);
  icon.textContent = marked ? 'bookmark' : 'bookmark_border';
}

/* ==========================================================================
   Toolbar Event Wiring
   ========================================================================== */

export function wireViewerToolbar() {
  qs('#btn-zoom-in').addEventListener('click', async () => {
    zoomIn();
    updateZoomLabel();
    await rerenderVisiblePages();
  });

  qs('#btn-zoom-out').addEventListener('click', async () => {
    zoomOut();
    updateZoomLabel();
    await rerenderVisiblePages();
  });

  qs('#btn-rotate').addEventListener('click', async () => {
    rotateNext();
    await rerenderVisiblePages();
  });

  qs('#page-input').addEventListener('change', (e) => {
    const num = parseInt(e.target.value, 10);
    const max = getPageCount();
    if (num >= 1 && num <= max) scrollToPage(num);
    else e.target.value = viewState.currentPage;
  });

  qs('#btn-bookmark').addEventListener('click', () => {
    if (!docKey) return;
    const marked = bookmarks.toggleBookmark(docKey, viewState.currentPage);
    updateBookmarkIcon();
    showSnackbar(marked ? `Halaman ${viewState.currentPage} ditandai` : 'Bookmark dihapus');
  });

  qs('#btn-toggle-thumbnails').addEventListener('click', () => {
    qs('#thumbnail-panel').classList.toggle('visible');
  });
  qs('#btn-close-thumbnails').addEventListener('click', () => {
    qs('#thumbnail-panel').classList.remove('visible');
  });

  wireSearch();
}

function wireSearch() {
  const searchBar = qs('#search-bar');
  const searchInput = qs('#search-input');

  qs('#btn-search').addEventListener('click', () => {
    searchBar.hidden = false;
    searchInput.focus();
  });
  qs('#btn-search-close').addEventListener('click', () => {
    searchBar.hidden = true;
    clearHighlights();
  });

  const doSearch = debounce(async () => {
    const query = searchInput.value.trim();
    clearHighlights();
    if (!query) {
      qs('#search-count').textContent = '';
      return;
    }
    searchResults = await searchDocument(query);
    searchIndex = searchResults.length > 0 ? 0 : -1;
    qs('#search-count').textContent = searchResults.length > 0
      ? `${searchIndex + 1}/${searchResults.length}`
      : 'Tidak ditemukan';
    if (searchResults.length > 0) {
      await highlightAndJump(query);
    }
  }, 350);

  searchInput.addEventListener('input', doSearch);

  qs('#btn-search-next').addEventListener('click', () => navigateSearch(1, searchInput.value));
  qs('#btn-search-prev').addEventListener('click', () => navigateSearch(-1, searchInput.value));
}

async function navigateSearch(direction, query) {
  if (searchResults.length === 0) return;
  searchIndex = (searchIndex + direction + searchResults.length) % searchResults.length;
  qs('#search-count').textContent = `${searchIndex + 1}/${searchResults.length}`;
  await highlightAndJump(query);
}

async function highlightAndJump(query) {
  const result = searchResults[searchIndex];
  if (!result) return;
  scrollToPage(result.page);
  // Ensure the page is rendered before we try to highlight its text layer spans.
  const entry = renderedPages.get(result.page);
  if (entry.canvas.width === 0) {
    await renderPage(result.page, entry.canvas, entry.textLayer);
  }
  clearHighlights();
  const spans = qsa('span', entry.textLayer);
  const lowerQuery = query.toLowerCase();
  spans.forEach(span => {
    if ((span.dataset.text || '').toLowerCase().includes(lowerQuery)) {
      span.classList.add('search-highlight');
    }
  });
}

function clearHighlights() {
  qsa('.search-highlight').forEach(el => el.classList.remove('search-highlight', 'current'));
}

export function getDocKey() {
  return docKey;
}
