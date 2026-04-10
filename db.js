import sqlite3 from "sqlite3"
import { open } from "sqlite"
import path from "path"
import { fileURLToPath } from "url"
import crypto from "crypto"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const db = await open({
  filename: path.join(__dirname, "database", "wa.db"),
  driver: sqlite3.Database
});

// create table if not exists
await db.exec(`
  CREATE TABLE IF NOT EXISTS wa_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE,
    -- legacy session_id kept for compatibility
    session_name TEXT UNIQUE,
    uid TEXT UNIQUE,
    phone TEXT,
    status TEXT,
    qr TEXT,
    last_seen DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)
await db.exec(`
  CREATE TABLE IF NOT EXISTS wa_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    phone TEXT,
    message TEXT,
    status TEXT,
    sent_at TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`)
await db.exec(`
  CREATE TABLE IF NOT EXISTS session_chatbot_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    trigger_word TEXT,
    response TEXT,
    action_type TEXT DEFAULT 'reply',
    action_param TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES wa_sessions(uid)
  );
`)

// Ensure new columns exist (for older DBs that may lack them)
const cols = await db.all("PRAGMA table_info('wa_sessions')")
const colNames = cols.map(c => c.name)
if (!colNames.includes('session_name')) {
  await db.exec("ALTER TABLE wa_sessions ADD COLUMN session_name TEXT")
}
if (!colNames.includes('uid')) {
  await db.exec("ALTER TABLE wa_sessions ADD COLUMN uid TEXT UNIQUE")
}
if (!colNames.includes('enable_auto_reply')) {
  await db.exec("ALTER TABLE wa_sessions ADD COLUMN enable_auto_reply INTEGER DEFAULT 0")
}

// Migrate session_chatbot_rules table if it exists
const rulesTableCols = await db.all("PRAGMA table_info('session_chatbot_rules')")
const rulesColNames = rulesTableCols.map(c => c.name)
if (rulesTableCols.length > 0) {
  if (!rulesColNames.includes('action_type')) {
    await db.exec("ALTER TABLE session_chatbot_rules ADD COLUMN action_type TEXT DEFAULT 'reply'")
  }
  if (!rulesColNames.includes('action_param')) {
    await db.exec("ALTER TABLE session_chatbot_rules ADD COLUMN action_param TEXT")
  }
}

// Migrate existing rows: set session_name from session_id if empty, and generate uid if missing
const rowsToMigrate = await db.all("SELECT rowid, session_id, session_name, uid FROM wa_sessions")
for (const r of rowsToMigrate) {
  const updates = []
  const params = []
  if ((!r.session_name || r.session_name === '') && r.session_id) {
    updates.push('session_name = ?')
    params.push(r.session_id)
  }
  if ((!r.uid || r.uid === '')) {
    // generate short unique hash
    const uid = crypto.randomBytes(8).toString('hex')
    updates.push('uid = ?')
    params.push(uid)
  }
  if (updates.length) {
    params.push(r.session_id)
    await db.run(`UPDATE wa_sessions SET ${updates.join(', ')} WHERE session_id=?`, params)
  }
}

// Create business logic tables
await db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT UNIQUE,
    name TEXT,
    session_id TEXT,
    registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES wa_sessions(uid)
  );
`)

await db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    phone_number TEXT,
    session_id TEXT,
    total_price REAL,
    status TEXT DEFAULT 'pending',
    cancellation_reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (session_id) REFERENCES wa_sessions(uid)
  );
`)

await db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id TEXT,
    quantity INTEGER,
    price REAL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
`)

await db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    amount REAL,
    payment_method TEXT,
    change_amount REAL,
    status TEXT DEFAULT 'pending',
    session_id TEXT,
    paid_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (session_id) REFERENCES wa_sessions(uid)
  );
`)

export default db
