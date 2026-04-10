# WA Server

Server WhatsApp berbasis Node.js yang menyediakan:

- Manajemen multi-session WhatsApp
- Login QR dengan Baileys
- Dashboard web untuk monitoring session
- API kirim pesan WhatsApp
- Penyimpanan data dengan SQLite
- Auto-reply chatbot per session
- Business flow chatbot untuk pendaftaran, pesanan, pembayaran, dan profil pelanggan

## Teknologi

- Node.js
- Express
- Socket.IO
- SQLite
- Baileys

## Struktur Project

```text
.
|- database/         Database SQLite
|- logs/             File log runtime
|- public/           Dashboard web
|- routes/           Endpoint tambahan
|- sessions/         Kredensial auth WhatsApp per session
|- uploads/          File upload lokal
|- chatbot.js        Logic chatbot
|- db.js             Inisialisasi database dan migrasi sederhana
|- server.js         Entry point server HTTP + API + Socket.IO
|- wa-manager.js     Lifecycle session WhatsApp
|- wa-worker.js      Worker pengiriman pesan
```

## Fitur Utama

### 1. Session WhatsApp

- Membuat session baru
- Menampilkan QR untuk login
- Menyimpan status koneksi
- Auto-load session yang masih aktif saat server restart

### 2. API WhatsApp

- `POST /api/wa/create` membuat session baru
- `GET /api/wa/list` melihat daftar session
- `GET /api/wa/qr/:sessionId` mengambil QR dan status session
- `POST /api/wa/session` mengambil detail session
- `POST /api/wa/send` mengirim pesan WhatsApp

### 3. Chatbot

- Toggle chatbot per session
- Rule auto-reply per session
- Dukungan action chatbot berbasis business flow

### 4. Dashboard

- Halaman utama di `/`
- Halaman konfigurasi di `/config`

## Persiapan

Pastikan Node.js 18+ sudah terpasang.

```bash
npm install
```

## Menjalankan Project

```bash
node server.js
```

Server akan berjalan di:

```text
http://localhost:3030
```

## Penyimpanan Data Lokal

Project ini menyimpan data runtime di folder berikut:

- `database/wa.db`
- `sessions/`
- `logs/`
- `uploads/`

Folder-folder tersebut diabaikan oleh Git agar data lokal, session WhatsApp, dan file hasil runtime tidak ikut ter-upload.

## Catatan GitHub

Sebelum upload ke GitHub, pastikan yang ikut commit hanya source code dan dokumentasi. Jangan upload:

- `node_modules/`
- `sessions/`
- `database/*.db`
- `logs/`
- `uploads/`

## Upload ke GitHub

Jika repo GitHub sudah dibuat, jalankan:

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

Jika Git sudah terinisialisasi lokal, cukup tambahkan remote lalu push.

## Dokumen Tambahan

- `CHATBOT_SERVICES.md` berisi panduan integrasi business flow chatbot
