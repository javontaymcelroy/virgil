/* A pacer decides when the reader moves on. The reader owns position and display; the pacer
   only says "show word i now" (reader.advanceTo) and "the text is done" (reader.finish).

   interface Pacer {
     start(index)   // begin at this word; called on play, and again after any seek while playing
     stop()         // halt, keep no timers running
     liveWpm()      // pace to show on the stage while playing
   }

   Two pacers exist: this WPM timer, and the speech pacer (./speechPacer.js) that reads aloud
   with the Mac's voices and follows their word boundaries, so the reader itself never changes. */

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
