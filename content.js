(() => {
  "use strict";

  // Prevent double-injection (script may be injected multiple times)
  if (window.__voiceInputLoaded) return;
  window.__voiceInputLoaded = true;

  // ========== State ==========
  let recognition = null;
  let targetElement = null;
  let indicator = null;

  // ========== Safety: auto-stop if extension context dies ==========
  // When the extension is reloaded/updated, chrome.runtime becomes invalid.
  // Poll periodically so the user isn't stuck with a zombie recording.
  const contextCheckInterval = setInterval(() => {
    try {
      if (chrome.runtime && chrome.runtime.id) return; // still alive
    } catch (e) {
      // context invalidated
    }
    clearInterval(contextCheckInterval);
    if (recognition) stopRecognition();
  }, 2000);

  // ========== Escape / Space — stop recording, keep text ==========
  document.addEventListener("keydown", (e) => {
    if (!recognition) return;

    if (e.key === "Escape" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      stopRecognition();
      notifyBackground();
    }
  }, true); // capture phase so we get it before anything else

  // ========== Message handler ==========
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "voice-input-start") {
      const result = startRecognition(msg.lang || "en-US");
      sendResponse(result);
      return true; // keep channel open for async
    }

    if (msg.type === "voice-input-stop") {
      stopRecognition();
      sendResponse({ ok: true });
      return true;
    }
  });

  // ========== Find the currently focused editable element ==========
  function findFocusedEditable() {
    let el = document.activeElement;

    // Walk into shadow DOMs
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }

    if (!el || el === document.body) return null;

    // Standard inputs
    if (el.tagName === "TEXTAREA") return el;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      const editableTypes = new Set(["text", "search", "email", "url", "tel", "number", ""]);
      if (editableTypes.has(type) && !el.readOnly && !el.disabled) return el;
    }

    // Contenteditable — check the element itself, then walk up ancestors.
    // Modern editors (Messenger/Lexical, Slack, Notion) often focus a child
    // element inside the contenteditable root.
    let candidate = el;
    while (candidate && candidate !== document.body) {
      if (candidate.isContentEditable && candidate.getAttribute("contenteditable") !== "false") {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    // Last resort: look for [contenteditable="true"][role="textbox"] nearby
    // (Messenger uses role="textbox" on its editor root)
    const textbox = document.querySelector('[contenteditable="true"][role="textbox"]');
    if (textbox) {
      textbox.focus();
      return textbox;
    }

    return null;
  }

  // ========== Start speech recognition ==========
  function startRecognition(lang) {
    // Find the focused input
    const el = findFocusedEditable();
    if (!el) {
      return { ok: false, error: "no-editable-element" };
    }

    // Stop any existing recognition
    if (recognition) {
      stopRecognition();
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return { ok: false, error: "speech-api-not-supported" };
    }

    targetElement = el;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    // Base text = whatever is already in the field
    let baseText = getTargetValue(el);
    let committedTranscript = "";

    recognition.onresult = (event) => {
      // Guard: target may have been removed from DOM (SPA navigation, etc.)
      if (!el || !el.isConnected) {
        stopRecognition();
        notifyBackground();
        return;
      }

      let interimTranscript = "";
      let sessionFinal = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          sessionFinal += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (sessionFinal !== committedTranscript) {
        committedTranscript = sessionFinal;
      }

      // Build full text: base + space + final + interim
      const separator = baseText.length > 0 && !baseText.endsWith(" ") ? " " : "";
      const fullText = baseText + separator + committedTranscript + interimTranscript;

      setTargetValue(el, fullText);
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.warn("[Voice Input] Recognition error:", event.error);
      stopRecognition();
      notifyBackground();
    };

    recognition.onend = () => {
      // Auto-restart if we're still supposed to be recording
      if (recognition && targetElement === el) {
        baseText = getTargetValue(el);
        committedTranscript = "";
        try {
          recognition.start();
        } catch (e) {
          stopRecognition();
          notifyBackground();
        }
      }
    };

    try {
      recognition.start();
      showIndicator(el);
      return { ok: true };
    } catch (e) {
      console.warn("[Voice Input] Could not start recognition:", e);
      stopRecognition();
      return { ok: false, error: e.message };
    }
  }

  // ========== Stop speech recognition ==========
  function stopRecognition() {
    if (recognition) {
      try {
        recognition.onend = null; // prevent auto-restart
        recognition.stop();
      } catch (e) {
        // Ignore
      }
      recognition = null;
    }
    targetElement = null;
    hideIndicator();
  }

  // ========== Tell background we stopped ==========
  function notifyBackground() {
    try {
      chrome.runtime.sendMessage({ type: "voice-input-stopped" });
    } catch (e) {
      // Extension context invalidated — ignore
    }
  }

  // ========== Get/set value on target element ==========
  function getTargetValue(el) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      return el.value;
    }
    return el.innerText || "";
  }

  function isStandardInput(el) {
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA";
  }

  function setTargetValue(el, text) {
    if (isStandardInput(el)) {
      // Use native setter to work with React/Vue/Angular
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const nativeSet = Object.getOwnPropertyDescriptor(proto, "value")?.set;

      if (nativeSet) {
        nativeSet.call(el, text);
      } else {
        el.value = text;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Contenteditable — use execCommand for maximum compatibility with
      // rich-text editors (Messenger/Lexical, Slack, Notion, Gmail).
      // execCommand integrates with the editor's internal state, undo stack,
      // and event pipeline, unlike raw DOM mutations.
      setContentEditableValue(el, text);
    }
  }

  function setContentEditableValue(el, text) {
    // Focus the element and select all existing content
    el.focus();

    try {
      // Select all content in the element
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      // Ignore selection errors
    }

    // Try execCommand first — it works with most rich-text editors because
    // it fires the full browser input pipeline (beforeinput → DOM change → input)
    // which Lexical, Draft.js, ProseMirror, etc. all listen to.
    const inserted = document.execCommand("insertText", false, text);

    if (!inserted) {
      // Fallback: simulate InputEvent manually.
      // This covers edge cases where execCommand is blocked or deprecated.
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);

        // Fire beforeinput
        el.dispatchEvent(new InputEvent("beforeinput", {
          inputType: "insertText",
          data: text,
          bubbles: true,
          cancelable: true,
          composed: true,
        }));

        // Perform the actual DOM update
        el.textContent = text;

        // Fire input
        el.dispatchEvent(new InputEvent("input", {
          inputType: "insertText",
          data: text,
          bubbles: true,
          composed: true,
        }));
      } catch (e) {
        // Last resort: raw textContent + generic input event
        el.textContent = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    // Move cursor to end
    moveCursorToEnd(el);
  }

  function moveCursorToEnd(el) {
    try {
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      // Ignore
    }
  }

  // ========== Visual indicator ==========
  function showIndicator(el) {
    hideIndicator();

    indicator = document.createElement("div");
    indicator.className = "vi-recording-indicator";
    indicator.textContent = "Recording...";
    document.body.appendChild(indicator);

    positionIndicator(el);

    // Reposition on scroll/resize
    window.addEventListener("scroll", repositionHandler, true);
    window.addEventListener("resize", repositionHandler, true);
  }

  function positionIndicator(el) {
    if (!indicator || !el) return;
    const rect = el.getBoundingClientRect();
    indicator.style.top = (window.scrollY + rect.top - 28) + "px";
    indicator.style.left = (window.scrollX + rect.left) + "px";
  }

  function repositionHandler() {
    if (targetElement && indicator) {
      positionIndicator(targetElement);
    }
  }

  function hideIndicator() {
    if (indicator) {
      indicator.remove();
      indicator = null;
    }
    window.removeEventListener("scroll", repositionHandler, true);
    window.removeEventListener("resize", repositionHandler, true);
  }
})();
