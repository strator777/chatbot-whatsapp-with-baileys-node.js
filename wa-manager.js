import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";
import Pino from "pino";
import db from "./db.js";
import qrcode from "qrcode-terminal";
import { fileURLToPath } from "url";
import path from "path";
import fs from 'fs';
import { setQR, clearQR } from './qr-store.js';
import { chatbot } from './chatbot.js';
const userCooldown = new Map();
const lastMessage = new Map();
const COOLDOWN_MS = 2000;

const sessions = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Start / get WhatsApp session
 */
export async function startSession(sessionUid, io) {
  console.log("[startSession] Requested:", sessionUid);

  // 🔒 Guard: jangan buat ulang session
  if (sessions[sessionUid]) {
    console.log("[startSession] Session already active:", sessionUid);
    return sessions[sessionUid];
  }

  // Ambil metadata session
  const row = await db.get(
    "SELECT session_name, session_id FROM wa_sessions WHERE uid=? OR session_id=?",
    [sessionUid, sessionUid]
  );

  const sessionName = row?.session_name || row?.session_id || sessionUid;
  console.log("[startSession] Session name:", sessionName);

  // Load auth state
  const sessionPath = path.join(__dirname, "sessions", sessionUid);
  if (fs.existsSync(sessionPath)) {
    const files = fs.readdirSync(sessionPath);
    if (files.length === 0) {
      console.log("Empty session folder detected → removing");
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
  }
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  // Buat socket Baileys
  console.log("[startSession] Membuat Socket:", sessionUid);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    browser: ["Chrome", "Windows", "10"], // 🔑 penting
    logger: Pino({ level: "silent" }),
    version: version
  });

  sessions[sessionUid] = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;
    // Debug: log full update so we can see why it disconnects after scan
    try {
      console.log("[connection.update] update:", JSON.stringify(update, null, 2));
    } catch (e) {
      console.log("[connection.update] (non-serializable)", update);
    }

    /* ===================== QR ===================== */
    if (qr) {
      console.log("[QR] Generated for:", sessionUid);
      setQR(sessionUid, qr); // 🔥 SIMPAN QR
      io.to(sessionUid).emit("qr", { qr, uid: sessionUid, status: "QR Generated" });
      qrcode.generate(qr, { small: true });
      console.log("[QR] Emitted via socket.io for:", sessionUid);
    }

    /* ===================== CONNECTED ===================== */
    if (connection === "open") {
      console.log("[CONNECTED]:", sessionUid);
      clearQR(sessionUid);

      const phone = sock.user?.id?.split(":")[0] || null;

      await db.run(
        "UPDATE wa_sessions SET status='CONNECTED', phone=? WHERE uid=? OR session_id=?",
        [phone, sessionUid, sessionUid]
      );

      io.to(sessionUid).emit("ready", {
        uid: sessionUid,
        sessionName,
        phone
      });
    }

    /* ===================== DISCONNECTED ===================== */
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;

      console.log("[DISCONNECTED]:", sessionUid, code);

      const isLoggedOut = code === DisconnectReason.loggedOut;
      const isFatalError = code === 405;

      if (isLoggedOut || isFatalError) {
        console.log("Logged out.");
        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          console.log("Auth folder deleted:", sessionUid);
        }
        await db.run(
          "UPDATE wa_sessions SET status=? WHERE uid=? OR session_id=?",
          [
            isLoggedOut || isFatalError
              ? "LOGGED_OUT"
              : "DISCONNECTED",
            sessionUid,
            sessionUid
          ]
        );
        delete sessions[sessionUid];
        console.log("[startSession] Session removed from memory:", sessionUid);
        return;
      }
          // 🟢 Semua selain logout → RESTART
      console.log("Restarting session...");
      delete sessions[sessionUid];

      setTimeout(() => {
        startSession(sessionUid, io);
      }, 2000);
    }

  });
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      if (!m.messages?.length) return;

      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const sender = msg.key.remoteJid;
      const messageType = Object.keys(msg.message)[0];

      if (
        messageType !== 'conversation' &&
        messageType !== 'extendedTextMessage'
      ) return;

      try {
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (!text) return;

        const now = Date.now();

        if (userCooldown.has(sender)) {
          if (now - userCooldown.get(sender) < COOLDOWN_MS) return;
        }
        userCooldown.set(sender, now);

        if (text.length > 500) {
          await sock.sendMessage(sender, {
            text: "❌ Pesan terlalu panjang (maks 500 karakter)"
          });
          return;
        }

        // =========================
        // 🔒 SANITASI
        // =========================
        const cleanText = text.trim().replace(/\s+/g, ' ');
        const lowerText = cleanText.toLowerCase();

        // =========================
        // 🔒 ANTI DUPLIKAT
        // =========================
        if (lastMessage.get(sender) === cleanText) return;
        lastMessage.set(sender, cleanText);

        await chatbot(sock, sender, cleanText, sessionUid);
        return;

      } catch (err) {
        console.error("Chatbot error:", err);

        await sock.sendMessage(sender, {
          text: "⚠️ Terjadi kesalahan, coba lagi nanti 🙏"
        });
      }
    });



  return sock;
}

/**
 * Get active session
 */
export function getSession(sessionUid) {
  return sessions[sessionUid] || null;
}

async function scanocr(msg, sender) {
  const stream = await downloadContentFromMessage(
    msg.message.imageMessage,
    'image'
  );

  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }

  const filename = `./ocr/${Date.now()}.jpg`;
  fs.writeFileSync(filename, buffer);

  //await sock.sendMessage(sender, {
  //  text: '📸 Gambar diterima, sedang diproses OCR...'
  //});

  // lanjutkan proses OCR di sini
}
