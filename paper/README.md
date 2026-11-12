# Paper outputs

The study is pre-registered in `PREREGISTRATION.md` with the specs in `paper/study/*.json`: tag `prereg-v1` (commit 9b18473), amended once in tag `prereg-amend-1` (commit adc4636).

`npm run paper:export` reads the done and failed experiments whose name matches a committed `paper/study/*.json` spec and whose stored `configHash` equals that spec's as parsed today. Other `study:*` experiments are listed as ignored; a same-named experiment with another `configHash` stops the export (exit 1). It writes, overwriting:

- `paper/data/study.csv` — one row per fund-run, including the five `behaviour_*` values
- `paper/data/failed.csv` — every failed study experiment with its error
- `paper/tables/<H>.tex` and `paper/figures/<H>-forest.svg` — one per hypothesis
- `paper/figures/H1-returns.svg` — mean NAV path per arm
- `paper/tables/H4.tex` — H4 return difference per USD, from the H1 experiments

Every table and figure starts with a `exp=<ids> cfg=<hashes>` provenance tag. The generated outputs are committed only from the real study, never from test runs.
