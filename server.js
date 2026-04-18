import express from 'express';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config(); // Load .env

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULT_DIR = path.join(__dirname, 'result');
if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(__dirname));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const commentJobs = new Map();
const clients = new Map();

// ─── Rate Limiter ────────────────────────────────────────────────
// Struktur: { ip -> { count: number, resetAt: timestamp } }
const scrapeRateLimit = new Map();
const RATE_LIMIT_MAX   = parseInt(process.env.RATE_LIMIT_MAX  || '3'); // max scrape per hari
const RESET_HOUR     = parseInt(process.env.RATE_RESET_HOUR || '8'); // jam reset harian (default 08:00)

// Hitung timestamp jam reset berikutnya
function getNextResetAt() {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(RESET_HOUR, 0, 0, 0);
  if (now >= reset) reset.setDate(reset.getDate() + 1); // sudah lewat, pakai besok
  return reset.getTime();
}

function getRateLimitInfo(ip) {
  const now = Date.now();
  const entry = scrapeRateLimit.get(ip);

  // Belum pernah scrape atau sudah melewati waktu reset
  if (!entry || now >= entry.resetAt) {
    return { count: 0, resetAt: getNextResetAt(), remaining: RATE_LIMIT_MAX };
  }

  return {
    count: entry.count,
    resetAt: entry.resetAt,
    remaining: Math.max(0, RATE_LIMIT_MAX - entry.count),
  };
}

function incrementRateLimit(ip) {
  const info = getRateLimitInfo(ip);
  scrapeRateLimit.set(ip, {
    count: info.count + 1,
    resetAt: info.resetAt,
  });
}

function checkRateLimit(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const info = getRateLimitInfo(ip);

  // Tambahkan header info ke response (opsional tapi berguna untuk debugging)
  res.setHeader('X-RateLimit-Limit',     RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', info.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(info.resetAt / 1000)); // Unix timestamp

  if (info.count >= RATE_LIMIT_MAX) {
    const resetDate = new Date(info.resetAt);
    const resetStr  = resetDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    res.status(429).json({
      error: `Batas scraping harian tercapai (${RATE_LIMIT_MAX}x/hari). Reset jam ${resetStr}.`,
      resetAt: info.resetAt,
      remaining: 0,
    });
    return false; // blocked
  }

  return true; // allowed
}
// ────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  const clientId = Date.now().toString();
  clients.set(clientId, ws);
  ws.send(JSON.stringify({ type: 'connected', clientId }));
  ws.on('close', () => clients.delete(clientId));
});

function broadcast(clientId, data) {
  const ws = clients.get(clientId);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function cleanOldFolders() {
  const activeJobs = Array.from(commentJobs.values())
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 5);

  // path formatnya 'result/scrape_.../videos.csv' -> index 1 = nama folder
  const activeFolders = new Set(
    activeJobs
      .flatMap(j => [j.videosCsv, j.commentsCsv])
      .filter(Boolean)
      .map(f => f.split('/')[1])
  );

  if (!fs.existsSync(RESULT_DIR)) return;
  const entries = fs.readdirSync(RESULT_DIR);
  const scrapeFolders = entries.filter(f =>
    f.startsWith('scrape_') &&
    fs.statSync(path.join(RESULT_DIR, f)).isDirectory()
  );

  scrapeFolders.forEach(folder => {
    if (!activeFolders.has(folder)) {
      fs.rmSync(path.join(RESULT_DIR, folder), { recursive: true, force: true });
      console.log(`🗑️ Deleted old folder: result/${folder}`);
    }
  });
}

// Comment scraper
app.post('/api/scrape-comments', (req, res) => {
  const { query, videoCount = 20, commentCount = 500, clientId } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });

  // ── Cek rate limit sebelum mulai scraping ──
  if (!checkRateLimit(req, res)) return;
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  incrementRateLimit(ip);
  // ──────────────────────────────────────────

  const jobId = Date.now().toString();
  const job = { id: jobId, query, videoCount, commentCount, status: 'running', logs: [], startTime: Date.now(), endTime: null, videosCsv: null, commentsCsv: null, videoCountResult: 0, commentCountResult: 0 };
  commentJobs.set(jobId, job);

  const encodedQuery = encodeURIComponent(query);
  const proc = spawn(`npx tsx parse-comments.ts ${encodedQuery} ${videoCount} ${commentCount}`, {
    cwd: __dirname,
    env: { ...process.env, OUTPUT_DIR: RESULT_DIR },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true
  });

  proc.stdout.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      job.logs.push(line);
      broadcast(clientId, { type: 'log', jobId, line });
      const vidMatch = line.match(/videos-[^\s]+\.csv/);
      if (vidMatch) job.videosCsv = vidMatch[0].replace(/\\/g, '/');
      const comMatch = line.match(/comments-[^\s]+\.csv/);
      if (comMatch) job.commentsCsv = comMatch[0].replace(/\\/g, '/');
      if (line.includes('✅ DONE') || line.includes('Videos  :') || line.includes('Comments:')) {
        const vCount = line.match(/(\d+).*videos/i);
        const cCount = line.match(/(\d+).*comments/i);
        if (vCount) job.videoCountResult = parseInt(vCount[1]);
        if (cCount) job.commentCountResult = parseInt(cCount[1]);
      }
      const folderMatch = line.match(/Output folder[^:]*:\s*(.+)/);
      if (folderMatch) {
        const folder = path.basename(folderMatch[1].trim());
        job.videosCsv   = `result/${folder}/videos.csv`;
        job.commentsCsv = `result/${folder}/comments.csv`;
      }
    });
  });

  proc.stderr.on('data', (data) => {
    const line = '⚠️ ' + data.toString();
    job.logs.push(line);
    broadcast(clientId, { type: 'log', jobId, line });
  });

  proc.on('close', (code) => {
    job.status = code === 0 ? 'done' : 'error';
    job.endTime = Date.now();
    const safeQuery = query.replace(/[^a-zA-Z0-9]/g, '_');
    const allEntries = fs.existsSync(RESULT_DIR) ? fs.readdirSync(RESULT_DIR) : [];
    const scrapeFolder = allEntries
      .filter(f => f.startsWith(`scrape_${safeQuery}_`))
      .sort().pop();
    if (scrapeFolder) {
      if (!job.videosCsv)   job.videosCsv   = `result/${scrapeFolder}/videos.csv`;
      if (!job.commentsCsv) job.commentsCsv = `result/${scrapeFolder}/comments.csv`;
    }
    broadcast(clientId, { type: 'done', jobId, status: job.status, videosCsv: job.videosCsv, commentsCsv: job.commentsCsv, videoCount: job.videoCountResult, commentCount: job.commentCountResult, duration: ((job.endTime - job.startTime) / 1000).toFixed(1) });
    cleanOldFolders();
  });

  res.json({ jobId });
});

