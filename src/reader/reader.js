/* The RSVP reader: owns the text, the position and everything on screen. Timing is delegated
   to a pacer (./pacer.js), so a voice can drive the same reader later. */

import { tokenize, orp, sentenceIndex, sentenceJump, formatDuration } from "./text.js";
import { createTimerPacer } from "./pacer.js";
import { createSpeechPacer, systemVoices } from "./speechPacer.js";
import { systemSpeech } from "../voice/systemSpeech.js";
import { setStatus } from "../import.js";
import { store } from "../store.js";

const $ = id => document.getElementById(id);
const MIN_WPM = 100, MAX_WPM = 1000;

export function createReader() {
  const settings = {
    wpm: store.get("wpm", 300),
    chunk: store.get("chunk", 1),
    punct: store.get("punct", true),
    ramp: store.get("ramp", true),
    voice: store.get("voice", false),
    voiceId: store.get("voiceId", ""),
  };
  // The face a pacer sees: the tokens, sentence starts, the settings, and a few callbacks.
  const face = { tokens: [], starts: [0], settings, advanceTo, finish, hint: t => { $("hint").textContent = t }, fail };
  const timer = createTimerPacer(face), mac = systemSpeech(), speech = createSpeechPacer(face, mac);
  let pacer = timer;

  let starts = [0], idx = 0, playing = false, title = "", session = null, wakeLock = null;

  /* ---------- display ---------- */
  function render() {
    const el = $("word"), tokens = face.tokens;
    if (!tokens.length) { el.className = "word"; el.innerHTML = '<span class="l"></span><span class="p">·</span><span class="r"></span>'; return }
    if (settings.chunk === 1) {
      const w = tokens[idx].w, i = orp(w);
      el.className = "word";
      el.replaceChildren(...[w.slice(0, i), w[i], w.slice(i + 1)].map((s, j) => {
        const span = document.createElement("span"); span.className = ["l", "p", "r"][j]; span.textContent = s; return span;
      }));
    } else {
      el.className = "word chunk";
      el.textContent = tokens.slice(idx, idx + settings.chunk).map(t => t.w).join(" ");
    }
    updateMeta(); showContext();
  }

  function updateMeta() {
    const n = face.tokens.length || 1;
    const pct = Math.round(idx / Math.max(1, n - 1) * 100);
    const scrub = $("scrub");
    scrub.max = Math.max(0, n - 1); scrub.value = idx; scrub.style.setProperty("--fill", pct + "%");
    $("pos").textContent = `Word ${(idx + 1).toLocaleString()} of ${n.toLocaleString()}`;
    $("pct").textContent = pct + "%";
    $("eta").textContent = formatDuration((n - idx) / settings.wpm * 60000 * (settings.punct ? 1.18 : 1)) + " left";
    $("wpmLive").textContent = (playing ? pacer.liveWpm() : settings.wpm) + " wpm";
  }

  /** The passage around the current word: the previous sentence through the next two. Rebuilt
   *  only when that window moves; otherwise just the highlight shifts, so it can follow every
   *  word while reading. Each word is a span; clicking one seeks there. */
  let ctxRange = null;
  function showContext() {
    const tokens = face.tokens;
    if (!tokens.length) return;
    const s = sentenceIndex(starts, idx);
    const a = starts[Math.max(0, s - 1)], b = starts[s + 2] ?? tokens.length;
    const box = $("ctxText");
    if (!ctxRange || ctxRange[0] !== a || ctxRange[1] !== b) {
      ctxRange = [a, b];
      box.replaceChildren(...tokens.slice(a, b).flatMap((t, k) => {
        const w = document.createElement("span"); w.textContent = t.w; w.dataset.i = a + k;
        return [w, document.createTextNode(t.para ? "  \u00b6  " : " ")];
      }));
    }
    let cur = null;
    for (const w of box.children) { const on = +w.dataset.i >= idx && +w.dataset.i < idx + settings.chunk; w.classList.toggle("cur", on); if (on && !cur) cur = w }
    const panel = $("context"); panel.hidden = false;
    if (cur) { const top = cur.offsetTop - panel.offsetTop, bottom = top + cur.offsetHeight;
      if (top < panel.scrollTop) panel.scrollTop = top; else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight }
  }

  /* ---------- pacer callbacks ---------- */
  function advanceTo(i) {
    if (session && i > idx) session.words += i - idx;
    idx = i; render();
  }
  function finish() {
    if (session) session.words += face.tokens.length - idx;
    idx = face.tokens.length - 1; render();
    stop(true);
  }
  function fail(message) { stop(false); setStatus("Voice stopped: " + message, "err") }

  /* ---------- transport ---------- */
  function play() {
    if (!face.tokens.length || playing) return;
    if (idx >= face.tokens.length - 1) idx = 0;
    playing = true; session = { start: performance.now(), words: 0 };
    const btn = $("play"); btn.textContent = "Pause";
    $("hint").textContent = "";
    lockScreen();
    pacer = settings.voice ? speech : timer;
    pacer.start(idx);
  }
  function stop(finished) {
    if (!playing) return;
    playing = false; pacer.stop(); releaseScreen();
    $("play").textContent = finished ? "Again" : "Read";
    $("hint").textContent = finished ? "Finished." : "Paused.";
    logSession(); savePos(); updateMeta();
  }
  const toggle = () => playing ? stop(false) : play();

  function seek(i) {
    idx = Math.max(0, Math.min(face.tokens.length - 1, i));
    if (playing) pacer.start(idx); else render();
    savePos();
  }
  const jumpSentence = dir => seek(sentenceJump(starts, idx, dir));

  function setWpm(v) {
    settings.wpm = Math.max(MIN_WPM, Math.min(MAX_WPM, v));
    $("wpm").value = settings.wpm; $("wpmVal").textContent = settings.wpm;
    $("wpm").style.setProperty("--fill", (settings.wpm - MIN_WPM) / (MAX_WPM - MIN_WPM) * 100 + "%");
    store.set("wpm", settings.wpm); updateMeta();
    if (playing && pacer.setRate) pacer.setRate();
  }
  function setChunk(n) {
    settings.chunk = n; store.set("chunk", n);
    for (const b of $("chunkSeg").children) b.setAttribute("aria-pressed", +b.dataset.n === n);
    render();
  }

  /* ---------- voice ---------- */
  /** Fills the voice menu with this Mac's voices, Premium ones first. A saved pick that no
   *  longer exists falls back to the first voice offered. */
  function fillVoices() {
    const sel = $("voice"), voices = systemVoices(mac.synth);
    sel.replaceChildren(...voices.map(v => { const o = document.createElement("option"); o.value = v.id; o.textContent = v.name; return o }));
    if (!voices.some(v => v.id === settings.voiceId)) { settings.voiceId = voices[0]?.id || ""; store.set("voiceId", settings.voiceId) }
    sel.value = settings.voiceId;
    $("voiceNote").hidden = voices.some(v => v.premium);
  }

  async function lockScreen() { try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen") } catch { wakeLock = null } }
  function releaseScreen() { try { wakeLock && wakeLock.release() } catch { /* already released */ } wakeLock = null }

  /* ---------- history ---------- */
  function logSession() {
    if (!session) return;
    const ms = performance.now() - session.start;
    if (session.words >= 20 && ms > 3000) {
      const log = store.get("log", []);
      log.unshift({ t: title, w: session.words, p: Math.round(session.words / (ms / 60000)), d: Date.now() });
      store.set("log", log.slice(0, 50));
    }
    session = null; renderRecord();
  }
  function renderRecord() {
    const log = store.get("log", []);
    const words = log.reduce((a, e) => a + e.w, 0);
    $("stWords").textContent = words.toLocaleString();
    $("stSessions").textContent = log.length;
    $("stPace").textContent = log.length ? Math.round(log.reduce((a, e) => a + e.p * e.w, 0) / Math.max(1, words)) : "—";
    const ul = $("log"); ul.textContent = "";
    for (const e of log.slice(0, 6)) {
      const li = document.createElement("li");
      const cells = [["label", new Date(e.d).toLocaleDateString(undefined, { month: "short", day: "numeric" })], ["t", e.t], ["n", `${e.w.toLocaleString()} w · ${e.p} wpm`]];
      for (const [cls, text] of cells) { const s = document.createElement("span"); s.className = cls; s.textContent = text; li.appendChild(s) }
      ul.appendChild(li);
    }
    $("logEmpty").hidden = log.length > 0;
  }

  /* ---------- documents ---------- */
  // The position is saved with the document's title and length, so it is only ever restored
  // onto the text it was saved from.
  const savePos = () => store.set("pos", { title, words: face.tokens.length, idx });
  function savedPos() {
    const p = store.get("pos", null);
    return p && p.title === title && p.words === face.tokens.length ? p.idx : 0;
  }

  /** Shows a document; returns false if it has no words. `remember` keeps the text across
   *  launches; `resume` returns to the position saved for this same text. */
  function load(doc, { resume = false, remember = false } = {}) {
    stop(false);
    const r = tokenize(doc.text || "");
    if (!r.tokens.length) return false;
    face.tokens = r.tokens; starts = face.starts = r.starts; title = doc.title || "Untitled";
    idx = resume ? Math.min(savedPos(), face.tokens.length - 1) : 0; ctxRange = null;
    $("docTitle").textContent = title;
    $("source").textContent = doc.source || ""; $("source").hidden = !doc.source;
    $("input").value = doc.text;
    $("play").textContent = "Read";
    $("hint").textContent = idx ? "Resuming where you left off. Press Space." : "Click the reader or press Space to begin.";
    // A book too big for local storage simply isn't kept; the sample opens next launch instead.
    if (remember && !store.set("doc", { title: doc.title, text: doc.text, source: doc.source || "" })) store.del("doc");
    render(); savePos();
    const w = $("word"); w.classList.remove("enter"); void w.offsetWidth; w.classList.add("enter");
    return true;
  }

  /* ---------- wiring ---------- */
  function wire() {
    $("optPunct").checked = settings.punct; $("optRamp").checked = settings.ramp;
    $("play").addEventListener("click", toggle);
    $("stage").addEventListener("click", toggle);
    $("back").addEventListener("click", () => jumpSentence(-1));
    $("fwd").addEventListener("click", () => jumpSentence(1));
    $("ctxText").addEventListener("click", e => { const i = e.target.dataset.i; if (i !== undefined) seek(+i) });
    $("scrub").addEventListener("input", e => seek(+e.target.value));
    $("wpm").addEventListener("input", e => setWpm(+e.target.value));
    $("chunkSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setChunk(+b.dataset.n) });
    $("optPunct").addEventListener("change", e => { settings.punct = e.target.checked; store.set("punct", settings.punct); updateMeta() });
    $("optRamp").addEventListener("change", e => { settings.ramp = e.target.checked; store.set("ramp", settings.ramp) });
    $("optVoice").checked = settings.voice; fillVoices();
    mac.synth?.addEventListener("voiceschanged", fillVoices);
    $("optVoice").addEventListener("change", e => { settings.voice = e.target.checked; store.set("voice", settings.voice) });
    $("voice").addEventListener("change", e => { stop(false); settings.voiceId = e.target.value; store.set("voiceId", settings.voiceId) });
    document.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches("textarea, input:not([type=range]):not([type=checkbox]), select")) return;
      const keys = { " ": toggle, ArrowLeft: () => jumpSentence(-1), ArrowRight: () => jumpSentence(1), ArrowUp: () => setWpm(settings.wpm + 25), ArrowDown: () => setWpm(settings.wpm - 25) };
      const fn = keys[e.key];
      if (fn) { e.preventDefault(); fn() }
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) stop(false); else if (playing) lockScreen() });
    setChunk(settings.chunk); setWpm(settings.wpm); renderRecord();
  }

  wire();
  return {
    load, play, stop: () => stop(false), toggle, seek,
    get wordCount() { return face.tokens.length },
  };
}
