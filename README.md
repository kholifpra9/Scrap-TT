# TikTok Comment Scraper

Web interface untuk scraping komentar TikTok berdasarkan keyword. Hasil disimpan otomatis ke CSV (videos + comments) dan bisa didownload langsung dari browser.

## Struktur File

```
project/
├── server.js           ← Backend server (Express + WebSocket)
├── index.html       ← Web UI (jadikan index.html kalau mau deploy)
├── parse-comments.ts   ← Script scraper utama
├── tsconfig.json       ← Konfigurasi TypeScript
└── README.md
```

## Requirement

- **Node.js** v18+
- **Chrome** — harus terinstall di komputer
- **npx / tsx** — untuk menjalankan `parse-comments.ts` via server

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

Buka browser ke `http://localhost:3000`, isi keyword, set jumlah video & komentar per video, klik **Start Scraping**.

- Log scraping tampil live di terminal UI
- Setelah selesai, klik **Download Videos CSV** atau **Download Comments CSV**
- History job tersimpan selama server hidup

## Output

Setiap job menghasilkan satu folder `scrape_<keyword>_<timestamp>/` berisi dua file:

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

> Komentar yang hanya berisi emoji, sticker, atau tag akun otomatis difilter dan tidak disimpan.

## Catatan

- Login TikTok diperlukan — Chrome akan terbuka otomatis, login manual sekali, sesi tersimpan untuk berikutnya
- Untuk stop server: **Ctrl+C** di terminal
- Folder hasil scraping tersimpan di direktori yang sama dengan `server.js`