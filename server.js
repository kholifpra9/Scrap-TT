import express from 'express';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// Comment scraper
app.post('/api/scrape-comments', (req, res) => {
  const { query, videoCount = 20, commentCount = 500, clientId } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });

  const jobId = Date.now().toString();
  const job = { id: jobId, query, videoCount, commentCount, status: 'running', logs: [], startTime: Date.now(), endTime: null, videosCsv: null, commentsCsv: null, videoCountResult: 0, commentCountResult: 0 };
  commentJobs.set(jobId, job);

  const encodedQuery = encodeURIComponent(query);
  const proc = spawn(`npx tsx parse-comments.ts ${encodedQuery} ${videoCount} ${commentCount}`, { cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'], shell: true });

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
        job.videosCsv = folder + '/videos.csv';
        job.commentsCsv = folder + '/comments.csv';
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
    const allEntries = fs.readdirSync(__dirname);
    const scrapeFolder = allEntries
      .filter(f => f.startsWith(`scrape_${safeQuery}_`))
      .sort().pop();
    if (scrapeFolder) {
      if (!job.videosCsv) job.videosCsv = scrapeFolder + '/videos.csv';
      if (!job.commentsCsv) job.commentsCsv = scrapeFolder + '/comments.csv';
    }
    broadcast(clientId, { type: 'done', jobId, status: job.status, videosCsv: job.videosCsv, commentsCsv: job.commentsCsv, videoCount: job.videoCountResult, commentCount: job.commentCountResult, duration: ((job.endTime - job.startTime) / 1000).toFixed(1) });
  });

  res.json({ jobId });
});

app.get('/api/jobs-comments', (req, res) => {
  res.json(Array.from(commentJobs.values()).map(j => ({ id: j.id, query: j.query, videoCount: j.videoCountResult, commentCount: j.commentCountResult, status: j.status, videosCsv: j.videosCsv, commentsCsv: j.commentsCsv, duration: j.endTime ? ((j.endTime - j.startTime) / 1000).toFixed(1) : null })).reverse());
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
});