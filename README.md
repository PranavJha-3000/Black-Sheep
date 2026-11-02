# Black Sheep
A Long-Horizon Autonomous Financial Agent Laboratory.

Product direction and research objectives: [docs/VISION.md](docs/VISION.md).
Working agreement for contributors and AI agents: [AGENTS.md](AGENTS.md) and `docs/ai/`.

## Setup
```bash
npm install
npm run db:up        # Postgres via docker compose
npm run server:dev   # API + world loop on :3001
npm run dev          # client on :5173
npm test
```
