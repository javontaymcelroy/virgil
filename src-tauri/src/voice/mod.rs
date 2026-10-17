//! Voice providers (phase 2 onward; nothing calls this yet).
//!
//! Every voice, whatever its engine, returns the same thing for a span of text: audio plus
//! the time each word is spoken. The page plays the audio and moves the RSVP display to
//! whichever word the playback position falls in, so speech and display can't drift.
//!
//! Planned providers:
//! - `system`: macOS AVSpeechSynthesizer, writing to a buffer with word markers
//!   (`writeUtterance:toBufferCallback:toMarkerCallback:`), so it fits this same shape.
//! - `kokoro`: the Kokoros sidecar run with `--timestamps`; model downloaded on first launch
//!   to `~/Library/Application Support/Virgil/models`, checked against a SHA-256.
//! - `elevenlabs`: `POST /v1/text-to-speech/{voice}/stream/with-timestamps`, character
//!   timings from `alignment` (not `normalized_alignment`) grouped into words.
//!
//! API keys live in the macOS Keychain and are read only here, in Rust; the webview asks for
//! synthesis by provider id and never sees a key.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// What the page asks for: one sentence or a short run of them.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    /// The words exactly as the reader tokenised them, so timings map back one-to-one.
    pub words: Vec<String>,
    /// Index of `words[0]` in the whole document.
    pub first_word: usize,
    pub voice_id: String,
    /// 1.0 is the voice's natural pace; the WPM slider sets this while voice is on.
    pub rate: f32,
}

/// When one word is spoken, relative to the start of its clip.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordTiming {
    /// Index in the whole document.
    pub word: usize,
    pub start_ms: u32,
    pub end_ms: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Speech {
    /// Encoded audio (WAV or MP3), sent to the page as bytes.
    pub audio: Vec<u8>,
    pub mime: String,
    pub timings: Vec<WordTiming>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub language: String,
}

pub trait VoiceProvider: Send + Sync {
    /// Stable id: "system", "kokoro", "elevenlabs".
    fn id(&self) -> &'static str;
    /// False until the provider can speak (model not downloaded, no API key).
    fn is_ready(&self) -> bool;
    fn voices(&self) -> Result<Vec<VoiceInfo>, String>;
    fn synthesize(&self, request: &SpeechRequest) -> Result<Speech, String>;
}
