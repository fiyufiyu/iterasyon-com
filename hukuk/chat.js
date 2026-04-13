/* iterasyon hukuk — chat client
   Calls /api/chat on our Express server (server streams Claude SSE). */

// ── State ─────────────────────────────────────
let history     = []; // { role: "user"|"assistant", content: string }[]
let isStreaming  = false;

// ── DOM refs ──────────────────────────────────
const messagesEl = document.getElementById("messages");
const inputEl    = document.getElementById("chat-input");
const sendBtn    = document.getElementById("send-btn");

// ── Init ──────────────────────────────────────
inputEl.addEventListener("input",  onInputChange);
inputEl.addEventListener("keydown", onKeyDown);
sendBtn.addEventListener("click",   onSend);
onInputChange();

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
  } catch (err) {
    removeTyping(typingId);
    appendMessage("ai", `⚠ ${err.message}`);
  } finally {
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
    body:    JSON.stringify({ messages: history }),
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

// ── Minimal markdown → HTML ───────────────────
function markdownToHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`([^`]+)`/g,     "<code style='font-size:.85em;background:rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;'>$1</code>")
    .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .split(/\n{2,}/)
    .map((p) => {
      p = p.trim();
      if (!p) return "";
      if (p.startsWith("<ul>") || p.startsWith("<li>")) return p;
      return `<p>${p.replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("");
}
