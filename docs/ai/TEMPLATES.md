# Document Templates

Starter shapes for the files in `docs/ai/`. Create each one empty-but-structured on day one —
a missing file gets ignored, a stub file gets filled in.

---

## HANDOVER.md

```markdown
# Handover

## Current state
- Working: <what's stable>
- In progress: <what's half-done and where it stops>
- Broken: <known failures, with the error>
- Avoid: <landmines — files, flows, or approaches that waste time>

## Open items
- [ ] <deferred cleanups, noticed-but-not-fixed things>

## Log

### YYYY-MM-DD · <model version>
Did:
Left:
Watch:
Next:
Verified:
```

---

## DECISIONS.md

```markdown
# Decisions

### D-001 · YYYY-MM-DD · <model version>
**Decision:** <what was chosen>
**Context:** <what forced a choice>
**Reasoning:** <why this one>
**Rejected:** <alternatives, and the specific reason each lost>
**Tradeoff accepted:** <what we knowingly gave up>
**Revisit if:** <the condition that would make this wrong>
```

Never edit a past entry. Supersede it with a new one that references the old ID.

---

## FLOW.md

```markdown
# Execution Flow

## <Flow name, e.g. "User login">
Entry: <file:function>

1. `auth/routes.ts → handleLogin()` — validates payload
2. `auth/service.ts → verifyCredentials()` — hits the user store
3. `session/issue.ts → issueToken()` — signs and sets cookie

Assumptions: <what must already be true for this path to work>
Side effects: <writes, emits, external calls>
Fragile: <where this has broken before>
```

Document the flows you actually touch. A partial, accurate map beats a complete, stale one.

---

## ARCHITECTURE.md

```markdown
# Architecture

## Modules
| Module | Responsibility | Talks to |
|---|---|---|

## Data movement
<where data enters, where it's stored, where it leaves>

## Boundaries
<what must not know about what>
```

Shape, not implementation. If it needs updating on a normal feature change, it's too detailed.

---

## CONSTRAINTS.md

```markdown
# Constraints

The AI must never:
- Touch <module> without explicit approval
- Add a dependency without asking
- Modify migrations, secrets, or CI config
- Change public API signatures
- Refactor code outside the scope of the current request
- Delete tests to make a build pass

The AI must always:
- Use <pattern> for data access
- Write tests for new branching logic
- Keep changes under ~<N> files per request
```

You own this file. The AI reads it and never edits it.

---

## TEST-CHECKLIST.md

```markdown
# Test Checklist

Run before any change counts as done.

| # | Command | Expected |
|---|---|---|
| 1 | `npm run typecheck` | exits 0, no errors |
| 2 | `npm test` | all pass, N tests |
| 3 | `npm run lint` | no new warnings |
| 4 | <manual check> | <specific observable result> |

## Task-specific
<checks that only apply to the current area of work>
```

Actual commands and actual expected outputs. "Looks fine" is not a checklist item.

---

## ROLLBACK.md

```markdown
# Rollback

## <change name> · YYYY-MM-DD
Safe commit: `<sha>`
Revert with: `git revert <sha>` / `git checkout <sha> -- <paths>`
Files touched: <list>
Non-code changes to undo: <migrations, config, feature flags, cached data>
Re-check after rollback: <checklist items to re-run>
```

Written *before* the risky change, not after it goes wrong.

---

## bugs/BUG-<id>.md

```markdown
# BUG-001 · <short title>
Status: open | fixed | won't fix
Found: <how it surfaced, YYYY-MM-DD>

## Symptom
<observable behavior, exact error text>

## Reproduction
1.

## Path
<relevant flow from FLOW.md, and where it diverges from expected>

## Attempts
| # | Hypothesis | What was tried | Result |
|---|---|---|---|
| 1 |  |  | didn't fix it — <why> |

## Fix
<what worked, and why the earlier attempts didn't>

## Verification
<commands run, output observed>
```

Log the dead ends. They're the part nobody can reconstruct later.

---

## features/FEATURE-<id>.md

```markdown
# FEATURE-001 · <short title>
Status: scoping | in progress | shipped

## Scope
In: <what this includes>
Out: <what it explicitly does not>

## Plan
- [ ] Step 1
- [ ] Step 2

## Decisions
<references to DECISIONS.md IDs>

## Verification
<how we know it's done>
```
