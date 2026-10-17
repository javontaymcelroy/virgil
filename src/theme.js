/* Themes are CSS custom properties layered on the default (themes/default/theme.css). Two kinds
   can be layered on top, listed under Settings → Themes:
   - built-in private themes: themes/private/<name>/theme.css, found when Virgil is built
     (that folder is gitignored, so they only exist in your own builds);
   - your themes: built with pickers ("New theme", previewed live), written or pasted as CSS
     ("Custom theme"), or chosen with "Add from file…";
     all saved by Rust in the app-data folder and served as vtheme://localhost/<name>.css. They can
     be edited, renamed and deleted from the list.
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

let current = "default", added = [], editing = null;   // editing: id of the theme being edited, "" for a new one

// The builder ("New theme"): a few pickers that become CSS custom properties. Everything else
// (borders, hover and muted shades, the smaller and larger text sizes) is derived from them.
const MARK = "/* Made with Virgil's theme builder */";
const FONTS = {
  "System": '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  "SF Rounded": 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  "Avenir Next": '"Avenir Next", Avenir, system-ui, sans-serif',
  "Helvetica Neue": '"Helvetica Neue", Helvetica, sans-serif',
  "New York": 'ui-serif, "New York", Georgia, serif',
  "Iowan Old Style": '"Iowan Old Style", Georgia, serif',
  "Palatino": 'Palatino, "Palatino Linotype", serif',
  "Georgia": "Georgia, serif",
  "Menlo": 'ui-monospace, "SF Mono", Menlo, monospace',
};
const FIELDS = [
  "Colors",
  { key: "--bg", label: "Background", type: "color" },
  { key: "--surface", label: "Panels", type: "color" },
  { key: "--text", label: "Text", type: "color" },
  { key: "--text-muted", label: "Secondary text", type: "color" },
  { key: "--accent", label: "Buttons and switches", type: "color" },
  { key: "--pivot", label: "Focus letter", type: "color" },
  "Fonts",
  { key: "--font-ui", label: "Interface", type: "font" },
  { key: "--font-reading", label: "Reading", type: "font" },
  "Sizes",
  { key: "--word-size", label: "Word size", min: 32, max: 120, step: 2, unit: "px", def: 56 },
  { key: "--word-weight", label: "Word weight", min: 300, max: 800, step: 100, unit: "", def: 500 },
  { key: "--text-md", label: "Text size", min: 13, max: 19, step: 1, unit: "px", def: 15 },
  { key: "--radius", label: "Corner roundness", min: 0, max: 24, step: 1, unit: "px", def: 12 },
];
const DERIVED = `
  --font-word: var(--font-reading);
  --accent-hover: color-mix(in srgb, var(--accent) 88%, var(--text));
  --track-fill: var(--accent);
  --thumb: var(--accent);
  --surface-sunken: color-mix(in srgb, var(--bg) 94%, var(--text));
  --text-faint: color-mix(in srgb, var(--text-muted) 70%, var(--bg));
  --border: color-mix(in srgb, var(--text) 12%, transparent);
  --border-strong: color-mix(in srgb, var(--text) 26%, transparent);
  --track: color-mix(in srgb, var(--text) 14%, transparent);
  --selection: color-mix(in srgb, var(--pivot) 24%, transparent);
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent);
  --text-sm: calc(var(--text-md) - 2px);
  --text-lg: calc(var(--text-md) + 5px);
  --text-xl: calc(var(--text-md) + 13px);
  --word-size-chunk: calc(var(--word-size) * 0.7);
  --radius-sm: calc(var(--radius) * 2 / 3);`;

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
    ...added.map(n => [ADDED + n, words(n), "Your theme"]),
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
      const slug = id.slice(ADDED.length);
      item.append(action("Edit", `Edit ${name}`, () => openEditor(slug)), deleteButton(slug, name));
    }
    list.appendChild(item);
  }
}

