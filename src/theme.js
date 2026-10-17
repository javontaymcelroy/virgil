/* Themes are folders of CSS custom properties: themes/default/ ships with the app, and any
   themes/private/<name>/theme.css on your machine is found at build time and listed under
   Settings → Themes (the first one is on until you choose). At most one theme is on; turning
   it off goes back to the default. A theme loads after the default, so it only overrides what it sets. */

import { store } from "./store.js";

// Filled in by vite.config.js from the folders in themes/private/.
const PRIVATE = typeof __VIRGIL_PRIVATE_THEMES__ === "undefined" ? [] : __VIRGIL_PRIVATE_THEMES__;
export const themes = ["default", ...PRIVATE];

const $ = id => document.getElementById(id);
const ready = () => document.documentElement.setAttribute("data-ready", "");

function apply(name) {
  document.getElementById("theme-override")?.remove();
  if (name === "default" || !PRIVATE.includes(name)) { ready(); return }
  const link = document.createElement("link");
  link.id = "theme-override"; link.rel = "stylesheet"; link.href = `/private/${name}/theme.css`;
  link.onload = link.onerror = ready;
  document.head.appendChild(link);
}

const label = name => name[0].toUpperCase() + name.slice(1);
let current = "default";

function choose(name) {
  current = name;
  store.set("theme", name);
  apply(name);
  for (const row of $("themeList").children) row.setAttribute("aria-checked", row.dataset.theme === name);
}

function renderToggles() {
  const list = $("themeList");
  for (const name of themes) {
    const row = document.createElement("button");
    row.type = "button"; row.className = "theme-row"; row.setAttribute("role", "switch"); row.dataset.theme = name;
    const text = document.createElement("span");
    text.textContent = label(name);
    const sub = document.createElement("small");
    sub.textContent = name === "default" ? "Light and dark, follows macOS" : "Private, only in your builds";
    text.appendChild(sub);
    const sw = document.createElement("span"); sw.className = "switch"; sw.setAttribute("aria-hidden", "true");
    row.append(text, sw);
    // Turning a theme on turns the others off; turning the current one off returns to the default.
    row.addEventListener("click", () => choose(name === current && name !== "default" ? "default" : name));
    list.appendChild(row);
  }
  $("themeNote").textContent = PRIVATE.length
    ? "Themes in themes/private/ appear here the next time Virgil is built."
    : "Add your own as themes/private/<name>/theme.css; it appears here the next time Virgil is built.";
}

export function initTheme() {
  // Until you pick one, a private theme (if this build has one) wins over the default.
  const saved = store.get("theme", null);
  current = saved === "default" || PRIVATE.includes(saved) ? saved : PRIVATE[0] || "default";
  apply(current);
  setTimeout(ready, 1500); // never stay hidden if a theme fails to load
  renderToggles();
  choose(current);
}
