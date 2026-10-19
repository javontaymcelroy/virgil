/* Getting text in: the Open panel, files dropped on the window, and pasting.
   Files are read and converted to text in Rust (src-tauri/src/import/); the page only ever
   receives {title, text, source}. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { titleFor } from "./reader/text.js";
import { store, docKey } from "./store.js";
import { action, confirmButton } from "./theme.js";

const $ = id => document.getElementById(id);

/** The status line sits under the reader, so it is seen and announced whether or not a panel is open. */
export function setStatus(message, kind) {
  const s = $("status"); s.textContent = message; s.className = "status" + (kind ? " " + kind : "");
}

/** `show(doc, { resume })` puts a document on the reader: null if it has no words, else a
 *  note to add to the status ("" when there is nothing to add). `reader` is asked what is on
 *  it (`doc`, `wordCount`) and told when that was shelved. Returns `{ renderRecent, renderLibrary, openShelf }`. */
export function wireImport(show, reader) {
  function loaded(doc, from, opts) {
    const note = show(doc, opts);
    if (note === null) return false;
    setStatus(`Loaded ${countWords(doc.text).toLocaleString()} words${from}.` + (note ? " " + note : ""), note ? "err" : "ok");
    renderRecent(); renderLibrary();
    return true;
  }

  /** Puts a text from the library shelf on the reader, where it was left. */
  async function openShelf(id) {
    setStatus("Opening…");
    try {
      const doc = await invoke("library_open", { id });
      loaded({ ...doc, lib: id }, doc.source ? ` from ${doc.source}` : "", { resume: true });
    } catch (err) { setStatus(String(err), "err") }
  }

  const sameAs = (a, b) => docKey(a.title, a.words) === docKey(b.title, b.words);
  const onReader = d => reader.doc && sameAs(d, { title: reader.doc.title, words: reader.wordCount });

  /** Puts `doc` on the shelf and points its recent entry there. */
  async function save(doc) {
    try {
      const entry = await invoke("library_save", { doc: { title: doc.title, text: doc.text, source: doc.source || "", headings: doc.headings || [] } });
      if (onReader({ title: doc.title, words: entry.words })) reader.shelved(entry.id);
      else store.set("recent", store.get("recent", []).map(d => sameAs(d, { title: doc.title, words: entry.words }) ? { title: d.title, source: d.source, words: d.words, headings: d.headings, lib: entry.id } : d));
      setStatus(`${entry.title} is in the library.`, "ok");
    } catch (err) { setStatus(String(err), "err") }
    await renderLibrary();
  }

  /** Saves what is on the reader to the library (⌘S). */
  async function shelve() {
    const doc = reader.doc, b = $("shelve");
    if (!doc || b.disabled) return;
    b.disabled = true; b.textContent = "Saving…";
    await save(doc);
  }

  /** The library shelf: every saved text, by title, with how far it was read. Its panel is
   *  hidden in a plain browser, where there is no disk to keep them on. */
  let shelf = [];
  async function renderLibrary() {
    if (!isTauri()) return;
    document.querySelector('[aria-controls="libraryPanel"]').hidden = false;
    try { shelf = await invoke("library_list") } catch (err) { shelf = []; setStatus(String(err), "err") }
    const positions = store.get("positions", {}), cur = reader.doc;
    const on = cur && shelf.find(e => e.id === cur.lib || onReader(e));
    $("library").hidden = !shelf.length; $("libraryEmpty").hidden = !!shelf.length;
    $("shelve").disabled = !cur || !!on; $("shelve").textContent = on ? "On the shelf" : "Save to library";
    $("library").replaceChildren(...shelf.map(e => {
      const li = document.createElement("li"); li.className = "theme-item";
      const row = document.createElement("button"); row.type = "button"; row.className = "theme-row";
      const pct = Math.round((positions[docKey(e.title, e.words)] ?? 0) / Math.max(1, e.words - 1) * 100);
      const text = document.createElement("span"); text.textContent = e.title;
      const sub = document.createElement("small"); sub.textContent = `${e.source || "Pasted text"} · ${e.words.toLocaleString()} words · ${pct}% read`; text.appendChild(sub);
      row.appendChild(text);
      row.addEventListener("click", () => openShelf(e.id));
      const remove = confirmButton("Remove", `Remove ${e.title} from the library`, async () => {
        try {
          await invoke("library_remove", { id: e.id });
          // The recent entry for this text pointed at the shelf; it holds the text itself again.
          if (reader.doc?.lib === e.id) { reader.shelved(null); renderRecent() }
          setStatus(`${e.title} was removed from the library.`, "ok");
        } catch (err) { setStatus(String(err), "err") }
        renderLibrary();
      });
      li.append(row, remove);
      return li;
    }));
    renderRecent();
  }

  /** The last few texts, newest first, each with how far it was read. One not on the shelf
   *  gets a Save action. */
  function renderRecent() {
    const list = store.get("recent", []), positions = store.get("positions", {});
    $("recentWrap").hidden = !list.length;
    $("recent").replaceChildren(...list.map((d, i) => {
      const li = document.createElement("li"); li.className = "theme-item";
      const row = document.createElement("button"); row.type = "button"; row.className = "theme-row";
      const pct = Math.round((positions[docKey(d.title, d.words)] ?? 0) / Math.max(1, d.words - 1) * 100);
      const text = document.createElement("span"); text.textContent = d.title;
      const sub = document.createElement("small"); sub.textContent = `${d.source || "Pasted text"} · ${pct}% read`; text.appendChild(sub);
      row.appendChild(text);
      row.addEventListener("click", () => d.lib ? openShelf(d.lib) : loaded(d, d.source ? ` from ${d.source}` : "", { resume: true }));
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "theme-action"; remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${d.title} from recent`);
      remove.addEventListener("click", () => { store.set("recent", list.filter((_, k) => k !== i)); renderRecent() });
      li.append(row);
      if (!(d.lib || shelf.some(e => sameAs(e, d)))) li.append(action("Save", `Save ${d.title} to the library`, () => save(d)));
      li.append(remove);
      return li;
    }));
  }
  function accept(doc) {
    if (!loaded(doc, ` from ${doc.source}`)) setStatus(`${doc.source} has no readable words.`, "err");
  }

  async function openFile() {
    if (!isTauri()) { setStatus("Opening files needs the Virgil app. Paste the text instead.", "err"); return }
    setStatus("Opening…");
    try {
      const doc = await invoke("open_document");
      if (doc) accept(doc); else setStatus("");
    } catch (err) { setStatus(String(err), "err") }
  }

  function readPasted(text) {
    const doc = { title: titleFor(text), text, source: "Pasted text" };
    if (!loaded(doc, "")) setStatus("There's no text to read. Paste some first.", "err");
  }

  $("open").addEventListener("click", openFile);
  $("shelve").addEventListener("click", shelve);
  $("useText").addEventListener("click", () => readPasted($("input").value));
  document.addEventListener("keydown", e => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "o") { e.preventDefault(); openFile() }
    if (key === "s" && isTauri()) { e.preventDefault(); shelve() }
  });
  // Pasting anywhere outside a text field reads the clipboard straight away.
  document.addEventListener("paste", e => {
    if (e.target.closest && e.target.closest("textarea, input, select")) return;
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (text && text.trim()) { e.preventDefault(); readPasted(text) }
  });

  if (isTauri()) {
    listen("import:hover", e => document.body.classList.toggle("dropping", !!e.payload));
    listen("import:started", e => setStatus(`Opening ${e.payload}…`));
    listen("import:done", e => accept(e.payload));
    listen("import:failed", e => setStatus(e.payload, "err"));
  }
  return { renderRecent, renderLibrary, openShelf };
}

const countWords = text => (text.match(/\S+/g) || []).length;
