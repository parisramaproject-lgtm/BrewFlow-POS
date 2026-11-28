# Laporan Audit Teknis & Rekomendasi Perbaikan: BrewFlow-POS

---

## 5. Temuan Kritis (P0) — Wajib Diperbaiki Sebelum Produksi

### P0-1. Transaksi bisa hilang, tetapi kasir melihat “Tersimpan”
* **`POSPage.tsx:368-392`** selalu menjalankan `resetCart()` dan menampilkan status sukses tanpa mengecek `result.syncStatus.synced`.
* **`PaymentModal.tsx:178`** menampilkan `"Tersimpan (Supabase)"` hanya berdasarkan kondisi `mode === 'supabase'`, bukan `synced === true`.
* Jika proses *insert* gagal (karena *offline*, RLS, atau *duplicate order number*), kasir tetap melihat pesan sukses. Setelah halaman di-*reload*, transaksi hilang dan stok kembali seperti semula.

> **Dampak:** Kehilangan data penjualan serta selisih kas dan inventori tanpa terdeteksi.

---

### P0-2. Nomor order hampir pasti bentrok
* **`StoreContext.tsx:1009-1018`** dan **`POSPage.tsx:166-169`** menghasilkan nomor order dengan format berikut:
  ```typescript
  `BF-261125-${String(orders.length + 2).padStart(3, '0')}`
  ```
* Tanggal di-*hardcode* (`261125`), dan *sequence* dihitung berdasarkan panjang array lokal (`orders.length`).
* **Simulasi Kasus:** Setelah 10 transaksi (`005`–`014`), halaman di-*reload* $\rightarrow$ `orders.length` terbaca `10` $\rightarrow$ transaksi berikutnya menjadi `012` $\rightarrow$ terjadi *duplicate key* $\rightarrow$ *insert* gagal $\rightarrow$ digabung dengan masalah **P0-1**, transaksi pun hilang.

> **Dampak:** Transaksi gagal secara berkala, terutama setelah aplikasi di-*reload*.

---

### P0-3. RLS tidak membedakan role — kasir bisa baca HPP dan ubah data master
* **`schema_full_brewflow.sql:607-639`** memberikan *policy* yang sama untuk semua tabel operasional:
  ```sql
  FOR ALL TO anon, authenticated
  USING (public.is_active_employee())
  ```
* Artinya, kasir dapat mengakses langsung melalui REST API Supabase untuk:
  * Membaca `inventory_items.last_purchase_price` dan `menu_recipes` $\rightarrow$ HPP dapat dihitung.
  * Membaca `purchases`, `store_settings`, dan `membership_program_settings`.
  * Mengubah harga menu, stok, pesanan, pajak, nomor WA owner, bahkan menghapus data.
* Hal ini bertentangan dengan PRD yang menjanjikan proteksi HPP pada level RLS.
* Tabel `employees` juga diberikan `GRANT SELECT` ke `anon` (`schema_full:230`), dan *policy* mengizinkan karyawan membaca barisnya sendiri — termasuk kolom `password_hash` jika di-*query* secara langsung.

> **Dampak:** RBAC hanya bersifat kosmetik di UI; siapa pun dengan sesi kasir dapat melakukan aksi setingkat *owner* melalui API.

---

### P0-4. Checkout tidak atomik
* **`posService.ts:107-257`** melakukan operasi *insert/update* secara terpisah:
  1. `orders`
  2. `order_items`
  3. Update `customers` (poin)
  4. Update `inventory_items` (stok, nilai absolut)
  5. Increment `voucher`
* Tidak menggunakan transaksi database atau RPC. Jika langkah 3–5 gagal, data *order* tetap tercatat tetapi stok atau poin menjadi tidak konsisten. Karena stok ditulis sebagai nilai absolut (`remainingStock`), dua kasir yang bertransaksi bersamaan berisiko saling menimpa data (*lost update*).

---

### P0-5. Pembatalan tidak mengembalikan stok, poin, atau voucher
* **`StoreContext.tsx:1226-1269`** hanya mengubah `status = 'cancelled'` dan menambahkan catatan.
* Stok yang sudah terpotong tidak dikembalikan, poin member tidak dikurangi, dan kuota voucher tidak dipulihkan. Selain itu, belum tersedia fitur *refund* atau *void*.

