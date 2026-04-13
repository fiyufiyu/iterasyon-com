/* İletişim formu — AI sohbet özetini sessionStorage'dan alır, /api/contact'a gönderir */

const STORAGE_KEY = "iterasyon_hukuk_chat_for_contact";

function transcriptFromHistory(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  return messages
    .map((m) => {
      const who = m.role === "user" ? "Kullanıcı" : "Asistan";
      return `${who}:\n${m.content}`;
    })
    .join("\n\n—\n\n");
}

function loadChatFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return transcriptFromHistory(parsed);
  } catch (_) {
    /* ignore */
  }
  return "";
}

const form = document.getElementById("contact-form");
const statusEl = document.getElementById("contact-form-status");
const submitBtn = document.getElementById("contact-submit");
const transcriptTa = document.getElementById("cf-transcript");
const transcriptBlock = document.getElementById("transcript-block");

const prefill = loadChatFromStorage();
if (prefill) {
  transcriptTa.value = prefill;
  transcriptBlock.hidden = false;
  transcriptBlock.open = true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "";
  statusEl.classList.remove("contact-form-status--error", "contact-form-status--ok");

  const payload = {
    name: document.getElementById("cf-name").value.trim(),
    email: document.getElementById("cf-email").value.trim(),
    phone: document.getElementById("cf-phone").value.trim(),
    subject: document.getElementById("cf-subject").value.trim(),
    message: document.getElementById("cf-message").value.trim(),
    chatTranscript: transcriptTa.value.trim(),
  };

  if (!payload.name || !payload.email || !payload.message) {
    statusEl.textContent = "Lütfen ad, e-posta ve mesaj alanlarını doldurun.";
    statusEl.classList.add("contact-form-status--error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Gönderiliyor…";

  try {
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Hata: ${res.status}`);
    }

    statusEl.textContent = "Teşekkürler. Mesajınız bize ulaştı; en kısa sürede dönüş yapacağız.";
    statusEl.classList.add("contact-form-status--ok");
    form.reset();
    transcriptTa.value = "";
    transcriptBlock.hidden = true;
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    statusEl.textContent = err.message || "Bir hata oluştu.";
    statusEl.classList.add("contact-form-status--error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Gönder";
  }
});
