/* Voice providers — phase 2 onward; nothing imports this yet.

   Every voice returns the same thing for a span of words: audio, plus when each word is
   spoken. The audio pacer plays the clip and moves the reader to whichever word the playback
   position falls in (wordAtTime in ./sync.js), so speech and display stay locked together
   whichever engine produced the sound. While voice is on, the WPM slider becomes a rate.

   Synthesis runs in Rust (src-tauri/src/voice/), which holds any API key in the Keychain; the
   page only names a provider and a voice.

   Providers, in build order:
     system      macOS AVSpeechSynthesizer with word markers. No download, works at first launch.
     kokoro      Kokoro-82M through the Kokoros sidecar with --timestamps; model fetched on first use.
     elevenlabs  stream/with-timestamps; character times from `alignment`, grouped into words.

   Pipeline: split into sentences, synthesize two sentences ahead of the one playing, and play
   them back to back so there are no gaps. */

/**
 * @typedef {object} WordTiming
 * @property {number} word     index into the reader's tokens
 * @property {number} startMs  from the start of this clip
 * @property {number} endMs
 */

/**
 * @typedef {object} Speech
 * @property {Uint8Array} audio
 * @property {string} mime        "audio/wav" or "audio/mpeg"
 * @property {WordTiming[]} timings  sorted by startMs
 */

/**
 * @typedef {object} VoiceProvider
 * @property {"system"|"kokoro"|"elevenlabs"} id
 * @property {() => Promise<boolean>} ready         false until the model is downloaded or a key is saved
 * @property {() => Promise<{id: string, name: string, language: string}[]>} voices
 * @property {(req: {words: string[], firstWord: number, voiceId: string, rate: number}) => Promise<Speech>} synthesize
 */

export {};