---

### P0-6. Mode offline tidak benar-benar menyimpan transaksi
* **`OfflineIndicator.tsx:17`** mengklaim *“Data lokal & cache tetap aktif”*.
* Kenyataannya, data `orders`, `inventory`, `menus`, `customers`, dan `purchases` tidak disimpan (*persist*) ke `localStorage` (**`StoreContext.tsx:575-599`**).
* Saat *offline*, transaksi hanya tersimpan di memori sementara. Jika halaman di-*reload*, aplikasi kembali memuat data *seed*/DB dan transaksi hilang.
* Belum ada mekanisme antrean atau coba ulang (*queue/retry* menggunakan IndexedDB) untuk sinkronisasi ulang saat kembali *online*.

---

## 6. Temuan Tinggi (P1)

### P1-1. Multi-device tidak berfungsi untuk beberapa modul
Data berikut hanya tersimpan di `localStorage` perangkat lokal:
* `vendors` (**`StoreContext.tsx:509-537`**)
* `restock_requests` (**`StoreContext.tsx:771-821`**)
* `ops_notifications`
* `whatsapp_logs`
* `username_login_logs`

> **Dampak:** Ketika kasir mengajukan *restock*, *owner* di perangkat lain tidak akan pernah menerimanya. Notifikasi *“real-time”* juga hanya mengandalkan `BroadcastChannel` dan `Notification API` lokal (**`pwaNotificationService.ts`**), bukan *push notification* lintas perangkat.

---

### P1-2. Data demo bocor ke produksi
* **`supabaseHydrationService.ts:111-433`** hanya mengganti *state* lokal jika tabel *remote* berisi data. Jika database baru atau masih kosong, aplikasi tetap menampilkan:
  * 3 order palsu (`BF-261125-002`, `003`, `004`).
  * Data *customer*, *vendor*, *purchase*, dan omzet demo.

> **Dampak:** *Owner* bisa keliru menganggap data demo sebagai transaksi nyata karena *dashboard* menampilkan omzet fiktif.

---

### P1-3. Setup & deploy belum bisa diikuti dari dokumentasi
* **`README.md`** masih menggunakan template bawaan AI Studio dan mencantumkan `GEMINI_API_KEY` yang sebenarnya tidak digunakan.
* **`DEPLOYMENT_VERCEL.md`** hanya menginstruksikan untuk menjalankan `schema_google_oauth_employees.sql`, tanpa menyebutkan `schema_full_brewflow.sql`.
* **`schema_full_brewflow.sql`** tidak dapat dijalankan secara mandiri: baris 16 membuat `app_sessions` dengan *Foreign Key* ke `public.employees` yang belum ada, dan baris 226 memberikan *grant* ke fungsi yang belum dibuat. Eksekusi harus berurutan: `employees` $\rightarrow$ `full`.
* **`package.json`** masih menggunakan nama `react-example` dengan versi `0.0.0`.

---

### P1-4. Laporan tidak akurat
* **`DashboardPage.tsx:20-22`** menghitung *“Penjualan Hari Ini”* dari seluruh *order* berstatus `completed` tanpa filter tanggal.
* Perhitungan HPP dan laba menggunakan harga beli saat ini, bukan harga historis saat transaksi terjadi.
* Proses *hydration* membatasi pengambilan data: `orders` (200), `order_items` (1000), `purchases` (200), dan `opname_details` (1500) (**`supabaseHydrationService.ts:87-97`**). Laporan atau ekspor Excel di atas batas tersebut menjadi tidak lengkap.
* Belum tersedia *pagination* maupun agregasi *server-side*.

---

