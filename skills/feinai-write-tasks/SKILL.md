---
name: feinai-write-tasks
description: Use when a spec + plan already exist in feinai (written by `feinai-write-spec` or manually) and need to be broken down into executable tasks. Decomposes the plan into atomic `feinai add` calls, analyzes file-level parallelism, and embeds TDD instructions. Output: a set of tasks with `blocked_by` dependencies ready for `feinai-dispatch` to execute.
---

# feinai-write-tasks

Read an existing spec + plan from feinai, produce the executable task set.

## Preconditions

1. `feinai status` must succeed
2. The spec must exist: `feinai spec show SPEC-NNN` returns content
3. A plan must exist: `feinai plan show SPEC-NNN` returns content

If any fails: stop. Tell the user to run `feinai-write-spec` first.

## Input

User invokes you with a SPEC-ID. If they don't, ask: *"Which SPEC-ID? (e.g. SPEC-121-B)"*.

## The flow

### Step 1 — Load spec + plan

```bash
feinai spec show SPEC-NNN --full
```

That single command returns spec + latest plan. Read both. Internalize:
- What the spec says (the WHAT)
- What the plan says (the HOW)
- The "Files to touch" list in the plan
- The "Task breakdown preview" in the plan — your starting point, not a contract

### Step 2 — Build the task graph

For each unit of work in the plan, decide:

**A. Granularity** — One task per logical change. Rule of thumb: a task is the unit of work a single subagent can complete in one session. Split if too big, merge if too small.

**B. Parallelism** — Apply this rule, no exceptions:

> **Tasks that touch the same file cannot run in parallel.**
> Tasks in disjoint files can.

When the plan requires changes to a **shared file** (e.g. `router.ts`, `index.ts`, a schema file), split it:

```
TASK-NNN-0: edit shared file once (e.g. add all new routes to router.ts)
   ↓ blocks
TASK-NNN-1: implement feature A (controller, service)  ┐
TASK-NNN-2: implement feature B (controller, service)  ├ parallel
TASK-NNN-3: implement feature C (controller, service)  ┘
```

The shared-file task goes first, sequentially. The rest parallelize.

**C. Dependencies** — Use `--blocked-by` to encode:
- File-level conflicts (above)
- Logical dependencies (B uses a type defined in A)
- Test tasks that need implementation tasks first (only if separated — see TDD below)

### Step 3 — Embed TDD instructions

Each implementation task description starts with this fixed paragraph:

```
## TDD baseline
Write the tests first based on the "Tests required" section of SPEC-NNN.
Run them — they must fail (the implementation doesn't exist yet).
Implement until all tests pass. Then run the quality gates.
```

No separate "write tests" tasks. Test + implementation live together. The
agent writes tests first because the description tells it to, and the quality
gates verify the tests pass.

**Exception:** if tests for one task need fixtures shared with other tasks,
extract the fixtures into a tiny TASK-NNN-0 that other tasks block on.

### Step 4 — Write the tasks

For each task:

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
  --blocked-by TASK-NNN-Y    # if applicable, repeatable
```

**Task description = self-contained.** The subagent reads only the task (via
`feinai take`) and gets spec+plan as `spec_context` automatically. It does NOT
need to read external files for context.

### Step 5 — Annotate parallelism for dispatch

After writing all tasks, output a summary table to the user:

```
TASK-NNN-0: shared file edit            (sequential)
TASK-NNN-1: feature A                   (parallel with 2, 3) blocked-by 0
TASK-NNN-2: feature B                   (parallel with 1, 3) blocked-by 0
TASK-NNN-3: feature C                   (parallel with 1, 2) blocked-by 0
TASK-NNN-4: integration tests           (sequential)         blocked-by 1, 2, 3
```

This summary tells the user (and `feinai-dispatch`) which tasks parallelize.

### Step 6 — Hand off

Tell the user:
> Tasks written for SPEC-NNN. View with `feinai list --spec SPEC-NNN`.
> Next step: run `/feinai-dispatch SPEC-NNN` to execute.

---

## Important rules

### Same-file rule (the only parallelism check that matters)

If two pending tasks would write to the same path, they must have a `blocked_by`
relationship — direct or via a common dependency. This is the only rule the
subagents need to trust about safety.

If a task touches MANY files (e.g. a refactor across the codebase), it does NOT
parallelize with anything in those files. Mark it sequential by giving it no
parallel siblings.

### Granularity guardrails

- Too big: "implement the entire auth system" — split by route
- Too small: "add a single import" — merge into the larger task
- Sweet spot: ~50–300 lines of changes, 1–3 files (or a single file for shared)

### What goes in description vs gates

- **description** — what to do, what to read, what to write, TDD baseline, exclusion list
- **quality_gates** — the verification commands. Subagent runs them; if they pass, calls `feinai done`.

If a gate is project-wide (e.g. `pnpm -r typecheck`), keep it. If it's local
to the task's package, scope it (`pnpm --filter @x typecheck`) so failures
don't cascade across unrelated work.

---

## What NOT to do

- ❌ Re-think architecture — it's in the plan, follow it
- ❌ Write tasks without a SPEC-ID — every task must have `--spec SPEC-NNN`
- ❌ Skip the same-file analysis — it's the single biggest cause of merge conflicts
- ❌ Put "and also fix X" in a task — one task, one change
- ❌ Hardcode worktree paths — `feinai-dispatch` assigns those at execution time

---

## Quick reference

| Need | Command |
|---|---|
| Load spec + plan in one call | `feinai spec show SPEC-N --full` |
| List existing tasks for spec | `feinai list --spec SPEC-N` |
| Add task | `feinai add TASK-X "subject" --spec SPEC-N --desc "..." --gate "..." [--blocked-by TASK-Y]` |
| Edit task after writing | `feinai task edit TASK-X --desc "..." --gate "..."` |
