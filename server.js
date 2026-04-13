import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import jwt from "jsonwebtoken";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import crypto from "crypto";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const port = process.env.PORT || 3000;

// ── PostgreSQL ────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL &&
       !process.env.DATABASE_URL.includes("localhost") &&
       !process.env.DATABASE_URL.includes("127.0.0.1")
    ? { rejectUnauthorized: false }
    : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_submissions (
      id          SERIAL PRIMARY KEY,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      phone       TEXT,
      subject     TEXT,
      message     TEXT NOT NULL,
      chat_transcript TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id            TEXT PRIMARY KEY,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      messages      JSONB NOT NULL DEFAULT '[]',
      message_count INTEGER DEFAULT 0
    );
  `);
  console.log("[db] tablolar hazır");
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Middleware ────────────────────────────────
app.use(express.json({ limit: "512kb" }));

// ── Auth helpers ──────────────────────────────
function getEnv(key) {
  return String(process.env[key] ?? "").trim();
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (ba.length === 0 || bb.length === 0) return false;
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function signToken() {
  const secret = getEnv("JWT_SECRET");
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET eksik veya kısa (min 32 karakter).");
  return jwt.sign({ sub: "admin", iss: "iterasyon" }, secret, { expiresIn: "8h" });
}

function verifyToken(req) {
  const secret = getEnv("JWT_SECRET");
  if (!secret) return null;
  const header = req.get("Authorization") || "";
  const token  = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try { return jwt.verify(token, secret); } catch { return null; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ════════════════════════════════════════════════
//  API ROUTES
// ════════════════════════════════════════════════

// ── Chat (streaming SSE + session save) ───────
app.post("/api/chat", async (req, res) => {
  const { messages, sessionId } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }

  res.writeHead(200, {
    "Content-Type":      "text/event-stream",
    "Cache-Control":     "no-cache, no-transform",
    "Connection":        "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  let fullText = "";

  try {
    const stream = anthropic.messages.stream({
      model:      getEnv("CLAUDE_MODEL") || "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages:   messages.slice(-30),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        send({ text: event.delta.text });
      }
    }
    send({ done: true });

    // Save session to DB after stream completes
    if (sessionId && typeof sessionId === "string" && sessionId.length <= 128 && fullText) {
      const fullHistory = [...messages, { role: "assistant", content: fullText }];
      pool.query(
        `INSERT INTO chat_sessions (id, messages, message_count)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (id) DO UPDATE SET
           messages      = $2::jsonb,
           message_count = $3,
           updated_at    = NOW()`,
        [sessionId, JSON.stringify(fullHistory), fullHistory.length],
      ).catch((e) => console.error("[db/chat_sessions]", e.message));
    }
  } catch (err) {
    console.error("[/api/chat]", err.message);
    send({ error: err.message ?? "Bilinmeyen hata" });
  }

  res.end();
});

// ── Contact form submit ───────────────────────
app.post("/api/contact", async (req, res) => {
  const body            = req.body || {};
  const name            = String(body.name           || "").trim().slice(0, 200);
  const email           = String(body.email          || "").trim().slice(0, 320);
  const phone           = String(body.phone          || "").trim().slice(0, 40)  || null;
  const subject         = String(body.subject        || "").trim().slice(0, 300) || null;
  const message         = String(body.message        || "").trim().slice(0, 12000);
  const chatTranscript  = String(body.chatTranscript || "").trim().slice(0, 200000) || null;

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Ad, e-posta ve mesaj zorunludur." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Geçerli bir e-posta girin." });
  }

  try {
    await pool.query(
      `INSERT INTO contact_submissions (name, email, phone, subject, message, chat_transcript)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [name, email, phone, subject, message, chatTranscript],
    );
    console.log("[/api/contact] kaydedildi:", email, subject || "");
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/contact]", err.message);
    res.status(500).json({ error: "Kayıt alınamadı. Lütfen sonra tekrar deneyin." });
  }
});

// ── Admin: login ──────────────────────────────
app.post("/api/admin/login", (req, res) => {
  const expectedUser = getEnv("ADMIN_USER");
  const expectedPass = getEnv("ADMIN_PASS");

  if (!expectedUser || !expectedPass) {
    return res.status(503).json({ error: "ADMIN_USER / ADMIN_PASS .env'de tanımlı değil." });
  }

  try { getEnv("JWT_SECRET"); if (getEnv("JWT_SECRET").length < 32) throw new Error(); }
  catch { return res.status(503).json({ error: "JWT_SECRET eksik veya kısa." }); }

  const { username = "", password = "" } = req.body || {};

  if (!safeEqual(username, expectedUser) || !safeEqual(password, expectedPass)) {
    return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
  }

  const token = signToken();
  console.log("[/api/admin/login]", new Date().toISOString());
  res.json({ token, expiresIn: "8h" });
});

// ── Admin: contact submissions ─────────────────
app.get("/api/admin/contacts", async (req, res) => {
  if (!verifyToken(req)) {
    return res.status(401).json({ error: "Geçersiz veya süresi dolmuş oturum." });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM contact_submissions ORDER BY created_at DESC",
    );
    res.set("Cache-Control", "no-store");
    res.json({ contacts: rows });
  } catch (err) {
    console.error("[/api/admin/contacts]", err.message);
    res.status(500).json({ error: "Okunamadı." });
  }
});

// ── Admin: chat sessions list ──────────────────
app.get("/api/admin/chats", async (req, res) => {
  if (!verifyToken(req)) {
    return res.status(401).json({ error: "Geçersiz veya süresi dolmuş oturum." });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, updated_at, message_count,
              (messages->0->>'content') AS first_message
       FROM chat_sessions
       ORDER BY updated_at DESC
       LIMIT 200`,
    );
    res.set("Cache-Control", "no-store");
    res.json({ sessions: rows });
  } catch (err) {
    console.error("[/api/admin/chats]", err.message);
    res.status(500).json({ error: "Okunamadı." });
  }
});

// ── Admin: single chat session ─────────────────
app.get("/api/admin/chats/:id", async (req, res) => {
  if (!verifyToken(req)) {
    return res.status(401).json({ error: "Geçersiz veya süresi dolmuş oturum." });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM chat_sessions WHERE id = $1",
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Bulunamadı." });
    res.set("Cache-Control", "no-store");
    res.json({ session: rows[0] });
  } catch (err) {
    console.error("[/api/admin/chats/:id]", err.message);
    res.status(500).json({ error: "Okunamadı." });
  }
});

// ════════════════════════════════════════════════
//  Static + SPA fallback
// ════════════════════════════════════════════════
app.use(express.static(__dirname));

app.use((req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

// ── Boot ──────────────────────────────────────
initDB()
  .then(() => {
    app.listen(port, () => console.log(`iterasyon ▸ http://localhost:${port}`));
  })
  .catch((err) => {
    console.error("[db] bağlantı hatası:", err.message);
    console.error("DATABASE_URL .env veya Railway değişkenlerinde tanımlı olmalı.");
    process.exit(1);
  });
