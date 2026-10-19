/* Screenshots for the design pass and the layout invariants behind them. */
import { test, expect, boot, SHORT, drop } from "./helpers.js";

const DIR = "tests/e2e/__screenshots__";
// Lets the drawer and word-enter transitions finish; drawer shots are viewport-sized because
// a fixed drawer does not survive a full-page capture.
const settle = page => page.waitForTimeout(600);

for (const width of [1280, 980, 640]) {
  for (const scheme of ["light", "dark"]) {
    test(`layout ${width}px ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page, { knobs: { __themes: ["midnight"] }, storage: { log: [{ t: "The Tell-Tale Heart", w: 1240, p: 320, d: Date.now() }] } });
      await drop(page, SHORT);
      await settle(page);
      await page.screenshot({ path: `${DIR}/reader-${width}-${scheme}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await page.keyboard.press("Meta+,");
      await page.locator("#newTheme").click();
      await settle(page);
      await page.screenshot({ path: `${DIR}/settings-${width}-${scheme}.png` });
      // Under 980px the open drawer covers the masthead toggles (design finding D2), so switch by keyboard.
      await page.keyboard.press("Meta+t");
      await expect(page.locator("#textPanel")).toHaveClass(/is-open/);
      await settle(page);
      await page.screenshot({ path: `${DIR}/addtext-${width}-${scheme}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
}

for (const theme of ["paper", "night", "high-contrast"]) {
  for (const scheme of ["light", "dark"]) {
    test(`theme ${theme} ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page, { storage: { theme, recent: [SHORT] } });
      await drop(page, { ...SHORT, headings: [{ title: "Opening", word: 0 }, { title: "Second", word: 5 }] });
      await page.keyboard.press("Meta+,");
      await settle(page);
      await page.screenshot({ path: `${DIR}/theme-${theme}-${scheme}.png` });
    });
  }
}

for (const width of [1280, 640]) {
  test(`Library open at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await boot(page);
    await drop(page, SHORT);
    await page.keyboard.press("Meta+s");
    await drop(page, { title: "A Longer Second Document", text: "Alpha beta gamma delta.", source: "second.md" });
    await page.keyboard.press("Meta+l");
    await expect(page.locator("#libraryPanel")).toHaveClass(/is-open/);
    await settle(page);
    await page.screenshot({ path: `${DIR}/library-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("the word band is centred on the reader card, whatever sits below it", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await page.keyboard.press("Space"); await page.keyboard.press("Space");
  await expect(page.locator("#hint")).toHaveText("Paused.");
  const off = await page.evaluate(() => {
    const card = document.querySelector(".lectern").getBoundingClientRect();
    const [top, bottom] = [...document.querySelectorAll(".guide")].map(e => e.getBoundingClientRect());
    return Math.abs((top.top + bottom.bottom) / 2 - (card.top + card.height / 2));
  });
  expect(off).toBeLessThan(1);
});

for (const scheme of ["light", "dark"]) {
  test(`popped out, ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 300 });
    await page.emulateMedia({ colorScheme: scheme });
    await boot(page);
    await drop(page, SHORT);
    await page.locator("#popout").click();
    await expect(page.locator("body")).toHaveClass(/popped/);
    await settle(page);
    await page.screenshot({ path: `${DIR}/popped-${scheme}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBeLessThanOrEqual(0);
  });
}
