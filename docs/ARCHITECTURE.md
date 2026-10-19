# Architecture

```
virgil/
├─ src/                    frontend (plain JS + Vite), runs in the Tauri webview
│  ├─ reader/text.js       pure engine: tokenize, ORP pivot, timing, sentence jumps
│  ├─ reader/pacer.js      what moves the reader on: the WPM timer today, audio later
│  ├─ reader/reader.js     the RSVP display, transport, history
│  ├─ import.js            Open panel, drag-and-drop, paste
│  ├─ theme.js             default + private themes
│  ├─ voice/               phase 2+: provider contract, audio → word sync
│  └─ converse/            phase 5: Converse provider contract
├─ src-tauri/              Rust
│  ├─ src/import/          .txt .md .pdf .epub → plain text (paragraphs = blank lines)
│  └─ src/voice/           phase 2+: VoiceProvider trait, request/timing types
├─ themes/default/         public theme (CSS custom properties only)
├─ themes/private/         gitignored personal themes
└─ .github/workflows/      ci.yml (tests + universal .dmg on every push), release.yml (tags)
```

## Boundaries

- **Files are read in Rust.** The page calls `open_document` (shows the Open panel, returns `{title, text, source}`) and listens for `import:*` events from drag-and-drop. It has no file-system permission of its own (`src-tauri/capabilities/default.json` grants only `core:default`).
- **The reader doesn't own time.** `reader.js` owns position and display; a *pacer* decides when to move (`start(i)`, `stop()`, `liveWpm()`, calling back `advanceTo(i)` / `finish()`). Phase 1 ships the WPM timer pacer.

## Phase plan

1. ✅ Tauri shell, paste + file import, neutral theme, release workflow.
2. ✅ **Voice.** The *speech pacer* (`src/reader/speechPacer.js`) reads the text aloud with this Mac's own voices and moves the display to each word as it is spoken. It cuts the text into runs of up to four paragraphs (`chunkParagraphs` in `src/reader/text.js`; a single paragraph past 400 words is closed at a sentence end) and speaks them one after another; the synthesizer's word-boundary callbacks carry a character offset, which maps straight back to a token, so there is nothing to synthesize ahead, cache or align. Pause cancels; resume and seek speak again from the chosen word; a WPM change restarts from the current word once the slider settles, since an utterance's rate is fixed. Speech runs in Rust (`src-tauri/src/voice/system.rs`, AVSpeechSynthesizer via objc2) rather than the Web Speech API because WebKit's content process only sees the built-in compact voices, not the Premium ones a user downloads; the page calls `speech_voices`/`speech_speak`/`speech_stop` and listens for `speech:boundary` and `speech:end` events. `src/voice/systemSpeech.js` gives that bridge the shape of `window.speechSynthesis`, so the pacer and its tests don't know which they have. Premium voices are listed first and the novelty voices hidden; a user installs them in System Settings › Accessibility › Read & Speak.
3. **Kokoro-82M.** Ship the Kokoros binary as a Tauri sidecar (`bundle.externalBin`), run with `--timestamps`. Download the timestamped ONNX model on first use to `~/Library/Application Support/Virgil/models` with progress events and a SHA-256 check; don't put it in the repo or `.dmg`. Add a `NOTICE` crediting Kokoro (Apache-2.0).
4. **ElevenLabs.** `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps` from Rust. Group character timings from `alignment` (not `normalized_alignment`, which expands "$5" to "five dollars") into words. Key stored with the `keyring` crate (macOS Keychain backend), read only in Rust; the page sends a provider id and voice id, never a key.
5. **Converse**, then signing, the updater plugin (`latest.json` on each release) and a Homebrew cask. Converse providers: Anthropic (bring-your-own key, Keychain, called from Rust) and Ollama (`localhost:11434`). Replies are plain prose fed to `reader.load()` and the voice pipeline.

## Known limits

- Remembered texts live in the webview's local storage (~5 MB). A larger book still opens but isn't remembered across launches; moving saved documents to the app-data folder fixes that when it matters.
- Scanned PDFs have no text layer; Virgil says so rather than running OCR.
- DRM-protected EPUBs can't be read.
