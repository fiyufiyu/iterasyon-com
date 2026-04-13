/* Admin panel — JWT auth + PostgreSQL contacts & chats */

const JWT_KEY = "iterasyon_admin_jwt";

// ── DOM refs ──────────────────────────────────
const loginPanel    = document.getElementById("login-panel");
const inboxPanel    = document.getElementById("inbox-panel");
const loginForm     = document.getElementById("login-form");
const loginUser     = document.getElementById("login-user");
const loginPass     = document.getElementById("login-pass");
const loginBtn      = document.getElementById("login-btn");
const loginError    = document.getElementById("login-error");
const logoutBtn     = document.getElementById("logout-btn");
const sessionInfo   = document.getElementById("admin-session-info");

// Tabs
const tabContacts   = document.getElementById("tab-contacts");
const tabChats      = document.getElementById("tab-chats");
const panelContacts = document.getElementById("panel-contacts");
const panelChats    = document.getElementById("panel-chats");
const badgeContacts = document.getElementById("badge-contacts");
const badgeChats    = document.getElementById("badge-chats");

// Contacts panel
const contactSearch   = document.getElementById("contact-search");
const contactsRefresh = document.getElementById("contacts-refresh");
const contactsStatus  = document.getElementById("contacts-status");
const contactsList    = document.getElementById("contacts-list");

// Chats panel
const chatSearch   = document.getElementById("chat-search");
const chatsRefresh = document.getElementById("chats-refresh");
const chatsStatus  = document.getElementById("chats-status");
const chatsList    = document.getElementById("chats-list");

// ── JWT helpers ───────────────────────────────
const saveToken  = (t)  => { try { sessionStorage.setItem(JWT_KEY, t); } catch (_) {} };
const loadToken  = ()   => { try { return sessionStorage.getItem(JWT_KEY) || ""; } catch (_) { return ""; } };
const clearToken = ()   => { try { sessionStorage.removeItem(JWT_KEY); } catch (_) {} };

function parseJwtPayload(token) {
  try {
    const [, b64] = token.split(".");
    return JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

function tokenExpired(token) {
  const p = parseJwtPayload(token);
  if (!p?.exp) return true;
  return Date.now() / 1000 > p.exp;
}

// ── UI state ──────────────────────────────────
function showLogin(msg) {
  loginError.textContent = msg || "";
  loginPanel.hidden = false;
  inboxPanel.hidden = true;
  loginUser.focus();
}

function showInbox(token) {
  loginPanel.hidden = true;
  inboxPanel.hidden = false;
  const p = parseJwtPayload(token);
  if (p?.exp) {
    const exp = new Date(p.exp * 1000);
    sessionInfo.textContent = `oturum: ${exp.toLocaleTimeString("tr-TR")}'e kadar`;
  }
}

// ── Tabs ──────────────────────────────────────
function activateTab(name) {
  const isContacts = name === "contacts";
  tabContacts.classList.toggle("active", isContacts);
  tabChats.classList.toggle("active", !isContacts);
  tabContacts.setAttribute("aria-selected", isContacts);
  tabChats.setAttribute("aria-selected", !isContacts);
  panelContacts.hidden = !isContacts;
  panelChats.hidden    = isContacts;
}

tabContacts.addEventListener("click", () => activateTab("contacts"));
tabChats.addEventListener("click", () => {
  activateTab("chats");
  if (!allSessions.length && chatsStatus.textContent === "") loadChats();
});

// ── Auth ──────────────────────────────────────
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "Giriş yapılıyor…";

  try {
    const res  = await fetch("/api/admin/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username: loginUser.value.trim(), password: loginPass.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    saveToken(data.token);
    showInbox(data.token);
    loginPass.value = "";
    loadContacts();
  } catch (err) {
    loginError.textContent = err.message || "Giriş başarısız.";
  } finally {
    loginBtn.disabled    = false;
    loginBtn.textContent = "Giriş yap";
  }
});

logoutBtn.addEventListener("click", () => {
  clearToken();
  allContacts = [];
  allSessions = [];
  contactsList.textContent = "";
  chatsList.textContent    = "";
  contactsStatus.textContent = "";
  chatsStatus.textContent    = "";
  loginUser.value = "";
  showLogin();
});

// ── API fetch helper ──────────────────────────
async function apiFetch(path) {
  const token = loadToken();
  const res   = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) {
    clearToken();
    showLogin("Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.");
    throw new Error("401");
  }

  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    const snippet = (await res.text()).slice(0, 100);
    throw new Error(`Sunucu JSON döndürmedi — sayfayı http://localhost:3000/admin/contacts/ adresinden açın. (${snippet})`);
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ════════════════════════════════════════════════
//  CONTACTS
// ════════════════════════════════════════════════
let allContacts = [];

function setContactsStatus(msg, isErr) {
  contactsStatus.textContent = msg || "";
  contactsStatus.className = "admin-status" + (isErr ? " admin-status--err" : "");
}

async function loadContacts() {
  setContactsStatus("Yükleniyor…", false);
  contactsRefresh.disabled = true;
  try {
    const data  = await apiFetch("/api/admin/contacts");
    allContacts = Array.isArray(data.contacts) ? data.contacts : [];
    badgeContacts.textContent = allContacts.length;
    setContactsStatus(`${allContacts.length} kayıt`, false);
    renderContacts(allContacts);
  } catch (err) {
    if (err.message !== "401") setContactsStatus(err.message || "Hata", true);
  } finally {
    contactsRefresh.disabled = false;
  }
}

contactsRefresh.addEventListener("click", loadContacts);

contactSearch.addEventListener("input", () => {
  const q = contactSearch.value.toLowerCase();
  renderContacts(q ? allContacts.filter((c) =>
    [c.name, c.email, c.subject, c.message, c.phone].some((v) => v && String(v).toLowerCase().includes(q))
  ) : allContacts, q ? true : false);
});

function renderContacts(list, isFiltered) {
  contactsList.textContent = "";
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "admin-empty";
    p.textContent = isFiltered ? "Arama sonucu bulunamadı." : "Henüz form gönderimi yok.";
    contactsList.appendChild(p);
    return;
  }

  for (const c of list) {
    const card = document.createElement("article");
    card.className = "admin-card";

    const meta = document.createElement("div");
    meta.className = "admin-card-meta";
    meta.textContent = c.created_at ? new Date(c.created_at).toLocaleString("tr-TR") : "";
    card.appendChild(meta);

    const dl = document.createElement("dl");
    function row(label, val) {
      if (!val) return;
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = String(val);
      dl.appendChild(dt); dl.appendChild(dd);
    }
    row("Ad", c.name); row("E-posta", c.email);
    row("Telefon", c.phone); row("Konu", c.subject);
    card.appendChild(dl);

    if (c.message) {
      const pre = document.createElement("pre");
      pre.textContent = c.message;
      card.appendChild(pre);
    }

    if (c.chat_transcript) {
      const det = document.createElement("details");
      const sum = document.createElement("summary"); sum.textContent = "AI sohbet özeti";
      const pre = document.createElement("pre");     pre.textContent = c.chat_transcript;
      det.appendChild(sum); det.appendChild(pre);
      card.appendChild(det);
    }

    contactsList.appendChild(card);
  }
}

