# Black Sheep

A simulated market where AI hedge funds trade against each other, built to study how language-model agents behave over long horizons.

[Paper source](paper/main.tex) · [Pre-registration](paper/PREREGISTRATION.md) · [Vision](docs/VISION.md) · [Contributing](AGENTS.md)

## What is Black Sheep?

Black Sheep is a fictional economy of ten listed companies and three hedge funds. The world ticks every five seconds whether or not anyone is watching. Funds research companies with tools, open and close positions, keep a memory of what worked, and live with the price impact of their own trades. A World Director fires market events when the market goes quiet. Humans watch and run experiments; they do not trade.

The same engine runs headless in the Research Lab. There you hold the world fixed, change one thing about a fund (its model, its memory, whether the Director is on), and run every arm on the same seeds so the results compare run for run.

Each fund decides with one of two brains:

- a deterministic policy written for its personality, which is free and reproducible;
- a language model with research tools, which runs only on the server and only under a hard budget.

## The three funds

| Fund | Personality | Mandate | Max position |
|---|---|---|---|
| Sterling & Vale | cautious | Preserve capital and compound steadily through value and macro discipline. | 12% of NAV |
| Halden Whitmore | aggressive | Generate outsized returns by shorting broken stories and overextended rallies. | 20% of NAV |
| Crown Meridian | quant | Harvest systematic edge from order flow without narrative bias. | 15% of NAV |

Every fund starts with 10,000,000 USD and decides every 10 ticks in its own slot. A risk check clamps or refuses any order larger than the fund's position limit. Full profiles are in [`config/funds.ts`](config/funds.ts).

## Research questions

The study in [`paper/`](paper) is pre-registered (tag `prereg-v1`, amended once in `prereg-amend-1`) and has not been run yet. It asks four questions about the subject fund, Crown Meridian:

1. H1, cross-model. Does a Claude brain (Haiku 5.5, Sonnet 5.5 or Opus 5.5) earn more than the policy it replaces?
2. H2, memory. Do episodic memories, reflections, or both change returns?
3. H3, Director. Does the rule-based World Director change returns?
4. H4, cost. How many percentage points of return does each model buy per USD?

Each question runs on seeds 1 to 20 for 500 ticks, with differences paired by seed, a bootstrap 95% CI, a sign test and Holm correction.

## What we measure

| Metric | Definition |
|---|---|
| Total return | Final NAV against starting capital, in percent. The primary metric. |
| Max drawdown | Largest peak-to-trough fall of NAV, in percent of the peak. |
| Sharpe | Mean over standard deviation of per-snapshot NAV returns. No risk-free rate, no annualisation. |
| Survival | The fund was not liquidated. |
| Action entropy | How evenly the fund spreads its decisions over buy, short, close and hold (0 to 1). |
| Risk compliance | Share of orders the risk check left unchanged. |
| Repeated error rate | Share of losing closes followed by the same trade on the same ticker within 50 ticks. |
| Shock de-risk | Change in gross exposure in the 30 ticks after a price shock of 5% or more. |
| Trade rate | Trades per decision. |
| Cost | Fallback rate to the policy, and USD per decision. |

Exact definitions are in [`paper/main.tex`](paper/main.tex) and [`packages/engine/src/behaviour.ts`](packages/engine/src/behaviour.ts).

## World design

- Ten fictional companies in eight sectors, from NOVA AI (tech) to LEDGER TRUST (finance). Prices mean-revert, and trades move them through a square-root impact model.
- Shorts post 50% initial margin. A fund is liquidated when its NAV falls below 25% of its shorts' value.
- Scripted and ambient events move sectors and the macro picture. The rule-based Director only fires events from a validated catalogue, and holds off when the market is already moving.
- Model funds research with five tools: `inspect_company`, `inspect_portfolio`, `calculate_risk`, `recent_events` and `recall_memory`. A decision is a bounded loop of at most four tool rounds.
- When nothing has changed since a model fund's last call, it takes its policy decision instead of paying for another one.
- A policy-only run is fully determined by its seed. Each run stores a digest of its final prices and NAV path, so a rerun can be checked byte for byte.

