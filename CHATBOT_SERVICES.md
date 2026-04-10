# Chatbot Services Integration Guide

## Overview
Sistem chatbot terintegrasi dengan business logic functions untuk automation pendaftaran, pemesanan, pembayaran, dll melalui WhatsApp.

## File Structure
```
wa-server/
├── chatbot.js           ← Auto-reply message processing
├── action-handlers.js   ← Conversational flow handlers
├── services.js          ← Business logic functions
├── webhook.js           ← Removed (integrated into action-handlers)
└── db.js               ← Database schemas (updated)
```

## Setup Chatbot Rules

Untuk menggunakan service actions, setup rule dengan action_type='webhook' dan action_param='nama_action'.

### 1. Pendaftaran (Registration)

**Setup Rule:**
- Trigger Word: `daftar` atau `saya ingin daftar`
- Response: `Baik, silakan isi data diri Anda`
- Action Type: `webhook`
- Action Param: `pendaftaran`

**User Flow:**
```
User: saya ingin daftar
Bot:  📝 Selamat datang! Untuk mendaftar, silakan kirim nama Anda.
      Format: nama: [nama anda]

User: nama: John Doe
Bot:  ✅ Selamat datang John Doe! Akun Anda berhasil dibuat.
      ID Pelanggan: 1
      Nomor: 62812xxxx
      Nama: John Doe
```

---

### 2. Pemesanan (Ordering)

**Setup Rule:**
- Trigger Word: `pesan` atau `order`
- Response: `Baik, saya siap membantu menerima pesanan Anda`
- Action Type: `webhook`
- Action Param: `pemesanan`

**User Flow:**
```
User: saya ingin pesan
Bot:  📦 Baik, silakan masukkan item yang ingin dipesan.
      Format: item: [nama], qty: [jumlah], harga: [harga]
      Contoh: item: Nasi Goreng, qty: 2, harga: 25000

User: item: Nasi Goreng, qty: 2, harga: 25000
Bot:  ✅ Pesanan #123 berhasil dibuat. Total: Rp50.000
      Silakan lanjut pembayaran dengan mengirim: "saya ingin bayar #123"
```

---

### 3. Pembayaran (Payment)

**Setup Rule:**
- Trigger Word: `bayar` atau `saya ingin bayar`
- Response: `Baik, berapa yang ingin dibayar?`
- Action Type: `webhook`
- Action Param: `pembayaran`

**User Flow:**
```
User: saya ingin bayar #123
Bot:  💰 Total yang harus dibayar: Rp50.000
      Silakan kirim jumlah pembayaran.
      Format: jumlah: [jumlah]

User: jumlah: 50000
Bot:  ✅ Pembayaran untuk pesanan #123 berhasil.
      Kembalian: Rp0
```

---

### 4. Cek Status Pesanan

**Setup Rule:**
- Trigger Word: `status` atau `cek pesanan`
- Response: `Berapa nomor pesanannya?`
- Action Type: `webhook`
- Action Param: `cekStatus`

**User Flow:**
```
User: cek status #123
Bot:  📊 Status Pesanan #123
      Nama: John Doe
      Status: Sudah Dibayar
      Total: Rp50.000
      Items: 1
```

---

### 5. Batal Pesanan

**Setup Rule:**
- Trigger Word: `batal` atau `cancel`
- Response: `Baik, pembatalan diproses`
- Action Type: `webhook`
- Action Param: `batalPesanan`

**User Flow:**
```
User: batal pesanan #123
Bot:  ✅ Pesanan #123 berhasil dibatalkan
```

---

### 6. Profil Pelanggan

**Setup Rule:**
- Trigger Word: `profil` atau `info`
- Response: `Mengambil data profil Anda...`
- Action Type: `webhook`
- Action Param: `profil`

**User Flow:**
```
User: profil
Bot:  👤 Profil Anda
      Nama: John Doe
      Nomor: 628123xxxx
      Terdaftar: 2026-04-05
      Total Pesanan: 5
      Total Belanja: Rp250.000
```

---

## Available Services

### pendaftaran(phoneNumber, customerName, sessionId)
Mendaftarkan pelanggan baru.

