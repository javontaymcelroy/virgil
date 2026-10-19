/* Quality-of-life features: recent texts, the library, chapters and paragraph jumps, clearing
   history, voice preview, appearance, the run-up on resume, pausing on blur, and the built-in themes. */
import { test, expect, boot, SHORT, drop, calls } from "./helpers.js";

const THREE = { title: "Three", text: "One two three.\n\nFour five six.\n\nSeven eight nine.", source: "three.txt" };
const BOOK = { title: "Book", text: "Prologue starts here. Chapter one begins now. Chapter two begins later.", source: "book.epub",
  headings: [{ title: "Prologue", word: 0 }, { title: "Chapter one", word: 3 }, { title: "Chapter two", word: 7 }] };

test("recent texts are listed newest first, reopen where they were left, and can be removed", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await drop(page, THREE);
  await page.keyboard.press("Meta+t");
  const rows = page.locator("#recent .theme-row");
  await expect(rows).toHaveText([/Three/, /Short/]);
  await expect(rows.nth(1)).toContainText("short.txt · 0% read");
  await rows.nth(1).click();
  await expect(page.locator("#docTitle")).toHaveText("Short");
  await page.locator("#scrub").fill("5");
  await page.reload();
  await expect(page.locator("#docTitle")).toHaveText("Short");
  await expect(page.locator("#pos")).toHaveText("Word 6 of 10");
  await expect(page.locator("#textPanel")).toHaveClass(/is-open/);   // the open panel is remembered too
  await expect(page.locator("#recent .theme-row").first()).toContainText("56% read");
  await page.getByRole("button", { name: "Remove Short from recent" }).click();
  await expect(page.locator("#recent .theme-row")).toHaveText([/Three/]);
});

test("a document saved by an earlier build is carried into the recent list", async ({ page }) => {
  await boot(page, { storage: { doc: SHORT, pos: { title: "Short", words: 10, idx: 4 } } });
  await expect(page.locator("#docTitle")).toHaveText("Short");
  await expect(page.locator("#pos")).toHaveText("Word 5 of 10");
  expect(await page.evaluate(() => localStorage.getItem("virgil:doc"))).toBeNull();
});

test("Shift+arrows jump by paragraph", async ({ page }) => {
  await boot(page);
  await drop(page, THREE);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("#pos")).toHaveText("Word 4 of 9");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("#pos")).toHaveText("Word 7 of 9");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.locator("#pos")).toHaveText("Word 4 of 9");
});

test("a book's headings become a chapter menu that follows the reader", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await expect(page.locator("#chapterRow")).toBeHidden();
  await drop(page, BOOK);
  const chapters = page.locator("#chapters");
  await expect(chapters).toBeVisible();
  await expect(chapters.locator("option")).toHaveText(["Start", "Prologue", "Chapter one", "Chapter two"]);
  await chapters.selectOption({ label: "Chapter two" });
  await expect(page.locator("#pos")).toHaveText("Word 8 of 11");
  await page.locator("#scrub").fill("4");
  await expect(chapters).toHaveValue("1");
});

test("the reading history can be cleared, with a confirming second click", async ({ page }) => {
  await boot(page, { storage: { log: [{ t: "A", w: 500, p: 300, d: Date.now() }] } });
  const clear = page.locator("#clearLog");
  await expect(page.locator("#stSessions")).toHaveText("1");
  await clear.click();
  await expect(clear).toHaveText("Clear?");
  await expect(clear).toHaveAccessibleName(/Confirm/);
  await clear.click();
  await expect(page.locator("#stSessions")).toHaveText("0");
  await expect(clear).toBeHidden();
  await expect(page.locator("#logEmpty")).toBeVisible();
});

test("Hear it speaks a line in the chosen voice", async ({ page }) => {
  await boot(page, { storage: { voiceId: "com.apple.voice.compact.en-US.Samantha" } });
  await page.locator("#hearVoice").click();
  const [sample] = await calls(page, "speech_speak");
  expect(sample.args.voice).toBe("com.apple.voice.compact.en-US.Samantha");
  expect(sample.args.text).toMatch(/how I sound/);
});

test("Appearance asks the window for light or dark and remembers it", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Meta+,");
  await page.getByRole("button", { name: "Dark" }).click();
  const themes = (await calls(page, "plugin:window|set_theme")).map(c => c.args.value);
  expect(themes.at(-1)).toBe("dark");
  await page.reload();
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  expect((await calls(page, "plugin:window|set_theme")).at(-1).args.value).toBe("dark");
});

test("resuming after a pause backs up to the start of the sentence", async ({ page }) => {
  await boot(page, { storage: { voice: true, voiceId: "com.apple.voice.premium.en-US.Ava" }, knobs: { __msPerWord: 250 } });
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await expect.poll(() => page.locator("#scrub").inputValue().then(Number)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Space");
  await expect(page.locator("#hint")).toHaveText("Paused.");
  await page.keyboard.press("Space");
  expect((await calls(page, "speech_speak")).at(-1).args.text).toMatch(/^One two three/);
});

test("reading pauses when the window loses focus", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await page.keyboard.press("Space");
  await expect(page.locator("#play")).toHaveText("Pause");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("#play")).toHaveText("Read");
  await expect(page.locator("#hint")).toHaveText("Paused.");
});

