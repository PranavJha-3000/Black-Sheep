# Paper outputs

`npm run paper:export` reads every finished `study:*` experiment from the database and writes, overwriting:

- `paper/data/study.csv` — one row per fund-run
- `paper/tables/<H>.tex` and `paper/figures/<H>-forest.svg` — one per hypothesis
- `paper/figures/H1-returns.svg` — mean NAV path per arm

Every table and figure starts with a `exp=<ids> cfg=<hashes>` provenance tag. The generated outputs are committed only from the real study, never from test runs.
