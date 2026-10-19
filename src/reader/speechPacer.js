/* The system-voice pacer: speaks the text with the platform's own speech synthesis (the Web
   Speech API over the macOS voices) and moves the reader to each word as it is spoken. Same
   shape as the timer pacer (see ./pacer.js). Nothing to prepare or cache: speech
   starts at once, and the synthesizer's word-boundary events give the position for free.

   Text is spoken a few paragraphs at a time (chunkParagraphs). Pause cancels; resume and seek
   speak again from the chosen word. A rate change restarts from the current word, since an
   utterance's rate is fixed once it has started. */

import { chunkParagraphs } from "./text.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Words per minute the macOS voices speak at rate 1. */
export const BASE_WPM = 175;
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/;

/** The voices worth offering: the reader's language (all languages if none match), local, not
 *  novelty, Premium/Enhanced first, then by name. The synthesizer may hand back an empty list
 *  until its `voiceschanged` event. */
export function systemVoices(synth = globalThis.speechSynthesis, lang = globalThis.navigator?.language || "en") {
  if (!synth) return [];
  const rank = v => /premium/i.test(v.voiceURI + v.name) ? 0 : /enhanced/i.test(v.voiceURI + v.name) ? 1 : 2;
  const all = synth.getVoices().filter(v => v.localService !== false && !NOVELTY.test(v.name));
  const prefix = lang.slice(0, 2).toLowerCase();
  const mine = all.filter(v => (v.lang || "").toLowerCase().startsWith(prefix));
  return (mine.length ? mine : all)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map(v => ({ id: v.voiceURI, name: v.name + (rank(v) === 0 ? " (Premium)" : rank(v) === 1 ? " (Enhanced)" : ""), lang: v.lang, premium: rank(v) < 2, voice: v }));
}

/** `deps` lets tests pass a fake synthesizer and utterance class. `startTimeout` is how long
 *  a voice may stay silent after `speak` before it is reported as failed. */
export function createSpeechPacer(reader, deps = {}) {
  const { synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, chunking = {}, startTimeout = 3000 } = deps;
  let chunks = [], primed = null, run = 0, cur = -1, offsets = [], last = -1, rateTimer = 0, watchdog = 0;

  function prime() {
    if (primed === reader.tokens) return;
    primed = reader.tokens;
    chunks = chunkParagraphs(reader.tokens, chunking);
  }
  const chunkOf = i => chunks.findIndex(c => i >= c.from && i < c.to);

  /** The chunk's text from word `at`, plus each word's character offset so boundary events
   *  map back to a token. Paragraph breaks become newlines so the voice pauses there. */
  function script(c, at) {
    const { to } = chunks[c];
    let s = "", offs = [];
    for (let i = at; i < to; i++) {
      offs.push(s.length);
      s += reader.tokens[i].w + (i + 1 < to ? (reader.tokens[i].para ? "\n\n" : " ") : "");
    }
    return { s, offs };
  }

  const voiceOf = () => {
    return synth.getVoices().find(v => v.voiceURI === reader.settings.voiceId) || null;
  };

  function speak(c, at) {
    const my = ++run;
    cur = c; last = -1;
    const { s, offs } = script(c, at);
    offsets = offs;
    const u = new Utterance(s);
    u.voice = voiceOf();
    u.rate = clamp(reader.settings.wpm / BASE_WPM, 0.5, 4);
    u.onboundary = e => {
      if (my !== run || e.name === "sentence") return;
      clearTimeout(watchdog);
      // Last word whose offset is at or before the boundary: a linear scan from the previous
      // word, since boundaries arrive in order.
      let k = Math.max(0, last - at);
      while (k + 1 < offsets.length && offsets[k + 1] <= e.charIndex) k++;
      const w = at + k;
      if (w !== last) { last = w; reader.advanceTo(w) }
    };
    u.onend = () => {
      if (my !== run) return;
      clearTimeout(watchdog);
      if (c + 1 < chunks.length) speak(c + 1, chunks[c + 1].from); else reader.finish();
    };
    u.onerror = e => { if (my === run && e.error !== "interrupted" && e.error !== "canceled") reader.fail(e.error || "Speech failed.") };
    synth.cancel();
    synth.speak(u);
    if (last < 0) { last = at; reader.advanceTo(at) }
    // A voice that accepts the text but never speaks (a broken download, say) would otherwise
    // leave the reader "playing" in silence for good.
    clearTimeout(watchdog);
    watchdog = setTimeout(() => { if (my === run) reader.fail("The system voice didn't start. Try another voice.") }, startTimeout + s.length * 5);
  }

  function start(index) {
    prime();
    if (!synth || !Utterance) { reader.fail("This system has no speech synthesis."); return }
    speak(chunkOf(index), index);
  }

  function stop() { run++; clearTimeout(rateTimer); clearTimeout(watchdog); synth && synth.cancel() }

  /** The slider changed while reading: restart from the current word with the new rate, once
   *  the slider has settled. */
  function setRate() {
    clearTimeout(rateTimer);
    rateTimer = setTimeout(() => { if (cur >= 0 && synth.speaking) speak(cur, Math.max(last, chunks[cur].from)) }, 300);
  }

  /** What is actually spoken: the slider's pace, capped at four times the voice's natural one. */
  const liveWpm = () => Math.min(reader.settings.wpm, BASE_WPM * 4);
  return { start, stop, liveWpm, setRate, prime };
}
