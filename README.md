# Virgil

An open-source RSVP speed reader for macOS. Virgil shows a text one word at a time in a fixed spot, with the letter your eye should land on marked in color, so you read without moving your eyes across a page.

- **Paste text** or **open a file** from the Add a text side panel (⌘T): `.txt`, `.md`, `.pdf` or `.epub` (or drop one on the window). Files are converted on your Mac and never uploaded.
- Pace from 100 to 1000 words per minute, one to three words per flash, pauses at punctuation and paragraph breaks, and an ease-in at the start.
- Pausing shows the surrounding passage. Virgil remembers the last text and where you stopped, plus a short history of your sessions.
- Native and lightweight: built with [Tauri](https://tauri.app).

Coming next: read-aloud with word-synced voices (macOS system voices, a local Kokoro model, or ElevenLabs), and a Converse mode for asking about what you're reading. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install

1. Download the latest `Virgil_x.y.z_universal.dmg` from [Releases](https://github.com/javontaymcelroy/virgil/releases). It runs on Apple Silicon and Intel Macs, macOS 11 or later.
2. Open the `.dmg` and drag **Virgil** into **Applications**.
3. **The first time only:** Virgil isn't signed with an Apple Developer ID yet, so double-clicking it shows a warning that it "can't be opened". Instead, in Applications, **right-click (or Control-click) Virgil → Open**, then click **Open** in the dialog. From then on it opens normally.

   On macOS 15 (Sequoia) and later the right-click route may not show an Open button. In that case, try opening Virgil once, then go to **System Settings → Privacy & Security**, scroll down to the message about Virgil, and click **Open Anyway**.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Read / pause |
| ← → | Previous / next sentence |
| ↑ ↓ | Pace ±25 wpm |
| ⌘O | Open a file |
| ⌘T | Show or hide the Add a text panel |
| ⌘, | Show or hide Settings |
| Esc | Close the open panel |
| ⌘V | Paste anywhere outside a text field to read the clipboard |

## Build from source

You need [Node.js](https://nodejs.org) 20+ and [Rust](https://rustup.rs), plus Xcode Command Line Tools (`xcode-select --install`).

```sh
git clone https://github.com/javontaymcelroy/virgil.git
cd virgil
npm install
npm run tauri dev        # run with live reload
npm run tauri build      # build Virgil.app and a .dmg into src-tauri/target/release/bundle/
```

Tests: `npm test` (reader engine) and `cargo test` in `src-tauri/` (file import).

## Themes

Every color, font and size comes from CSS custom properties in [`themes/default/theme.css`](themes/default/theme.css); the app's stylesheet hard-codes none of them. To use your own look, create `themes/private/<name>/theme.css`. It loads on top of the default, so it only needs the properties it changes, and it can add its own rules (and `@import` web fonts). `themes/private/` is gitignored: your theme is in your local builds, used automatically, and switched on and off under **Settings → Themes**, but it is never committed or included in public releases.

You can also make themes without rebuilding, under **Settings → Themes**:

- **New theme** builds one with color pickers (each solid or a gradient), font menus and size sliders, previewing it live as you change them.
- **Custom theme** takes CSS you write or paste.
- **Add from file…** takes any `.css` file.

They are saved in Virgil's app data on your Mac (`~/Library/Application Support/io.github.javontaymcelroy.virgil/themes/`) and listed with a switch, **Edit** (renaming included) and **Delete**.

The built-in themes (Default and your private ones) have **Edit** too. It opens the builder on the theme's current look and saves only what you change, layered on top of the original, so the theme's own rules and fonts stay. **Reset** removes your changes.

## Releasing

Bump `version` in `src-tauri/tauri.conf.json` and `package.json`, commit, then tag:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The [release workflow](.github/workflows/release.yml) builds a universal `.dmg` on GitHub Actions and publishes it as a GitHub Release.

### Signing (optional, removes the first-launch warning)

With an [Apple Developer Program](https://developer.apple.com/programs/) membership, add these repository secrets and the release workflow signs and notarizes automatically:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Your *Developer ID Application* certificate exported as `.p12`, base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | An [app-specific password](https://support.apple.com/102654) |
| `APPLE_TEAM_ID` | Your 10-character team ID |

## License

[MIT](LICENSE). The sample text is Edgar Allan Poe's "The Tell-Tale Heart" (1843, public domain).