function action(text, label, onClick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "theme-action"; b.textContent = text; b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

// Delete takes two clicks: the first turns the button into "Delete?" for a few seconds.
function deleteButton(slug, name) {
  const b = action("Delete", `Delete ${name}`, () => {
    if (!b.classList.contains("confirm")) {
      b.classList.add("confirm"); b.textContent = "Delete?";
      setTimeout(() => { b.classList.remove("confirm"); b.textContent = "Delete" }, 3000);
      return;
    }
    remove(slug, name);
  });
  b.classList.add("danger");
  return b;
}

// Edit opens a theme where it was made: the builder for builder themes, the CSS editor otherwise.
async function openEditor(slug, builder = false) {
  setThemeStatus("");
  let css = "";
  if (slug) {
    try { css = await invoke("read_theme", { name: slug }) } catch (err) { setThemeStatus(String(err), "err"); return }
  }
  closeEditor();
  editing = slug || "";
  if (builder || css.startsWith(MARK)) return openBuilder(slug, css);
  $("themeEditorH").textContent = slug ? `Edit ${words(slug)}` : "Custom theme";
  $("themeName").value = slug ? words(slug) : "";
  $("themeCss").value = css;
  $("themeEditor").hidden = false;
  (slug ? $("themeCss") : $("themeName")).focus();
}

function closeEditor() {
  editing = null;
  $("themeEditor").hidden = $("themeBuilder").hidden = true;
  document.getElementById("theme-draft")?.remove();
  const link = document.getElementById("theme-override");
  if (link?.sheet) link.sheet.disabled = false;
}

// Starts from the values in the theme being edited, or else from the theme that is on now.
function openBuilder(slug, css) {
  const now = getComputedStyle(document.documentElement), probe = document.createElement("i");
  document.body.appendChild(probe);
  const saved = {};
  for (const [, k, v] of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) saved[k] = v.trim();
  const box = $("builderFields"); box.textContent = "";
  for (const f of FIELDS) {
    if (typeof f === "string") { const h = document.createElement("h4"); h.className = "label"; h.textContent = f; box.appendChild(h); continue }
    const row = document.createElement("label"); row.className = "builder-field";
    const name = document.createElement("span"); name.textContent = f.label;
    let input, out;
    if (f.type === "color") {
      probe.style.color = saved[f.key] || `var(${f.key})`;
      input = document.createElement("input"); input.type = "color"; input.value = hex(getComputedStyle(probe).color);
    } else if (f.type === "font") {
      const value = saved[f.key] || now.getPropertyValue(f.key).trim();
      input = document.createElement("select"); input.className = "select";
      const options = Object.entries(FONTS);
      if (!options.some(([, v]) => v === value)) options.unshift(["Current", value]);
      for (const [label, v] of options) input.add(new Option(label, v, false, v === value));
    } else {
      const n = parseFloat(saved[f.key] ?? now.getPropertyValue(f.key));
      input = document.createElement("input"); input.type = "range";
      Object.assign(input, { min: f.min, max: f.max, step: f.step, value: Number.isFinite(n) ? n : f.def });
      out = document.createElement("output");
    }
    input.dataset.key = f.key;
    if (f.unit != null) input.dataset.unit = f.unit;
    row.append(name, out || input);
    if (out) row.appendChild(input);
    box.appendChild(row);
  }
  probe.remove();
  $("themeBuilderH").textContent = slug ? `Edit ${words(slug)}` : "New theme";
  $("builderName").value = slug ? words(slug) : "";
  $("themeBuilder").hidden = false;
  // Preview the draft alone, as it will look once saved, with the current theme set aside.
  const link = document.getElementById("theme-override");
  if (link?.sheet) link.sheet.disabled = true;
  const draft = document.createElement("style"); draft.id = "theme-draft"; document.head.appendChild(draft);
  preview();
  $("builderName").focus();
}

function builderCss() {
  const lines = [...$("builderFields").querySelectorAll("[data-key]")].map(i => {
    if (i.type === "range") {
      i.style.setProperty("--fill", `${(i.value - i.min) / (i.max - i.min) * 100}%`);
      i.previousElementSibling.textContent = i.value + i.dataset.unit;
    }
    return `  ${i.dataset.key}: ${i.value}${i.dataset.unit || ""};`;
  });
  const get = k => $("builderFields").querySelector(`[data-key="${k}"]`).value;
  return `${MARK}\n:root {\n  color-scheme: ${light(get("--bg")) ? "light" : "dark"};\n${lines.join("\n")}\n` +
    `  --on-accent: ${light(get("--accent")) ? "#111111" : "#ffffff"};${DERIVED}\n}\n`;
}

function preview() { const d = document.getElementById("theme-draft"); if (d) d.textContent = builderCss() }

// Any CSS color to #rrggbb, which is what <input type="color"> takes.
const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
function hex(color) {
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
  return "#" + [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(v => v.toString(16).padStart(2, "0")).join("");
}
function light(h) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

function save(e) {
  e.preventDefault();
  persist($("themeName").value.trim(), $("themeCss").value);
}

async function persist(name, css) {
  try {
    const id = await invoke("save_theme", { name, css, replacing: editing || null });
    const wasCurrent = editing && current === ADDED + editing;
    closeEditor();
    await refresh();
    choose(ADDED + id);   // reapplies even when it was already on, so edits show at once
    setThemeStatus(wasCurrent ? `Saved ${words(id)}.` : `Saved ${words(id)} and switched to it.`, "ok");
  } catch (err) { setThemeStatus(String(err), "err") }
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
    if (editing === name) closeEditor();
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
  if (isTauri()) {
    refresh();
    $("addTheme").addEventListener("click", add);
    $("newTheme").addEventListener("click", () => openEditor(null, true));
    $("customTheme").addEventListener("click", () => openEditor(null));
    for (const id of ["cancelTheme", "cancelBuilder"]) $(id).addEventListener("click", () => { closeEditor(); setThemeStatus("") });
    $("themeEditor").addEventListener("submit", save);
    $("builderFields").addEventListener("input", preview);
    $("themeBuilder").addEventListener("submit", e => { e.preventDefault(); persist($("builderName").value.trim(), builderCss()) });
  } else {
    $("addTheme").hidden = $("newTheme").hidden = $("customTheme").hidden = true;
  }
}
