/* Pop out: the window shrinks to a small one that stays on top and shows only the reader, so
   a text can run beside other work. Pop in restores the window. The page is the same; a
   class on <body> hides everything but the reader card. */

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { setStatus } from "./import.js";
import { closePanel } from "./panel.js";

const POPPED = { w: 520, h: 300, minW: 360, minH: 220 };
const MAIN = { minW: 560, minH: 640 };   // as in tauri.conf.json
let before = null;

export const popped = () => document.body.classList.contains("popped");

export async function setPopped(on) {
  if (on === popped()) return;
  const btn = document.getElementById("popout");
  // An open panel would count the small window as narrow and dim the page under it.
  if (on) closePanel();
  document.body.classList.toggle("popped", on);
  btn.setAttribute("aria-pressed", on);
  btn.setAttribute("aria-label", on ? "Pop the reader back in" : "Pop out the reader");
  if (!isTauri()) return;
  const win = getCurrentWindow();
  try {
    if (on) {
      before = { w: window.innerWidth, h: window.innerHeight };
      await win.setMinSize(new LogicalSize(POPPED.minW, POPPED.minH));
      await win.setSize(new LogicalSize(POPPED.w, POPPED.h));
      await win.setAlwaysOnTop(true);
    } else {
      await win.setAlwaysOnTop(false);
      await win.setMinSize(new LogicalSize(MAIN.minW, MAIN.minH));
      if (before) await win.setSize(new LogicalSize(before.w, before.h));
    }
  } catch (err) { setStatus(String(err), "err") }
}

export function wirePopout() {
  document.getElementById("popout").addEventListener("click", () => setPopped(!popped()));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && popped() && !e.defaultPrevented) { e.preventDefault(); setPopped(false) }
  });
}
