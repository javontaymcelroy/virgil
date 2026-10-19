//! The Mac's own voices, spoken through AVSpeechSynthesizer from the app process.
//!
//! The webview's Web Speech API only sees the built-in compact voices: WebKit's content
//! process can't reach the Premium voices a user downloads. The app process can (that's what
//! `say` uses), so the page asks Rust to speak and listens for the synthesizer's
//! word-boundary callbacks as events: `speech:boundary` `{id, charIndex}` and `speech:end`
//! `{id}`, where `id` is the one the page passed to `speech_speak`.

use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_avf_audio::{
    AVSpeechBoundary, AVSpeechSynthesisVoice, AVSpeechSynthesisVoiceQuality, AVSpeechSynthesizer,
    AVSpeechSynthesizerDelegate, AVSpeechUtterance,
};
use objc2_foundation::{NSObject, NSObjectProtocol, NSRange, NSString};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct Voice {
    pub id: String,
    pub name: String,
    pub lang: String,
    /// "premium", "enhanced" or "default".
    pub quality: &'static str,
}

struct Ivars {
    app: AppHandle,
    /// `(id, utterance address)` of the utterance being spoken, so callbacks for a cancelled
    /// one are never reported under the next one's id.
    current: Mutex<(u64, usize)>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and Delegate has no Drop.
    #[unsafe(super(NSObject))]
    #[name = "VirgilSpeechDelegate"]
    #[ivars = Ivars]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl AVSpeechSynthesizerDelegate for Delegate {
        #[unsafe(method(speechSynthesizer:willSpeakRangeOfSpeechString:utterance:))]
        unsafe fn will_speak(
            &self,
            _s: &AVSpeechSynthesizer,
            range: NSRange,
            u: &AVSpeechUtterance,
        ) {
            if let Some(id) = self.id_of(u) {
                let _ = self.ivars().app.emit(
                    "speech:boundary",
                    json!({ "id": id, "charIndex": range.location }),
                );
            }
        }

        #[unsafe(method(speechSynthesizer:didFinishSpeechUtterance:))]
        unsafe fn did_finish(&self, _s: &AVSpeechSynthesizer, u: &AVSpeechUtterance) {
            if let Some(id) = self.id_of(u) {
                let _ = self.ivars().app.emit("speech:end", json!({ "id": id }));
            }
        }
    }
);

impl Delegate {
    fn new(app: AppHandle) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Ivars {
            app,
            current: Mutex::new((0, 0)),
        });
        unsafe { msg_send![super(this), init] }
    }
    fn id_of(&self, u: &AVSpeechUtterance) -> Option<u64> {
        let (id, addr) = *self.ivars().current.lock().unwrap();
        (addr == u as *const _ as usize).then_some(id)
    }
}

thread_local! {
    /// One synthesizer for the app, created on first use on the main thread. The delegate is
    /// a weak property of the synthesizer, so it is kept alive here too.
    static SYNTH: std::cell::RefCell<Option<(Retained<AVSpeechSynthesizer>, Retained<Delegate>)>> = const { std::cell::RefCell::new(None) };
}

fn with_synth<R>(app: &AppHandle, f: impl FnOnce(&AVSpeechSynthesizer, &Delegate) -> R) -> R {
    SYNTH.with(|cell| {
        let mut slot = cell.borrow_mut();
        let (synth, delegate) = slot.get_or_insert_with(|| {
            let synth = unsafe { AVSpeechSynthesizer::init(AVSpeechSynthesizer::alloc()) };
            let delegate = Delegate::new(app.clone());
            unsafe { synth.setDelegate(Some(ProtocolObject::from_ref(&*delegate))) };
            (synth, delegate)
        });
        f(synth, delegate)
    })
}

/// AVSpeech's rate runs 0–1 with 0.5 as the voice's natural pace; above it the scale is
/// compressed, so a multiplier of the natural pace maps onto it piecewise.
fn av_rate(multiplier: f32) -> f32 {
    let m = multiplier.clamp(0.25, 4.0);
    if m <= 1.0 {
        0.5 * m
    } else {
        (0.5 + (m - 1.0) / 6.0).min(1.0)
    }
}

/// Every voice installed on this Mac, including downloaded Premium ones.
#[tauri::command]
pub fn speech_voices() -> Vec<Voice> {
    let voices = unsafe { AVSpeechSynthesisVoice::speechVoices() };
    voices
        .iter()
        .map(|v| Voice {
            id: unsafe { v.identifier() }.to_string(),
            name: unsafe { v.name() }.to_string(),
            lang: unsafe { v.language() }.to_string(),
            quality: match unsafe { v.quality() } {
                AVSpeechSynthesisVoiceQuality::Premium => "premium",
                AVSpeechSynthesisVoiceQuality::Enhanced => "enhanced",
                _ => "default",
            },
        })
        .collect()
}

/// Speaks `text` with `voice` (an id from `speech_voices`, or the system default) at `rate`
/// times the voice's natural pace, replacing whatever was being spoken. Word boundaries and
/// the end are reported as events tagged with `id`.
#[tauri::command]
pub fn speech_speak(
    app: AppHandle,
    id: u64,
    text: String,
    voice: Option<String>,
    rate: f32,
) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        with_synth(&handle, |synth, delegate| unsafe {
            synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
            let u = AVSpeechUtterance::speechUtteranceWithString(&NSString::from_str(&text));
            if let Some(v) = voice.and_then(|id| {
                AVSpeechSynthesisVoice::voiceWithIdentifier(&NSString::from_str(&id))
            }) {
                u.setVoice(Some(&v));
            }
            u.setRate(av_rate(rate));
            *delegate.ivars().current.lock().unwrap() = (id, &*u as *const _ as usize);
            synth.speakUtterance(&u);
        })
    })
    .map_err(|e| e.to_string())
}

/// Stops speaking at once. Nothing is reported for the stopped utterance.
#[tauri::command]
pub fn speech_stop(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        with_synth(&handle, |synth, delegate| unsafe {
            *delegate.ivars().current.lock().unwrap() = (0, 0);
            synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
        })
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::av_rate;

    #[test]
    fn rate_maps_natural_pace_to_the_middle_and_clamps() {
        assert_eq!(av_rate(1.0), 0.5);
        assert_eq!(av_rate(0.5), 0.25);
        assert_eq!(av_rate(4.0), 1.0);
        assert_eq!(av_rate(10.0), 1.0);
        assert!(av_rate(2.0) > 0.5 && av_rate(2.0) < 1.0);
    }
}

#[cfg(test)]
mod adversarial {
    use super::av_rate;

    /// S5: NaN can't arrive over JSON, but if it did, clamp passes it through and min() picks
    /// the top speed rather than panicking.
    #[test]
    fn nan_rate_is_finite() {
        let r = av_rate(f32::NAN);
        assert!(r.is_finite() && (0.0..=1.0).contains(&r), "{r}");
        assert_eq!(av_rate(f32::INFINITY), 1.0);
        assert_eq!(av_rate(-1.0), 0.125);
    }
}
