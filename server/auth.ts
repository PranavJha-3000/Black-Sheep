import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { prisma } from './db';

const BCRYPT_ROUNDS = 10;
const TOKEN_TTL = '7d';

/**
 * If JWT_SECRET is unset we mint an ephemeral one per process boot: all
 * sessions die on restart. Acceptable for dev, and avoids ever hardcoding a
 * secret. Production must set JWT_SECRET in the environment.
 */
const JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length > 0
    ? process.env.JWT_SECRET
    : randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET not set - using an ephemeral per-boot secret (dev only).');
}

export interface AuthedRequest extends Request {
  userId: number;
}

function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/** Bearer-token middleware. Attaches userId on success, 401s otherwise. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const sub =
      typeof payload === 'object' && payload !== null && 'sub' in payload
        ? (payload as { sub?: unknown }).sub
        : undefined;
    const userId = typeof sub === 'string' ? Number.parseInt(sub, 10) : Number.NaN;
    if (!Number.isInteger(userId)) throw new Error('bad sub');
    (req as AuthedRequest).userId = userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
}

/**
 * Express 4 does not catch rejected promises from async handlers — an
 * unhandled rejection would take the process down. Every async route goes
 * through this wrapper so failures become 500s instead of crashes.
 */
export function wrap(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function readCredentials(body: unknown): { email: string; password: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { email, password } = body as CredentialsBody;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  if (password.length < 8) return null;
  return { email: trimmed, password };
}

export const authRouter = Router();

authRouter.post('/register', wrap(async (req, res) => {
  const creds = readCredentials(req.body);
  if (!creds) {
    res.status(400).json({ error: 'Valid email and a password of at least 8 characters are required.' });
    return;
  }
  try {
    const passwordHash = await bcrypt.hash(creds.password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({ data: { email: creds.email, passwordHash } });
    res.status(201).json({ token: signToken(user.id), user: { id: user.id, email: user.email } });
  } catch (err) {
    // Prisma unique-violation code: the email already exists.
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'An account with that email already exists.' });
      return;
    }
    throw err;
  }
}));

authRouter.post('/login', wrap(async (req, res) => {
  const creds = readCredentials(req.body);
  if (!creds) {
    res.status(400).json({ error: 'Valid email and password are required.' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: creds.email } });
  // Constant-shape response: never reveal whether the email exists.
  if (!user || !(await bcrypt.compare(creds.password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  res.json({ token: signToken(user.id), user: { id: user.id, email: user.email } });
}));


