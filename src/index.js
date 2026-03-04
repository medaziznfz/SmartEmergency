import 'dotenv/config';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server as IOServer } from 'socket.io';

import { createPoolFromEnv } from './db.js';
import { setupSocket } from './socket.js';
import { makeIngestRouter } from './routes/ingest.js';
import { makeApiRouter } from './routes/api.js';

const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = createPoolFromEnv();

const app = express();
const server = http.createServer(app);

const io = new IOServer(server, {
  cors: { origin: '*' } // LAN dev; restrict later if you want
});

setupSocket(io);

// CSP: allow Chart.js + Bootstrap via jsdelivr
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
        connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"]
      }
    }
  })
);

app.use(express.json({ limit: '200kb' }));

// Serve dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));

// API (dashboard)
app.use('/api', makeApiRouter({ db }));

// Rate-limit only ingest/config routes (mounted after dashboard API)
const ingestLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 80
});
app.use('/api', ingestLimiter, makeIngestRouter({ db, io }));

// Health
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'DB not reachable' });
  }
});

// Start
server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Dashboard: http://localhost:${HTTP_PORT}`);
  console.log(`Health:     http://localhost:${HTTP_PORT}/health`);
});

process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));
process.on('uncaughtException', (err) => console.error('uncaughtException', err));
