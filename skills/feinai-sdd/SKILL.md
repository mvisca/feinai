---
name: feinai-sdd
description: Use when working in spec-driven development (SDD) workflows that involve brainstorming, writing-plans, or subagent-driven-development AND the project has a `\.feinai/feinai.db` file. Replaces creating markdown files in `docs/superpowers/specs/` and `docs/superpowers/plans/` with atomic `feinai` CLI calls, keeping state queryable, race-free, and audit-logged. Also use when the user asks to create a spec, add a task, claim work, or mark progress.
---

# feinai SDD integration

`feinai` is a CLI + local SQLite database for managing specs, plans, and tasks in
SDD workflows. When a project has `\.feinai/feinai.db`, you should write to that
database instead of producing markdown files under `docs/superpowers/`.

This skill extends superpowers — it does not replace it. You still follow the
SDD process (brainstorming → writing-plans → subagent-driven-development); you
just change *where the artifacts get stored*.

---

## When to use this skill

Invoke when **all** of the following are true:

1. The project has a `\.feinai/feinai.db` file (walk up the directory tree from
   the current working directory; feinai uses the same discovery pattern as git).
   Check with: `feinai status` (exit code 0 = feinai is set up).
2. You are about to:
   - Write a spec via the `brainstorming` skill, OR
   - Write a plan via the `writing-plans` skill, OR
   - Execute tasks via `subagent-driven-development` or `executing-plans`, OR
   - The user explicitly mentions creating/claiming/marking tasks or specs.

If `\.feinai/feinai.db` does not exist, skip this skill — let superpowers do its
normal markdown-based flow.

---

## Detection (do this first)

Before any spec / plan / task write, run:

```bash
feinai status 2>/dev/null
```

- Exit code 0: feinai is active in this project → use this skill.
- Exit code 2: `No \.feinai/feinai.db found` → fall back to vanilla superpowers
  (or ask the user `feinai init` if it seems intended).
- Command not found: feinai is not installed or not on PATH. Tell the user:

  > `feinai` is not found. Install it with:
  > ```bash
  > bun install -g feinai
  > ```
  > Full documentation and setup guide: https://www.npmjs.com/package/feinai
  >
  > If already installed but not found in this shell context (non-interactive SSH), see the PATH setup section in the docs above.

  Stop and wait for the user to confirm it's fixed before continuing.

---

## Phase 1 — Brainstorming → `feinai spec add`

When `brainstorming` would write to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`,
instead create a spec entry in feinai with the same content.

**Spec ID convention:** `SPEC-NNN` where `NNN` is the next free integer.
Find the next number with:

```bash
feinai spec list --json | jq -r '.[].numero' | sort -n | tail -1
```

(or just inspect the list — the next number is `max + 1`.)

### Pattern — create the spec

Use stdin for the markdown content to avoid quoting issues:

```bash
feinai spec add SPEC-042 "Short title" --stdin <<'FEINAI_EOF'
# SPEC-042: Short title

## Goal
One sentence describing what this builds.

## Architecture
2-3 sentences about approach.

## Components
- ...

## Tests
- ...
FEINAI_EOF
```

### What replaces what

| Superpowers step | feinai equivalent |
|---|---|
| `Write(docs/superpowers/specs/YYYY-MM-DD-X-design.md, ...)` | `feinai spec add SPEC-NNN "title" --stdin <<<` content |
| Spec self-review (re-read the markdown) | `feinai spec content SPEC-NNN` (returns the markdown) |
| User reviews written spec | Same — but they can also use `feinai server` and open the dashboard |
| Refining the spec | `feinai spec set-content SPEC-NNN --stdin <<<` updated content |

---

## Phase 2 — Writing-plans → `feinai plan add` + `feinai add`

When `writing-plans` would write a plan file with checkbox tasks, do **two**
things in feinai:

1. **Store the plan markdown** for the human/agent reference.
2. **Create individual tasks** as structured rows so subagents can claim them.

### Pattern — store the plan

```bash
feinai plan add SPEC-042 --stdin <<'FEINAI_EOF'
# Implementation plan for SPEC-042

## Architecture
...

## Task breakdown
- TASK-042-A: schema (touches packages/auth)
- TASK-042-B: routes (depends on A)
- TASK-042-C: tests (depends on A, B)
FEINAI_EOF
```

Plans are versioned automatically; `feinai plan add` always creates a new
version (`v1`, `v2`, ...). Use this when refining a plan after review.

### Pattern — create each task

For every numbered task in the plan, create a row. Pass the task's workplan
markdown as `--desc`:

```bash
feinai add TASK-042-A "Create auth schema" \
  --spec SPEC-042 \
  --desc "Define Drizzle schema for users table with email, password_hash, refresh_token columns. See specs/042-auth for column types." \
  --package "@app/auth" \
  --gate "pnpm --filter @app/auth typecheck" \
  --gate "pnpm --filter @app/auth test -- --run"

feinai add TASK-042-B "Add auth routes" \
  --spec SPEC-042 \
  --desc "POST /auth/login, POST /auth/refresh, POST /auth/logout. Validate via TypeBox." \
  --package "@app/auth" \
  --gate "pnpm --filter @app/auth typecheck" \
  --gate "pnpm --filter @app/auth test -- --run" \
  --blocked-by TASK-042-A

