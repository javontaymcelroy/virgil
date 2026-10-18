/* Drives the system-voice pacer with a fake synthesizer: what is spoken, from where, and how
   boundary events move the reader. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/reader/text.js";
import { createSpeechPacer, systemVoices, BASE_WPM } from "../src/reader/speechPacer.js";

// Five paragraphs of ten words, two paragraphs per chunk: chunks [0,20) [20,40) [40,50).
const TEXT = Array.from({ length: 5 }, (_, s) => Array.from({ length: 10 }, (_, k) => `s${s}w${k}`).join(" ") + ".").join("\n\n");

class FakeUtterance {
  constructor(text) { this.text = text; this.voice = null; this.rate = 1; this.onboundary = this.onend = this.onerror = null }
  /** Fires a word boundary at the start of the n-th word of this utterance. */
  word(n) { const i = [...this.text.matchAll(/\S+/g)][n].index; this.onboundary && this.onboundary({ name: "word", charIndex: i }) }
  end() { this.onend && this.onend() }
}

function harness(voices = [{ voiceURI: "com.apple.voice.premium.en-US.Ava", name: "Ava", lang: "en-US", localService: true }]) {
  const { tokens, starts } = tokenize(TEXT);
  const reader = {
    tokens, starts, settings: { wpm: 350, voiceId: "com.apple.voice.premium.en-US.Ava" },
    shown: [], fails: [], finished: false,
    advanceTo(i) { this.shown.push(i) }, finish() { this.finished = true }, fail(m) { this.fails.push(m) },
  };
  const synth = { spoken: [], cancels: 0, speaking: false, getVoices: () => voices, speak(u) { synth.spoken.push(u); synth.speaking = true }, cancel() { synth.cancels++; synth.speaking = false } };
  const pacer = createSpeechPacer(reader, { synth, Utterance: FakeUtterance, chunking: { paras: 2 } });
  return { reader, synth, pacer, tokens, current: () => synth.spoken.at(-1) };
}

test("play speaks the first chunk with the chosen voice at the slider's rate, showing the first word at once", () => {
  const h = harness();
  h.pacer.start(0);
  assert.equal(h.synth.spoken.length, 1);
  const u = h.current();
  assert.ok(u.text.startsWith("s0w0 s0w1") && u.text.includes("\n\n") && u.text.endsWith("s1w9."), "two paragraphs, break kept");
  assert.equal(u.voice.name, "Ava");
  assert.equal(u.rate, 350 / BASE_WPM);
  assert.deepEqual(h.reader.shown, [0]);
});

test("boundary events move the reader word by word, across the paragraph break", () => {
  const h = harness();
  h.pacer.start(0);
  const u = h.current();
  u.word(1); u.word(2); u.word(10); u.word(11);
  assert.deepEqual(h.reader.shown, [0, 1, 2, 10, 11]);
});

test("a chunk ending speaks the next one; the last one finishes the text", () => {
  const h = harness();
  h.pacer.start(0);
  h.current().end();
  assert.equal(h.synth.spoken.length, 2);
  assert.ok(h.current().text.startsWith("s2w0"));
  assert.equal(h.reader.shown.at(-1), 20);
  h.current().end(); h.current().end();
  assert.equal(h.reader.finished, true);
});

test("pause cancels; resume and seek speak again from the chosen word", () => {
  const h = harness();
  h.pacer.start(0);
  h.current().word(3);
  h.pacer.stop();
  assert.equal(h.synth.speaking, false);
  h.pacer.start(3);
  assert.ok(h.current().text.startsWith("s0w3 s0w4"), "resumes mid-chunk, not from its start");
  h.pacer.start(25);
  assert.ok(h.current().text.startsWith("s2w5"));
  h.current().word(2);
  assert.equal(h.reader.shown.at(-1), 27);
});

test("events from a cancelled utterance are ignored", () => {
  const h = harness();
  h.pacer.start(0);
  const old = h.current();
  h.pacer.start(20);
  old.word(5); old.end();
  assert.equal(h.synth.spoken.length, 2, "the stale end did not start another chunk");
  assert.equal(h.reader.shown.at(-1), 20);
});

test("a rate change restarts from the current word once the slider settles", async () => {
  const h = harness();
  h.pacer.start(0);
  h.current().word(4);
  h.reader.settings.wpm = 175;
  h.pacer.setRate(); h.pacer.setRate();
  await new Promise(r => setTimeout(r, 350));
  assert.equal(h.synth.spoken.length, 2, "one restart, not two");
  assert.ok(h.current().text.startsWith("s0w4"));
  assert.equal(h.current().rate, 1);
});

test("systemVoices drops novelty voices and puts Premium first", () => {
  const synth = { getVoices: () => [
    { voiceURI: "com.apple.speech.synthesis.voice.Zarvox", name: "Zarvox", lang: "en-US", localService: true },
    { voiceURI: "com.apple.voice.compact.en-US.Samantha", name: "Samantha", lang: "en-US", localService: true },
    { voiceURI: "com.apple.voice.premium.en-US.Ava", name: "Ava", lang: "en-US", localService: true },
    { voiceURI: "com.apple.eloquence.en-US.Reed", name: "Reed", lang: "en-US", localService: true },
    { voiceURI: "com.apple.voice.compact.fr-FR.Thomas", name: "Thomas", lang: "fr-FR", localService: true },
  ] };
  assert.deepEqual(systemVoices(synth, "en-US").map(v => v.name), ["Ava (Premium)", "Samantha"], "only the reader's language");
  assert.deepEqual(systemVoices(synth, "en-US").map(v => v.premium), [true, false]);
  assert.equal(systemVoices(synth, "en-US")[0].id, "com.apple.voice.premium.en-US.Ava");
  assert.deepEqual(systemVoices(synth, "de").map(v => v.name), ["Ava (Premium)", "Samantha", "Thomas"], "no match: every language");
  assert.deepEqual(systemVoices(undefined), []);
});
