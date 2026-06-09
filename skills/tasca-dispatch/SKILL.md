---
name: tasca-dispatch
description: Use when tasks exist in tasca for a spec and need to be executed. Dispatches subagents to claim and complete tasks, enforces worktree isolation, handles parallelism (sequential or parallel based on user choice), and resolves merge conflicts and failures by blocking the loop until repair completes. Replaces `subagent-driven-development` from superpowers when tasca is active.
---

# tasca-dispatch

Execute the pending tasks of a SPEC. One responsibility: dispatch subagents in worktrees, integrate their output, handle failures.

## Preconditions

1. `tasca status` succeeds
2. The SPEC has pending tasks: `tasca list --spec SPEC-NNN --pending --json` returns non-empty
3. The current working directory is a clean git repo (no uncommitted changes blocking worktree creation)

If any fails: stop and report. Do not improvise.

## Input

User invokes with a SPEC-ID. If missing, ask: *"Which SPEC-ID? (e.g. SPEC-121-B)"*.

---

## Phase 0 — Detect orphans

Before doing anything, check for orphaned tasks:

```bash
tasca list --spec SPEC-NNN --json | jq '.[] | select(.status == "in_progress")'
```

Any `in_progress` task is a previous run that didn't complete. For each:

1. Check if its `worktree` path still exists on disk
2. Check if the worktree has uncommitted work
3. Report to the user and ask: *"Task TASK-X is in_progress at <worktree>. Resume, release, or fail?"*

Do not proceed to Phase 1 until all orphans are resolved.

---

## Phase 1 — Choose execution mode

Read the task graph:

```bash
tasca list --spec SPEC-NNN --pending --json
```

Analyze `blocked_by` to find tasks ready to run (no unresolved blockers).

If multiple tasks are ready simultaneously, ask the user:

> Found N tasks ready: TASK-A, TASK-B, TASK-C.
> Run **in parallel** (faster, harder to debug) or **sequentially** (safer, slower)?

Do NOT decide for the user. The choice is intentional — fallos críticos
en cadena son una preocupación real del usuario. Respect their answer.

---

## Phase 2 — The dispatch loop

For each iteration:

### Step A — Pick the next task(s)

- **Sequential mode:** one task whose blockers are all `completed`
- **Parallel mode:** all ready tasks (max as recommended by the plan)

### Step B — Create worktrees

For each task to dispatch:

```bash
git worktree add .claude/worktrees/TASK-X-id <branch>
```

Branch naming: `feature/TASK-X-id-slug` derived from the subject.

### Step C — Register the worktree in tasca

```bash
tasca take TASK-X --json   # atomic claim, sin worktree aún
tasca task edit TASK-X --worktree .claude/worktrees/TASK-X-id
```

Order matters: take first (atomic reservation), then edit to record the worktree path.

### Step D — Dispatch the subagent

Spawn a subagent with this prompt template:

> Your task is TASK-X. You are operating in the worktree at <path>.
> Do not switch branches. Do not edit files outside the worktree.
>
> The task is already claimed for you. Begin with:
> ```
> tasca show TASK-X --json
> ```
> The JSON returns the task description, packages, quality_gates, and spec_context
> (the full spec + plan_content). Use only that payload — do not read external files
> unless the description tells you to.
>
> Implement the task. Run the quality gates. If they pass:
> ```
> tasca done TASK-X --result "<gates summary>"
> ```
>
> If gates fail and you cannot resolve, or if you hit a merge conflict on merge-back:
> ```
> tasca fail TASK-X --error "<short reason>"
> ```
> and stop. Do not try to recover or improvise.

**Parallel mode:** dispatch all subagents in one batch (one tool call with multiple subagent invocations).

### Step E — Wait for results

Each subagent returns `done` or `fail`. The tasca DB is the source of truth — re-query it:

```bash
tasca show TASK-X --json
```

### Step F — Integrate (per completed task)

For each `completed` task:

1. Run the quality gates **again** in the worktree as a final check
2. Merge worktree branch into the working branch
3. Remove the worktree: `git worktree remove .claude/worktrees/TASK-X-id`
4. Clear the worktree field: `tasca task edit TASK-X --worktree ""`

