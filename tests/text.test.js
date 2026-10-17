import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, orp, delayFor, rampedWpm, sentenceJump, formatDuration } from "../src/reader/text.js";
import { wordAtTime } from "../src/voice/sync.js";

test("tokenize marks sentence ends, pauses and paragraphs", () => {
  const { tokens, starts } = tokenize("One, two.  Three!\n\nFour \"five.\"\nsix");
  assert.deepEqual(tokens.map(t => t.w), ["One,", "two.", "Three!", "Four", "\"five.\"", "six"]);
  assert.equal(tokens[0].pause, true);
  assert.equal(tokens[1].end, true);
  assert.equal(tokens[2].para, true);
  assert.equal(tokens[4].end, true, "closing quote after the full stop");
  assert.deepEqual(starts, [0, 2, 3, 5]);
});

test("tokenize handles empty text", () => {
  assert.deepEqual(tokenize("  \n\n "), { tokens: [], starts: [0] });
});

test("orp lands a little left of centre and skips leading punctuation", () => {
  assert.equal(orp("a"), 0);
  assert.equal(orp("read"), 1);
  assert.equal(orp("reading"), 2);
  assert.equal(orp("“Hearken!”"), 3, "the e, after the quote and H");
});

test("punctuation and long words hold longer", () => {
  const w = s => tokenize(s).tokens;
  const plain = delayFor(w("word"), 300, true);
  assert.equal(plain, 200);
  assert.ok(delayFor(w("word."), 300, true) > plain);
  assert.equal(delayFor(w("word."), 300, false), plain);
  assert.ok(delayFor(w("extraordinarily"), 300, true) > plain);
});

test("pace eases in over forty words", () => {
  assert.equal(rampedWpm(500, 0), 300);
  assert.equal(rampedWpm(500, 40), 500);
  assert.equal(rampedWpm(500, 400), 500);
});

test("sentence jumps go back to the start before the previous sentence", () => {
  const starts = [0, 5, 10];
  assert.equal(sentenceJump(starts, 9, -1), 5);
  assert.equal(sentenceJump(starts, 6, -1), 0);
  assert.equal(sentenceJump(starts, 6, 1), 10);
  assert.equal(sentenceJump(starts, 12, 1), 10);
});

test("durations read naturally", () => {
  assert.equal(formatDuration(42_000), "42s");
  assert.equal(formatDuration(125_000), "2m 05s");
  assert.equal(formatDuration(3_900_000), "1h 5m");
});

test("wordAtTime finds the word being spoken", () => {
  const t = [{ word: 10, startMs: 0, endMs: 200 }, { word: 11, startMs: 250, endMs: 500 }, { word: 12, startMs: 600, endMs: 900 }];
  assert.equal(wordAtTime(t, -5), -1);
  assert.equal(wordAtTime(t, 0), 10);
  assert.equal(wordAtTime(t, 240), 10);
  assert.equal(wordAtTime(t, 250), 11);
  assert.equal(wordAtTime(t, 5000), 12);
  assert.equal(wordAtTime([], 100), -1);
});
