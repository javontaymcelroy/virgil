import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, orp, delayFor, rampedWpm, sentenceJump, formatDuration, chunkParagraphs } from "../src/reader/text.js";

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

const sentence = (n, i) => Array.from({ length: n }, (_, k) => `w${i}_${k}`).join(" ") + ".";
const text = (...ns) => ns.map(sentence).join(" ");

function tiles(chunks, n) {
  assert.equal(chunks[0].from, 0);
  assert.equal(chunks[chunks.length - 1].to, n);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].from, chunks[i - 1].to);
}

test("chunkParagraphs groups whole paragraphs", () => {
  const paras = Array.from({ length: 7 }, (_, p) => `${sentence(6, p)} ${sentence(6, p + 10)}`);
  const { tokens } = tokenize(paras.join("\n\n"));
  const c = chunkParagraphs(tokens, { paras: 3 });
  assert.deepEqual(c, [{ from: 0, to: 36 }, { from: 36, to: 72 }, { from: 72, to: 84 }]);
  tiles(c, tokens.length);
});

test("chunkParagraphs cuts a text with no sentence ends at twice maxWords", () => {
  const { tokens } = tokenize(Array.from({ length: 25 }, (_, i) => "w" + i).join(" "));
  const chunks = chunkParagraphs(tokens, { maxWords: 5 });
  assert.deepEqual(chunks.map(c => c.to - c.from), [10, 10, 5]);
});

test("chunkParagraphs splits a wall of text at a sentence end past maxWords", () => {
  const { tokens } = tokenize(text(30, 30, 30, 30));
  const c = chunkParagraphs(tokens, { paras: 4, maxWords: 50 });
  assert.deepEqual(c, [{ from: 0, to: 60 }, { from: 60, to: 120 }]);
});
