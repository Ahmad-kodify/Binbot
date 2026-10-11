(function () {
  "use strict";

  // Prevent multiple initializations
  if (window.__BINBOT_WIDGET_LOADED__) return;
  window.__BINBOT_WIDGET_LOADED__ = true;

  // Find the script tag that loaded this widget
  const currentScript =
    document.currentScript ||
    document.querySelector("script[data-bot-id]") ||
    document.querySelector("script[src*='widget.js']");

  const botId = currentScript ? currentScript.getAttribute("data-bot-id") : null;
  // If data-api-url is provided use it, otherwise derive from script src or current origin
  let scriptUrl = "";
  try {
    scriptUrl = currentScript && currentScript.src ? new URL(currentScript.src).origin : "";
  } catch {}

  const apiUrl =
    (currentScript && currentScript.getAttribute("data-api-url")) ||
    scriptUrl ||
    window.location.origin;

  if (!botId) {
    console.warn("[Binbot] Missing data-bot-id attribute on script tag.");
  }

  // Create isolated widget container
  const container = document.createElement("div");
  container.id = "binbot-widget-root";
  document.body.appendChild(container);

  // Attach Shadow DOM for complete CSS isolation from host page
  const shadow = container.attachShadow ? container.attachShadow({ mode: "open" }) : container;

  const style = document.createElement("style");
  style.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .binbot-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
      color: #ffffff;
      box-shadow: 0 10px 25px -5px rgba(6, 182, 212, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      border: none;
      outline: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .binbot-launcher:hover {
      transform: scale(1.08) translateY(-2px);
      box-shadow: 0 14px 30px -5px rgba(6, 182, 212, 0.5);
    }

    .binbot-launcher:active {
      transform: scale(0.95);
    }

    .binbot-launcher svg {
      width: 28px;
      height: 28px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .binbot-window {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      height: 580px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 120px);
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 20px;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 999999;
      opacity: 0;
      transform: translateY(16px) scale(0.96);
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .binbot-window.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .binbot-header {
      background: #0f172a;
      padding: 16px;
      border-bottom: 1px solid #1e293b;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .binbot-header-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .binbot-avatar {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }

    .binbot-avatar svg {
      width: 20px;
      height: 20px;
    }

    .binbot-title {
      font-size: 15px;
      font-weight: 600;
      color: #f8fafc;
    }

    .binbot-subtitle {
      font-size: 11px;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .binbot-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      display: inline-block;
    }

    .binbot-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }

    .binbot-close-btn:hover {
      background: #1e293b;
      color: #f1f5f9;
    }

    .binbot-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #060911;
    }

    .binbot-message {
      max-width: 82%;
      padding: 11px 14px;
      border-radius: 14px;
      font-size: 13.5px;
      line-height: 1.5;
      word-break: break-word;
    }

    .binbot-msg-bot {
      align-self: flex-start;
      background: #131b2e;
      color: #e2e8f0;
      border: 1px solid #1e293b;
      border-bottom-left-radius: 4px;
    }

    .binbot-msg-user {
      align-self: flex-end;
      background: #0284c7;
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }

    .binbot-sources {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px dashed rgba(255, 255, 255, 0.1);
      font-size: 11px;
    }

    .binbot-sources-title {
      color: #38bdf8;
      font-weight: 600;
      margin-bottom: 3px;
    }

    .binbot-source-link {
      color: #93c5fd;
      text-decoration: underline;
      display: block;
      margin-bottom: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .binbot-source-link:hover {
      color: #60a5fa;
    }

    .binbot-typing {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 14px;
      background: #131b2e;
      border-radius: 14px;
      border-bottom-left-radius: 4px;
      align-self: flex-start;
      border: 1px solid #1e293b;
    }

    .binbot-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #06b6d4;
      animation: binbot-pulse 1.4s infinite ease-in-out both;
    }

    .binbot-dot:nth-child(1) { animation-delay: -0.32s; }
    .binbot-dot:nth-child(2) { animation-delay: -0.16s; }

    @keyframes binbot-pulse {
      0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    .binbot-input-area {
      padding: 12px 14px;
      background: #0f172a;
      border-top: 1px solid #1e293b;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .binbot-input {
      flex: 1;
      background: #1e293b;
      border: 1px solid #334155;
      color: #f8fafc;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13.5px;
      outline: none;
      transition: border-color 0.15s;
    }

    .binbot-input:focus {
      border-color: #06b6d4;
    }

    .binbot-input::placeholder {
      color: #64748b;
    }

    .binbot-send-btn {
      background: #06b6d4;
      border: none;
      color: #090d16;
      width: 38px;
      height: 38px;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      flex-shrink: 0;
    }

    .binbot-send-btn:hover {
      background: #22d3ee;
      transform: scale(1.04);
    }

    .binbot-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .binbot-send-btn svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
    }

    .binbot-footer-brand {
      padding: 6px;
      text-align: center;
      font-size: 10px;
      color: #64748b;
      background: #0f172a;
      border-top: 1px solid rgba(255, 255, 255, 0.03);
    }
  `;

  shadow.appendChild(style);

  // Widget HTML structure
  const widgetWrapper = document.createElement("div");
  widgetWrapper.innerHTML = `
    <button class="binbot-launcher" id="binbot-launcher" aria-label="Open chat assistant">
      <svg id="binbot-launcher-icon-open" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      <svg id="binbot-launcher-icon-close" style="display:none;" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>

    <div class="binbot-window" id="binbot-window" role="dialog" aria-modal="true" aria-label="Binbot AI Assistant">
      <div class="binbot-header">
        <div class="binbot-header-info">
          <div class="binbot-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8.01" y2="16"></line><line x1="16" y1="16" x2="16.01" y2="16"></line></svg>
          </div>
          <div>
            <div class="binbot-title" id="binbot-header-name">AI Assistant</div>
            <div class="binbot-subtitle"><span class="binbot-status-dot"></span> Online & Grounded</div>
          </div>
        </div>
        <button class="binbot-close-btn" id="binbot-close-btn" aria-label="Close chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="binbot-messages" id="binbot-messages">
        <div class="binbot-message binbot-msg-bot">
          Hello! I am an AI assistant trained on this website. Ask me anything about our services, products, or information!
        </div>
      </div>

      <div class="binbot-input-area">
        <input type="text" class="binbot-input" id="binbot-input" placeholder="Ask a question..." autocomplete="off" />
        <button class="binbot-send-btn" id="binbot-send-btn" aria-label="Send message">
          <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>

      <div class="binbot-footer-brand">Powered by Binbot AI</div>
    </div>
  `;

  shadow.appendChild(widgetWrapper);

  // Widget elements
  const launcher = shadow.getElementById("binbot-launcher");
  const win = shadow.getElementById("binbot-window");
  const closeBtn = shadow.getElementById("binbot-close-btn");
  const input = shadow.getElementById("binbot-input");
  const sendBtn = shadow.getElementById("binbot-send-btn");
  const messagesBox = shadow.getElementById("binbot-messages");
  const iconOpen = shadow.getElementById("binbot-launcher-icon-open");
  const iconClose = shadow.getElementById("binbot-launcher-icon-close");

  let isOpen = false;
  let isSending = false;

  function toggleWidget() {
    isOpen = !isOpen;
    if (isOpen) {
      win.classList.add("open");
      iconOpen.style.display = "none";
      iconClose.style.display = "block";
      setTimeout(() => input.focus(), 150);
    } else {
      win.classList.remove("open");
      iconOpen.style.display = "block";
      iconClose.style.display = "none";
    }
  }

  launcher.addEventListener("click", toggleWidget);
  closeBtn.addEventListener("click", toggleWidget);

  function appendMessage(text, isUser = false, sources = []) {
    const msg = document.createElement("div");
    msg.className = `binbot-message ${isUser ? "binbot-msg-user" : "binbot-msg-bot"}`;
    msg.textContent = text;

    if (!isUser && sources && sources.length > 0) {
      const srcBox = document.createElement("div");
      srcBox.className = "binbot-sources";
      const srcTitle = document.createElement("div");
      srcTitle.className = "binbot-sources-title";
      srcTitle.textContent = "Sources:";
      srcBox.appendChild(srcTitle);

      sources.forEach((s) => {
        const link = document.createElement("a");
        link.className = "binbot-source-link";
        link.href = s.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = s.title || s.url;
        srcBox.appendChild(link);
      });

      msg.appendChild(srcBox);
    }

    messagesBox.appendChild(msg);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function showTyping() {
    const typing = document.createElement("div");
    typing.className = "binbot-typing";
    typing.id = "binbot-typing-indicator";
    typing.innerHTML = `<span class="binbot-dot"></span><span class="binbot-dot"></span><span class="binbot-dot"></span>`;
    messagesBox.appendChild(typing);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function removeTyping() {
    const typing = shadow.getElementById("binbot-typing-indicator");
    if (typing) typing.remove();
  }

  async function handleSend() {
    const text = input.value.trim();
    if (!text || isSending) return;

    if (!botId) {
      appendMessage("Error: No bot ID was configured for this widget snippet.", false);
      return;
    }

    appendMessage(text, true);
    input.value = "";
    isSending = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const endpoint = `${apiUrl.replace(/\/$/, "")}/api/chat`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: botId,
          message: text,
        }),
      });

      removeTyping();

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${res.status}`);
      }

      const data = await res.json();
      appendMessage(data.answer || "No response received.", false, data.sources || []);
    } catch (err) {
      removeTyping();
      appendMessage(`Error: ${err.message || "Failed to reach chatbot service."}`, false);
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener("click", handleSend);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  });
})();