## Models

| Provider | Models | Where |
|---|---|---|
| Anthropic | Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 | Live world and Research Lab |
| OpenRouter | GPT-6.1 Terra Pro, Gemini 3.8 Flash, Grok 4.7 | Research Lab only |

Prices and ids live in [`config/models.ts`](config/models.ts). Keys stay on the server; the browser never calls a model.

## Stack

| Layer | Technology |
|---|---|
| Engine | Pure TypeScript package with no I/O (`packages/engine`) |
| Server | Node, Express, Prisma 6 |
| Database | PostgreSQL |
| Frontend | React, Zustand, Tailwind CSS, Vite |
| Tests | Vitest |

## Repository structure

```
├── packages/engine/   # market, funds, policies, Director, memory, metrics, statistics
├── server/            # world loop, Research Lab API, model providers, paper exporter
├── src/               # observer UI: world, funds, activity, Research Lab, analytics
├── config/            # funds, models and world constants
├── prisma/            # database schema and migrations
├── scripts/           # study runner and paper exporter
├── paper/             # LaTeX source, pre-registration and the 42 study specs
└── docs/              # vision, architecture, decisions and working notes
```

## Get started

Docker is optional.

```bash
npm install
cp .env.example .env
```

Then run each of these in its own terminal:

```bash
npm run db:local
```

```bash
npm run db:migrate
npm run server:dev
```

```bash
npm run dev
```

`db:local` starts Postgres on port 5432 with its data in `.pgdata/`. With Docker, `npm run db:up` does the same job; run only one of them. `server:dev` starts the API and the always-on world on port 3001, and `dev` serves the observer UI on http://localhost:5173. Run `db:migrate` once, and again after pulling new migrations.

### Environment variables

| Variable | Without it | With it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Funds trade on their policies (decisions tagged `policy`). | Live funds decide with Claude Opus 5.5, capped at 2 USD per fund per day and 10 USD per day. Watch `LlmCallLog` cost on the first run. |
| `OPENROUTER_API_KEY` | Lab experiments cannot use OpenAI, Google or xAI models. | The Research Lab can give a fund an OpenRouter model. The live world stays on Anthropic. |
| `LAB_ADMIN_TOKEN` | The Research Lab is view only. | Enter the token in Research Lab → + NEW to run experiments. |
| `DIRECTOR_MODE` | `rule` | `none` turns the Director off. `jev` is a stub. |
| `JWT_SECRET`, `WORLD_SEED` | Ephemeral secret, default seed | Fixed values |

## Running the study

```bash
npm run study:run
```

Without flags this is a dry run: it checks every spec in `paper/study/` against the lab's rules and prints the worst-case cost (793.92 USD over 42 experiments; the hard cap is the 804 USD sum of per-experiment budgets). It refuses to run if the pre-registration or any spec has uncommitted changes. Add `--confirm`, with `LAB_ADMIN_TOKEN` set and the server running, to submit. Submission resumes by name after a failure.

```bash
npm run paper:export
```

This writes `paper/data/study.csv`, `paper/data/failed.csv`, and the tables and SVG figures the paper includes. Every output carries the ids and config hashes of the experiments it came from. The compiled PDF is not committed; build it from `paper/main.tex`.

## Checks

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

## Inspiration

Black Sheep borrows its scope from [Emergence World](https://github.com/EmergenceAI/Emergence-World) (persistent agents compared across models) and [napole0n.ai](https://napole0n.ai/) (agents with different strategies competing in one arena). The paper follows the structure of Faldor, Singh and Raileanu's [Minecraft report](https://arxiv.org/abs/2610.22319). The companies, funds and market are fictional, and nothing here says anything about trading real money.

## Citation

```bibtex
@misc{blacksheep2026,
  title  = {Black Sheep: a controlled laboratory for AI hedge funds},
  author = {{Black Sheep project}},
  year   = {2026},
  url    = {https://github.com/PranavJha-3000/Black-Sheep}
}
```
