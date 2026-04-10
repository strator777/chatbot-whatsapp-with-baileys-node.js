import db from './db.js';

/**
 * Process auto-reply chatbot logic
 * Checks if auto-reply is enabled and matches incoming message against rules
 * @param {string} sessionUid - Session UID
 * @param {string} sender - Sender phone number
 * @param {string} text - Incoming message text
 * @returns {Promise<string>} - Response text or empty string
 */

let sessionEnable = {};
export async function chatbot(sock, sender, text, sessionUid) {
  // Cek apakah auto reply diaktifkan untuk session ini
  if (sessionEnable[sessionUid] === undefined) {
    const row = await db.get(
        "SELECT enable_auto_reply FROM wa_sessions WHERE uid=? OR session_id=?",
        [sessionUid, sessionUid]
    );
    sessionEnable[sessionUid] = row?.enable_auto_reply === 1;
  }
  
  if (!sessionEnable[sessionUid]) {
    return '';
  }
  // Load rules dari session_chatbot_rules
  const rules = await db.all(
    "SELECT id, trigger_word, response, action_type, action_param FROM session_chatbot_rules WHERE session_id=?",
    [sessionUid]
  );


  // Cek apakah pesan cocok dengan aturan (case insensitive)
  const lowerText = text.toLowerCase();
  for (const rule of rules) {
    if (lowerText.includes(rule.trigger_word.toLowerCase())) {
      
        try { // Execute action
            switch (rule.action_type) {
            case 'reply':
                const text = rule.response.replace(/\\n/g, "\n");
                await sock.sendMessage(sender, {
                    text: text
                });
                break;

            case 'fungsi':
                // action_param is expected to be a URL
                console.log(`[ACTION] Calling function: ${rule.action_param}`); 
                functionMap[rule.action_param]?.(sock, sender, sessionUid); // Call the function if it exists
                break;

            case 'webhook':
                // action_param is expected to be a URL
                console.log(`[ACTION] Calling webhook: ${rule.action_param}`);  
                break;

            default:
                console.warn(`[ACTION] Unknown action type: ${rule.action_type}`);
            }
        } catch (err) {
            console.error(`[ACTION ERROR] ${rule.action_type}:`, err.message);
        }
      return;
    }
  }

  return '';
}

const functionMap = {
  daftar: async (sock, sender, sessionUid) => {
    console.log("Hello executed");
    await sock.sendMessage(sender, {
      text: "Halo! Terima kasih telah menghubungi kami. Untuk informasi lebih lanjut, silakan kunjungi website kami di https://example.com atau balas dengan kata 'INFO' untuk mendapatkan detail lebih lanjut."
    });
  },

  resetUser: async (sock, sender, sessionUid) => {
    console.log("Reset user executed");
  }
};