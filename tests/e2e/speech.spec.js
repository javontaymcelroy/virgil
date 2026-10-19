/* Read aloud through the IPC shim: what the page asks Rust for, and how it copes when the
   voice goes quiet or the user scrubs. */
import { test, expect, finding, boot, SHORT, drop, calls } from "./helpers.js";

const VOICE = { storage: { voice: true, voiceId: "com.apple.voice.premium.en-US.Ava" } };

test("Space speaks the first chunk with the chosen voice and follows its word boundaries", async ({ page }) => {
  await boot(page, { ...VOICE, knobs: { __msPerWord: 150 } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  const [first] = await calls(page, "speech_speak");
  expect(first.args.voice).toBe("com.apple.voice.premium.en-US.Ava");
  expect(first.args.text).toMatch(/^One two three/);
  await expect.poll(() => page.locator("#scrub").inputValue().then(Number)).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#hint")).toHaveText("Finished.", { timeout: 8000 });
});

test("a voice that never starts is reported and playback stops", async ({ page }) => {
  finding("B1");
  await boot(page, { ...VOICE, knobs: { __speechSilent: true } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveText("Read", { timeout: 8000 });
  await expect(page.locator("#status")).toHaveText(/voice/i);
});

test("a voice that fails to start is reported", async ({ page }) => {
  await boot(page, { ...VOICE, knobs: { __speechFail: true } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveText("Read");
  await expect(page.locator("#status")).toHaveText(/could not start/i);
});

test("dragging the position slider restarts speech once, not once per pixel", async ({ page }) => {
  finding("B10");
  await boot(page, { ...VOICE, knobs: { __msPerWord: 400 } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await page.locator("#scrub").evaluate(s => { for (let v = 1; v <= 8; v++) { s.value = v; s.dispatchEvent(new Event("input", { bubbles: true })) } s.dispatchEvent(new Event("change", { bubbles: true })) });
  await page.waitForTimeout(500);
  const speaks = await calls(page, "speech_speak");
  expect(speaks.length, "speech_speak calls").toBeLessThanOrEqual(3);
  await expect(page.locator("#play")).toHaveText("Pause");
});

test("pause stops the voice and resume speaks from the current word", async ({ page }) => {
  await boot(page, { ...VOICE, knobs: { __msPerWord: 200 } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await expect.poll(() => page.locator("#scrub").inputValue().then(Number)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Space");
  const at = Number(await page.locator("#scrub").inputValue());
  expect((await calls(page, "speech_stop")).length).toBeGreaterThan(0);
  await expect(page.locator("#hint")).toHaveText("Paused.");
  await page.keyboard.press("Space");
  const last = (await calls(page, "speech_speak")).at(-1);
  expect(last.args.text.startsWith(SHORT.text.split(" ")[at]), last.args.text).toBe(true);
});

test("a newly installed voice appears when the window regains focus", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#voice option")).toHaveCount(2);
  await page.evaluate(() => { window.__voices = [...window.__voices, { id: "com.apple.voice.premium.en-US.Zoe", name: "Zoe", lang: "en-US", quality: "premium" }]; window.dispatchEvent(new Event("focus")) });
  await expect(page.locator("#voice option")).toHaveCount(3);
});
