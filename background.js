// ========== State ==========
const recordingTabs = new Set();

// ========== Languages ==========
const LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (BR)" },
  { code: "pt-PT", label: "Portuguese (PT)" },
  { code: "nl-NL", label: "Dutch" },
  { code: "ru-RU", label: "Russian" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "ar-SA", label: "Arabic" },
  { code: "hi-IN", label: "Hindi" },
  { code: "tr-TR", label: "Turkish" },
  { code: "pl-PL", label: "Polish" },
  { code: "sv-SE", label: "Swedish" },
  { code: "da-DK", label: "Danish" },
  { code: "fi-FI", label: "Finnish" },
  { code: "nb-NO", label: "Norwegian" },
  { code: "uk-UA", label: "Ukrainian" },
  { code: "cs-CZ", label: "Czech" },
  { code: "ro-RO", label: "Romanian" },
  { code: "el-GR", label: "Greek" },
  { code: "he-IL", label: "Hebrew" },
  { code: "th-TH", label: "Thai" },
  { code: "vi-VN", label: "Vietnamese" },
  { code: "id-ID", label: "Indonesian" },
  { code: "ms-MY", label: "Malay" },
];

// ========== Context menu (right-click on extension icon) ==========
chrome.runtime.onInstalled.addListener(async () => {
  // Build the language picker as a context menu on the action icon
  chrome.contextMenus.create({
    id: "vi-lang-parent",
    title: "Language",
    contexts: ["action"],
  });

  const { lang: savedLang } = await chrome.storage.local.get({ lang: "en-US" });

  for (const { code, label } of LANGUAGES) {
    chrome.contextMenus.create({
      id: `vi-lang-${code}`,
      parentId: "vi-lang-parent",
      title: label,
      type: "radio",
      checked: code === savedLang,
      contexts: ["action"],
    });
  }
});

// Handle language selection
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId.startsWith("vi-lang-")) {
    const lang = info.menuItemId.replace("vi-lang-", "");
    chrome.storage.local.set({ lang });
  }
});

// ========== Extension icon click — toggle recording ==========
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const isRecording = recordingTabs.has(tab.id);

  if (isRecording) {
    // Stop recording
    recordingTabs.delete(tab.id);
    setBadge(tab.id, false);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "voice-input-stop" });
    } catch (e) {
      // Content script not loaded — ignore
    }
  } else {
    // Start recording — inject content script + css on demand
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (e) {
      // May already be injected, or restricted page — still try messaging
    }

    const { lang } = await chrome.storage.local.get({ lang: "en-US" });

    // Small delay to let content script initialize on first injection
    setTimeout(async () => {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "voice-input-start",
          lang,
        });

        if (response && response.ok) {
          recordingTabs.add(tab.id);
          setBadge(tab.id, true);
        } else {
          setBadge(tab.id, false);
        }
      } catch (e) {
        console.warn("[Voice Input] Could not start recording:", e);
        setBadge(tab.id, false);
      }
    }, 100);
  }
});

// ========== Cleanup ==========
chrome.tabs.onRemoved.addListener((tabId) => {
  recordingTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    recordingTabs.delete(tabId);
    setBadge(tabId, false);
  }
});

// Content script tells us it stopped (error, escape key, etc.)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "voice-input-stopped" && sender.tab) {
    recordingTabs.delete(sender.tab.id);
    setBadge(sender.tab.id, false);
  }
});

// ========== Badge ==========
function setBadge(tabId, recording) {
  if (recording) {
    chrome.action.setBadgeText({ text: "REC", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#e53e3e", tabId });
    chrome.action.setTitle({
      title: "Voice Input — click to STOP recording",
      tabId,
    });
  } else {
    chrome.action.setBadgeText({ text: "", tabId });
    chrome.action.setTitle({
      title: "Voice Input — click to start recording",
      tabId,
    });
  }
}
