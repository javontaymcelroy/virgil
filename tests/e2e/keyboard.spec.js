/* Keyboard: the reader's shortcuts must not steal keys from controls that use them. */
import { test, expect, boot, SHORT, drop } from "./helpers.js";

test.beforeEach(async ({ page }) => { await boot(page); await drop(page, SHORT) });

test("Space on a focused checkbox toggles the checkbox, not playback", async ({ page }) => {
  const box = page.locator("#optPunct");
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).not.toBeChecked();
  await expect(page.locator("#play")).toHaveText("Read");
});

test("Space on a focused button activates that button", async ({ page }) => {
  await page.locator("#fwd").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#pos")).toHaveText("Word 6 of 10");
  await expect(page.locator("#play")).toHaveText("Read");
});

test("arrow keys on the position slider step one word, not one sentence", async ({ page }) => {
  await page.locator("#scrub").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#pos")).toHaveText("Word 2 of 10");
});

test("arrow keys inside an open drawer are left to the drawer", async ({ page }) => {
  await page.keyboard.press("Meta+,");
  await expect(page.locator("#settingsPanel")).toHaveClass(/is-open/);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#wpmVal")).toHaveText("300");
});

test("Enter on the stage starts reading, like a button", async ({ page }) => {
  await page.locator("#stage").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#play")).toHaveText("Pause");
});

test("passage words are buttons, not bare spans", async ({ page }) => {
  await expect(page.locator("#ctxText button, #ctxText [role=button]").first()).toBeAttached();
});

test("shortcuts are declared on their controls", async ({ page }) => {
  await expect(page.locator("#play")).toHaveAttribute("aria-keyshortcuts", /Space/);
  await expect(page.locator("#back")).toHaveAttribute("aria-keyshortcuts", /ArrowLeft/);
});

test("Escape closes the drawer and returns focus to its toggle", async ({ page }) => {
  await page.getByRole("button", { name: "Add text" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#textPanel")).not.toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: "Add text" })).toBeFocused();
});