// ════════════════════════════════════════════════
//  CHATS
// ════════════════════════════════════════════════
let allSessions = [];

function setChatsStatus(msg, isErr) {
  chatsStatus.textContent = msg || "";
  chatsStatus.className = "admin-status" + (isErr ? " admin-status--err" : "");
}

async function loadChats() {
  setChatsStatus("Yükleniyor…", false);
  chatsRefresh.disabled = true;
  try {
    const data  = await apiFetch("/api/admin/chats");
    allSessions = Array.isArray(data.sessions) ? data.sessions : [];
    badgeChats.textContent = allSessions.length;
    setChatsStatus(`${allSessions.length} sohbet`, false);
    renderSessions(allSessions);
  } catch (err) {
    if (err.message !== "401") setChatsStatus(err.message || "Hata", true);
  } finally {
    chatsRefresh.disabled = false;
  }
}

chatsRefresh.addEventListener("click", loadChats);

chatSearch.addEventListener("input", () => {
  const q = chatSearch.value.toLowerCase();
  renderSessions(q ? allSessions.filter((s) =>
    s.first_message && String(s.first_message).toLowerCase().includes(q)
  ) : allSessions);
});

function renderSessions(list) {
  chatsList.textContent = "";
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "admin-empty";
    p.textContent = "Henüz AI sohbeti kaydedilmedi.";
    chatsList.appendChild(p);
    return;
  }

  for (const s of list) {
    const card = document.createElement("article");
    card.className = "admin-card admin-chat-card";

    const header = document.createElement("div");
    header.className = "admin-card-meta";
    const started  = s.created_at ? new Date(s.created_at).toLocaleString("tr-TR") : "";
    const updated  = s.updated_at ? new Date(s.updated_at).toLocaleString("tr-TR") : "";
    header.textContent = `${started}${updated !== started ? " · son: " + updated : ""} · ${s.message_count ?? "?"} mesaj`;
    card.appendChild(header);

    if (s.first_message) {
      const preview = document.createElement("p");
      preview.className = "admin-chat-preview";
      preview.textContent = String(s.first_message).slice(0, 180);
      card.appendChild(preview);
    }

    const det = document.createElement("details");
    det.className = "admin-chat-details";
    const sum = document.createElement("summary");
    sum.textContent = "Sohbeti göster";
    const body = document.createElement("div");
    body.className = "admin-chat-body";

    let loaded = false;
    det.addEventListener("toggle", async () => {
      if (!det.open || loaded) return;
      loaded = true;
      body.textContent = "Yükleniyor…";
      try {
        const data = await apiFetch(`/api/admin/chats/${s.id}`);
        const messages = Array.isArray(data.session?.messages) ? data.session.messages : [];
        body.textContent = "";
        for (const m of messages) {
          const row = document.createElement("div");
          row.className = `admin-chat-msg admin-chat-msg--${m.role}`;
          const who = document.createElement("span");
          who.className = "admin-chat-who";
          who.textContent = m.role === "user" ? "Kullanıcı" : "Asistan";
          const txt = document.createElement("p");
          txt.textContent = m.content;
          row.appendChild(who);
          row.appendChild(txt);
          body.appendChild(row);
        }
        if (!messages.length) body.textContent = "Mesaj bulunamadı.";
      } catch (err) {
        body.textContent = err.message || "Yüklenemedi.";
      }
    });

    det.appendChild(sum);
    det.appendChild(body);
    card.appendChild(det);
    chatsList.appendChild(card);
  }
}

// ── Boot ──────────────────────────────────────
(function init() {
  const token = loadToken();
  if (token && !tokenExpired(token)) {
    showInbox(token);
    loadContacts();
  } else {
    clearToken();
    showLogin();
  }
})();
