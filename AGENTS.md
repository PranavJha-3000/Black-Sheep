# AI Working Agreement

You are an AI coding agent working in this repository.

The goal is not maximum speed. Every change must be understandable, reviewable, reversible, and verified.

## Project Context

All AI working documents live in `docs/ai/`.

Before meaningful work, read:

1. `docs/ai/HANDOVER.md`
2. `docs/ai/CONSTRAINTS.md`
3. `docs/ai/ARCHITECTURE.md`
4. Relevant sections of `docs/ai/FLOW.md`
5. Relevant `features/` or `bugs/` files

If a required file does not exist, create it from `docs/ai/TEMPLATES.md`.

## Plan First

For anything beyond a trivial one-line fix:

- Inspect the relevant code and documentation.
- Explain the problem.
- Identify files to change.
- Identify the affected execution flow.
- State the approach and at least one rejected alternative.
- State risks.
- State exact verification steps.
- STOP and wait for approval.

Do not implement while presenting the plan unless explicitly told to `plan and implement`.

## Scope

One logical change per request.

Do not:

- Refactor unrelated code.
- Rename unrelated code.
- Perform opportunistic cleanup.
- Add unrequested features.
- Modify unrelated files.

If additional work is discovered, record it in `docs/ai/HANDOVER.md` instead.

## Constraints

`docs/ai/CONSTRAINTS.md` is authoritative.

Never:

- Add dependencies without approval.
- Modify secrets or CI configuration without approval.
- Modify migrations without approval.
- Change public API signatures without approval.
- Delete tests to make a build pass.
- Rewrite code you do not understand.

If a request conflicts with a constraint, STOP.

## Implementation

- Follow existing patterns in the codebase.
- Make the smallest coherent change.
- Comment intent, not obvious syntax.
- Do not introduce unnecessary abstractions.
- Do not silently change architecture.

## Verification

A change is not complete because it looks correct.

Run the relevant commands in `docs/ai/TEST-CHECKLIST.md`.

Never claim something works or is fixed unless it was actually verified.

Clearly report:

- Commands run and their results.
- Tests that passed or failed.
- Anything that could not be verified.

## Diff Review

After implementation, inspect the actual Git diff.

Check for:

- Unrelated changes.
- Accidental deletions.
- Scope creep.
- Missing tests.
- Unexpected files.
- Documentation that should have been updated.

Never substitute an AI-generated summary for reviewing the diff.

## Documentation

Maintain `docs/ai/` during the work:

- `HANDOVER.md` — current project state.
- `DECISIONS.md` — meaningful decisions and reasoning.
- `FLOW.md` — execution paths that changed.
- `ARCHITECTURE.md` — structural changes only.
- `CONSTRAINTS.md` — never modify without explicit authorization.
- `TEST-CHECKLIST.md` — permanent verification requirements.
- `ROLLBACK.md` — risky changes.
- `features/` — feature progress.
- `bugs/` — bug investigation, including failed attempts.

## Risky Changes

Before a large, risky, data-affecting, difficult-to-reverse change, or a change affecting more than three files, create the rollback plan in `docs/ai/ROLLBACK.md`.

## Core Workflow

**Read → Understand → Plan → Approval → Implement → Verify → Review Diff → Document → Handover**

The AI must not treat approval of one change as permission to modify adjacent code.

The human must retain the mental model of what the code does. Documentation supports understanding; it does not replace it.