### P1-5. Hardening autentikasi
* Login *email/password* serta penentuan *role* bergantung pada `auth.jwt()->>'email'` $\rightarrow$ jika *signup* publik Supabase terbuka dan konfirmasi email dimatikan, pihak luar dapat mendaftar menggunakan email karyawan dan memperoleh akses sistem.
* RPC `authenticate_employee_username` terbuka untuk `anon` tanpa *rate limit* $\rightarrow$ rentan terhadap serangan *brute force*.
* Sesi *username* berlaku selama 7 hari (*sliding*) tanpa mekanisme rotasi maupun antarmuka pencabutan sesi (*revocation UI*).
* Endpoint **`/api/send-login-alert`** hanya memeriksa keberadaan *header* `Bearer` (**`api/send-login-alert.ts:209-214`**), tanpa memvalidasi keaslian token.
* Edge Function **`send-whatsapp`** tidak memeriksa identitas atau *role* pemanggil serta menggunakan `Access-Control-Allow-Origin: *`. Karena `anon key` bersifat publik, siapa pun yang mengetahui URL fungsi tersebut dapat memicu pengiriman WhatsApp menggunakan token milik *owner*.

---

### P1-6. Password hash & data sensitif di localStorage
* `hashPasswordLocal` menggunakan `PBKDF2-SHA256` dengan 100.000 iterasi (**`usernameAuth.ts:8`**), berada di bawah standar rekomendasi OWASP (600.000 iterasi).
* Panjang minimal *password* hanya 6 karakter (**`usernameAuth.ts:36-44`**).
* *Hash password*, nominal gaji, dan data pribadi karyawan disimpan di `localStorage` (**`StoreContext.tsx:2168-2174, 2519-2527`**).
* *Bcrypt* di sisi server menggunakan *cost* 10 (cukup wajar), tetapi *hash* tetap dapat terbaca secara langsung melalui *query* `SELECT` pada tabel `employees`.

---

## 7. Gap Fitur vs Kebutuhan POS Coffee Shop

| Kebutuhan Umum | Status |
| :--- | :--- |
| Shift kasir & *cash drawer reconciliation* | ❌ Tidak ada |
| *Refund/void* + pemulihan stok/poin | ❌ Tidak ada |
| *Split payment* / *split bill* | ❌ Tidak ada |
| Manajemen meja / *floor plan* | ❌ Hanya input nomor meja teks |
| *Kitchen Display System* (KDS) | ❌ *TV Display* hanya menampilkan video promo |
| Integrasi order online (GoFood/GrabFood) | ❌ Tidak ada |
| *Multi-outlet* | ❌ Terkunci *singleton* `store_settings.id='default'` |
| Konversi satuan beli ($\text{kg} \rightarrow \text{gram}$) | ❌ Tidak ada; rawan kesalahan perhitungan HPP |
| *Batch* / *expiry tracking* | ❌ Tidak ada |
| *Purchase order* & hutang *supplier* | ❌ Hanya pencatatan pembelian |
| *Backup* / *restore* data | ❌ Tidak ada |
| *Push notification* lintas perangkat | ❌ Hanya notifikasi lokal |
| Tanggal lahir member & *consent* WA | ❌ Tidak ada |
| *Service charge* terpisah dari pajak | ❌ Hanya mendukung satu jenis pajak |
| Pembulatan kas | ❌ Tidak ada |
| *Offline queue* | ❌ Tidak ada |
| *Audit trail* perubahan data | ❌ Hanya mencatat log *login* |
| *E2E / integration test* | ❌ Hanya tersedia *unit test* |

---

## 8. Skor Evaluasi

| Aspek Evaluasi | Skor |
| :--- | :---: |
| Kelengkapan fitur | **8/10** |
| UI/UX | **8/10** |
| Arsitektur & *maintainability* | **6/10** |
| Keamanan & RBAC | **4/10** |
| Keandalan transaksi & *offline* | **3/10** |
| *Testing* | **6/10** |
| Dokumentasi & *deploy* | **4/10** |
| **Kesiapan Produksi** | **± 5/10** |

---

## 9. Rekomendasi Prioritas

