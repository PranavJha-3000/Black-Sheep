# FEATURE-016 · Stage 10 research study, Phase 4: paper pipeline
Status: built on branch `feat/stage10-research-study` (unmerged); the study has NOT been run (Gate G2 open), the PDF has NOT been compiled

## Scope
In:
- `server/paperCore.ts` + `scripts/export-paper.ts` (`npm run paper:export`): study rows, paired contrasts, H4, CSV, TeX tables, SVG figures
- `server/studyPlan.ts` + `scripts/run-study.ts` (`npm run study:run`): plan guard, git pre-registration check, `--confirm`, resumable submission
- `paper/PREREGISTRATION.md` (with Amendment 1) and `paper/study/*.json` (42 experiments)
- `paper/main.tex`, `paper/refs.bib`: skeleton; Environment, Agents and brains, Protocol and Reproducibility written from code
- Additive `GET /lab/experiments?name=` filter

Out (later phases):
- The study run itself (G2), arXiv submission (G3), Results/Behaviour/Cost narrative (needs data)
- Phase 5 other providers

## Plan
Full plan: `docs/superpowers/plans/` (research study, Phase 4)
- [x] Tasks 4-6: exporter, plan guard and runner, pre-registration and specs
- [x] Task 7: paper skeleton and docs

## Decisions
D-045 (and D-044 for the behaviour metric definitions the paper quotes)

## Verification
`npm test` (count in the Task 7 report). The TeX skeleton passed a script check of brace, environment and citation balance.
Not verified: PDF compilation (no TeX toolchain; figures need `-shell-escape` and Inkscape); a real export (no study data); a keyed run (G2, G5).
