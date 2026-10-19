/* Side panels on the right: "Add a text" and "Settings". One is open at a time; which one is
   remembered across launches. Each has a masthead button (aria-controls names its panel) and a
   shortcut: ⌘T for Add a text, ⌘, for Settings. Esc closes the open panel. */

import { store } from "./store.js";

const PANELS = { text: "textPanel", settings: "settingsPanel" };
const KEYS = { t: "text", ",": "settings" };
const $ = id => document.getElementById(id);
const toggleFor = name => document.querySelector(`[aria-controls="${PANELS[name]}"]`);
const narrow = matchMedia("(max-width: 979px)");
let current = null;

// On a narrow window the open drawer lies over the page, so the page is inert underneath it.
const syncOverlay = () => { document.querySelector(".wrap").inert = !!current && narrow.matches };

function show(name, { focus = false } = {}) {
  current = PANELS[name] ? name : null;
  for (const [key, id] of Object.entries(PANELS)) {
    const open = key === current;
    $(id).classList.toggle("is-open", open);
    $(id).inert = !open;
    toggleFor(key).setAttribute("aria-expanded", open);
  }
  store.set("panel", current);
  syncOverlay();
  if (current && focus) {
    const panel = $(PANELS[current]);
    // The first of these that is actually shown (the theme editors' fields sit in hidden forms).
    const target = ["textarea", '[aria-checked="true"]', "button:not(.drawer-close)"]
      .flatMap(sel => [...panel.querySelectorAll(sel)]).find(el => !el.closest("[hidden]"));
    target?.focus({ preventScroll: true });
  }
}

const toggle = name => show(current === name ? null : name, { focus: true });
function close() {
  const was = current;
  show(null);
  if (was) toggleFor(was).focus();
}

export const openPanel = (name = "text") => { if (current !== name) show(name) };

export function wirePanel() {
  const saved = store.get("panel", null);
  show(saved === true ? "text" : saved);   // older builds stored a boolean for the text panel
  for (const name of Object.keys(PANELS)) toggleFor(name).addEventListener("click", () => toggle(name));
  for (const btn of document.querySelectorAll(".drawer-close")) btn.addEventListener("click", close);
  narrow.addEventListener("change", syncOverlay);
  document.addEventListener("keydown", e => {
    const name = KEYS[e.key.toLowerCase()];
    if (name && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) { e.preventDefault(); toggle(name) }
    else if (e.key === "Escape" && current && !e.defaultPrevented) close();
  });
}
