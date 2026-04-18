# TikTok Comment Scraper + AI Analysis

Web interface untuk scraping komentar TikTok berdasarkan keyword, dilengkapi fitur analisis AI untuk social listening dan riset pasar.

## Struktur File

```
project/
├── server.js           ← Backend server (Express + WebSocket)
├── index.html          ← Web UI (scraper + AI analysis)
├── parse-comments.ts   ← Script scraper utama
├── tsconfig.json       ← Konfigurasi TypeScript
├── .env                ← Konfigurasi environment (buat dari _env.example)
├── _env.example        ← Template konfigurasi
└── README.md
```

## Requirement

- **Node.js** v18+
- **Chrome** — harus terinstall di komputer
- **tsx** — untuk menjalankan TypeScript via server

```bash
npm install -g tsx
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Konfigurasi environment

Copy file template dan isi API key kamu:

```bash
cp _env.example .env
```

Edit file `.env`:

```env
# Groq API Key — wajib untuk fitur AI Analysis
# Daftar gratis di: https://console.groq.com
GROQ_API_KEY=gsk_...

# Personalisasi konteks AI (opsional)
AI_SYSTEM_PROMPT=Kamu adalah analis bisnis senior yang berpengalaman di pasar Indonesia.
AI_BISNIS=Nama bisnis kamu
AI_INDUSTRI=Industri kamu
AI_TONE=semi-formal

# Port server (opsional, default 3000)
PORT=3000

# Rate limiting scraping per IP (opsional)
RATE_LIMIT_MAX=3        # max scrape per hari, default 3
RATE_RESET_HOUR=8       # jam reset harian, default 08:00
```

### 3. Jalankan server

```bash
node server.js
```

Buka browser ke `http://localhost:3000`.

---

## Cara Pakai

### 1. Scraping Komentar

Isi keyword, set jumlah video & komentar per video, klik **▶ Start Scraping**.

- Log scraping tampil live di terminal UI
- Setelah selesai, klik **Download Videos CSV** atau **Download Comments CSV**
- Komentar yang hanya berisi emoji, sticker, atau tag akun otomatis difilter

> **Rate Limit:** Setiap IP dibatasi **3x scraping per hari** (default). Sisa kuota ditampilkan di UI dan reset setiap pagi jam 08:00. Batas ini bisa diubah via variabel `RATE_LIMIT_MAX` dan `RATE_RESET_HOUR` di `.env`.

### 2. Analisis AI (setelah scrape selesai)

Setelah scraping selesai, section **Analyze with AI** muncul otomatis di bawah hasil.

1. Isi kolom **Prompt Analisis** — tulis instruksi yang ingin kamu tanyakan ke AI, contoh:
   > "Temukan pain points yang paling sering muncul dan beri rekomendasi pengembangan produk"
2. Klik **✦ Analyze Comments**
3. Hasil analisis muncul langsung di halaman

AI menggunakan model **Llama 3.3 70B** via [Groq](https://console.groq.com) — cepat dan gratis untuk pemakaian wajar. API key dikonfigurasi di file `.env` di server, tidak perlu diisi ulang di browser.

#### Cara dapat Groq API Key

Daftar/login di [console.groq.com](https://console.groq.com) → **API Keys** → **Create Key**. Groq menyediakan free tier yang cukup untuk penggunaan normal.

#### Jika kena rate limit Groq

- Tunggu ±30 detik lalu coba lagi
- Persingkat prompt — fokus ke 1 pertanyaan
- Kurangi jumlah komentar yang discrape (300–400 komentar sudah cukup untuk insight yang bagus)
- Upgrade ke Groq Dev Tier di [console.groq.com/settings/billing](https://console.groq.com/settings/billing)

---

## Output

Setiap job menghasilkan folder `result/scrape_<keyword>_<timestamp>/` berisi dua file CSV:

### `videos.csv`

| Kolom | Keterangan |
|---|---|
| videoId | ID unik video |
| username | Username TikTok |
| nickname | Nama tampilan |
| views | Jumlah views |
| likes | Jumlah likes |
| comments | Jumlah komentar |
| shares | Jumlah share |
| saves | Jumlah simpan |
| description | Caption video |
| hashtags | Hashtag yang dipakai |
| videoUrl | Link video |
| scrapeDate | Waktu scraping |

### `comments.csv`

| Kolom | Keterangan |
|---|---|
| commentId | ID unik komentar |
| videoId | ID video asal |
| videoUrl | Link video asal |
| commenterUsername | Username komentator |
| commenterNickname | Nama tampilan komentator |
| commenterUid | UID komentator |
| commentText | Isi komentar |
| likes | Likes pada komentar |
| replyCount | Jumlah balasan |
| commentDate | Waktu komentar dibuat |
| scrapeDate | Waktu scraping |

> Server hanya menyimpan **5 folder scraping terbaru**. Folder lama otomatis dihapus setelah job baru selesai — segera download hasil yang dibutuhkan.

---

## Catatan

- **Login TikTok diperlukan** — Chrome terbuka otomatis, login manual sekali, sesi tersimpan untuk berikutnya
- **API Key Groq** disimpan di file `.env` di server — tidak dikirim ke tempat lain
- **AI Analysis** memproses maksimal 800 komentar per analisis
- Untuk stop server: **Ctrl+C** di terminal