**Returns:**
```javascript
{
  success: boolean,
  customerId: number,
  message: string
}
```

---

### pemesanan(customerId, phoneNumber, items, sessionId)
Membuat pesanan baru.

**Items Format:**
```javascript
[
  {
    productId: "ID_PRODUK",
    quantity: 2,
    price: 25000
  }
]
```

**Returns:**
```javascript
{
  success: boolean,
  orderId: number,
  totalPrice: number,
  itemCount: number,
  message: string
}
```

---

### pembayaran(orderId, amount, paymentMethod, sessionId)
Memproses pembayaran pesanan.

**paymentMethod options:** `bank_transfer`, `e_wallet`, `cash`

**Returns:**
```javascript
{
  success: boolean,
  paymentId: number,
  orderId: number,
  amountPaid: number,
  changeAmount: number,
  status: "paid",
  message: string
}
```

---

### cekStatusPesanan(orderId)
Mengambil status dan detail pesanan.

**Returns:**
```javascript
{
  success: boolean,
  orderId: number,
  customerName: string,
  customerPhone: string,
  totalPrice: number,
  status: string,
  itemCount: number,
  items: Array,
  statusText: string
}
```

---

### batalPesanan(orderId, reason)
Membatalkan pesanan.

**Returns:**
```javascript
{
  success: boolean,
  orderId: number,
  status: "cancelled",
  message: string
}
```

---

### profilPelanggan(phoneNumber)
Mengambil profil lengkap pelanggan.

**Returns:**
```javascript
{
  success: boolean,
  customerId: number,
  name: string,
  phoneNumber: string,
  registeredAt: string,
  totalOrders: number,
  totalSpending: number,
  recentOrders: Array
}
```

---

## Conversation State Management

Untuk multi-step conversational flow (seperti pendaftaran), sistem menggunakan in-memory state store:

```javascript
conversationState = {
  "sessionUid_phoneNumber": {
    step: "awaiting_name",
    action: "pendaftaran"
  }
}
```

**Untuk clear state (opsional):**
```javascript
import { clearConversationState } from './action-handlers.js'
clearConversationState(sessionUid, phoneNumber)
```

---

## Adding New Service Actions

1. **Buat fungsi di services.js:**
```javascript
export async function namaAction(params) {
  // logic
  return { success: true, message: "..." }
}
```

2. **Tambah handler di action-handlers.js:**
```javascript
case 'namaAction':
  return await handleNamaAction(sessionUid, sender, userMessage);

async function handleNamaAction(...) {
  // flow logic
}
```

3. **Setup rule di chatbot dengan:**
- Action Type: `webhook`
- Action Param: `namaAction`

---

## Database Schema

### customers
```sql
id, phone_number, name, session_id, registered_at
```

### orders
```sql
id, customer_id, phone_number, session_id, total_price, status, created_at
```

### order_items
```sql
id, order_id, product_id, quantity, price
```

### payments
```sql
id, order_id, amount, payment_method, change_amount, status, session_id, paid_at
```

---

## Tips & Best Practices

1. **Setup order flow correctly:**
   - Daftar → Pesan → Bayar → Selesai

2. **Validasi input di client:**
   - Format pesan harus sesuai contoh
   - Bot akan meminta ulang jika format salah

3. **Track conversation state:**
   - Setiap user memiliki state tersendiri
   - State otomatis dihapus setelah transaksi selesai

4. **Extend dengan webhook eksternal:**
   - Integrasi dengan sistem billing eksternal
   - Kirim notifikasi ke admin

---

## Common Issues & Troubleshooting

**Q: User tidak bisa mendaftar karena nomor sudah terdaftar?**
A: Sistem akan menolak dengan pesan "Nomor XXX sudah terdaftar". User harus gunakan nomor lain atau hubungi admin.

**Q: Pembayaran gagal jka jumlah kurang?**
A: System akan menolak dan menampilkan jumlah yang dibutuhkan. User harus kirim ulang dengan jumlah yang tepat.

**Q: Bagaimana reset conversation state?**
A: Gunakan `clearConversationState(sessionUid, phoneNumber)` dari action-handlers.js

