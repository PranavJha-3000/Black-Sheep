import 'dotenv/config';
import express from 'express';
import { authRouter } from './auth';
import { roomsRouter } from './rooms';
import { awayRouter } from './away';
import { resultCardRouter } from './resultCard';
import { startWorldLoop } from './world';

const app = express();
app.use(express.json());

// Permissive CORS for the Vite dev origin (browser :5173 → API :3001).
// No auth yet, no cookie sessions — the JWT rides in Authorization, so no
// credential mode is needed. Production would narrow the origin list.
app.use((req, res, next) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/auth', authRouter);
app.use('/rooms', roomsRouter);
app.use('/rooms', awayRouter);
app.use('/funds', resultCardRouter);

// Express error handler (next-param signature is how Express detects it).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

// The world ticks with or without clients connected - that is the point.
const stopWorld = startWorldLoop();

const shutdown = (): void => {
  stopWorld();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
