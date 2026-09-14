/**
 * The only network layer the client talks through.
 *
 * The API lives on the game server (Express, :3001) while Vite serves the
 * terminal at :5173, so we hit it cross-origin (the server sends permissive
 * CORS headers). We deliberately do NOT use import.meta.env here — this
 * tsconfig has no vite/client types — so the base is a constant; point it at
 * whatever host serves the server in your environment.
 */
const API_BASE = 'http://localhost:3001';

/** Error carrying the server's `error` string plus the HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface SessionPayload {
  token: string;
  user: { id: number; email: string };
}

export async function apiFetch<T = unknown>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data !== null &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (HTTP ${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}