import express from "express"
import path from "path"
import { fileURLToPath } from "url"
import { createServer } from "http"
import { Server } from "socket.io"
import { getQR } from './qr-store.js';
import fs from "fs";

import db from "./db.js"
import { startSession, getSession } from "./wa-manager.js"
import { startMessageWorker } from "./wa-worker.js";
import { time } from "console"

// ==============================
// CONFIG
// ==============================
const app = express()
const PORT = 3030

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ==============================
// MIDDLEWARE
// ==============================
app.use(express.json({
  limit: "20mb"
}));

app.use(express.urlencoded({
  limit: "20mb",
  extended: true
}));


// static folder
app.use(express.static(path.join(__dirname, "public")))

// Content Security Policy (CSP) sementara, bisa diperketat nanti
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; script-src 'self' https://cdn.jsdelivr.net; connect-src * ws: wss:; style-src 'self' 'unsafe-inline'"
  )
  next()
})

// ==============================
// CREATE SERVER & SOCKET.IO
// ==============================
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: "*" } // izinkan semua origin sementara
})

// expose io ke wa-manager
app.set("io", io)

// ==============================
// SOCKET.IO EVENTS
// ==============================
io.on("connection", (socket) => {
  // console.log("[socket] connected:", socket.id)

  socket.on("join-session", async (sessionUid) => {
    console.log("[socket] join room:", sessionUid)
    socket.join(sessionUid)

    const qr = getQR(sessionUid);
    if (qr) {
      io.to(sessionUid).emit("qr", {
        uid: sessionUid,
        qr
      })
      console.log("[QR] Emitted to ROOM:", sessionUid)
    }
  })
  socket.on("config", async (sessionUid) => {
    const session = await db.get(
      "SELECT * FROM wa_sessions WHERE uid = ?",
      [sessionUid]
    )
    socket.emit("status", { session_name: session.session_name, status: session.status })
    if (session.status === "INIT" || session.status === "LOGGED_OUT") {
      await db.run(
        "UPDATE wa_sessions SET status = ? WHERE uid = ?",
        ["STARTING", sessionUid]
      )
        socket.emit("status", { session_name: session.session_name, status: "STARTING" })
      await startSession(sessionUid, io)
    }
  })

  socket.on("disconnect", () => {
    console.log("[socket] disconnected:", socket.id)
  })
})

// ==============================ba
// AUTO LOAD SESSIONS FROM DB
// ==============================
async function loadSessionsFromDB() {
  const sessions = await db.all(
    "SELECT uid FROM wa_sessions WHERE status != 'LOGGED_OUT'"
  )

  for (const s of sessions) {
    const idToStart = s.uid || s.session_id
    console.log("Auto loading session:", idToStart)
    startSession(idToStart, io)
  }
}

// ==============================
// ROUTES API
// ==============================

// create new WA session
app.post("/api/wa/create", async (req, res) => {
  const { sessionName } = req.body
  if (!sessionName) return res.status(400).json({ error: "sessionName required" })

  // generate UID random
  const crypto = await import("crypto")
  const uid = crypto.randomBytes(8).toString("hex")

  const exist = await db.get("SELECT * FROM wa_sessions WHERE session_name=?", [sessionName])
  if (exist) return res.status(400).json({ error: "Session already exists" })

  await db.run(
    "INSERT INTO wa_sessions (uid, session_name, status) VALUES (?, ?, ?)",
    [uid, sessionName, "INIT"]
  )

  res.json({ ok: true, uid, sessionName })
})

// list all sessions
app.get("/api/wa/list", async (req, res) => {
  const rows = await db.all(
    "SELECT uid, session_name, phone, status, last_seen FROM wa_sessions ORDER BY created_at DESC"
  )
  res.json(rows)
})

// get session status / QR
app.get("/api/wa/qr/:sessionId", async (req, res) => {
  const { sessionId } = req.params
  const row = await db.get(
    "SELECT qr, status, session_name, phone FROM wa_sessions WHERE uid=? OR session_id=?",
    [sessionId, sessionId]
  )

  if (!row) return res.status(404).json({ error: "Session not found" })
  res.json(row)
})

