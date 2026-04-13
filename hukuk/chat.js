/* iterasyon hukuk — chat client
   Calls /api/chat on our Express server (server streams Claude SSE). */

const STORAGE_CHAT_CONTACT  = "iterasyon_hukuk_chat_for_contact";
const STORAGE_LAWYER_NUDGE_DISMISSED = "iterasyon_lawyer_nudge_closed";
const STORAGE_SESSION_ID    = "iterasyon_hukuk_session_id";

// ── State ─────────────────────────────────────
let history     = []; // { role: "user"|"assistant", content: string }[]
let isStreaming  = false;
let lawyerNudgeShownThisVisit = false;

// Generate or restore a UUID for this chat session
function getSessionId() {
  try {
    let id = sessionStorage.getItem(STORAGE_SESSION_ID);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(STORAGE_SESSION_ID, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
const SESSION_ID = getSessionId();

// ── DOM refs ──────────────────────────────────
const messagesEl = document.getElementById("messages");
const inputEl    = document.getElementById("chat-input");
const sendBtn    = document.getElementById("send-btn");

// ── Init ──────────────────────────────────────
inputEl.addEventListener("input",  onInputChange);
inputEl.addEventListener("keydown", onKeyDown);
sendBtn.addEventListener("click",   onSend);
onInputChange();

function persistChatForContactPage() {
  try {
    sessionStorage.setItem(STORAGE_CHAT_CONTACT, JSON.stringify(history));
  } catch (_) {
    /* quota / private mode */
  }
}

function userTurnCount() {
  return history.filter((m) => m.role === "user").length;
}

function maybeShowLawyerNudge() {
  if (lawyerNudgeShownThisVisit) return;
  if (sessionStorage.getItem(STORAGE_LAWYER_NUDGE_DISMISSED)) return;
  if (userTurnCount() < 2) return;
  lawyerNudgeShownThisVisit = true;

  const previousFocus = document.activeElement;

  const overlay = document.createElement("div");
  overlay.className = "lawyer-nudge-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "lawyer-nudge-title");

  overlay.innerHTML = `
    <div class="lawyer-nudge-modal">
      <button type="button" class="lawyer-nudge-close" aria-label="Kapat">×</button>
      <h2 id="lawyer-nudge-title">Avukatla konuşmak ister misiniz?</h2>
      <p>AI genel bilgi verir; somut dosyanız veya riskli bir adım söz konusuysa bir avukata danışmanız doğru olur. İsterseniz mesajınızı ve sohbet özetinizi bırakın, size dönelim.</p>
      <div class="lawyer-nudge-actions">
        <a href="/iletisim/" class="btn btn-gold lawyer-nudge-primary">İletişim formunu aç</a>
        <button type="button" class="btn btn-ghost lawyer-nudge-dismiss">Şimdilik hayır</button>
      </div>
    </div>
  `;

  const close = (dismissForSession) => {
    if (dismissForSession) {
      try {
        sessionStorage.setItem(STORAGE_LAWYER_NUDGE_DISMISSED, "1");
      } catch (_) {}
    }
    overlay.remove();
    previousFocus?.focus();
  };

  overlay.querySelector(".lawyer-nudge-close").addEventListener("click", () => close(true));
  overlay.querySelector(".lawyer-nudge-dismiss").addEventListener("click", () => close(true));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close(true);
  });

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(true); return; }
    if (e.key === "Tab") {
      const focusable = [...overlay.querySelectorAll("a[href], button:not([disabled])")];
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });

  document.body.appendChild(overlay);
  overlay.querySelector(".lawyer-nudge-close").focus();
}

// ── Input helpers ─────────────────────────────
function onInputChange() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  sendBtn.disabled = !inputEl.value.trim() || isStreaming;
}

function onKeyDown(e) {
  if (e.key === "Enter" && !e.shiftKey && window.innerWidth > 640) {
    e.preventDefault();
    if (!sendBtn.disabled) onSend();
  }
}

