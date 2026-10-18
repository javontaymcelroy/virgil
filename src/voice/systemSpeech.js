/* This Mac's voices for the speech pacer. In the app, speech goes through Rust
   (src-tauri/src/voice/system.rs) because WebKit's own speech API can't see downloaded Premium
   voices; the adapter below gives that bridge the same shape as `window.speechSynthesis`, so
   the pacer doesn't care which one it has. In a plain browser it is the real thing. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

class BridgeUtterance {
  constructor(text) { this.text = text; this.voice = null; this.rate = 1; this.onboundary = null; this.onend = null; this.onerror = null }
}

/** `{ synth, Utterance }` for `createSpeechPacer`'s deps. */
export function systemSpeech() {
  if (!isTauri()) return { synth: globalThis.speechSynthesis, Utterance: globalThis.SpeechSynthesisUtterance };
  const synth = new EventTarget();
  let voices = [], current = null, seq = 0;
  /** Asks the system for its voices again; fires `voiceschanged` only if the list differs.
   *  Runs at start and whenever the window comes back to the front, so a voice downloaded in
   *  System Settings shows up without a relaunch. */
  function refresh() {
    invoke("speech_voices").then(list => {
      const next = list.map(v => ({ voiceURI: v.id, name: v.name, lang: v.lang, localService: true, quality: v.quality }));
      if (next.map(v => v.voiceURI).join() === voices.map(v => v.voiceURI).join()) return;
      voices = next;
      synth.dispatchEvent(new Event("voiceschanged"));
    }).catch(() => {});
  }
  refresh();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh() });
  listen("speech:boundary", e => { if (current && e.payload.id === current.id) current.u.onboundary?.({ name: "word", charIndex: e.payload.charIndex }) });
  listen("speech:end", e => { if (current && e.payload.id === current.id) { const { u } = current; current = null; synth.speaking = false; u.onend?.() } });
  Object.assign(synth, {
    speaking: false,
    getVoices: () => voices,
    speak(u) {
      // The page picks the id, so a boundary that lands before the call returns still counts.
      const mine = { id: ++seq, u };
      current = mine; synth.speaking = true;
      invoke("speech_speak", { id: mine.id, text: u.text, voice: u.voice?.voiceURI ?? null, rate: u.rate })
        .catch(err => { if (current === mine) { current = null; synth.speaking = false; u.onerror?.({ error: String(err) }) } });
    },
    cancel() { current = null; synth.speaking = false; invoke("speech_stop").catch(() => {}) },
  });
  return { synth, Utterance: BridgeUtterance };
}