app.post("/api/wa/session", async (req, res) => {
  try {
    let { sessionId } = req.body;
    let row;
    if (!sessionId || sessionId === "default") {
      row = await db.get(
        "SELECT * FROM wa_sessions WHERE session_name=?",
        ["Default-Session"]
      );
    } else {
      row = await db.get(
        "SELECT * FROM wa_sessions WHERE uid=? OR session_id=?",
        [sessionId, sessionId]
      );
    }
    if (!row) {
      return res.status(404).json({ error: "Session not found" });
    }
    const isReady = row.status === "CONNECTED";
    res.json({
      success: true,
      session: row,
      ready: isReady
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});



// send message
// ==============================
// SEND MESSAGE VIA WHATSAPP
// ==============================
app.post("/api/wa/send", async (req, res) => {
  try {
    let { sessionId, to, message } = req.body; // ubah `number` menjadi `to`
    console.log(`[SEND] Request to send message via session ${sessionId} to ${to} and meessage: ${message}`);
    // ------------------- VALIDASI -------------------
    if ( !to || !message) {
      return res.status(400).json({ error: "sessionId, to, and message are required" });
    }
    if (!sessionId || sessionId === "default") {
      const sessionRow = await db.get(
        "SELECT uid FROM wa_sessions WHERE session_name='Default-Session'"
      );
      if (!sessionRow) {
        return res.status(400).json({ error: "Default session not found" });
      }
      sessionId = sessionRow.uid;
    }

    // ------------------- INSERT LOG (PENDING) -------------------
    const result = await db.run(
      "INSERT INTO wa_log (session_id, phone, message, status) VALUES (?, ?, ?, ?)",
      [sessionId, to, message, "pending"]
    );

    const logId = result.lastID; // 🔥 penting
    // ------------------- AMBIL SESSION -------------------
    const sock = getSession(sessionId);
    if (!sock) {
      await db.run(
        "UPDATE wa_log SET status=? WHERE id=?",
        ["failed", logId]
      );
      return res.status(404).json({ error: "Session not active or disconnected" });
    }

    let destination;

    // Cek apakah input group (mengandung @g.us) atau nomor biasa
    if (to.includes("@g.us")) {
      destination = to; // group ID sudah lengkap
    } else {
      // Nomor pribadi → pastikan format internasional tanpa "+"
      destination = to.replace(/\D/g, "") + "@s.whatsapp.net";
    }

    // ------------------- KIRIM PESAN -------------------
    await sock.sendMessage(destination, { text: message });

    await db.run(
      "UPDATE wa_log SET status=?, sent_at=datetime('now') WHERE id=?",
      ["sent", logId]
    );
    // ------------------- RESPONSE -------------------
    res.json({ ok: true, to: destination, sessionId, message });

  } catch (err) {
    console.error(`[ERROR] /api/wa/send`, err);
    if (typeof logId !== "undefined") {
      await db.run(
        "UPDATE wa_log SET status=?, error_message=? WHERE id=?",
        ["failed", err.message, logId]
      );
    }
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});


// ==============================
// SEND BULK SAFE (ANTI-BLOCK)
// ==============================
app.post("/api/wa/send-bulk-safe", async (req, res) => {
  const { sessionId, messages } = req.body;

  if (!sessionId || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "sessionId & messages array required" });
  }

  const sock = getSession(sessionId);
  if (!sock) {
    return res.status(404).json({ error: "Session not active" });
  }

  res.json({
    ok: true,
    message: "Bulk sending started safely",
    total: messages.length
  });

  // ⛔ kirim async (tidak blocking request)
  (async () => {
    let sentCount = 0;

    for (const item of messages) {
      const { number, message, name } = item;

      if (!number || !message) continue;

      // 🔒 limit aman
      if (sentCount >= 50) {
        console.log("⛔ Limit per batch reached, stopping");
        break;
      }

      const to = number.replace(/\D/g, "") + "@s.whatsapp.net";

      // 🧠 personalisasi pesan
      const finalMessage = message
        .replace("{name}", name || "Kak")
        .replace("{time}", new Date().toLocaleTimeString());

      try {
        await sock.sendMessage(to, { text: finalMessage });
        sentCount++;
        console.log(`✅ Sent to ${to}`);
      } catch (err) {
        console.error(`❌ Failed ${to}`, err.message);
      }

      // ⏳ delay random seperti manusia
      await sleep(randomDelay(5000, 15000));
    }

    console.log("📤 Bulk safe sending finished");
  })();
});
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = 5000, max = 15000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
app.post("/api/wa/send-image", async (req, res) => {
  const { filename, wa_wali, wa, sessionId, image } = req.body;
  try {
    const sock = getSession(sessionId);
    if (!sock) {
      return res.status(404).json({
        error: "Session WA tidak ditemukan"
      });
    }
    const base64Data = image.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const jid =
      wa_wali.replace(/\D/g, "") + "@s.whatsapp.net";
    // kirim ke WhatsApp (punya kamu)
    await sock.sendMessage(jid, { image: buffer, caption: "Bukti Pembayaran" });
  } catch (error) {
    console.error("Error sending image:", error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
})


// reconnect session manually
app.post("/api/wa/reconnect/:sessionId", async (req, res) => {
  const { sessionId } = req.params
  startSession(sessionId, io)
  res.json({ ok: true })
})

// delete session
app.delete("/api/wa/delete/:sessionId", async (req, res) => {
  const { sessionId } = req.params
  try {
    // hapus dari DB
    await db.run("DELETE FROM wa_sessions WHERE uid=? OR session_id=?", [sessionId, sessionId])

    // hapus folder session
    const fs = await import("fs/promises")
    const sessionPath = `./sessions/${sessionId}`
    try { await fs.rm(sessionPath, { recursive: true, force: true }) } 
    catch (err) { console.warn(`Could not delete session folder: ${err.message}`) }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ==============================
// DASHBOARD / CONFIG HTML
// ==============================
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")))
app.get("/config", (req, res) => res.sendFile(path.join(__dirname, "public", "config.html")))

// toggle chatbot for session
app.post("/api/wa/toggle-chatbot/:sessionId", async (req, res) => {
  const { sessionId } = req.params
  const { enable } = req.body // true or false

  try {
    await db.run(
      "UPDATE wa_sessions SET enable_auto_reply = ? WHERE uid=? OR session_id=?",
      [enable ? 1 : 0, sessionId, sessionId]
    )
    res.json({ ok: true, enable })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// set chatbot rules for session
app.post("/api/wa/set-chatbot-rules/:sessionId", async (req, res) => {
  const { sessionId } = req.params
  const { rules } = req.body // object like {"hallo": "hay", "ping": "pong"}

  try {
    await db.run(
      "UPDATE wa_sessions SET chatbot_rules = ? WHERE uid=? OR session_id=?",
      [JSON.stringify(rules), sessionId, sessionId]
    )
    res.json({ ok: true, rules })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ==============================
// CHATBOT RULES MANAGEMENT (per session)
// ==============================

// get chatbot rules for a session
app.get("/api/chatbot/rules/:sessionId", async (req, res) => {
  const { sessionId } = req.params

  try {
    const rows = await db.all(
      "SELECT id, session_id, trigger_word, response, action_type, action_param FROM session_chatbot_rules WHERE session_id=? ORDER BY created_at DESC",
      [sessionId]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// create chatbot rule
app.post("/api/chatbot/rules/:sessionId", async (req, res) => {
  const { sessionId } = req.params
  const { trigger_word, response, action_type = 'reply', action_param } = req.body

  if (!trigger_word || !response) {
    return res.status(400).json({ error: "trigger_word dan response diperlukan" })
  }

  try {
    const result = await db.run(
      "INSERT INTO session_chatbot_rules (session_id, trigger_word, response, action_type, action_param) VALUES (?, ?, ?, ?, ?)",
      [sessionId, trigger_word, response, action_type, action_param]
    )
    res.json({ ok: true, id: result.lastID, session_id: sessionId, trigger_word, response, action_type, action_param })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// update chatbot rule
app.put("/api/chatbot/rules/:ruleId", async (req, res) => {
  const { ruleId } = req.params
  const { trigger_word, response, action_type = 'reply', action_param } = req.body

  if (!trigger_word || !response) {
    return res.status(400).json({ error: "trigger_word dan response diperlukan" })
  }

  try {
    await db.run(
      "UPDATE session_chatbot_rules SET trigger_word = ?, response = ?, action_type = ?, action_param = ? WHERE id = ?",
      [trigger_word, response, action_type, action_param, ruleId]
    )
    res.json({ ok: true, id: ruleId, trigger_word, response, action_type, action_param })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// delete chatbot rule
app.delete("/api/chatbot/rules/:ruleId", async (req, res) => {
  const { ruleId } = req.params

  try {
    await db.run("DELETE FROM session_chatbot_rules WHERE id = ?", [ruleId])
    res.json({ ok: true, id: ruleId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ==============================
// START SERVER
// ==============================
httpServer.listen(PORT, async () => {
  console.log(`🚀 WA API running on http://localhost:${PORT}`)
    // Start WA sessions dulu

  await loadSessionsFromDB();  // ✅ di sini
  startMessageWorker();        // worker jalan setelah session ready
});