---
name: feinai-write-spec
description: Use when the user wants to design a new feature, refactor, or change in a project that has `.tasca/tasca.db`. Writes a complete spec + plan into tasca in a single session. Replaces `brainstorming` + `writing-plans` from superpowers when feinai is active. Reads project context (CLAUDE.md, ARCHITECTURE.md, README.md), asks clarifying questions only when context has gaps, and produces spec+plan atomically with one `feinai spec add` + one `feinai plan add`.
---

# feinai-write-spec

Write a spec + plan for a feature in one session. Output goes to tasca, not markdown files.

## Preconditions

Run `feinai status` (exit 0 = tasca is active). If not active, stop and ask the
user if they want `feinai init` or to fall back to vanilla superpowers.

## The flow — three entry modes

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

## Phase 1 — Load project context

Read **in this order, stop early if enough**:

1. `CLAUDE.md` (root) — already in your context normally
2. `.claude/ARCHITECTURE.md` or `ARCHITECTURE.md` (root)
3. `README.md`
4. `decisions/` directory (just file names, read only if a name matches the topic)

If none exist or context is **insufficient or contradictory** for the spec at hand:

- **Ask the user** with a short, targeted questionnaire (3–6 questions max)
- Do not invent or assume. Do not guess architecture.
- If you have permission, offer to write/update `ARCHITECTURE.md` after the spec is done — but **only ask permission once**, not per file.

Keep this phase tight — every read costs tokens. Stop as soon as you can write the spec accurately.

---

## Phase 2 — Draft and write the spec

**Spec answers: what and why.** Not how.

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

---

## Phase 3 — Draft and write the plan

**Plan answers: how.** Architecture decisions, file map, dependencies.

Required sections:
- **Architecture overview** — 2–4 sentences
- **Files to touch** — explicit list
- **Task breakdown preview** — high-level (the actual tasks are written by `feinai-write-tasks`)
- **Quality gates** — the commands that prove correctness

**Write the plan:**
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

## Phase 4 — Hand off

Tell the user:
> Spec + plan written: SPEC-NNN. View with `feinai spec show SPEC-NNN --full`.
> Next step: run `/feinai-write-tasks SPEC-NNN` to break it down into executable tasks.

Do NOT create tasks here. That's `feinai-write-tasks`. One responsibility per skill.

---

## Key questions to ask (during, only if needed)

These come up mid-session. Ask them inline, one at a time, brief:

- Ambiguity in scope: *"Do we include X in this spec or punt to a follow-up?"*
- Missing architecture decision: *"This needs a choice between A and B. Default is A unless you say otherwise."*
- Architecture gap: *"ARCHITECTURE.md doesn't cover X. Want me to add a note after the spec is done?"*

**Do not batch questions.** Ask one, get answer, move on. Most specs need 0–2 questions.

---

## What NOT to do

- ❌ Write `docs/superpowers/specs/*.md` files — spec lives in feinai
- ❌ Create tasks in this skill — that's `feinai-write-tasks`
- ❌ Invent architecture if `ARCHITECTURE.md` is silent — ask the user
- ❌ Write spec content that is actually a plan (HOW). Keep them separated.
- ❌ Ask the user to confirm before writing — write the spec, then they review with `feinai spec show`

---

## Subagent isolation

If you delegate the spec drafting to a subagent (e.g. for parallel research),
the subagent must NOT use this skill — it has no context. Hand it concrete
findings and let it return text; you write to tasca yourself.

---

## Quick reference

| Need | Command |
|---|---|
| Next free SPEC ID | `feinai spec list --json \| jq -r '.[].id'` |
| Write spec | `feinai spec add SPEC-N "title" --stdin <<<` content |
| Update spec content | `feinai spec set-content SPEC-N --stdin <<<` content |
| Write plan | `feinai plan add SPEC-N --stdin <<<` content |
| Show spec+plan together | `feinai spec show SPEC-N --full` |
