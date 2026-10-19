/* Settings and reading history, kept in the webview's local storage under "virgil:". */
const PREFIX = "virgil:";

/** Keys a document's saved position: the same text under the same title. */
export const docKey = (title, words) => `${title}\u0000${words}`;

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
  },
  /** Returns false if the value couldn't be stored (quota exceeded or storage blocked). */
  set(key, value) { try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true } catch { return false } },
  del(key) { try { localStorage.removeItem(PREFIX + key) } catch { /* blocked */ } },
};
