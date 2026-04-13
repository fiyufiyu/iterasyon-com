/* iterasyon hukuk — chat engine
   Uses OpenAI Chat Completions API with streaming.
   API key stored in localStorage only. */

const STORAGE_KEY = "ik_openai_key";
const MODEL       = "gpt-4o-mini";

const SYSTEM_PROMPT = `Sen iterasyon hukuk'un yapay zeka asistanısın. Türkiye'deki bireylere Türk hukuku konusunda genel bilgi ve rehberlik sağlarsın.

Kurallar:
- Her zaman Türkçe yanıt ver.
- Sade, anlaşılır bir dil kullan; gereksiz jargondan kaçın.
- Somut ve pratik bilgi ver.
- Kısa ve öz cevapları tercih et; gerekmedikçe çok uzun yazma.
- Her yanıtın sonuna, konunun hassasiyetine göre kısa bir "Önemli not: Bu bilgi hukuki tavsiye değildir; önemli kararlar için bir avukata danışın." uyarısı ekle.
- Şu alanlarda uzmansın: iş hukuku, kira ve taşınmaz hukuku, tüketici hakları, sözleşme hukuku, aile hukuku, idare hukuku ve genel hukuki prosedürler.
- Bilmediğin veya emin olmadığın konularda bunu açıkça belirt.
- Yanıt verirken ilgili kanun maddelerini veya mevzuatı isimlendirmen (örn. "İş Kanunu Madde 17") kullanıcıya çok yardımcı olur.`;

// ── State ─────────────────────────────────────
let history    = []; // { role, content }[]
let isStreaming = false;

// ── DOM refs ──────────────────────────────────
const messagesEl  = document.getElementById("messages");
const inputEl     = document.getElementById("chat-input");
const sendBtn     = document.getElementById("send-btn");
const keyOverlay  = document.getElementById("key-overlay");
const keyInput    = document.getElementById("api-key-input");
const saveKeyBtn  = document.getElementById("save-key-btn");
const settingsBtn = document.getElementById("settings-btn");

// ── Init ──────────────────────────────────────
function init() {
  const key = getKey();
  if (!key) showKeyOverlay();
  else      hideKeyOverlay();

  inputEl.addEventListener("input",   onInputChange);
  inputEl.addEventListener("keydown",  onKeyDown);
  sendBtn.addEventListener("click",    onSend);
  saveKeyBtn.addEventListener("click", onSaveKey);
  settingsBtn.addEventListener("click", showKeyOverlay);

  // keep send button state in sync
  onInputChange();
}

// ── Key management ────────────────────────────
function getKey() { return localStorage.getItem(STORAGE_KEY) || ""; }

function showKeyOverlay() {
  keyInput.value = getKey();
  keyOverlay.style.display = "flex";
  setTimeout(() => keyInput.focus(), 100);
}

function hideKeyOverlay() {
  keyOverlay.style.display = "none";
}

function onSaveKey() {
  const val = keyInput.value.trim();
  if (!val.startsWith("sk-")) {
    keyInput.style.borderColor = "rgba(255,80,80,.6)";
    keyInput.focus();
    return;
  }
  keyInput.style.borderColor = "";
  localStorage.setItem(STORAGE_KEY, val);
  hideKeyOverlay();
  inputEl.focus();
}

// close overlay by clicking outside modal
keyOverlay.addEventListener("click", (e) => {
  if (e.target === keyOverlay && getKey()) hideKeyOverlay();
});

keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onSaveKey();
});

// ── Input auto-resize ─────────────────────────
function onInputChange() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  sendBtn.disabled = !inputEl.value.trim() || isStreaming;
}

function onKeyDown(e) {
  // Send on Enter (not Shift+Enter) on non-mobile
  if (e.key === "Enter" && !e.shiftKey && window.innerWidth > 640) {
    e.preventDefault();
    if (!sendBtn.disabled) onSend();
  }
}

// ── Send ──────────────────────────────────────
async function onSend() {
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;

  const key = getKey();
  if (!key) { showKeyOverlay(); return; }

  // Append user message
  appendMessage("user", text);
  history.push({ role: "user", content: text });

  inputEl.value = "";
  onInputChange();
  scrollToBottom();

  // Show typing indicator
  const typingId = showTyping();
  isStreaming = true;
  sendBtn.disabled = true;

  try {
    const aiText = await streamCompletion(key, (chunk) => {
      // Update bubble in place during streaming
      updateTypingBubble(typingId, chunk);
      scrollToBottom();
    });

    history.push({ role: "assistant", content: aiText });
  } catch (err) {
    removeTyping(typingId);
    appendMessage("ai", getErrorMessage(err));
  } finally {
    isStreaming = false;
    onInputChange();
    inputEl.focus();
    scrollToBottom();
  }
}

// ── OpenAI streaming ──────────────────────────
async function streamCompletion(apiKey, onChunk) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model:      MODEL,
      messages,
      stream:     true,
      max_tokens: 1200,
      temperature: 0.6
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
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
    buffer = lines.pop(); // keep partial line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const json  = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(full);
        }
      } catch { /* ignore parse errors */ }
    }
  }

  return full;
}

// ── DOM helpers ───────────────────────────────
function appendMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "ai" ? "ik" : "siz";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = markdownToHtml(text);

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  return wrap;
}

// Typing indicator — returns a unique id
let typingCounter = 0;

function showTyping() {
  const id = `typing-${++typingCounter}`;

  const wrap = document.createElement("div");
  wrap.className = "msg ai";
  wrap.id = id;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
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

  // Replace dots with real bubble on first chunk
  const existing = wrap.querySelector(".bubble");
  if (!existing) {
    const dots = wrap.querySelector(".typing-dots");
    if (dots) dots.remove();

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    wrap.appendChild(bubble);
  }

  const bubble = wrap.querySelector(".bubble");
  if (bubble) bubble.innerHTML = markdownToHtml(text);
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToBottom() {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
}

// ── Minimal markdown → HTML ───────────────────
function markdownToHtml(text) {
  return text
    // escape
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // inline code
    .replace(/`([^`]+)`/g, "<code style='font-size:.85em;background:rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;'>$1</code>")
    // unordered list items
    .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    // paragraphs (double newline)
    .split(/\n{2,}/).map(p => {
      if (p.startsWith("<ul>") || p.startsWith("<li>")) return p;
      return `<p>${p.replace(/\n/g, "<br>")}</p>`;
    }).join("");
}

// ── Error messages ────────────────────────────
function getErrorMessage(err) {
  const msg = err.message || "";
  if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("invalid_api_key")) {
    return "API anahtarı geçersiz. Lütfen ⚙ butonundan anahtarınızı güncelleyin.";
  }
  if (msg.includes("429") || msg.includes("quota")) {
    return "API kullanım limitiniz dolmuş. OpenAI hesabınızı kontrol edin.";
  }
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "Bağlantı hatası. İnternet bağlantınızı kontrol edin.";
  }
  return `Bir hata oluştu: ${msg || "bilinmeyen hata"}`;
}

// ── Start ─────────────────────────────────────
init();
