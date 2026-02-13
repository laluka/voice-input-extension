# Voice Input

A Chrome extension that adds speech-to-text to any input field on any website. Click a field, click the icon, and start talking -- words stream in as you speak.

No account, no external server, no data collection. Everything runs through Chrome's built-in [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API).

## How it works

1. **Click** into any text field (`<input>`, `<textarea>`, or `contenteditable`)
2. **Click the extension icon** in the toolbar -- a red **REC** badge appears
3. **Speak** -- text appears word by word in real time
4. **Stop** by pressing `Escape` or clicking the icon again -- text stays

Right-click the extension icon to change the recognition language.

## Supported elements

- Standard `<input>` fields (text, search, email, url, tel, number)
- `<textarea>` elements
- `contenteditable` elements (Gmail compose, Notion, Slack, etc.)
- Elements inside Shadow DOM (best-effort)
- Works with React, Vue, Angular, and other frameworks (uses native value setters + synthetic events)

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
  manifest.json     Manifest V3 configuration
  background.js     Service worker -- icon click handler, badge, context menu
  content.js        Injected on demand -- speech recognition + streaming
  content.css       Recording indicator styles
  icons/            Extension icons (16, 48, 128px)
  build.sh          Local build & packaging script
  .github/
    workflows/
      release.yml   CI -- builds and publishes a release on every push
```

## Architecture

```
  [Extension Icon Click]
          |
          v
    background.js (service worker)
      - injects content.js + content.css into the active tab
      - sends "start" message with selected language
      - manages REC badge state
          |
          v
    content.js (injected into page)
      - finds the currently focused editable element
      - starts SpeechRecognition (continuous + interim results)
      - streams recognized text word-by-word into the field
      - listens for Escape key to stop
      - notifies background on stop/error
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

This validates the manifest, generates store assets, and packages everything into `build/voice-input-extension.zip`.

### CI

Every push to `main` triggers the [GitHub Actions workflow](.github/workflows/release.yml) which:

1. Validates the manifest
2. Packages the extension into a zip
3. Generates store listing assets
4. Creates a GitHub Release with the zip attached

Releases are tagged `v{version}-{short_sha}`.

## Publishing to Chrome Web Store

1. Register at the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole) ($5 one-time fee)
2. Upload `build/voice-input-extension.zip`
3. Fill in the store listing, privacy fields, and distribution settings
4. Submit for review (typically 1-3 business days)

Run `./build.sh` for a detailed checklist.

## Contributing

Contributions are welcome. Fork the repo, make your changes, and open a pull request.

Some ideas:

- Keyboard shortcut to start/stop recording (configurable via `chrome://extensions/shortcuts`)
- Visual waveform or audio level indicator while recording
- Per-site language preferences
- Punctuation commands ("period", "comma", "new line")

## License

MIT
