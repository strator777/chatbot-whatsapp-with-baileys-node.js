import { startSession, getSession } from "./wa-manager.js"
import db from "./db.js";

const MAX_RETRY = 3;
const BATCH_LIMIT = 10;
const INTERVAL = 30000; // 30 detik

export function startMessageWorker() {
  console.log("📨 Message Worker Started");

  setInterval(async () => {
    try {

      // Ambil pesan pending / retry
      const rows = await db.all(`
        SELECT * FROM wa_log 
        WHERE status IN ('pending','retry') 
        AND retry_count < ?
        ORDER BY id ASC
        LIMIT ?
      `, [MAX_RETRY, BATCH_LIMIT]);

      if (!rows.length) return;

      console.log(`🔁 Processing ${rows.length} messages`);

      for (const row of rows) {

        try {

          // Ubah jadi processing dulu
          await db.run(
            "UPDATE wa_log SET status='processing' WHERE id=?",
            [row.id]
          );

          const sock = getSession(row.session_id);

          // Cek session
          if (!sock || !sock.user) {
            throw new Error("Session not connected");
          }

          // Format nomor
          let destination;
          if (row.phone.includes("@g.us")) {
            destination = row.phone;
          } else {
            destination =
              row.phone.replace(/\D/g, "") + "@s.whatsapp.net";
          }

          // Kirim pesan
          await sock.sendMessage(destination, { text: row.message });

          // Update sukses
          await db.run(
            `UPDATE wa_log 
             SET status='sent', 
                 sent_at=datetime('now') 
             WHERE id=?`,
            [row.id]
          );

          console.log("✅ Sent:", row.id);

        } catch (err) {

          console.log("❌ Failed:", row.id, err.message);

          await db.run(
            `UPDATE wa_log 
             SET status='retry',
                 retry_count = retry_count + 1,
                 error_message = ?
             WHERE id=?`,
            [err.message, row.id]
          );

          // Jika retry melebihi batas → permanent fail
          const updated = await db.get(
            "SELECT retry_count FROM wa_log WHERE id=?",
            [row.id]
          );

          if (updated.retry_count >= MAX_RETRY) {
            await db.run(
              "UPDATE wa_log SET status='failed' WHERE id=?",
              [row.id]
            );

            console.log("💀 Permanent Failed:", row.id);
          }

        }

      }

    } catch (err) {
      console.error("Worker Error:", err);
    }

  }, INTERVAL);
}
