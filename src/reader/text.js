/* Pure text functions for the reader: no DOM, so they run under `node --test`. */

/** Splits text into word tokens. Paragraphs are separated by a blank line.
 *  Each token notes whether it ends a sentence, carries a clause pause, or ends a paragraph.
 *  `starts` holds the index of the first word of every sentence. */
export function tokenize(text) {
  const tokens = [], starts = [0];
  const paras = text.replace(/\r/g, "").split(/\n\s*\n+/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  paras.forEach((p, pi) => {
    const words = p.split(" ");
    words.forEach((w, wi) => {
      const bare = w.replace(/["'”’)\]]+$/, "");
      const t = { w, end: /[.!?…]$/.test(bare), pause: /[,;:—–-]$/.test(bare), para: wi === words.length - 1 && pi < paras.length - 1 };
      tokens.push(t);
      if (t.end || t.para) starts.push(tokens.length);
    });
  });
  const s = [...new Set(starts)].filter(i => i < tokens.length);
  return { tokens, starts: s.length ? s : [0] };
}

/** Optimal recognition point: the letter the eye should land on, a little left of centre. */
export function orp(word) {
  const core = word.replace(/^[^\p{L}\p{N}]+/u, "");
  const lead = word.length - core.length;
  const n = core.replace(/[^\p{L}\p{N}]+$/u, "").length;
  const k = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4;
  return Math.min(lead + k, word.length - 1);
}

/** Pace while easing in: starts at 60% and reaches full pace after 40 words. */
export function rampedWpm(wpm, wordsSinceStart) {
  return Math.round(wpm * Math.min(1, 0.6 + 0.4 * wordsSinceStart / 40));
}

/** How long a group of words stays on screen, in ms. Long words and punctuation hold longer. */
export function delayFor(group, wpm, restAtPunctuation) {
  const base = 60000 / wpm * group.length;
  const last = group[group.length - 1];
  let m = 1;
  const longest = Math.max(...group.map(t => t.w.length));
  if (longest > 8) m += 0.15 + (longest - 8) * 0.04;
  if (restAtPunctuation) { if (last.para) m += 1.6; else if (last.end) m += 1.1; else if (last.pause) m += 0.5 }
  return base * m;
}

/** Index of the sentence containing word i. */
export function sentenceIndex(starts, i) {
  let s = 0;
  for (let k = 0; k < starts.length; k++) { if (starts[k] <= i) s = k; else break }
  return s;
}

/** Word index to jump to for the previous (dir < 0) or next sentence. Going back from more than
 *  two words into a sentence returns to its start first, like a music player's back button. */
export function sentenceJump(starts, i, dir) {
  const s = sentenceIndex(starts, i);
  if (dir < 0) return (i - starts[s] > 2 || s === 0) ? starts[s] : starts[s - 1];
  return starts[Math.min(s + 1, starts.length - 1)];
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** A short title for pasted text: its first five words. */
export function titleFor(text) {
  const first = text.trim().split(/\s+/).slice(0, 5).join(" ");
  return first ? first + "…" : "Pasted text";
}

/** Cuts the text into runs of whole paragraphs, `paras` at a time. A paragraph longer than
 *  `maxWords` is closed at the next sentence end instead, so a wall of text is still read in
 *  pieces; one with no sentence ends at all is cut at twice that. */
export function chunkParagraphs(tokens, { paras = 4, maxWords = 400 } = {}) {
  const chunks = [];
  let from = 0, count = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], n = i + 1 - from;
    if (t.para) count++;
    if ((t.para && count >= paras) || (t.end && n >= maxWords) || n >= 2 * maxWords) { chunks.push({ from, to: i + 1 }); from = i + 1; count = 0 }
  }
  if (from < tokens.length) chunks.push({ from, to: tokens.length });
  return chunks;
}
