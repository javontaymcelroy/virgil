/* Missing and stale states: what the reader says after a seek, a failed save, an empty voice
   list, a change while reading. */
import { test, expect, boot, SHORT, drop, calls } from "./helpers.js";

test("seeking after the text finished clears Finished and offers Read, not Again", async ({ page }) => {
  await boot(page, { storage: { wpm: 1000 } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await expect(page.locator("#hint")).toHaveText("Finished.", { timeout: 10000 });
  await page.locator("#scrub").fill("0");
  await expect(page.locator("#hint")).not.toHaveText("Finished.");
  await expect(page.locator("#play")).toHaveText("Read");
});

test("a saved voice pick survives the voice list arriving late", async ({ page }) => {
  await boot(page, { storage: { voiceId: "com.apple.voice.compact.en-US.Samantha" } });
  await expect(page.locator("#voice")).toHaveValue("com.apple.voice.compact.en-US.Samantha");
});

test("a text too big to keep says so instead of silently forgetting it", async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "virgil:doc") throw new DOMException("quota", "QuotaExceededError"); return set.call(this, k, v) };
  });
  await boot(page);
  await drop(page, SHORT);
  await expect(page.locator("#status")).toHaveText(/kept|keep|next time/i);
});

test("the loaded message is visible while the Add text panel is closed", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#textPanel")).not.toHaveClass(/is-open/);
  await drop(page, SHORT);
  await expect(page.getByText("Loaded 10 words from short.txt.")).toBeInViewport();
});

test("the hint is a live region so Paused and Finished are announced", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#hint")).toHaveAttribute("aria-live", /polite|assertive/);
});

test("turning Read aloud on while reading switches to the voice at once", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveText("Pause");
  await page.locator("#optVoice").check();
  await expect.poll(() => calls(page, "speech_speak").then(c => c.length)).toBeGreaterThan(0);
  await expect(page.locator("#play")).toHaveText("Pause");
});

test("changing the voice while reading keeps reading with the new voice", async ({ page }) => {
  await boot(page, { storage: { voice: true, voiceId: "com.apple.voice.premium.en-US.Ava" } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await page.locator("#voice").selectOption("com.apple.voice.compact.en-US.Samantha");
  await expect(page.locator("#play")).toHaveText("Pause");
  await expect.poll(() => calls(page, "speech_speak").then(c => c.at(-1)?.args.voice)).toBe("com.apple.voice.compact.en-US.Samantha");
});

test("no installed voices: the menu says so and the note shows", async ({ page }) => {
  await boot(page, { knobs: { __voices: [] } });
  await expect(page.locator("#voice")).toBeDisabled();
  await expect(page.locator("#voice")).toContainText(/no voices/i);
  await expect(page.locator("#voiceNote")).toBeVisible();
});

test("a failed voice query is reported, not swallowed", async ({ page }) => {
  await boot(page, { knobs: { __voicesFail: true } });
  await expect(page.locator("#voice")).toBeDisabled();
  await expect(page.locator("#voiceNote")).toBeVisible();
});

test("the live pace never claims more than the voice can speak", async ({ page }) => {
  await boot(page, { storage: { voice: true, wpm: 1000 } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  const live = await page.locator("#wpmLive").textContent();
  expect(parseInt(live), live).toBeLessThanOrEqual(700);
});

test("the delete button's accessible name changes when it asks for confirmation", async ({ page }) => {
  await boot(page, { knobs: { __themes: ["midnight"] } });
  await page.keyboard.press("Meta+,");
  const del = page.getByRole("button", { name: "Delete Midnight" });
  await del.click();
  await expect(del).toHaveText("Delete?");
  await expect(del).not.toHaveAccessibleName("Delete Midnight");
});

test("a long source name in the hint is not cut off", async ({ page }) => {
  await boot(page);
  await drop(page, { ...SHORT, source: "A Very Long Chapter Title From An Even Longer Book Name That Goes On And On For A While.epub" });
  const clipped = await page.locator("#hint").evaluate(el => el.scrollWidth > el.clientWidth + 1);
  expect(clipped).toBe(false);
});

test("Open file loads the document the app returns", async ({ page }) => {
  await boot(page, { knobs: { __doc: SHORT } });
  await page.keyboard.press("Meta+o");
  await expect(page.locator("#docTitle")).toHaveText("Short");
});

test("an empty document is refused with a message", async ({ page }) => {
  await boot(page);
  await drop(page, { title: "Blank", text: "   ", source: "blank.txt" });
  await expect(page.locator("#status")).toHaveText("blank.txt has no readable words.");
});