test("the built-in themes are offered and apply", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Meta+,");
  const rows = page.locator("#themeList .theme-row");
  await expect(rows.filter({ hasText: "Paper" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Night" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "High Contrast" })).toHaveCount(1);
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await rows.filter({ hasText: "Night" }).click();
  await expect(page.locator("#theme-override")).toHaveAttribute("href", "/builtin/night/theme.css");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(before);
  await page.reload();
  await expect(page.locator("#theme-override")).toHaveAttribute("href", "/builtin/night/theme.css");
  // Every built-in theme has a half for each appearance.
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(light);
});

const recentOf = (page, title) => page.evaluate(t => JSON.parse(localStorage.getItem("virgil:recent")).find(d => d.title === t), title);

test("a text saved to the library is listed, reopens where it was left, and is still there after a relaunch", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.locator("#libraryPanel")).toHaveClass(/is-open/);
  await expect(page.locator("#libraryEmpty")).toBeVisible();
  const shelve = page.locator("#shelve");
  await expect(shelve).toBeEnabled();
  await shelve.click();
  await expect(page.locator("#status")).toHaveText("Short is in the library.");
  await expect(page.locator("#library .theme-row")).toHaveText([/Short/]);
  await expect(page.locator("#library .theme-row")).toContainText("short.txt · 10 words · 0% read");
  await expect(shelve).toBeDisabled();
  await expect(shelve).toHaveText("On the shelf");
  // The recent entry points at the shelf instead of carrying the text.
  expect(await recentOf(page, "Short")).toMatchObject({ lib: "short" });
  expect((await recentOf(page, "Short")).text).toBeUndefined();
  await page.locator("#scrub").fill("5");
  await drop(page, THREE);
  await expect(shelve).toBeEnabled();
  await page.reload();
  await expect(page.locator("#docTitle")).toHaveText("Three");
  await page.locator("#library .theme-row").first().click();
  await expect(page.locator("#docTitle")).toHaveText("Short");
  await expect(page.locator("#pos")).toHaveText("Word 6 of 10");
  await expect(page.locator("#library .theme-row")).toContainText("56% read");
  // Saving the same text again keeps it once; a different text under the same title gets its own row
  // (same title and same length counts as the same text, as it does for saved positions).
  await drop(page, { ...SHORT, text: "Ten nine eight seven six five four three two one zero." });
  await page.keyboard.press("Meta+s");
  await expect(page.locator("#library .theme-row")).toHaveCount(2);
  await page.keyboard.press("Meta+s");
  await expect(page.locator("#library .theme-row")).toHaveCount(2);
});

test("a shelved book reopens on launch even when it is too long for local storage", async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "virgil:recent" && v.includes('"text"')) throw new DOMException("quota", "QuotaExceededError"); return set.call(this, k, v) };
  });
  await boot(page);
  await drop(page, SHORT);
  await expect(page.locator("#status")).toContainText("save it to the library");
  await page.keyboard.press("Meta+s");
  await expect(page.locator("#status")).toHaveText("Short is in the library.");
  await page.locator("#scrub").fill("3");
  await page.reload();
  await expect(page.locator("#docTitle")).toHaveText("Short");
  await expect(page.locator("#pos")).toHaveText("Word 4 of 10");
});

test("removing from the library takes a confirming click and hands the text back to the recent list", async ({ page }) => {
  await boot(page);
  await drop(page, SHORT);
  await page.keyboard.press("Meta+s");
  await page.keyboard.press("Meta+l");
  const remove = page.getByRole("button", { name: "Remove Short from the library" });
  await remove.click();
  await expect(remove).toHaveText("Remove?");
  await expect(remove).toHaveAccessibleName(/Confirm/);
  await remove.click();
  await expect(page.locator("#status")).toHaveText("Short was removed from the library.");
  await expect(page.locator("#library")).toBeHidden();
  await expect(page.locator("#libraryEmpty")).toBeVisible();
  await expect(page.locator("#shelve")).toBeEnabled();
  await expect(page.locator("#shelve")).toHaveText("Save to library");
  expect((await recentOf(page, "Short")).text).toBe(SHORT.text);
  await page.reload();
  await expect(page.locator("#docTitle")).toHaveText("Short");
});

test("a library that can't be reached says so, and a missing shelf entry falls back to the sample", async ({ page }) => {
  await boot(page, { knobs: { __libraryFail: true } });
  await drop(page, SHORT);
  await page.keyboard.press("Meta+s");
  await expect(page.locator("#status")).toHaveText("The library folder can't be read.");
  await expect(page.locator("#status")).toHaveClass(/err/);
  await expect(page.locator("#shelve")).toHaveText("Save to library");
  await page.evaluate(() => localStorage.setItem("virgil:recent", JSON.stringify([{ title: "Gone", source: "gone.txt", words: 3, headings: [], lib: "gone" }])));
  await page.reload();
  await expect(page.locator("#docTitle")).not.toHaveText(/Gone|Opening/);
});