feinai add TASK-042-C "Integration tests" \
  --spec SPEC-042 \
  --desc "End-to-end flow: register → login → refresh → logout." \
  --package "@app/auth" \
  --gate "pnpm --filter @app/auth test -- --run" \
  --blocked-by TASK-042-A \
  --blocked-by TASK-042-B
```

### Why each task lives in feinai instead of a checkbox in markdown

A subagent claiming `TASK-042-A` calls `feinai take TASK-042-A` and gets, in a
single response, the full payload: `description` (workplan), `quality_gates`,
`packages`, `blocked_by`. **The subagent never has to read the plan markdown.**

This is the single biggest token saving and the strongest correctness
guarantee from using feinai: each subagent's context contains exactly the task
it's executing, nothing else.

---

## Phase 3 — Subagent-driven-development → `feinai take` + `feinai done`

When dispatching subagents, instruct each one to:

1. Call `feinai take TASK-XXX` to atomically claim the task.
2. Use the returned JSON for everything it needs:
   - `description` — workplan
   - `packages` — what to touch
   - `quality_gates` — what to verify
   - `spec_id` — context if needed (`feinai spec content SPEC-XXX`)
3. Run the gates and write the code.
4. Call `feinai done TASK-XXX --result "typecheck ✓ lint ✓ test ✓"` (or
   `feinai fail TASK-XXX --error "..."` if gates fail).

### Subagent prompt template

When you dispatch a subagent for a task, include this in its prompt:

> Your task is `TASK-XXX`. Begin by running `feinai take TASK-XXX`. The command
> returns a JSON object with the full task description, packages to touch, and
> quality gates to run. Use only that payload — do not read the plan markdown.
>
> When you finish the implementation and the quality gates pass, run
> `feinai done TASK-XXX --result "<gates summary>"`. If the gates fail and you
> cannot resolve, run `feinai fail TASK-XXX --error "<short reason>"` and stop.
>
> You are operating in a worktree at `<path>`. Do not switch branches.

### Choosing the next task

To find the next task that is **pending** and has no unresolved blockers:

```bash
feinai list --pending --json
```

In JSON output, filter for tasks whose `blocked_by` array is empty or whose
blockers are all `completed`. Then `feinai take <id>`.

Atomic `take` means: if you and another agent both call `feinai take TASK-X` at
the same time, exactly one of you gets the task and the other gets an error.
You can dispatch parallel subagents safely.

### Marking the spec done

When all tasks for a spec are `completed`, mark the spec done:

```bash
feinai spec done SPEC-042 --pr 123 --merged 2026-06-05
```

---

## Visibility for the human

The user can watch progress live by running `feinai server` in another terminal
and opening `http://127.0.0.1:8272` in a browser. The dashboard streams events
via SSE, so they see takes / dones / fails as they happen.

If you anticipate the user will want to monitor a long-running multi-task
workflow, suggest this once at the start of the session.

---

## Common pitfalls

### ❌ Don't read the plan markdown to find tasks

If you've created tasks via `feinai add`, **never** re-read the plan to figure
out what to do next. Use `feinai list --pending --json`. The plan is the
human-readable rationale; the tasks are the executable state.

### ❌ Don't create `docs/superpowers/specs/*.md` files

If feinai is active, those files become a source of drift. The spec lives in
the database. If you need to publish the spec elsewhere (PR description, wiki,
etc.), export it on demand: `feinai spec content SPEC-X > /tmp/spec.md`.

### ❌ Don't skip `feinai take` and just read the task

`feinai show TASK-X` is read-only and does **not** claim the task. Two
subagents that both `show` then act will collide. Always `feinai take`.

### ❌ Don't try to write to the SQLite file directly

The CLI handles concurrency, audit logging, and validation. Direct SQL
mutations bypass the events table and leave the audit log incomplete.

### ✅ Do set `FEINAI_USER` for explicit subagent identity

When dispatching a subagent, pass `FEINAI_USER=subagent-N` in its environment
so the audit log distinguishes which subagent did what. Otherwise the actor
field will read `bun:<pid>:<user>` for everyone.

---

## Quick reference

| Need | Command |
|---|---|
| Is feinai set up here? | `feinai status` |
| Next pending task | `feinai list --pending --json` |
| Claim a task atomically | `feinai take TASK-X` |
| Read a spec | `feinai spec content SPEC-X` |
| Read the latest plan | `feinai plan show SPEC-X` |
| Create spec from stdin | `feinai spec add SPEC-X "title" --stdin <<<` markdown |
| Update spec content | `feinai spec set-content SPEC-X --stdin <<<` markdown |
| Add a plan version | `feinai plan add SPEC-X --stdin <<<` markdown |
| Create task | `feinai add TASK-X "subject" --spec SPEC-X --desc "..." --gate "..." --package "..." [--blocked-by TASK-Y]` |
| Mark task done | `feinai done TASK-X --result "..."` |
| Mark task failed | `feinai fail TASK-X --error "..."` |
| Mark spec done | `feinai spec done SPEC-X --pr N --merged DATE` |
| Live dashboard | `feinai server` then open `http://127.0.0.1:8272` |

---

## Relationship to superpowers skills

This skill is **additive**. The superpowers skills (`brainstorming`,
`writing-plans`, `subagent-driven-development`, etc.) still run; they still
own the process. feinai only changes the storage of the artifacts they produce.

If you start brainstorming and discover the project has no feinai DB, fall back
to the normal superpowers behavior (markdown files). Do not silently switch
storage strategy mid-project.
