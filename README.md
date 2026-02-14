<p align="center">
  <img src="icon.png" alt="Voice Input" width="128" height="128">
</p>

<h1 align="center">Voice Input</h1>

<p align="center">
  <strong>Speech-to-text for any input field, on any website.</strong><br>
  Click a field, press <code>Ctrl+Space</code>, talk, done.
</p>

<p align="center">
  <a href="#install">Install</a> &bull;
  <a href="#how-it-works">How it works</a> &bull;
  <a href="#keyboard-shortcuts">Shortcuts</a> &bull;
  <a href="#languages">Languages</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

No account, no external server, no data collection. Everything runs through Chrome's built-in [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API).

## How it works

1. **Click** into any text field (`<input>`, `<textarea>`, or `contenteditable`)
2. **Press `Ctrl+Space`** (or click the extension icon) — a centered overlay appears
3. **Speak** — finalized text appears in white, tentative words in gray italic
4. **Press `Space` or `Escape`** to stop — all text (including in-progress words) is inserted into the field

Right-click the extension icon to change the recognition language.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Space` (`Cmd+Space` on Mac) | Start / stop recording |
| `Space` | Stop recording and insert text |
| `Escape` | Stop recording and insert text |

Shortcuts are configurable at `chrome://extensions/shortcuts`.

> **Note:** On macOS, `Cmd+Space` is used by Spotlight by default. Either remap Spotlight in System Preferences or change the extension shortcut at `chrome://extensions/shortcuts`.

## Overlay

While recording, a centered overlay displays:

- A blinking red dot and instructions
- **White text** — finalized words (locked in by the speech engine)
- **Gray italic text** — interim words (still being processed, may change)

When you stop, **everything visible in the overlay is inserted** — including interim text. If anything looks wrong, just `Ctrl+Z` to undo.

## Text insertion

Text is inserted into the target field using a multi-strategy approach for maximum compatibility:

| Strategy | Used by |
|---|---|
| **Native value setter** + synthetic `input`/`change` events | `<input>`, `<textarea>`, React, Vue, Angular |
| **Synthetic paste event** (`ClipboardEvent` + `DataTransfer`, no clipboard pollution) | Messenger (Lexical), Discord (Slate), Notion, Gmail |
| **`execCommand("insertText")`** | Simple `contenteditable` elements |
| **`InputEvent` simulation** (`beforeinput` + `input`) | Fallback for remaining editors |
| **Raw DOM append** | Last resort |

## Supported elements

- Standard `<input>` fields (text, search, email, url, tel, number)
- `<textarea>` elements
- `contenteditable` elements (Gmail, Messenger, Discord, Slack, Notion, etc.)
- Elements inside Shadow DOM (best-effort)
- Works with React, Vue, Angular, and other frameworks

## Languages

31 languages available via right-click context menu:

English (US/UK), Spanish, French, German, Italian, Portuguese (BR/PT), Dutch, Russian, Chinese (Simplified/Traditional), Japanese, Korean, Arabic, Hindi, Turkish, Polish, Swedish, Danish, Finnish, Norwegian, Ukrainian, Czech, Romanian, Greek, Hebrew, Thai, Vietnamese, Indonesian, Malay.

## Install

### From source (developer mode)

```bash
git clone https://github.com/laluka/voice-input-extension.git
```

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the cloned `voice-input-extension/` folder
5. Pin the extension for easy access

### From releases

Download the latest `voice-input-extension.zip` from the [Releases](https://github.com/laluka/voice-input-extension/releases) page, unzip it, and load it as an unpacked extension.

## Project structure

```
voice-input-extension/
  icon.png          Source icon (500x500) — all sizes generated from this
  manifest.json     Manifest V3 configuration
  background.js     Service worker — hotkey + icon click, badge, context menu
  content.js        Injected on demand — speech recognition + overlay + insertion
  content.css       Overlay styles (centered transcription display)
  icons/            Extension icons (16, 48, 128px — generated from icon.png)
  build.sh          Build script — resizes icons, packages zip
  .github/
    workflows/
      release.yml   CI — builds and publishes a release on every push
```

## Architecture

```
  [Ctrl+Space / Icon Click]
          |
          v
    background.js (service worker)
      - toggleRecording(): shared by hotkey + icon click
      - injects content.js + content.css into the active tab
      - sends "start" message with selected language
      - retries with backoff (50ms -> 150ms -> 400ms) on first injection
      - manages REC badge state
          |
          v
    content.js (injected into page)
      1. FIND   -- locates focused editable element (walks shadow DOM + ancestors)
      2. RECORD -- starts SpeechRecognition, shows centered overlay
      3. DISPLAY -- streams finalized + interim text into the overlay
      4. STOP   -- on Space/Escape, inserts all text into the field (single shot)
      5. INSERT -- synthetic paste -> execCommand -> InputEvent -> DOM append
```

No data leaves the browser. Audio is processed by Chrome's built-in speech engine. The extension only stores the selected language preference in `chrome.storage.local`.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access the currently active tab to inject the content script |
| `scripting` | Programmatically inject content.js and content.css on demand |
| `storage` | Persist the user's language preference locally |
| `contextMenus` | Language picker on right-click of the extension icon |

## Build

### Local

```bash
./build.sh
```

Requires [ImageMagick](https://imagemagick.org/) (`magick` command) for icon resizing.

This validates the manifest, resizes icons from `icon.png`, generates store assets, and packages everything into `build/voice-input-extension.zip`.

### CI

Every push to `main` triggers the [GitHub Actions workflow](.github/workflows/release.yml) which:

1. Validates the manifest
2. Packages the extension into a zip
3. Creates a GitHub Release with the zip attached

Releases are tagged `v{version}-{short_sha}`.

## Publishing to Chrome Web Store

1. Register at the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole) ($5 one-time fee)
2. Upload `build/voice-input-extension.zip`
3. Fill in the store listing, privacy fields, and distribution settings
4. Submit for review (typically 1-3 business days)

Run `./build.sh` for a detailed checklist.

## Contributing

Contributions are welcome! Fork the repo, make your changes, and open a pull request.

Some ideas:

- Visual waveform or audio level indicator while recording
- Per-site language preferences
- Punctuation commands ("period", "comma", "new line")
- Overlay position/size preferences

## License

MIT
