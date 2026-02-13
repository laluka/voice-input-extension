(() => {
  "use strict";

  // Prevent double-injection (script may be injected multiple times)
  if (window.__voiceInputLoaded) return;
  window.__voiceInputLoaded = true;

  // ========== State ==========
  let recognition = null;
  let targetElement = null;
  let indicator = null;

  // ========== Escape key — stop recording, keep text ==========
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && recognition) {
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

    if (!el) return null;

    // Standard inputs
    if (el.tagName === "TEXTAREA") return el;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      const editableTypes = new Set(["text", "search", "email", "url", "tel", "number", ""]);
      if (editableTypes.has(type) && !el.readOnly && !el.disabled) return el;
    }

    // Contenteditable
    if (el.isContentEditable && el.getAttribute("contenteditable") !== "false") {
      return el;
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

  function setTargetValue(el, text) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
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
      // Contenteditable
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));

      // Move cursor to end
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
