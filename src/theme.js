/* Themes are CSS custom properties layered on the default (themes/default/theme.css). Two kinds
   can be layered on top, listed under Settings → Themes:
   - built-in private themes: themes/private/<name>/theme.css, found when Virgil is built
     (that folder is gitignored, so they only exist in your own builds);
   - added themes: .css files chosen with "Add theme…", copied by Rust into the app-data folder
     and served as vtheme://localhost/<name>.css.
   At most one is on; turning it off returns to the default. Until you choose, the first
   built-in private theme is on. */

import { invoke, isTauri, convertFileSrc } from "@tauri-apps/api/core";
import { store } from "./store.js";

// Filled in by vite.config.js from the folders in themes/private/.
const PRIVATE = typeof __VIRGIL_PRIVATE_THEMES__ === "undefined" ? [] : __VIRGIL_PRIVATE_THEMES__;
const ADDED = "added:";

const $ = id => document.getElementById(id);
const ready = () => document.documentElement.setAttribute("data-ready", "");
const words = s => s.split("-").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

let current = "default", added = [];

function href(id) {
  if (PRIVATE.includes(id)) return `/private/${id}/theme.css`;
  if (id.startsWith(ADDED)) return `${convertFileSrc(id.slice(ADDED.length) + ".css", "vtheme")}?v=${Date.now()}`;
  return null;
}

function apply(id) {
  document.getElementById("theme-override")?.remove();
  const url = href(id);
  if (!url) { ready(); return }
  const link = document.createElement("link");
  link.id = "theme-override"; link.rel = "stylesheet"; link.href = url;
  link.onload = ready;
  link.onerror = () => { ready(); if (current === id) choose("default") };   // e.g. an added theme was deleted
  document.head.appendChild(link);
}

function choose(id) {
  current = id;
  store.set("theme", id);
  apply(id);
  for (const row of document.querySelectorAll(".theme-row")) row.setAttribute("aria-checked", row.dataset.theme === id);
}

function setThemeStatus(message, kind) {
  const s = $("themeStatus"); s.textContent = message; s.className = "status" + (kind ? " " + kind : "");
}

function render() {
  const list = $("themeList"); list.textContent = "";
  const entries = [
    ["default", "Default", "Light and dark, follows macOS"],
    ...PRIVATE.map(n => [n, words(n), "Private, built into your copy"]),
    ...added.map(n => [ADDED + n, words(n), "Added theme"]),
  ];
  for (const [id, name, note] of entries) {
    const item = document.createElement("div"); item.className = "theme-item";
    const row = document.createElement("button");
    row.type = "button"; row.className = "theme-row"; row.setAttribute("role", "switch"); row.dataset.theme = id;
    row.setAttribute("aria-checked", id === current);
    const text = document.createElement("span"); text.textContent = name;
    const sub = document.createElement("small"); sub.textContent = note; text.appendChild(sub);
    const sw = document.createElement("span"); sw.className = "switch"; sw.setAttribute("aria-hidden", "true");
    row.append(text, sw);
    // Turning a theme on turns the others off; turning the current one off returns to the default.
    row.addEventListener("click", () => choose(id === current && id !== "default" ? "default" : id));
    item.appendChild(row);
    if (id.startsWith(ADDED)) {
      const rm = document.createElement("button");
      rm.type = "button"; rm.className = "theme-remove"; rm.textContent = "×";
      rm.setAttribute("aria-label", `Remove ${name}`); rm.title = `Remove ${name}`;
      rm.addEventListener("click", () => remove(id.slice(ADDED.length), name));
      item.appendChild(rm);
    }
    list.appendChild(item);
  }
}

async function refresh() {
  try { added = await invoke("list_themes") } catch { added = [] }
  if (current.startsWith(ADDED) && !added.includes(current.slice(ADDED.length))) choose("default");
  render();
}

async function add() {
  setThemeStatus("");
  try {
    const name = await invoke("add_theme");
    if (!name) return;
    await refresh();
    choose(ADDED + name);
    setThemeStatus(`Added ${words(name)}.`, "ok");
  } catch (err) { setThemeStatus(String(err), "err") }
}

async function remove(name, label) {
  try {
    await invoke("remove_theme", { name });
    if (current === ADDED + name) choose("default");
    await refresh();
    setThemeStatus(`Removed ${label}.`, "ok");
  } catch (err) { setThemeStatus(String(err), "err") }
}

export function initTheme() {
  const saved = store.get("theme", null);
  const known = saved === "default" || PRIVATE.includes(saved) || (saved && saved.startsWith(ADDED) && isTauri());
  current = known ? saved : PRIVATE[0] || "default";
  apply(current);
  setTimeout(ready, 1500); // never stay hidden if a theme is slow to load
  render();
  if (isTauri()) { refresh(); $("addTheme").addEventListener("click", add) }
  else $("addTheme").hidden = true;
}
