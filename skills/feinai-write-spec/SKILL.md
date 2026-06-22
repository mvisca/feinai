---
name: feinai-write-spec
description: Use when the user wants to design a new feature, refactor, or change in a project that has `.feinai/feinai.db`. With no argument, runs the full pipeline (spec + plan + tasks). With a SPEC-ID argument, skips to task generation only (use when iterating on an existing plan). Replaces `brainstorming` + `writing-plans` + `feinai-write-tasks` from superpowers when feinai is active.
---

# feinai-write-spec

Full pipeline: spec → plan → tasks. One skill, two entry points.

## Entry point detection

**Check the first argument before doing anything else.**

- **No argument** → full pipeline (Phases 1–5)
- **SPEC-ID given** (e.g. `SPEC-42`) → tasks only, jump to **Phase 4**

Ask the user which mode only if ambiguous.

---

## Preconditions

Run `feinai status` (exit 0 = feinai is active). If not active, stop and ask the
user if they want `feinai init` or to fall back to vanilla superpowers.

---

## Phase 1 — Decide entry mode (full pipeline only)

Decide which entry mode applies BEFORE doing anything else. Ask the user only if ambiguous.

### Mode A — User has a clear idea
"Add X feature to do Y." → proceed to **Phase 2** directly.

### Mode B — User has no idea yet
"What should we build next?" → propose 2–4 candidate features derived from
BACKLOG.md, recent commits, or the project's stated goals. User picks one.
→ proceed to **Phase 2**.

### Mode C — User gives a tiny idea
"Add a search bar." → BEFORE expanding, ask: *"Quick scope check: do you want this
as a minimal change (just the input + endpoint call) or shall I think wider
(filters, debounce, empty states, mobile UX)?"* User picks. → proceed to **Phase 2**.

---

## Phase 2 — Load project context (full pipeline only)

Read **in this order, stop early if enough**:

1. `AGENTS.md` (root) — already in your context normally
2. `ARCHITECTURE.md` (root)
3. `README.md`
4. `decisions/` directory (just file names, read only if a name matches the topic)

If none exist or context is **insufficient or contradictory** for the spec at hand:

- **Ask the user** with a short, targeted questionnaire (3–6 questions max)
- Do not invent or assume. Do not guess architecture.
- If you have permission, offer to write/update `ARCHITECTURE.md` after the spec is done — but **only ask permission once**, not per file.

Keep this phase tight — every read costs tokens. Stop as soon as you can write the spec accurately.

---

## Phase 3 — Draft and write the spec + plan (full pipeline only)

### Spec (what and why — not how)

Required sections:
- **Goal** — one sentence
- **Problem / motivation** — why this exists
- **Scope** — what's in, what's out
- **Contracts** — API shapes, data model changes, UI invariants (whichever apply)
- **Tests required** — the behavioral cases that must pass

**Pick the next SPEC ID:**
```bash
feinai spec list --json | jq -r '.[].id' | grep -oE 'SPEC-[0-9]+' | sort -V | tail -1
# next = max + 1, or follow project convention if user gave one
```

**Write it atomically:**
```bash
feinai spec add SPEC-NNN "Short title" --stdin <<'FEINAI_EOF'
# SPEC-NNN: Short title

## Goal
...

## Problem
...

## Scope
- In: ...
- Out: ...

## Contracts
...

## Tests required
- ...
FEINAI_EOF
```

### Plan (how — architecture decisions, file map, dependencies)

Required sections:
- **Architecture overview** — 2–4 sentences
- **Files to touch** — explicit list
- **Task breakdown preview** — high-level (the actual tasks come in Phase 4)
- **Quality gates** — the commands that prove correctness

```bash
feinai plan add SPEC-NNN --stdin <<'FEINAI_EOF'
# Plan v1 — SPEC-NNN: Title

## Architecture overview
...

## Files to touch
- packages/X/...
- packages/Y/...

## Task breakdown preview
- TASK-NNN-A: <what>
- TASK-NNN-B: <what> (blocked by A)
- ...

## Quality gates
pnpm --filter @X typecheck
pnpm --filter @X test -- --run
FEINAI_EOF
```

---

## Phase 4 — Build the task graph

*Entry point when SPEC-ID is given as argument.*

### Step 1 — Load spec + plan

```bash
feinai spec show SPEC-NNN --full
```

Read both. Internalize:
- The WHAT (spec)
- The HOW (plan)
- The "Files to touch" list
- The "Task breakdown preview" — your starting point, not a contract

### Step 2 — Analyze granularity and parallelism

**A. Granularity** — one task = one logical change a single subagent can complete in one session.
- Too big: "implement the entire auth system" → split by route
- Too small: "add a single import" → merge into larger task
- Sweet spot: ~50–300 lines, 1–3 files

