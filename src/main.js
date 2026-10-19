import { initTheme } from "./theme.js";
import { createReader } from "./reader/reader.js";
import { wireImport, setStatus } from "./import.js";
import { SAMPLE } from "./sample.js";
import { store, docKey } from "./store.js";
import { wirePanel } from "./panel.js";

initTheme();
wirePanel();
const reader = createReader();

// Files and pasted text are kept so they reopen where you left off.
const importer = wireImport((doc, opts) => {
  if (!reader.load(doc, { remember: true, ...opts })) return null;
  document.getElementById("hint").textContent = `${doc.source || "Your text"} is ready. Press Space to begin.`;
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  return reader.kept ? "" : "Too long to keep between launches; open it again next time.";
});

document.getElementById("sample").addEventListener("click", () => {
  reader.load(SAMPLE);
  setStatus("Sample restored.", "ok");
});

// Earlier builds kept one document and one position; carry them into the recent list.
const old = store.get("doc", null);
if (old && old.text && !store.get("recent", []).length) {
  const words = (old.text.match(/\S+/g) || []).length, pos = store.get("pos", null);
  store.set("recent", [{ ...old, words, headings: [] }]);
  if (pos && pos.title === old.title && pos.words === words) store.set("positions", { [docKey(old.title, words)]: pos.idx });
}
store.del("doc"); store.del("pos");

const saved = store.get("recent", [])[0];
if (!(saved && saved.text && reader.load(saved, { resume: true }))) reader.load(SAMPLE, { resume: true });
importer.renderRecent();
