/* The RSVP reader: owns the text, the position and everything on screen. Timing is delegated
   to a pacer (./pacer.js), so a voice can drive the same reader later. */

import { tokenize, orp, sentenceIndex, sentenceJump, paragraphStarts, formatDuration } from "./text.js";
import { createTimerPacer } from "./pacer.js";
import { createSpeechPacer, systemVoices, BASE_WPM } from "./speechPacer.js";
import { systemSpeech } from "../voice/systemSpeech.js";
import { setStatus } from "../import.js";
import { store, docKey } from "../store.js";

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

  let starts = [0], paras = [0], headings = [], idx = 0, playing = false, title = "", session = null, wakeLock = null, kept = true, seekTimer = 0;
  let pausedAt = -1;   // where the last pause happened, so resuming can back up to its sentence

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
    const pos = `Word ${(idx + 1).toLocaleString()} of ${n.toLocaleString()}`;
    scrub.max = Math.max(0, n - 1); scrub.value = idx; scrub.style.setProperty("--fill", pct + "%"); scrub.setAttribute("aria-valuetext", pos);
    $("pos").textContent = pos;
    $("pct").textContent = pct + "%";
    // A voice can't go faster than four times its natural pace, whatever the slider says.
    const pace = playing ? pacer.liveWpm() : settings.voice ? Math.min(settings.wpm, BASE_WPM * 4) : settings.wpm;
    $("eta").textContent = formatDuration((n - idx) / pace * 60000 * (settings.punct ? 1.18 : 1)) + " left";
    $("wpmLive").textContent = pace + " wpm";
    if (headings.length) { let k = -1; for (let i = 0; i < headings.length; i++) if (headings[i].word <= idx) k = i; $("chapters").selectedIndex = k + 1 }
  }

  /** The passage around the current word: the previous sentence through the next two. Rebuilt
   *  only when that window moves; otherwise just the highlight shifts, so it can follow every
   *  word while reading. Each word is a button (out of the tab order: ←/→ is the keyboard way
   *  to move); clicking one seeks there. */
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
        const w = document.createElement("button"); w.type = "button"; w.tabIndex = -1; w.textContent = t.w; w.dataset.i = a + k;
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
    else if (idx === pausedAt) idx = starts[sentenceIndex(starts, idx)];   // a run-up after a pause
    pausedAt = -1;
    playing = true; session = { start: performance.now(), words: 0 };
    const btn = $("play"); btn.textContent = "Pause";
    $("hint").textContent = "";
    lockScreen();
    pacer = settings.voice ? speech : timer;
    pacer.start(idx);
  }
  function stop(finished) {
    if (!playing) return;
    playing = false; clearTimeout(seekTimer); pacer.stop(); releaseScreen();
    pausedAt = finished ? -1 : idx;
    $("play").textContent = finished ? "Again" : "Read";
    $("hint").textContent = finished ? "Finished." : "Paused.";
    logSession(); savePos(); updateMeta();
  }
  const toggle = () => playing ? stop(false) : play();

  /** Moves to word `i`. While a voice is reading, dragging the slider sends a seek per pixel,
   *  so speech restarts only once the slider rests (`settled`: the slider's change event). */
  function seek(i, settled = true) {
    idx = Math.max(0, Math.min(face.tokens.length - 1, i));
    clearTimeout(seekTimer); pausedAt = -1;
    if (!playing) {
      render();
      if ($("play").textContent === "Again") { $("play").textContent = "Read"; $("hint").textContent = "Paused." }
    } else if (pacer === speech && !settled) {
      pacer.stop(); render();
      seekTimer = setTimeout(() => { if (playing) pacer.start(idx) }, 150);
    } else pacer.start(idx);
    savePos();
  }
  const jumpSentence = dir => seek(sentenceJump(starts, idx, dir));
  const jumpParagraph = dir => seek(sentenceJump(paras, idx, dir));

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
    // No voices yet: the bridge may still be answering, or none are installed. The saved pick
    // is kept either way, so it is still there when the list arrives.
    sel.disabled = !voices.length;
    if (!voices.length) sel.appendChild(new Option("No voices installed"));
    else if (!voices.some(v => v.id === settings.voiceId)) { settings.voiceId = voices[0].id; store.set("voiceId", settings.voiceId) }
    sel.value = settings.voiceId;
    $("voiceNote").hidden = voices.some(v => v.premium);
    $("hearVoice").disabled = !voices.length;
  }

  /** Speaks one line in the chosen voice at the slider's pace, so a voice can be judged before a whole book. */
  function hearVoice() {
    stop(false);
    const u = new mac.Utterance("Here is how I sound when I read to you.");
    u.voice = systemVoices(mac.synth).find(v => v.id === settings.voiceId)?.voice ?? null;
    u.rate = Math.max(0.5, Math.min(4, settings.wpm / BASE_WPM));
    mac.synth.cancel(); mac.synth.speak(u);
  }

  async function lockScreen() {
    try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen") } catch { wakeLock = null }
    if (!playing) releaseScreen();   // stopped while the request was pending
  }
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
    $("clearLog").hidden = !log.length;
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
  // Positions are kept per document, keyed by title and length, so each one is only ever
  // restored onto the text it was saved from. The map is pruned to the fifty newest.
  const key = () => docKey(title, face.tokens.length);
  function savePos() {
    const p = store.get("positions", {});
    delete p[key()]; p[key()] = idx;
    for (const k of Object.keys(p).slice(0, -50)) delete p[k];
    store.set("positions", p);
  }
  const savedPos = () => store.get("positions", {})[key()] ?? 0;

  const RECENT = 5;
  /** Puts the document at the head of the recent list; the oldest fall off, and if even one
   *  does not fit in local storage the list is left as it was. Returns whether it was kept. */
  function rememberDoc(doc) {
    const prev = store.get("recent", []), k = docKey(doc.title, face.tokens.length);
    const entry = { title: doc.title, text: doc.text, source: doc.source || "", words: face.tokens.length, headings };
    const list = [entry, ...prev.filter(d => docKey(d.title, d.words) !== k)].slice(0, RECENT);
    while (!store.set("recent", list)) {
      if (list.length <= 1) { store.set("recent", prev.filter(d => docKey(d.title, d.words) !== k)); return false }
      list.pop();
    }
    return true;
  }

  /** Shows a document; returns false if it has no words. `remember` keeps the text across
   *  launches; `resume` returns to the position saved for this same text. */
  function load(doc, { resume = false, remember = false } = {}) {
    stop(false);
    const r = tokenize(doc.text || "");
    if (!r.tokens.length) return false;
    face.tokens = r.tokens; starts = face.starts = r.starts; paras = paragraphStarts(r.tokens); title = doc.title || "Untitled";
    headings = (doc.headings || []).filter(h => h.word < r.tokens.length);
    $("chapters").replaceChildren(new Option("Start", -1), ...headings.map((h, i) => new Option(h.title, i)));
    $("chapterRow").hidden = !headings.length;
    idx = resume ? Math.min(savedPos(), face.tokens.length - 1) : 0; ctxRange = null; pausedAt = -1;
    $("docTitle").textContent = title;
    $("source").textContent = doc.source || ""; $("source").hidden = !doc.source;
    $("input").value = doc.text;
    $("play").textContent = "Read";
    $("hint").textContent = idx ? "Resuming where you left off. Press Space." : "Click the reader or press Space to begin.";
    // A book too big for local storage isn't kept (see `kept`): the previous one opens next launch instead.
    kept = !remember || rememberDoc(doc);
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
    $("chapters").addEventListener("change", e => seek(+e.target.value < 0 ? 0 : headings[+e.target.value].word));
    $("hearVoice").addEventListener("click", hearVoice);
    // Clearing the log takes two clicks, like deleting a theme.
    $("clearLog").addEventListener("click", e => {
      const b = e.currentTarget;
      if (b.textContent !== "Clear?") { b.textContent = "Clear?"; b.setAttribute("aria-label", "Confirm: clear reading history"); setTimeout(() => { b.textContent = "Clear history"; b.removeAttribute("aria-label") }, 3000); return }
      store.del("log"); b.textContent = "Clear history"; b.removeAttribute("aria-label"); renderRecord();
    });
    $("ctxText").addEventListener("click", e => { const i = e.target.dataset.i; if (i !== undefined) { seek(+i); e.target.blur() } });
    $("scrub").addEventListener("input", e => seek(+e.target.value, false));
    $("scrub").addEventListener("change", e => seek(+e.target.value));
    $("wpm").addEventListener("input", e => setWpm(+e.target.value));
    $("chunkSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setChunk(+b.dataset.n) });
    $("optPunct").addEventListener("change", e => { settings.punct = e.target.checked; store.set("punct", settings.punct); updateMeta() });
    $("optRamp").addEventListener("change", e => { settings.ramp = e.target.checked; store.set("ramp", settings.ramp) });
    $("optVoice").checked = settings.voice; fillVoices();
    mac.synth?.addEventListener("voiceschanged", fillVoices);
    // Changing the voice or switching it on or off while reading carries on from the current word.
    $("optVoice").addEventListener("change", e => {
      settings.voice = e.target.checked; store.set("voice", settings.voice);
      if (playing) { pacer.stop(); pacer = settings.voice ? speech : timer; pacer.start(idx) }
      updateMeta();
    });
    $("voice").addEventListener("change", e => { settings.voiceId = e.target.value; store.set("voiceId", settings.voiceId); if (playing && pacer === speech) pacer.start(idx) });
    document.addEventListener("keydown", e => {
      // Only the page itself and the stage take these keys: a focused button, checkbox, slider,
      // field or drawer keeps its own (Space activates, arrows step).
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target !== document.body && e.target.id !== "stage")) return;
      const jump = e.shiftKey ? jumpParagraph : jumpSentence;
      const keys = { " ": toggle, ArrowLeft: () => jump(-1), ArrowRight: () => jump(1), ArrowUp: () => setWpm(settings.wpm + 25), ArrowDown: () => setWpm(settings.wpm - 25) };
      if (e.key === "Enter" && e.target.id === "stage") keys.Enter = toggle;
      const fn = keys[e.key];
      if (fn) { e.preventDefault(); fn() }
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) stop(false); else if (playing) lockScreen() });
    window.addEventListener("blur", () => stop(false));   // another app came to the front
    setChunk(settings.chunk); setWpm(settings.wpm); renderRecord();
  }

  wire();
  return {
    load, play, stop: () => stop(false), toggle, seek,
    get wordCount() { return face.tokens.length },
    /** False when the last `remember` load didn't fit in local storage. */
    get kept() { return kept },
  };
}
