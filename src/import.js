/* Getting text in: the Open panel, files dropped on the window, and pasting.
   Files are read and converted to text in Rust (src-tauri/src/import/); the page only ever
   receives {title, text, source}. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { titleFor } from "./reader/text.js";

const $ = id => document.getElementById(id);

export function setStatus(message, kind) {
  const s = $("status"); s.textContent = message; s.className = "status" + (kind ? " " + kind : "");
}

/** `show(doc)` puts a document on the reader and returns false if it has no words. */
export function wireImport(show) {
  function accept(doc) {
    if (show(doc)) setStatus(`Loaded ${countWords(doc.text).toLocaleString()} words from ${doc.source}.`, "ok");
    else setStatus(`${doc.source} has no readable words.`, "err");
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
    if (show(doc)) setStatus(`Loaded ${countWords(text).toLocaleString()} words.`, "ok");
    else setStatus("There's no text to read. Paste some first.", "err");
  }

  $("open").addEventListener("click", openFile);
  $("useText").addEventListener("click", () => readPasted($("input").value));
  document.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "o" && (e.metaKey || e.ctrlKey) && !e.shiftKey) { e.preventDefault(); openFile() }
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
}

const countWords = text => (text.match(/\S+/g) || []).length;
