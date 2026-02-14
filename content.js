(() => {
  "use strict";

  // Prevent double-injection (script may be injected multiple times)
  if (window.__voiceInputLoaded) return;
  window.__voiceInputLoaded = true;

  // ========== State ==========
  let recognition = null;
  let targetElement = null;   // the input/contenteditable to insert into at the end
  let overlay = null;         // center-screen transcription overlay
  let finalTranscript = "";   // accumulated final text across restarts
  let currentInterim = "";    // latest interim (tentative) text — included on stop

  // ========== Safety: auto-stop if extension context dies ==========
  const contextCheckInterval = setInterval(() => {
    try {
      if (chrome.runtime && chrome.runtime.id) return;
    } catch (e) { /* context invalidated */ }
    clearInterval(contextCheckInterval);
    if (recognition) {
      finalTranscript = ""; // don't insert on zombie cleanup
      stopRecognition();
    }
  }, 2000);

  // ========== Escape / Space — stop recording ==========
  document.addEventListener("keydown", (e) => {
    if (!recognition) return;

    if (e.key === "Escape" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      stopRecognition();
      notifyBackground();
    }
  }, true);

  // ========== Message handler ==========
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "voice-input-start") {
      sendResponse(startRecognition(msg.lang || "en-US"));
      return true;
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

    // Contenteditable — walk up from focused element to find the
    // contenteditable root (Messenger/Lexical, Slack, Notion focus a
    // child node inside the editor).
    let candidate = el;
    while (candidate && candidate !== document.body) {
      if (candidate.isContentEditable && candidate.getAttribute("contenteditable") !== "false") {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    // Last resort: query for a visible contenteditable textbox
    const textbox = document.querySelector('[contenteditable="true"][role="textbox"]');
    if (textbox) return textbox;

    return null;
  }

  // ========== Start speech recognition ==========
  function startRecognition(lang) {
    const el = findFocusedEditable();
    if (!el) {
      return { ok: false, error: "no-editable-element" };
    }

    if (recognition) stopRecognition();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return { ok: false, error: "speech-api-not-supported" };
    }

    targetElement = el;
    finalTranscript = "";
    currentInterim = "";

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    // Track committed text within each recognition session.
    // (Chrome auto-stops after ~60s; onend restarts it.)
    let sessionCommitted = "";

    recognition.onresult = (event) => {
      let sessionFinal = "";
      let interim = "";

      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          sessionFinal += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }

      // Accumulate newly finalized text into the global finalTranscript
      if (sessionFinal.length > sessionCommitted.length) {
        finalTranscript += sessionFinal.substring(sessionCommitted.length);
        sessionCommitted = sessionFinal;
      }

      // Keep interim accessible so stopRecognition can include it
      currentInterim = interim;

      // Update the overlay with everything so far + tentative text
      updateOverlay(finalTranscript, interim);
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
        sessionCommitted = "";
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
      showOverlay();
      return { ok: true };
    } catch (e) {
      console.warn("[Voice Input] Could not start recognition:", e);
      recognition = null;
      targetElement = null;
      return { ok: false, error: e.message };
    }
  }

  // ========== Stop speech recognition ==========
  function stopRecognition() {
    const el = targetElement;
    // Always include interim text — the user sees it in the overlay,
    // so it should be inserted. Worst case they can Ctrl+Z.
    const text = (finalTranscript + currentInterim).trim();

    if (recognition) {
      try {
        recognition.onend = null;
        recognition.stop();
      } catch (e) { /* ignore */ }
      recognition = null;
    }

    hideOverlay();

    // Insert the accumulated text into the target element (one single shot)
    if (el && el.isConnected && text) {
      insertTextIntoElement(el, text);
    }

    targetElement = null;
    finalTranscript = "";
    currentInterim = "";
  }

  // ========== Tell background we stopped ==========
  function notifyBackground() {
    try {
      chrome.runtime.sendMessage({ type: "voice-input-stopped" });
    } catch (e) { /* extension context invalidated */ }
  }

  // ========== Insert text into the target element (called once on stop) ==========
  function insertTextIntoElement(el, text) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      insertIntoStandardInput(el, text);
    } else {
      insertIntoContentEditable(el, text);
    }
  }

  function insertIntoStandardInput(el, text) {
    // Insert at cursor position (or append if no selection)
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.substring(0, start);
    const after = el.value.substring(end);

    // Add space separator if needed
    const needsSpace = before.length > 0 && !before.endsWith(" ") && !text.startsWith(" ");
    const newValue = before + (needsSpace ? " " : "") + text + after;

    // Use native setter for React/Vue/Angular compatibility
    const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const nativeSet = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    if (nativeSet) {
      nativeSet.call(el, newValue);
    } else {
      el.value = newValue;
    }

    // Place cursor after inserted text
    const cursorPos = before.length + (needsSpace ? 1 : 0) + text.length;
    el.setSelectionRange(cursorPos, cursorPos);

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function insertIntoContentEditable(el, text) {
    el.focus();

    // Determine if we need a leading space
    const existing = el.innerText || "";
    const needsSpace = existing.length > 0
      && !existing.endsWith(" ")
      && !existing.endsWith("\n")
      && !text.startsWith(" ");
    const toInsert = (needsSpace ? " " : "") + text;

    // Move cursor to end
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* ignore */ }

    // ------------------------------------------------------------------
    // Strategy 1: Synthetic paste event (no clipboard pollution).
    // Rich editors (Lexical/Messenger, Slate/Discord, Draft.js, ProseMirror)
    // all handle paste events via their own well-tested paste pipeline.
    // They call preventDefault() when they consume the event.
    // ------------------------------------------------------------------
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", toInsert);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      const consumed = !el.dispatchEvent(pasteEvent);
      if (consumed) return; // editor handled it
    } catch (e) { /* DataTransfer/ClipboardEvent not available — continue */ }

    // ------------------------------------------------------------------
    // Strategy 2: execCommand (works for simple contenteditable elements
    // without a JS framework managing the editor state).
    // ------------------------------------------------------------------
    if (document.execCommand("insertText", false, toInsert)) return;

    // ------------------------------------------------------------------
    // Strategy 3: InputEvent simulation — fire beforeinput + input with
    // the proper inputType so any remaining editors can pick it up.
    // ------------------------------------------------------------------
    try {
      el.dispatchEvent(new InputEvent("beforeinput", {
        inputType: "insertText",
        data: toInsert,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
      el.appendChild(document.createTextNode(toInsert));
      el.dispatchEvent(new InputEvent("input", {
        inputType: "insertText",
        data: toInsert,
        bubbles: true,
        composed: true,
      }));
    } catch (e) {
      // Strategy 4: raw DOM append — last resort
      el.appendChild(document.createTextNode(toInsert));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // ========== Overlay (center-screen transcription display) ==========
  function showOverlay() {
    hideOverlay();

    overlay = document.createElement("div");
    overlay.className = "vi-overlay";

    overlay.innerHTML =
      '<div class="vi-overlay-header">' +
        '<span class="vi-dot"></span> Recording — press <kbd>Space</kbd> or <kbd>Esc</kbd> to stop' +
      '</div>' +
      '<div class="vi-overlay-text" data-placeholder="Listening..."></div>';

    document.body.appendChild(overlay);
  }

  function updateOverlay(finalText, interimText) {
    if (!overlay) return;
    const textEl = overlay.querySelector(".vi-overlay-text");
    if (!textEl) return;

    // Final text in normal weight, interim text in lighter style
    if (finalText && interimText) {
      textEl.innerHTML =
        escapeHtml(finalText) +
        '<span class="vi-interim">' + escapeHtml(interimText) + '</span>';
    } else if (finalText) {
      textEl.textContent = finalText;
    } else if (interimText) {
      textEl.innerHTML = '<span class="vi-interim">' + escapeHtml(interimText) + '</span>';
    } else {
      textEl.textContent = "";
    }
  }

  function hideOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
})();
