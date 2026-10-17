/* The "Add a text" side panel: collapsed by default, remembered across launches.
   Toggle with the masthead button or ⌘T; Esc closes it while focus is inside. */

import { store } from "./store.js";

const $ = id => document.getElementById(id);

function set(open, { focus = false } = {}) {
  const panel = $("textPanel");
  document.body.classList.toggle("panel-open", open);
  $("panelToggle").setAttribute("aria-expanded", open);
  panel.inert = !open;
  store.set("panel", open);
  if (open && focus) $("input").focus({ preventScroll: true });
}

export const openPanel = () => set(true);
const isOpen = () => document.body.classList.contains("panel-open");

export function wirePanel() {
  set(store.get("panel", false));
  $("panelToggle").addEventListener("click", () => set(!isOpen(), { focus: true }));
  $("panelClose").addEventListener("click", () => { set(false); $("panelToggle").focus() });
  document.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "t" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) { e.preventDefault(); set(!isOpen(), { focus: true }) }
    else if (e.key === "Escape" && isOpen() && $("textPanel").contains(document.activeElement)) { set(false); $("panelToggle").focus() }
  });
}