If the merge has conflicts → treat as a failure. Go to Phase 3.

---

## Phase 3 — Failure handling (blocking)

When a task fails OR a merge conflict appears:

**Stop the loop.** No new tasks dispatch until repair is complete.

### Repair sequence

1. **Attempt your own fix** — read the worktree, the error, the failed task description. If it's a clear typo or trivial issue, fix it inline.
2. **If stuck → advisor()** — call the advisor with full context. Wait for the response.
3. **If still stuck → ask the user** — present:
   - What failed
   - What you tried
   - The advisor's suggestion (if available)
   - Ask: *"How to proceed? (a) I'll try the suggested fix, (b) escalate to a stronger model, (c) you take over"*

### After repair

- If you resolved it: `tasca task edit TASK-X --worktree ...` (if path changed), then `tasca release TASK-X` so it returns to pending, OR `tasca done` if you finished it yourself
- If user took over: stop. Tell them to relaunch dispatch with: `/tasca-dispatch SPEC-NNN`

**Never silently retry.** Always make the failure visible.

---

## Phase 4 — Completion

When `tasca list --spec SPEC-NNN --pending --json` returns empty:

1. Verify no `in_progress` left:
   ```bash
   tasca list --spec SPEC-NNN --json | jq '.[] | select(.status != "completed")'
   ```
   Should be empty.
2. Run project-wide quality gates (from the plan)
3. Report to the user:
   > SPEC-NNN complete. All N tasks done. Quality gates pass.
   > Mark spec done with: `tasca spec done SPEC-NNN --pr <num> --merged <date>` (when you merge to main).

---

## Rules

### Worktree rules (non-negotiable)

- ✅ Each task gets its own worktree under `.claude/worktrees/`
- ✅ Subagent never switches branches, never works outside its worktree
- ✅ Worktree path is recorded in tasca (`worktree` field) immediately after `take`
- ❌ Never run `git checkout` on the main working tree during dispatch
- ❌ Never delete a worktree without first marking the task done/failed/released

### Parallelism rules

- The "same file = sequential" decision was already made in `tasca-write-tasks` via `blocked_by`. Trust it.
- Do NOT second-guess. If `blocked_by` says A→B→C, run them sequentially even in "parallel mode."
- "Parallel mode" only means: tasks with no inter-dependencies dispatch concurrently.

### Failure rules

- One failure = stop the world. Block the loop. Repair before continuing.
- Failed tasks keep their `worktree` field (we changed this intentionally) — so you can inspect them.
- Never auto-retry. Repair → release → next loop iteration will re-pick.

### Subagent autonomy boundary

- Subagents read only their task payload (via `tasca take` / `tasca show`)
- Subagents may not call other skills (they have no context)
- Subagents may not dispatch other subagents
- All decision-making about scope, parallelism, and failure handling stays in the dispatcher

---

## What NOT to do

- ❌ Skip Phase 0 (orphan detection) — you'll dispatch into half-broken state
- ❌ Dispatch without creating a worktree first
- ❌ Decide parallel vs sequential without asking the user
- ❌ Continue the loop while a task is failed
- ❌ Read every task description yourself — let the subagent do it via `tasca take`
- ❌ Modify tasks during dispatch — that's `tasca-write-tasks`' job; if specs need changing, stop and tell the user

---

## Quick reference

| Need | Command |
|---|---|
| Find ready tasks | `tasca list --spec SPEC-N --pending --json` |
| Find orphans | `tasca list --spec SPEC-N --json \| jq '.[] \| select(.status=="in_progress")'` |
| Claim a task | `tasca take TASK-X` |
| Record worktree | `tasca task edit TASK-X --worktree <path>` |
| Mark done | `tasca done TASK-X --result "..."` |
| Mark failed (keeps worktree) | `tasca fail TASK-X --error "..."` |
| Release for retry | `tasca release TASK-X` |
| Verify all done | `tasca list --spec SPEC-N --json` |
