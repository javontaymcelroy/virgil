/* Maps an audio playback position to the word being spoken. Used by the audio pacer (phase 2). */

/** The word being spoken at `ms` into a clip: the last timing that has started, or -1 before
 *  the first word. Binary search, since this runs every animation frame. */
export function wordAtTime(timings, ms) {
  let lo = 0, hi = timings.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid].startMs <= ms) { found = mid; lo = mid + 1 } else hi = mid - 1;
  }
  return found < 0 ? -1 : timings[found].word;
}

