# Black Sheep
A Long-Horizon Autonomous Financial Agent Laboratory.

Product direction and research objectives: [docs/VISION.md](docs/VISION.md).
Working agreement for contributors and AI agents: [AGENTS.md](AGENTS.md) and `docs/ai/`.

## Run the demo
Three terminals, from the repo root:

```bash
npm install
cp .env.example .env     # DATABASE_URL already matches the local Postgres
npm run db:local         # terminal 1: Postgres on :5432, no Docker needed (data in .pgdata/)
npm run db:migrate       # once, and after pulling new migrations
npm run server:dev       # terminal 2: API + always-on world on :3001
npm run dev              # terminal 3: observer UI on http://localhost:5173
```

With Docker running, `npm run db:up` replaces `npm run db:local` (same port and credentials; run only one).

The world ticks every 5 s whether or not anyone watches. Views: WORLD, FUNDS, FUND DETAIL, ACTIVITY, RESEARCH LAB, ANALYTICS.

## Connecting the APIs (`.env`)
| Variable | Without it | With it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Funds trade on their deterministic policies (decisions tagged `policy`). | Funds decide with Claude Opus 5.5 via research tools, capped at $2/fund/day and $10/day (`config/funds.ts`, `config/game.ts`). Watch `LlmCallLog` cost on the first run. |
| `OPENROUTER_API_KEY` | Lab experiments cannot use cross-vendor brains (OpenAI, Google, xAI models). | RESEARCH LAB can give a fund an OpenRouter model brain (lab only; the live world stays on Anthropic, D-046). Each model brain needs its own provider's key. |
| `LAB_ADMIN_TOKEN` | RESEARCH LAB is view-only (creating returns 503). | Enter the token in RESEARCH LAB → + NEW to run experiments. |
| `DIRECTOR_MODE` | `rule` (default) | `none` disables the World Director; `jev` is a disabled stub until Jev's API contract exists (`server/providers/jev.ts`). |
| `JWT_SECRET`, `WORLD_SEED` | Ephemeral secret / default seed | Fixed values |

Keys stay on the server; the browser never calls a model.

## Checks
```bash
npm run typecheck && npm test && npm run lint && npm run build
```
