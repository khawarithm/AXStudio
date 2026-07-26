/**
 * bookmarks.js
 * Persists "last read page" and manual bookmarks per document using
 * localStorage. Documents are identified by a lightweight fingerprint
 * (name + byte length) since we don't have a stable file path in the browser.
 */

const STORAGE_KEY = 'axstudio_bookmarks';

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Build a stable-ish key for a document. */
export function makeDocKey(fileName, byteLength) {
  return `${fileName}__${byteLength}`;
}

/** Save the last-viewed page number for a document. */
export function setLastPage(docKey, pageNum) {
  const store = loadStore();
  store[docKey] = store[docKey] || {};
  store[docKey].lastPage = pageNum;
  saveStore(store);
}

/** Retrieve the last-viewed page for a document (or null). */
export function getLastPage(docKey) {
  const store = loadStore();
  return store[docKey]?.lastPage ?? null;
}

/** Toggle a manual bookmark on a specific page; returns new bookmarked state. */
export function toggleBookmark(docKey, pageNum) {
  const store = loadStore();
  store[docKey] = store[docKey] || {};
  store[docKey].marks = store[docKey].marks || [];
  const idx = store[docKey].marks.indexOf(pageNum);
  let isBookmarked;
  if (idx === -1) {
    store[docKey].marks.push(pageNum);
    isBookmarked = true;
  } else {
    store[docKey].marks.splice(idx, 1);
    isBookmarked = false;
  }
  saveStore(store);
  return isBookmarked;
}

/** Check if a page is bookmarked. */
export function isBookmarked(docKey, pageNum) {
  const store = loadStore();
  return (store[docKey]?.marks || []).includes(pageNum);
}

/** Get all bookmarked pages for a document. */
export function getBookmarks(docKey) {
  const store = loadStore();
  return store[docKey]?.marks || [];
}
