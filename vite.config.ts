import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only relay so the browser never talks to Anthropic directly (and never
 * sees the key). Forwards POST /api/llm to api.anthropic.com/v1/messages with
 * the key injected from the server environment. This MUST be a plugin with a
 * configureServer hook - a top-level `configureServer` in the user config is
 * silently ignored by Vite, which is why the route 404'd originally.
 *
 * Body reading is event-based (not async-iterable) because Vite's Connect
 * middleware layer does not await async handlers.
 *
 * For production this would become a real edge function / backend proxy.
 */
function llmProxyPlugin(): Plugin {
  return {
    name: 'anthropic-llm-proxy',
    configureServer(server) {
      const apiKey = loadEnv(server.config.mode, process.cwd(), '').ANTHROPIC_API_KEY;
      server.middlewares.use('/api/llm', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              error:
                'ANTHROPIC_API_KEY is not set. Create a .env file with it (see .env.example) and restart the dev server.',
            }),
          );
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body,
          })
            .then(async (upstream) => {
              const text = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader('content-type', 'application/json');
              res.end(text);
            })
            .catch((err: unknown) => {
              res.statusCode = 502;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: 'LLM proxy request failed', detail: String(err) }));
            });
        });
        req.on('error', (err: unknown) => {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'LLM proxy read failed', detail: String(err) }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), llmProxyPlugin()],
  server: {
    port: 5173,
  },
});
