// index.js
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

// --- Load server config from .env ---
const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);
const HTTP_HOST = process.env.HTTP_HOST || '0.0.0.0';

// --- Resolve __dirname ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Create DB pool from env ---
const db = createPoolFromEnv();

// --- Express & HTTP server ---
const app = express();
const server = http.createServer(app);

// --- Socket.IO ---
const io = new IOServer(server, {
  cors: { origin: '*' } // LAN dev; restrict later in production
});
setupSocket(io);

// --- Helmet + CSP ---
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
    },
    // Disable COOP & COEP to allow LAN IP access without HTTPS
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

// --- JSON body parsing ---
app.use(express.json({ limit: '200kb' }));

// --- Serve dashboard static files ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Dashboard API ---
app.use('/api', makeApiRouter({ db }));

// --- Rate-limit for ingest/config routes ---
const ingestLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: 80
});
app.use('/api', ingestLimiter, makeIngestRouter({ db, io }));

// --- Health check endpoint ---
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'DB not reachable' });
  }
});

// --- Start server ---
server.listen(HTTP_PORT, HTTP_HOST, () => {
  const displayHost = HTTP_HOST === '0.0.0.0' ? 'localhost' : HTTP_HOST;
  console.log(`Dashboard: http://${displayHost}:${HTTP_PORT}`);
  console.log(`Health:     http://${displayHost}:${HTTP_PORT}/health`);
});

// --- Error handling ---
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));
process.on('uncaughtException', (err) => console.error('uncaughtException', err));