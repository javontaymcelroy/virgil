/* Accessibility: axe over every view, plus the things axe can't see (focus ring contrast,
   reduced motion, hit sizes, the drawer overlay). */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, boot, SHORT, drop, contrast } from "./helpers.js";

const axe = page => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const report = r => r.violations.map(v => `${v.id}: ${v.help}\n  ${v.nodes.map(n => n.target.join(" ")).join("\n  ")}`).join("\n");

for (const scheme of ["light", "dark"]) {
  test(`axe: main view, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await boot(page, { knobs: { __voices: [{ id: "x", name: "Samantha", lang: "en-US", quality: "default" }] } });
    await drop(page, SHORT);
    const r = await axe(page);
    expect(report(r)).toBe("");
  });
}

test("axe: Library open, with a shelved text and the button disabled", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await page.keyboard.press("Meta+s");
  await page.keyboard.press("Meta+l");
  await expect(page.locator("#shelve")).toBeDisabled();
  const r = await axe(page);
  expect(report(r)).toBe("");
});

test("axe: Add text panel open, with the recent list", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await page.keyboard.press("Meta+t");
  const r = await axe(page);
  expect(report(r)).toBe("");
});

test("axe: Settings with a theme and the builder open", async ({ page }) => {
  await boot(page, { knobs: { __themes: ["midnight"] } });
  await page.keyboard.press("Meta+,");
  await page.locator("#newTheme").click();
  const r = await axe(page);
  expect(report(r)).toBe("");
});

test("the position slider announces a word, not a number", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await expect(page.locator("#scrub")).toHaveAttribute("aria-valuetext", /Word 1 of 10/);
});

test("the pace slider's name includes its visible label", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#wpm")).toHaveAccessibleName(/Pace/);
});

for (const scheme of ["light", "dark"]) {
  test(`focus ring and faint text have enough contrast, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await boot(page, { knobs: { __voices: [{ id: "x", name: "Samantha", lang: "en-US", quality: "default" }] } });
    await page.locator("#stage").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#back")).toBeFocused();
    expect(await contrast(page, "#back", "ring"), "focus ring").toBeGreaterThanOrEqual(3);
    expect(await contrast(page, "#voiceNote"), "voice note").toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, ".footnote"), "footnote").toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, "#logEmpty"), "log note").toBeGreaterThanOrEqual(4.5);
  });
}

test("focus rings inside the theme list are drawn where they can't be clipped", async ({ page }) => {
  await boot(page, { knobs: { __themes: ["midnight"] } });
  await page.keyboard.press("Meta+,");
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveClass(/theme-action|theme-row/);
  const clips = await page.locator("#themeList").evaluate(el => getComputedStyle(el).overflow === "hidden");
  const shadow = await focused.evaluate(el => getComputedStyle(el).boxShadow);
  expect(!clips || shadow.includes("inset"), shadow).toBe(true);
  expect(await contrast(page, ":focus", "ring")).toBeGreaterThanOrEqual(3);
});

test("every control is at least 24px tall", async ({ page }) => {
  await boot(page, { knobs: { __themes: ["midnight"] } });
  await page.keyboard.press("Meta+,");
  await page.locator("#newTheme").click();
  const small = await page.evaluate(() => [...document.querySelectorAll("button, select, input:not([type=checkbox]):not([type=color]), textarea")]
    .filter(el => el.offsetParent !== null)
    .map(el => [el.id || el.className || el.tagName, el.getBoundingClientRect().height])
    .filter(([, h]) => h < 24));
  expect(small).toEqual([]);
});

test("reduced motion turns every transition off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page, { knobs: { __themes: ["midnight"] } });
  await page.keyboard.press("Meta+,");
  await page.locator("#newTheme").click();
  const moving = await page.evaluate(() => [...document.querySelectorAll("*")]
    .map(el => [el.id || el.className, getComputedStyle(el)])
    .filter(([, cs]) => cs.transitionProperty !== "none" && cs.transitionDuration.split(",").some(d => parseFloat(d) > 0.01))
    .map(([n, cs]) => `${n}: ${cs.transitionProperty} ${cs.transitionDuration}`));
  expect([...new Set(moving)]).toEqual([]);
});

test("under 980px the open drawer covers the page and makes it inert", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await boot(page);
  await page.keyboard.press("Meta+t");
  await expect(page.locator(".wrap")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(page.locator(".wrap")).not.toHaveAttribute("inert", "");
  await page.keyboard.press("Meta+l");
  await expect(page.locator(".wrap")).toHaveAttribute("inert", "");
  await expect(page.locator("#libraryPanel")).toHaveClass(/is-open/);
});

test("an error is shown and announced with every panel closed", async ({ page }) => {
  await boot(page);
  await drop(page, { title: "Blank", text: " ", source: "blank.txt" });
  await expect(page.locator("#status")).toBeInViewport();
  await expect(page.locator("#status")).toHaveAttribute("role", "status");
  await expect(page.locator("#textPanel")).not.toHaveClass(/is-open/);
});
