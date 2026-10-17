import { initTheme } from "./theme.js";
import { createReader } from "./reader/reader.js";
import { wireImport, setStatus } from "./import.js";
import { SAMPLE } from "./sample.js";
import { store } from "./store.js";

initTheme();
const reader = createReader();

// Files and pasted text are kept so they reopen where you left off.
wireImport(doc => {
  if (!reader.load(doc, { remember: true })) return false;
  document.getElementById("hint").textContent = `${doc.source || "Your text"} is ready. Press Space to begin.`;
  window.scrollTo({ top: 0, behavior: "smooth" });
  return true;
});

document.getElementById("sample").addEventListener("click", () => {
  store.del("doc");
  reader.load(SAMPLE);
  setStatus("Sample restored.", "ok");
});

const saved = store.get("doc", null);
if (!(saved && saved.text && reader.load(saved, { resume: true }))) reader.load(SAMPLE, { resume: true });
