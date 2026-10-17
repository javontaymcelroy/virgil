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
2. **Voice interface + macOS system voices.** Add an *audio pacer*: it requests speech for the current sentence and the two after it, plays the clips back to back, and every animation frame calls `wordAtTime(timings, audio.currentTime*1000)` (`src/voice/sync.js`) and `reader.advanceTo()` with the result. While voice is on, the WPM slider sets `rate`. The system provider uses `AVSpeechSynthesizer.write(_:toBufferCallback:toMarkerCallback:)` (macOS 14+), whose word markers give per-word sample offsets, so it returns the same `{audio, timings}` as every other provider (see `src-tauri/src/voice/mod.rs`).
3. **Kokoro-82M.** Ship the Kokoros binary as a Tauri sidecar (`bundle.externalBin`), run with `--timestamps`. Download the timestamped ONNX model on first use to `~/Library/Application Support/Virgil/models` with progress events and a SHA-256 check; don't put it in the repo or `.dmg`. Add a `NOTICE` crediting Kokoro (Apache-2.0).
4. **ElevenLabs.** `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps` from Rust. Group character timings from `alignment` (not `normalized_alignment`, which expands "$5" to "five dollars") into words. Key stored with the `keyring` crate (macOS Keychain backend), read only in Rust; the page sends a provider id and voice id, never a key.
5. **Converse**, then signing, the updater plugin (`latest.json` on each release) and a Homebrew cask. Converse providers: Anthropic (bring-your-own key, Keychain, called from Rust) and Ollama (`localhost:11434`). Replies are plain prose fed to `reader.load()` and the voice pipeline.

## Known limits

- Remembered texts live in the webview's local storage (~5 MB). A larger book still opens but isn't remembered across launches; moving saved documents to the app-data folder fixes that when it matters.
- Scanned PDFs have no text layer; Virgil says so rather than running OCR.
- DRM-protected EPUBs can't be read.
