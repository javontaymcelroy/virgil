/* Themes are folders of CSS custom properties: themes/default/ ships with the app, and any
   themes/private/<name>/theme.css on your machine is found at build time and offered under
   Settings → Theme, and is used by default. A chosen theme loads after the default, so it only overrides what it sets. */

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

export function initTheme() {
  // Until you pick one, a private theme (if this build has one) wins over the default.
  const saved = store.get("theme", null);
  const current = saved === "default" || PRIVATE.includes(saved) ? saved : PRIVATE[0] || "default";
  apply(current);
  setTimeout(ready, 1500); // never stay hidden if a theme fails to load
  if (themes.length < 2) return;
  const select = $("theme");
  for (const name of themes) {
    const o = document.createElement("option");
    o.value = name; o.textContent = name[0].toUpperCase() + name.slice(1);
    select.appendChild(o);
  }
  select.value = current;
  select.addEventListener("change", () => { store.set("theme", select.value); apply(select.value) });
  $("themeSetting").hidden = false;
}