**B. Parallelism rule — no exceptions:**

> **Tasks that touch the same file cannot run in parallel.**

When a **shared file** needs changes (e.g. `router.ts`, `index.ts`, schema), extract it first:

```
TASK-NNN-0: edit shared file once
   ↓ blocks
TASK-NNN-1: feature A  ┐
TASK-NNN-2: feature B  ├ parallel
TASK-NNN-3: feature C  ┘
```

**C. Dependencies** — use `--blocked-by` for:
- File-level conflicts (above)
- Logical dependencies (B uses a type defined in A)

### Step 3 — Embed TDD instructions

Each implementation task description starts with:

```
## TDD baseline
Write the tests first based on the "Tests required" section of SPEC-NNN.
Run them — they must fail (the implementation doesn't exist yet).
Implement until all tests pass. Then run the quality gates.
```

No separate "write tests" tasks. Test + implementation live together.

**Exception:** if shared fixtures are needed across tasks, extract them into a tiny TASK-NNN-0 that others block on.

### Step 4 — Write the tasks

```bash
feinai add TASK-NNN-X "subject" \
  --spec SPEC-NNN \
  --desc "$(cat <<'EOF'
## TDD baseline
Write the tests first based on the "Tests required" section of SPEC-NNN.
Run them — they must fail. Implement until they pass.

## Files to touch
- packages/X/...
- packages/Y/...

## Implementation notes
<concrete, copy-pasteable details. Cite line numbers if useful.>

## Do not touch
- <files explicitly out of scope>
EOF
)" \
  --package "@scope/pkg" \
  --gate "pnpm --filter @scope/pkg typecheck" \
  --gate "pnpm --filter @scope/pkg test -- --run" \
  --blocked-by TASK-NNN-Y    # repeatable if needed
```

**Task description = self-contained.** The subagent reads only the task (via `feinai take`) and gets spec+plan as `spec_context` automatically.

---

## Phase 5 — Hand off

Output a parallelism summary table:

```
TASK-NNN-0: shared file edit            (sequential)
TASK-NNN-1: feature A                   (parallel with 2, 3) blocked-by 0
TASK-NNN-2: feature B                   (parallel with 1, 3) blocked-by 0
TASK-NNN-3: feature C                   (parallel with 1, 2) blocked-by 0
TASK-NNN-4: integration tests           (sequential)         blocked-by 1, 2, 3
```

Tell the user:
> Tasks written for SPEC-NNN. View with `feinai list --spec SPEC-NNN`.
> Next step: run `/feinai-dispatch SPEC-NNN` to execute.

---

## Key questions to ask (inline, only if needed)

- Ambiguity in scope: *"Do we include X in this spec or punt to a follow-up?"*
- Missing architecture decision: *"This needs a choice between A and B. Default is A unless you say otherwise."*
- Architecture gap: *"ARCHITECTURE.md doesn't cover X. Want me to add a note after the spec is done?"*

**Do not batch questions.** Ask one, get answer, move on. Most specs need 0–2 questions.

---

## What NOT to do

- ❌ Write `docs/superpowers/specs/*.md` files — spec lives in feinai
- ❌ Invent architecture if `ARCHITECTURE.md` is silent — ask the user
- ❌ Write spec content that is actually a plan (HOW). Keep them separated.
- ❌ Ask the user to confirm before writing — write spec/plan/tasks, then they review
- ❌ Re-think architecture in Phase 4 — it's in the plan, follow it
- ❌ Write tasks without a SPEC-ID — every task must have `--spec SPEC-NNN`
- ❌ Skip the same-file analysis — it's the single biggest cause of merge conflicts
- ❌ Hardcode worktree paths — `feinai-dispatch` assigns those at execution time

---

## Subagent isolation

If you delegate spec drafting to a subagent, the subagent must NOT use this skill. Hand it concrete findings and let it return text; you write to feinai yourself.

---

## Quick reference

| Need | Command |
|---|---|
| Next free SPEC ID | `feinai spec list --json \| jq -r '.[].id'` |
| Write spec | `feinai spec add SPEC-N "title" --stdin <<<` content |
| Update spec content | `feinai spec set-content SPEC-N --stdin <<<` content |
| Write plan | `feinai plan add SPEC-N --stdin <<<` content |
| Show spec+plan together | `feinai spec show SPEC-N --full` |
| List tasks for spec | `feinai list --spec SPEC-N` |
| Add task | `feinai add TASK-X "subject" --spec SPEC-N --desc "..." --gate "..." [--blocked-by TASK-Y]` |
| Edit task | `feinai task edit TASK-X --desc "..." --gate "..."` |