### P0 — Sebelum Dipakai Jualan (Estimasi 1–2 Minggu)
1. **Buat RPC checkout transaksional di Postgres:** Lakukan *insert* `order` + `order_items`, pemotongan stok (`UPDATE ... WHERE current_stock >= qty`), pembaruan poin, dan penggunaan voucher dalam satu transaksi atomik. Kembalikan nomor order dari *sequence* database, bukan dari `orders.length`.
2. **Perbaiki format nomor order:** Gunakan pola `BF-YYMMDD-<daily_seq>` berbasis *sequence* atau tabel *counter* harian, dilengkapi mekanisme *retry* jika terjadi *unique violation*.
3. **Validasi status sinkronisasi sebelum reset keranjang:** Jangan pernah memanggil `resetCart()` sebelum proses *sync* berhasil. Periksa `syncStatus.synced`; tampilkan pesan eror beserta tombol *retry*, serta simpan transaksi yang gagal ke IndexedDB.
4. **Perketat RLS per role:**
   * **Kasir:** Hanya baca menu/pelanggan, tambah *order*, dan baca *order* miliknya sendiri.
   * **Manager:** Akses penuh ke inventori, pembelian (*purchases*), dan *stock opname*.
   * **Owner:** Akses penuh ke seluruh data, pengaturan toko, dan manajemen karyawan.
   * Cabut hak akses kolom `password_hash` dari *role* `anon` dan `authenticated`.
5. **Perbaiki alur pembatalan/refund:** Pastikan fitur *cancel/refund* mengembalikan stok, poin pelanggan, dan kuota voucher secara atomik (idealnya melalui RPC).

### P1 — Sebelum Operasional Multi-Device
6. Pindahkan penyimpanan `vendors`, `restock_requests`, `notifications`, dan `whatsapp_logs` dari `localStorage` ke tabel Supabase.
7. Hapus data *fallback seed* saat mode Supabase aktif; ganti dengan tampilan *empty state* atau alur *onboarding* toko baru.
8. Perbaiki modul laporan: tambahkan filter tanggal, terapkan agregasi *server-side* dan *pagination*, serta simpan nilai HPP historis pada setiap baris `order_items`.
9. Perkuat keamanan autentikasi (*hardening*): tutup pendaftaran publik (wajib undangan), terapkan *rate limit* pada endpoint *login*, verifikasi JWT di Edge Function, validasi token `Bearer` pada API email, dan terapkan rotasi sesi.
10. Perbarui `README.md` dan panduan *setup*, rapikan urutan skrip SQL, kunci (*pin*) versi `esbuild`, hapus *dependency* yang tidak terpakai (`@google/genai`, `express`, `dotenv`, `motion`), serta ganti pustaka `xlsx` yang memiliki kerentanan keamanan.

### P2 — Kualitas Jangka Panjang
11. Pecah `StoreContext` menjadi beberapa *context* per domain dan pertimbangkan penggunaan *React Query* atau *Zustand*.
12. Aktifkan `strict: true` pada TypeScript, konfigurasikan ESLint, siapkan *pipeline* CI (`tsc`, `test`, `build`), dan tambahkan pengujian E2E menggunakan Playwright untuk alur kritis (`login` $\rightarrow$ `checkout` $\rightarrow$ `struk`).
13. Terapkan *code splitting* (ukuran *bundle* saat ini mencapai `1.36 MB`), tambahkan *error boundary*, serta *loading skeleton*.
14. Kembangkan fitur operasional lanjutan: manajemen *shift* dan *cash drawer*, *refund*, *split payment*, konversi satuan bahan baku, serta fitur *backup/restore* data.

---

## 10. Kesimpulan

**BrewFlow-POS** memiliki fondasi yang sangat kuat sebagai produk MVP: cakupan fiturnya luas, antarmuka pengguna (UI) terlihat profesional, logika perhitungan HPP/voucher/opname telah teruji dengan baik, serta integrasi printer *thermal* dan WhatsApp menjadi nilai jual yang nyata.

Namun, untuk sistem POS yang mengelola perputaran uang dan stok secara langsung, **tiga fondasi utama wajib diselesaikan terlebih dahulu**:
1. **Integritas transaksi** (proses atomik, penomoran order yang valid, dan penanganan eror sinkronisasi).
2. **RLS/RBAC yang ketat** untuk membatasi hak akses antar-peran secara nyata di level database.
3. **Dukungan offline & multi-device yang andal** (antrean sinkronisasi lokal dan persistensi penuh ke database).

Tanpa perbaikan pada ketiga aspek tersebut, risiko terbesar yang dihadapi bukan sekadar *bug* tampilan, melainkan hilangnya catatan transaksi tanpa terdeteksi serta celah keamanan yang memungkinkan kasir memodifikasi data sensitif milik *owner*.