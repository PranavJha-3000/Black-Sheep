# Pre-registration

This file is committed before any study run. Its commit is the pre-registration timestamp. The study specs it governs are `paper/study/*.json`, committed alongside it.

## Hypotheses

- **H1 (cross-model).** For subject fund `crown-meridian`, arms are policy vs Haiku 5.5 vs Sonnet 5.5 vs Opus 5.5. Each model is its own experiment pair (policy vs model).
- **H2 (memory).** The subject is on Haiku 5.5, with arms memory none / episodic / reflective / full. Baseline: none.
- **H3 (Director).** The subject is on Haiku 5.5, with directorMode none vs rule.
- **H4 (cost vs quality).** Derived from H1: mean paired return difference per $ spent.

## Metrics

- **Primary metric:** paired total-return difference vs the hypothesis baseline.
- **Secondary metrics:** Sharpe, max drawdown, survival, fallback rate, $/decision, and the five behaviour metrics.

## Protocol

- Seeds 1–20, in blocks of 5 (`s1` = 1–5 … `s4` = 16–20).
- Horizon: 500 ticks.
- `decisionEveryTicks`: 10.
- All three funds are present; only the subject has a model brain.

### Actual block layout

Each experiment must fit the $25 per-experiment cap at worst case. Blocks of 5 seeds fit for H1 Haiku, H2 and H3. They do not fit for H1 Sonnet or H1 Opus, so those models use smaller blocks (the same layout for every file of that model). Seeds 1–20 and every other setting are unchanged.

| Experiments | Block size | Blocks | Worst case per file |
|---|---|---|---|
| H1 Haiku (`study:H1:haiku:s1`–`s4`) | 5 | `s1` = 1–5 … `s4` = 16–20 | $2.96 |
| H1 Sonnet (`study:H1:sonnet:s1`–`s10`) | 2 | `s1` = 1–2, `s2` = 3–4 … `s10` = 19–20 | $23.70 |
| H1 Opus (`study:H1:opus:s1`–`s20`) | 1 | `s1` = 1, `s2` = 2 … `s20` = 20 | $23.70 |
| H2 memory (`study:H2:memory:s1`–`s4`) | 5 | `s1` = 1–5 … `s4` = 16–20 | $11.85 |
| H3 Director (`study:H3:director:s1`–`s4`) | 5 | `s1` = 1–5 … `s4` = 16–20 | $5.92 |

Base for every file: funds `sterling-vale`, `halden-whitmore`, `crown-meridian`; directorMode `rule` (unless it is the variable); memory `none` (unless it is the variable); `decisionEveryTicks` 10; 500 ticks. H1 base brains are `{}` and its first arm is the all-policy arm `{}`. `budgetUsd` is each file's own worst-case estimate rounded up to the next dollar.

## Statistics

Paired bootstrap 95% CI (2000 iterations, seeded); exact sign test; Holm within each hypothesis; α = 0.05.

## Exclusions

None. Every finished experiment is reported, and failed ones are listed with their error.

## Budget

Each experiment is ≤ $25. The worst-case total is printed by `study:run`, and the user approves it before `--confirm`.