app.get('/api/jobs-comments', (req, res) => {
  res.json(Array.from(commentJobs.values()).map(j => ({ id: j.id, query: j.query, videoCount: j.videoCountResult, commentCount: j.commentCountResult, status: j.status, videosCsv: j.videosCsv, commentsCsv: j.commentsCsv, duration: j.endTime ? ((j.endTime - j.startTime) / 1000).toFixed(1) : null })).reverse());
});

// Endpoint untuk cek apakah API key sudah terset di server
app.get('/api/ai-status', (req, res) => {
  const hasKey = !!process.env.GROQ_API_KEY;
  res.json({ configured: hasKey });
});

// AI Analyze — baca API key dari environment variable
app.post('/api/analyze', async (req, res) => {
  const { commentsCsv, context } = req.body;

  // Ambil API key dari .env, bukan dari request
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY belum diset di server. Tambahkan ke file .env' });
  }
  if (!commentsCsv) return res.status(400).json({ error: 'commentsCsv required' });

  const filePath = path.join(__dirname, commentsCsv);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  // Baca CSV, ambil kolom commentText saja, max 800 komentar
  const raw = fs.readFileSync(filePath, 'utf-8');

  function parseCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { result.push(cur); cur = ''; }
        else { cur += ch; }
      }
    }
    result.push(cur);
    return result;
  }

  const lines = raw.split('\n').filter(Boolean);
  const header = parseCSVLine(lines[0]);
  const textIdx = header.findIndex(h => h.trim() === 'commentText');

  const comments = lines.slice(1, 801)
    .map(line => {
      const cols = parseCSVLine(line);
      return (cols[textIdx] || '').trim();
    })
    .filter(t => t.length > 0);

  if (!comments.length) return res.status(400).json({ error: 'No comments found in file' });

  if (!context?.trim()) {
    return res.status(400).json({ error: 'Prompt tidak boleh kosong. Tulis instruksi analisis kamu dulu.' });
  }

  // Bangun konteks bisnis dari env
  const bisnisInfo = [
    process.env.AI_BISNIS    ? `Bisnis: ${process.env.AI_BISNIS}` : null,
    process.env.AI_INDUSTRI  ? `Industri: ${process.env.AI_INDUSTRI}` : null,
    process.env.AI_TONE      ? `Tone jawaban: ${process.env.AI_TONE}` : null,
  ].filter(Boolean).join('\n');

  const systemPrompt = process.env.AI_SYSTEM_PROMPT ||
    'Kamu adalah analis bisnis yang membantu menganalisis komentar media sosial untuk menemukan insight dan peluang bisnis.';

  const systemContent = bisnisInfo
    ? `${systemPrompt}\n\nKonteks bisnis pengguna:\n${bisnisInfo}`
    : systemPrompt;

  const prompt = `${context}

---
Berikut data komentar dari video TikTok (${comments.length} komentar):

${comments.join('\n')}
---`;

  try {
    const model = 'llama-3.3-70b-versatile';
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || 'Groq API error';
      return res.status(400).json({ error: errMsg });
    }

    const result = data.choices?.[0]?.message?.content || '';
    if (!result) return res.status(500).json({ error: 'Groq tidak mengembalikan hasil' });

    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cek sisa kuota scraping untuk IP saat ini
app.get('/api/rate-limit-status', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const info = getRateLimitInfo(ip);
  res.json({
    limit:     RATE_LIMIT_MAX,
    used:      info.count,
    remaining: info.remaining,
    resetAt:   info.resetAt,
  });
});

// Download
app.get('/api/download', (req, res) => {
  const filename = req.query.file;
  if (!filename) return res.status(400).json({ error: 'No file specified' });
  const file = path.join(__dirname, filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });
  res.download(file);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Comment Scraper UI -> http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) {
    console.warn('⚠️  GROQ_API_KEY belum diset. Tambahkan ke file .env untuk fitur AI Analysis.');
  } else {
    console.log('✅ GROQ_API_KEY loaded dari .env');
  }
});