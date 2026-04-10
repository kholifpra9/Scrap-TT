# TikTok Comment Scraper + AI Analysis

Web interface untuk scraping komentar TikTok berdasarkan keyword, dilengkapi fitur analisis AI untuk social listening dan riset pasar.

## Struktur File

```
project/
├── server.js           ← Backend server (Express + WebSocket)
├── index.html          ← Web UI (scraper + AI analysis)
├── parse-comments.ts   ← Script scraper utama
├── tsconfig.json       ← Konfigurasi TypeScript
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

```bash
npm install
```

## Cara Pakai

```bash
node server.js
```

Buka browser ke `http://localhost:3000`.

---

### 1. Scraping Komentar

Isi keyword, set jumlah video & komentar per video, klik **Start Scraping**.

- Log scraping tampil live di terminal UI
- Setelah selesai, klik **Download Videos CSV** atau **Download Comments CSV**
- Komentar yang hanya berisi emoji, sticker, atau tag akun otomatis difilter

### 2. Analisis AI (setelah scrape selesai)

Setelah scraping selesai, section **Analyze with AI** muncul otomatis di bawah hasil.

1. Isi **Anthropic API Key** (format `sk-ant-...`) → klik Save Key, tersimpan untuk sesi berikutnya
2. Isi **Konteks Bisnis** kamu, contoh:
   > "Saya ingin mengembangkan produk herbal dan sedang melakukan social listening dari komentar video kompetitor"
3. Klik **✦ Analyze Comments**
4. Hasil analisis muncul dalam dua bagian:
   - **Generalisasi Topik** — apa yang paling banyak dibahas di komentar
   - **Celah & Peluang** — insight actionable untuk develop produk/bisnis

#### Cara dapat API Key
Daftar/login di [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key**.
Anthropic memberikan **$5 free credit** saat pertama daftar.

#### Estimasi biaya
| Model | Per analisis (~800 komentar) | Rekomendasi |
|---|---|---|
| `claude-opus-4-6` | ~$0.10–0.15 | Hasil paling detail |
| `claude-haiku-4-5-20251001` | ~$0.01–0.02 | Hemat, tetap bagus |

Ganti model di `server.js` pada baris `model: 'claude-opus-4-6'` sesuai kebutuhan.

---

## Output

Setiap job menghasilkan folder `scrape_<keyword>_<timestamp>/` berisi:

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

---

## Catatan

- Login TikTok diperlukan — Chrome terbuka otomatis, login manual sekali, sesi tersimpan untuk berikutnya
- API Key Anthropic disimpan di `localStorage` browser, tidak dikirim ke server lain selain Anthropic
- Untuk stop server: **Ctrl+C** di terminal
- Folder hasil scraping tersimpan di direktori yang sama dengan `server.js`