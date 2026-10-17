/* Themes are CSS custom properties layered on the default (themes/default/theme.css). Two kinds
   can be layered on top, listed under Settings → Themes:
   - built-in private themes: themes/private/<name>/theme.css, found when Virgil is built
     (that folder is gitignored, so they only exist in your own builds);
   - your themes: built with pickers ("New theme", previewed live), written or pasted as CSS
     ("Custom theme"), or chosen with "Add from file…";
     all saved by Rust in the app-data folder and served as vtheme://localhost/<name>.css. They can
     be edited, renamed and deleted from the list.
   Built-in themes (Default and the private ones) can be edited too: the changes are saved as
   _<theme>.css, layered on top of the original, and Reset deletes them.
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

let current = "default", added = [], edited = [], editing = null;   // editing: id of the theme being edited, "" for a new one
let editingBuiltin = null;                                          // or the built-in theme whose changes are being edited
let onlyChanged = false;   // builder: write only the values changed from the original (built-in edits)
const builtin = id => id === "default" || PRIVATE.includes(id);

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
  { key: "--bg", label: "Background", type: "color", fill: "--bg-fill" },
  { key: "--surface", label: "Panels", type: "color", fill: "--surface-fill" },
  { key: "--text", label: "Text", type: "color", clip: ".brand, .word, .panel h2, .theme-editor h3, .setting .val, .record .num" },
  { key: "--text-muted", label: "Secondary text", type: "color", clip: ".label, .hint, .keys, .drawer-note, .panel > p, .theme-row small" },
  { key: "--pivot", label: "Focus letter", type: "color", clip: ".word .p" },
  "Buttons",
  { key: "--accent", label: "Primary", hint: "Buttons and switches", type: "color", fill: "--primary-fill", hover: "--primary-fill-hover" },
  { key: "--on-accent", label: "Primary label", type: "color", clip: ".btn--primary, .btn--primary:hover", under: "var(--primary-fill)" },
  { key: "--button", label: "Secondary", type: "color", fill: "--button-fill" },
  { key: "--button-text", label: "Secondary label", type: "color", clip: ".btn:not(.btn--primary, .btn--ghost)", under: "var(--button-fill)" },
  "Fonts",
  { key: "--font-ui", label: "Interface", type: "font" },
  { key: "--font-reading", label: "Reading", type: "font" },
  { key: "--font-word", label: "Flashed word", type: "font" },
  "Sizes",
  { key: "--word-size", label: "Word size", min: 32, max: 120, step: 2, unit: "px", def: 56 },
  { key: "--word-weight", label: "Word weight", min: 300, max: 800, step: 100, unit: "", def: 500 },
  { key: "--text-md", label: "Text size", min: 13, max: 19, step: 1, unit: "px", def: 15 },
  { key: "--radius", label: "Corner roundness", min: 0, max: 24, step: 1, unit: "px", def: 12 },
];
const DERIVED = `
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

// Resolves once the theme's stylesheets have loaded (or failed to).
function apply(id) {
  for (const old of document.querySelectorAll("#theme-override, #theme-edits")) old.remove();
  const loads = [];
  const add = (linkId, url, onerror) => loads.push(new Promise(done => {
    const link = document.createElement("link");
    link.id = linkId; link.rel = "stylesheet"; link.href = url;
    link.onload = done;
    link.onerror = () => { onerror?.(); done() };
    document.head.appendChild(link);
  }));
  const url = href(id);
  if (url) add("theme-override", url, () => { if (current === id) choose("default") });   // e.g. an added theme was deleted
  if (edited.includes(id)) add("theme-edits", `${convertFileSrc(`_${id}.css`, "vtheme")}?v=${Date.now()}`);
  return Promise.all(loads).then(ready);
}

function choose(id) {
  current = id;
  store.set("theme", id);
  const loaded = apply(id);
  for (const row of document.querySelectorAll(".theme-row")) row.setAttribute("aria-checked", row.dataset.theme === id);
  return loaded;
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
    const sub = document.createElement("small"); sub.textContent = edited.includes(id) ? `${note} · edited` : note; text.appendChild(sub);
    const sw = document.createElement("span"); sw.className = "switch"; sw.setAttribute("aria-hidden", "true");
    row.append(text, sw);
    // Turning a theme on turns the others off; turning the current one off returns to the default.
    row.addEventListener("click", () => choose(id === current && id !== "default" ? "default" : id));
    item.appendChild(row);
    if (id.startsWith(ADDED)) {
      const slug = id.slice(ADDED.length);
      item.append(action("Edit", `Edit ${name}`, () => openEditor(slug)), confirmButton("Delete", `Delete ${name}`, () => remove(slug, name)));
    } else if (isTauri()) {
      item.append(action("Edit", `Edit ${name}`, () => editBuiltin(id, name)));
      if (edited.includes(id)) item.append(confirmButton("Reset", `Reset ${name} to its original look`, () => reset(id, name)));
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

// Delete and Reset take two clicks: the first turns the button into "Delete?" for a few seconds.
function confirmButton(text, label, onConfirm) {
  const b = action(text, label, () => {
    if (!b.classList.contains("confirm")) {
      b.classList.add("confirm"); b.textContent = `${text}?`;
      setTimeout(() => { b.classList.remove("confirm"); b.textContent = text }, 3000);
      return;
    }
    onConfirm();
  });
  b.classList.add("danger");
  return b;
}

const BUTTON_RULES = {
  primary: `.btn--primary, .btn--primary:hover, .btn--primary:active {
  background: var(--primary-fill); border-color: var(--accent); color: var(--on-accent); box-shadow: none; text-shadow: none;
}
.btn--primary:hover { background: var(--primary-fill-hover); border-color: var(--accent-hover); }
`,
  secondary: `.btn:not(.btn--primary, .btn--ghost) { background: var(--button-fill); color: var(--button-text); }
`,
};

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

// Editing a built-in theme switches to it and opens the builder on its current look; the
// changes are saved on top of the original, so its own rules and fonts stay.
async function editBuiltin(id, name) {
  setThemeStatus("");
  let css = "";
  if (edited.includes(id)) {
    try { css = await invoke("read_theme", { name: `_${id}` }) } catch (err) { setThemeStatus(String(err), "err"); return }
  }
  closeEditor();
  if (current !== id) await choose(id);
  editingBuiltin = id;
  openBuilder(null, css, name);
}

function closeEditor() {
  editing = editingBuiltin = null;
  $("themeEditor").hidden = $("themeBuilder").hidden = true;
  document.getElementById("theme-draft")?.remove();
  for (const link of document.querySelectorAll("#theme-override, #theme-edits")) if (link.sheet) link.sheet.disabled = false;
}

// Starts from the values in the theme being edited, or else from the theme that is on now.
function openBuilder(slug, css, builtinName) {
  // For a built-in theme, start from the original so unchanged values aren't written.
  onlyChanged = !!builtinName;
  if (onlyChanged) { const e = document.getElementById("theme-edits"); if (e?.sheet) e.sheet.disabled = true }
  const now = getComputedStyle(document.documentElement), probe = document.createElement("i");
  document.body.appendChild(probe);
  const saved = {};
  for (const [, k, v] of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) saved[k] = v.trim();
  // Each group is a list like the theme list; each item is one value: its name and control on
  // one line, and a color's gradient settings, or a size's slider, on the line below.
  const box = $("builderFields"); box.textContent = "";
  let list;
  for (const f of FIELDS) {
    if (typeof f === "string") {
      const h = document.createElement("h4"); h.className = "label"; h.textContent = f; h.id = `builder-${f.toLowerCase()}`;
      list = document.createElement("div"); list.className = "builder-list"; list.setAttribute("role", "group"); list.setAttribute("aria-labelledby", h.id);
      box.append(h, list);
      continue;
    }
    const item = document.createElement("div"); item.className = "builder-item";
    const row = document.createElement("div"); row.className = "builder-row";
    const name = document.createElement("label"); name.className = "builder-name"; name.htmlFor = `builder${f.key}`; name.textContent = f.label;
    if (f.hint) { const s = document.createElement("small"); s.textContent = f.hint; name.appendChild(s) }
    row.appendChild(name); item.appendChild(row); list.appendChild(item);
    let input, out;
    let start, value;
    if (f.type === "color") {
      const resolve = c => { probe.style.color = c; return hex(getComputedStyle(probe).color) };
      start = resolve(`var(${f.key})`); value = saved[f.key] ? resolve(saved[f.key]) : start;
      input = document.createElement("input"); input.type = "color";
    } else if (f.type === "font") {
      start = now.getPropertyValue(f.key).trim(); value = saved[f.key] || start;
      input = document.createElement("select"); input.className = "select";
      const options = Object.entries(FONTS);
      if (!options.some(([, v]) => v === start)) options.unshift(["Current", start]);
      for (const [label, v] of options) input.add(new Option(label, v));
    } else {
      const n = parseFloat(now.getPropertyValue(f.key));
      start = Number.isFinite(n) ? n : f.def; value = parseFloat(saved[f.key]) || start;
      input = document.createElement("input"); input.type = "range";
      Object.assign(input, { min: f.min, max: f.max, step: f.step });
      out = document.createElement("output");
    }
    input.value = start; input.dataset.start = input.value;   // normalized the way the input reports it
    input.value = value;
    input.dataset.key = f.key; input.id = `builder${f.key}`;
    if (f.unit != null) input.dataset.unit = f.unit;
    if (out) { row.appendChild(out); item.appendChild(input) }   // a size: value on the right, slider below
    else if (f.type === "color") {
      const grad = gradientRow(f, saved[gradKey(f)]);
      row.append(fillSwitch(f, grad), input);
      item.appendChild(grad);
    } else row.appendChild(input);
  }
  probe.remove();
  $("themeBuilderH").textContent = builtinName ? `Edit ${builtinName}` : slug ? `Edit ${words(slug)}` : "New theme";
  $("builderName").value = slug ? words(slug) : "";
  $("builderName").hidden = $("builderName").labels[0].hidden = !!builtinName;
  $("themeBuilder").hidden = false;
  // Preview the draft as it will look once saved: alone, with the current theme set aside, or
  // for a built-in theme, on top of the original in place of its earlier changes.
  const aside = builtinName ? "#theme-edits" : "#theme-override, #theme-edits";
  for (const link of document.querySelectorAll(aside)) if (link.sheet) link.sheet.disabled = true;
  const draft = document.createElement("style"); draft.id = "theme-draft"; document.head.appendChild(draft);
  preview();
  (builtinName ? box.querySelector("input") : $("builderName")).focus();
}

// "Gradient" under each color: a linear gradient from that color to a second one, at an angle.
// A background color's fill takes it (--bg-fill for --bg, say); a text color's gradient is
// clipped to the text of the elements in its `clip` selector, over their own background
// (`under`) when they have one. The color itself stays solid for borders, mixes and the rest.
const gradKey = f => f.fill || `--grad${f.key.slice(1)}`;

// The second line of a color item, shown for a gradient: angle, and the color it ends on
// (in the same column as the color it starts from). Hidden means solid.
function gradientRow(f, saved) {
  const [, angle = "180", end = "#000000"] = /linear-gradient\((\d+)deg,\s*#\w+,\s*(#\w+)\)/.exec(saved || "") || [];
  const row = document.createElement("div"); row.className = "builder-grad"; row.dataset.gradient = f.key; row.hidden = !saved;
  const label = document.createElement("span"); label.textContent = "Angle";
  const turn = document.createElement("input"); turn.type = "range"; Object.assign(turn, { min: 0, max: 360, step: 15, value: angle });
  turn.setAttribute("aria-label", `${f.label}: gradient angle`);
  const out = document.createElement("output");
  const to = document.createElement("input"); to.type = "color"; to.value = end; to.setAttribute("aria-label", `${f.label}: gradient end color`);
  row.append(label, turn, out, to);
  return row;
}

// Solid | Gradient: a small segmented pair, styled apart from .btn so themes' button rules
// don't resize it.
function fillSwitch(f, grad) {
  const seg = document.createElement("div"); seg.className = "fill-switch"; seg.setAttribute("role", "group"); seg.setAttribute("aria-label", `${f.label} fill`);
  for (const [text, gradient] of [["Solid", false], ["Gradient", true]]) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = text; b.setAttribute("aria-pressed", grad.hidden !== gradient);
    b.addEventListener("click", () => {
      grad.hidden = !gradient;
      for (const other of seg.children) other.setAttribute("aria-pressed", other === b);
      preview();
    });
    seg.appendChild(b);
  }
  return seg;
}

function builderCss() {
  const changed = new Set(), lines = [];
  for (const i of $("builderFields").querySelectorAll("[data-key]")) {
    if (i.type === "range") {
      i.style.setProperty("--fill", `${(i.value - i.min) / (i.max - i.min) * 100}%`);
      i.closest(".builder-item").querySelector("output").textContent = i.value + i.dataset.unit;
    }
    if (onlyChanged && i.value === i.dataset.start) continue;
    changed.add(i.dataset.key);
    lines.push(`${i.dataset.key}: ${i.value}${i.dataset.unit || ""};`);
  }
  const textRules = [];
  for (const g of $("builderFields").querySelectorAll("[data-gradient]")) {
    const turn = g.querySelector("[type=range]"), to = g.querySelector("[type=color]");
    g.querySelector("output").textContent = `${turn.value}°`;
    turn.style.setProperty("--fill", `${turn.value / 3.6}%`);
    if (g.hidden) continue;
    const f = FIELDS.find(f => f.key === g.dataset.gradient), key = gradKey(f);
    const from = g.closest(".builder-item").querySelector("[data-key]").value;
    changed.add(key);
    lines.push(`${key}: linear-gradient(${turn.value}deg, ${from}, ${to.value});`);
    if (f.hover) lines.push(`${f.hover}: var(${key});`);
    if (f.clip) {
      const layers = f.under ? [`var(${key}), ${f.under}`, "text, border-box"] : [`var(${key})`, "text"];
      textRules.push(`${f.clip} {\n  background: ${layers[0]}; -webkit-background-clip: ${layers[1]}; background-clip: ${layers[1]}; color: transparent;\n}\n`);
    }
  }
  // Derived values follow the values they're made from; for a built-in theme, only changed ones.
  const uses = k => !onlyChanged || changed.has(k);
  const get = k => $("builderFields").querySelector(`[data-key="${k}"]`).value;
  if (uses("--bg")) lines.unshift(`color-scheme: ${light(get("--bg")) ? "light" : "dark"};`);
  for (const line of DERIVED.trim().split("\n")) {
    if ([...line.matchAll(/var\((--[\w-]+)\)/g)].some(([, k]) => uses(k))) lines.push(line.trim());
  }
  let css = `${MARK}\n:root {\n${lines.map(l => "  " + l).join("\n")}\n}\n`;
  // A built-in theme may style its buttons with its own rules (Vespertine's steel, say), which
  // the colors alone don't reach; changed button colors bring rules that apply them.
  const any = (...keys) => keys.some(k => changed.has(k));
  if (onlyChanged && any("--accent", "--on-accent", "--primary-fill")) css += BUTTON_RULES.primary;
  if (onlyChanged && any("--button", "--button-text", "--button-fill")) css += BUTTON_RULES.secondary;
  return css + textRules.join("");
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

async function saveBuiltin() {
  const id = editingBuiltin, name = $("themeBuilderH").textContent.replace(/^Edit /, "");
  try {
    await invoke("save_override", { id, css: builderCss() });
    closeEditor();
    await refresh();
    choose(id);
    setThemeStatus(`Saved your changes to ${name}.`, "ok");
  } catch (err) { setThemeStatus(String(err), "err") }
}

async function reset(id, name) {
  try {
    await invoke("remove_theme", { name: `_${id}` });
    if (editingBuiltin === id) closeEditor();
    await refresh();
    if (current === id) choose(id);
    setThemeStatus(`Reset ${name} to its original look.`, "ok");
  } catch (err) { setThemeStatus(String(err), "err") }
}

async function refresh() {
  let names = [];
  try { names = await invoke("list_themes") } catch { }
  added = names.filter(n => !n.startsWith("_"));
  edited = names.filter(n => n.startsWith("_")).map(n => n.slice(1));
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
    refresh().then(() => { if (edited.includes(current)) apply(current) });
    $("addTheme").addEventListener("click", add);
    $("newTheme").addEventListener("click", () => openEditor(null, true));
    $("customTheme").addEventListener("click", () => openEditor(null));
    for (const id of ["cancelTheme", "cancelBuilder"]) $(id).addEventListener("click", () => { closeEditor(); setThemeStatus("") });
    $("themeEditor").addEventListener("submit", save);
    $("builderFields").addEventListener("input", preview);
    $("themeBuilder").addEventListener("submit", e => {
      e.preventDefault();
      if (editingBuiltin) saveBuiltin(); else persist($("builderName").value.trim(), builderCss());
    });
  } else {
    $("addTheme").hidden = $("newTheme").hidden = $("customTheme").hidden = true;
  }
}
