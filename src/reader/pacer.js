/* A pacer decides when the reader moves on. The reader owns position and display; the pacer
   only says "show word i now" (reader.advanceTo) and "the text is done" (reader.finish).

   interface Pacer {
     start(index)   // begin at this word; called on play, and again after any seek while playing
     stop()         // halt, keep no timers running
     liveWpm()      // pace to show on the stage while playing
   }

   Phase 1 has one pacer: a WPM timer. Voice (phase 2) adds an audio pacer with the same shape
   that plays a provider's audio and follows its playback position through the word timings
   (see src/voice/), so the reader itself doesn't change when voice arrives. */

import { delayFor, rampedWpm } from "./text.js";

export function createTimerPacer(reader) {
  let timer = null, shown = 0;

  function pace() {
    const s = reader.settings;
    return s.ramp ? rampedWpm(s.wpm, shown) : s.wpm;
  }

  function tick(i) {
    const { chunk, punct } = reader.settings;
    const group = reader.tokens.slice(i, i + chunk);
    reader.advanceTo(i);
    shown += group.length;
    timer = setTimeout(() => {
      if (i + chunk >= reader.tokens.length) reader.finish();
      else tick(i + chunk);
    }, delayFor(group, pace(), punct));
  }

  return {
    start(index) { clearTimeout(timer); shown = 0; tick(index) },
    stop() { clearTimeout(timer); timer = null },
    liveWpm: pace,
  };
}
