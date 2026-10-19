import { test as base, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

const SHIM = fileURLToPath(new URL("./tauri-shim.js", import.meta.url));
export const SHORT = { title: "Short", text: "One two three four five. Six seven eight nine ten.", source: "short.txt" };

/** `boot(page, { knobs, storage })` loads the app with the Tauri shim. `knobs` become window
 *  globals the shim reads (see tauri-shim.js); `storage` seeds "virgil:" local-storage keys. */
export async function boot(page, { knobs = {}, storage = {} } = {}) {
  storage = { theme: "default", ...storage };   // the shipped theme, not a private one on this Mac
  await page.addInitScript(({ knobs, storage }) => {
    Object.assign(window, knobs);
    // Seeds only what the page hasn't stored yet, so a reload inside a test keeps what the page saved.
    for (const [k, v] of Object.entries(storage)) if (localStorage.getItem("virgil:" + k) == null) localStorage.setItem("virgil:" + k, JSON.stringify(v));
  }, { knobs, storage });
  await page.addInitScript({ path: SHIM });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "");
  await expect(page.locator("#docTitle")).not.toHaveText("Opening…");
}

export const calls = (page, cmd) => page.evaluate(c => window.__calls.filter(x => x.cmd === c), cmd);

/** Loads a document the way a dropped file arrives: through the import:done event. */
export const drop = (page, doc) => page.evaluate(d => window.__emit("import:done", d), doc);

/** Contrast ratio between an element's text colour and the background behind it. */
export const contrast = (page, selector, prop = "color") => page.evaluate(([sel, prop]) => {
  const el = document.querySelector(sel);
  const rgb = s => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } };
  const bgOf = e => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0) return c } return { r: 255, g: 255, b: 255, a: 1 } };
  const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) };
  const bg = bgOf(el.parentElement || el);
  let fg;
  const ratio = fg => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05) };
  if (prop === "ring") {
    // The best-contrasting ring colour counts: a two-tone ring (page colour, then accent) is drawn to be seen on any button.
    const cs = getComputedStyle(el);
    const src = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? cs.outlineColor : cs.boxShadow;
    const colors = src.match(/rgba?\([^)]*\)/g) || [];
    return Math.max(0, ...colors.map(c => ratio(over(rgb(c), bg))));
  }
  return ratio(over(rgb(getComputedStyle(el)[prop]), bg));
}, [selector, prop]);

/** The base test plus: any uncaught page error fails the test. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await use(page);
    expect(errors, "uncaught page errors").toEqual([]);
  },
});
export { expect };
