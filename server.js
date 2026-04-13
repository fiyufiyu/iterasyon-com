import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const port = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Sen iterasyon hukuk'un yapay zeka asistanısın. Türkiye'deki bireylere Türk hukuku konusunda genel bilgi ve rehberlik sağlarsın.

Kurallar:
- Her zaman Türkçe yanıt ver.
- Sade, anlaşılır bir dil kullan; gereksiz jargondan kaçın.
- Somut ve pratik bilgi ver; kısa ve öz cevapları tercih et.
- Yanıtın sonuna konunun hassasiyetine göre kısa bir hukuki uyarı ekle: "⚠ Bu bilgi hukuki tavsiye değildir; önemli kararlar için bir avukata danışın."
- Şu alanlarda uzmansın: iş hukuku, kira ve taşınmaz hukuku, tüketici hakları, sözleşme hukuku, aile hukuku, idare hukuku ve genel hukuki prosedürler.
- İlgili kanun maddelerini isimlendirmen (örn. "İş Kanunu Madde 17") kullanıcıya çok yardımcı olur.
- Emin olmadığın konularda bunu açıkça belirt.`;

// ── Middleware ────────────────────────────────
app.use(express.json({ limit: "50kb" }));
app.use(express.static(__dirname));

// ── Chat API — streaming SSE ──────────────────
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type":      "text/event-stream",
    "Cache-Control":     "no-cache, no-transform",
    "Connection":        "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (payload) =>
    res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const stream = anthropic.messages.stream({
      model:      process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system:     SYSTEM_PROMPT,
      messages:   messages.slice(-30), // cap history to last 30 turns
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        send({ text: event.delta.text });
      }
    }

    send({ done: true });
  } catch (err) {
    console.error("[/api/chat]", err.message);
    send({ error: err.message ?? "Bilinmeyen hata" });
  }

  res.end();
});

// ── SPA fallback — serve index.html for unknown routes ──
app.use((req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.listen(port, () => {
  console.log(`iterasyon ▸ http://localhost:${port}`);
});