// ── Send ──────────────────────────────────────
async function onSend() {
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;

  appendMessage("user", text);
  history.push({ role: "user", content: text });

  inputEl.value = "";
  onInputChange();
  scrollToBottom();

  const typingId = showTyping();
  isStreaming     = true;
  sendBtn.disabled = true;

  try {
    const aiText = await streamFromServer((chunk) => {
      updateTypingBubble(typingId, chunk);
      scrollToBottom();
    });
    history.push({ role: "assistant", content: aiText });
    persistChatForContactPage();
    maybeShowLawyerNudge();
  } catch (err) {
    removeTyping(typingId);
    appendMessage("ai", `⚠ ${err.message}`);
  } finally {
    persistChatForContactPage();
    isStreaming      = false;
    onInputChange();
    inputEl.focus();
    scrollToBottom();
  }
}

// ── Stream from /api/chat ─────────────────────
async function streamFromServer(onChunk) {
  const res = await fetch("/api/chat", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ messages: history, sessionId: SESSION_ID }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Sunucu hatası: HTTP ${res.status}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";
  let   full    = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break;

      try {
        const json = JSON.parse(raw);
        if (json.error) throw new Error(json.error);
        if (json.text) {
          full += json.text;
          onChunk(full);
        }
        if (json.done) break;
      } catch (e) {
        if (!e.message.startsWith("{")) throw e; // re-throw real errors
      }
    }
  }

  return full;
}

// ── DOM helpers ───────────────────────────────
function appendMessage(role, text) {
  const wrap   = document.createElement("div");
  wrap.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className  = "msg-avatar";
  avatar.textContent = role === "ai" ? "ik" : "siz";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = markdownToHtml(text);

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  return wrap;
}

let typingCounter = 0;

function showTyping() {
  const id = `typing-${++typingCounter}`;

  const wrap = document.createElement("div");
  wrap.className = "msg ai";
  wrap.id = id;

  const avatar = document.createElement("div");
  avatar.className  = "msg-avatar";
  avatar.textContent = "ik";

  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";

  wrap.appendChild(avatar);
  wrap.appendChild(dots);
  messagesEl.appendChild(wrap);
  return id;
}

function updateTypingBubble(id, text) {
  const wrap = document.getElementById(id);
  if (!wrap) return;

  if (!wrap.querySelector(".bubble")) {
    wrap.querySelector(".typing-dots")?.remove();
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    wrap.appendChild(bubble);
  }

  const bubble = wrap.querySelector(".bubble");
  if (bubble) bubble.innerHTML = markdownToHtml(text);
}

function removeTyping(id) {
  document.getElementById(id)?.remove();
}

function scrollToBottom() {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
}

// ── Markdown → HTML (streaming-safe) ─────────
// Runs on every chunk with the full accumulated text, so re-renders
// are cheap and incomplete patterns at the end are handled gracefully.

function markdownToHtml(raw) {
  // 1. Escape HTML entities so AI text can't inject markup
  let text = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 2. Process line by line for block elements
  const lines = text.split("\n");
  const out   = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Headings ──────────────────────────────
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) { out.push(`<h3>${applyInline(h3[1])}</h3>`); i++; continue; }

    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) { out.push(`<h2>${applyInline(h2[1])}</h2>`); i++; continue; }

    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) { out.push(`<h1>${applyInline(h1[1])}</h1>`); i++; continue; }

    // ── Bullet list ───────────────────────────
    if (/^[-•*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i])) {
        items.push(`<li>${applyInline(lines[i].replace(/^[-•*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // ── Numbered list ─────────────────────────
    if (/^\d+[.)]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) {
        items.push(`<li>${applyInline(lines[i].replace(/^\d+[.)]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // ── Blockquote ────────────────────────────
    const bq = line.match(/^>\s*(.*)/);
    if (bq) { out.push(`<blockquote>${applyInline(bq[1])}</blockquote>`); i++; continue; }

    // ── Horizontal rule ───────────────────────
    if (/^---+$/.test(line.trim())) { out.push("<hr>"); i++; continue; }

    // ── Blank line ────────────────────────────
    if (!line.trim()) { i++; continue; }

    // ── Paragraph ─────────────────────────────
    // Collect consecutive non-block lines
    const paraLines = [];
    const BLOCK_RE  = /^(#{1,3}\s|[-•*]\s|\d+[.)]\s|>\s|---+$)/;
    while (i < lines.length && lines[i].trim() && !BLOCK_RE.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      out.push(`<p>${applyInline(paraLines.join("<br>"))}</p>`);
    }
  }

  return out.join("");
}

// Inline: bold, italic, code — applied inside each block
function applyInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}
