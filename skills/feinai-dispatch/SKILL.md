---
name: feinai-dispatch
description: Use when tasks exist in feinai for a spec and need to be executed. Dispatches subagents to claim and complete tasks, enforces worktree isolation, handles parallelism (sequential or parallel based on user choice), and resolves merge conflicts and failures by blocking the loop until repair completes. Replaces `subagent-driven-development` from superpowers when feinai is active.
---

# feinai-dispatch

Execute the pending tasks of a SPEC (or, in all-ready mode, of every spec). One responsibility: dispatch subagents in worktrees, integrate their output, handle failures.

## Preconditions — environment check

Run this first:

```bash
feinai --version 2>&1
git status 2>&1
```

---

### Failure: `feinai: command not found`

feinai is not installed. Tell the user:

> feinai is not installed. Install with:
> ```bash
> bun install -g feinai
> ```
> Full setup guide: https://www.npmjs.com/package/feinai

**Offer to run it.** Do not proceed until `feinai --version` returns a version number.

---

### Failure: `feinai --version` works but `feinai status` fails with command not found in a different shell

PATH issue in non-interactive SSH session. `~/.bun/bin` is not loaded. Tell the user:

> feinai is installed but not on PATH in this shell context (common in non-interactive SSH sessions).
>
> Fix with a one-time symlink (requires root):
> ```bash
> sudo ln -sf ~/.bun/bin/feinai /usr/local/bin/feinai
> sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun
> ```
> Or via root SSH if available:
> ```bash
> ssh root@<host> "ln -sf /home/<user>/.bun/bin/feinai /usr/local/bin/feinai && ln -sf /home/<user>/.bun/bin/bun /usr/local/bin/bun"
> ```

**Offer to run it.** Full docs: https://www.npmjs.com/package/feinai

---

### Failure: `feinai status` exits with code 2 (`no .feinai/feinai.db found`)

feinai is installed but no DB in this project. Ask the user:

> No feinai DB found in this directory. Run `feinai init` to create one?

**Offer to run `feinai init`.**

---

**Do not proceed to dispatch until all checks pass:**

1. `feinai --version` returns a version number
2. `git status` runs without error
3. `feinai status` exits 0 (DB found)
4. The SPEC has pending tasks: `feinai list --spec SPEC-NNN --pending --json` returns non-empty
5. Current working directory is a clean git repo
6. `git ls-files .feinai` prints nothing. The DB is local state: a tracked copy gives each worktree its own stale DB, so `feinai done` fails there. If it prints a path, stop and tell the user to run `git rm --cached .feinai/feinai.db`, add `.feinai/` to `.gitignore` and commit.

If any fails: stop, diagnose, offer the fix above.

## Input

User invokes with a SPEC-ID. If missing, ask: *"Which SPEC-ID? (e.g. SPEC-121-B), or all ready tasks across specs?"*.

**All-ready mode** (`/feinai-dispatch all`): ready tasks often span several specs through cross-spec `blocked_by`. Drop `--spec` from every `feinai list` in this skill and work on the ready set of the whole DB. Everything else is identical; Phase 4 runs per spec once its tasks are all completed.

---

## Phase 0 — Detect orphans

Before doing anything, check for orphaned tasks:

```bash
feinai list --spec SPEC-NNN --status in_progress --json
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
feinai list --spec SPEC-NNN --pending --json
```

`blocked_by` keeps blockers that are already completed, so an empty array is not the readiness test. A pending task is **ready** when every blocker has status `completed`. There is no CLI flag for it; compute it (add `--spec SPEC-NNN` to scope, omit it for all specs):

```bash
feinai list --json | jq -r '(map({(.id):.status})|add) as $s | .[] | select(.status=="pending" and all(.blocked_by[]; $s[.]=="completed")) | .id'
```

If multiple tasks are ready simultaneously, ask the user:

> Found N tasks ready: TASK-A, TASK-B, TASK-C.
> Run **in parallel** (faster, harder to debug) or **sequentially** (safer, slower)?

Do NOT decide for the user. The choice is intentional — fallos críticos
en cadena son una preocupación real del usuario. Respect their answer.

Ask **once per run** and reuse the answer in later rounds; re-ask only if the situation changes (a failure, a different spec set, the user changes the plan). Never accept a bare "yes"/"ok" to an either/or question: ask again naming the options.

Parallel agents share ports, state dirs and other machine resources, so full-suite gates run concurrently give false failures. In parallel mode agents run only the task's **focused gate** (see below); the dispatcher runs the full gates serially at integration.
---

## Phase 2 — The dispatch loop

For each iteration:

### Step A — Pick the next task(s)

- **Sequential mode:** one task whose blockers are all `completed`
- **Parallel mode:** all ready tasks (max as recommended by the plan)
- Tasks marked `## Manual verification` are dispatched like any other; they are reported differently at the end (Phase 4)

### Step B — Create worktrees

For each task to dispatch:

```bash
git worktree add -b <branch> .worktrees/TASK-X-id
```

`-b` creates the branch; without it git expects an existing one. Branch naming: `feature/TASK-X-id-slug` derived from the subject.

Then do the project's worktree setup: read the worktree section of its `AGENTS.md`/`CLAUDE.md` (e.g. symlink `.venv`, install dependencies) and run it in the new worktree before dispatching.

### Step C — Register the worktree in feinai

```bash
feinai take TASK-X --json   # atomic claim, sin worktree aún
feinai edit TASK-X --worktree .worktrees/TASK-X-id
```

Order matters: take first (atomic reservation), then edit to record the worktree path.

### Step D — Dispatch the subagent

Spawn a subagent with this prompt template:

> Your task is TASK-X. You are operating in the worktree at <path>.
> Do not switch branches. Do not edit files outside the worktree.
>
> The task is already claimed for you. Begin with:
> ```
> feinai show TASK-X --json
> ```
> The JSON returns the task description, packages, quality_gates, and spec_context
> (the full spec + plan_content). Use only that payload — do not read external files
> unless the description tells you to.
>
> Implement the task. Commit your work on the branch (`git add` + `git commit`);
> the merge-back needs commits, uncommitted changes are lost.
> Do not edit files that the task description says another task owns (sync points).
> If you find a gap (missing help text, a follow-up needed, a doc out of date), do not
> fix it outside your scope and do not edit tasks: write it in the `--result` text.
>
> Gates: in parallel mode run only the focused gate; in sequential mode run all gates.
> Re-run them **after your last edit** and read the exit code of each command
> (a command that fails silently, e.g. piped or backgrounded, is a failure).
> Only if every exit code is 0:
> ```
> feinai done TASK-X --result "<gates summary>"
> ```
>
> If gates fail and you cannot resolve, or if you hit a merge conflict on merge-back:
> ```
> feinai fail TASK-X --error "<short reason>"
> ```
> and stop. Do not try to recover or improvise.

**Parallel mode:** dispatch all subagents in one batch (one tool call with multiple subagent invocations).

### Step E — Wait for results

Each subagent returns `done` or `fail`. The feinai DB is the source of truth — re-query it:

```bash
feinai show TASK-X --json
```

### Step F — Integrate (per completed task)

For each `completed` task:

1. Check the branch has commits ahead of the working branch; if not, the agent forgot to commit: treat as a failure
2. Run the quality gates **again** in the worktree as a final check (in parallel mode, serially one task at a time)
3. Merge worktree branch into the working branch
4. Remove the worktree: `git worktree remove .worktrees/TASK-X-id`

If the merge has conflicts → treat as a failure. Go to Phase 3.

### Step G — Verify the merged result (end of each round)

After integrating the round, run the **project gates** (full suite, from `AGENTS.md`/the plan) on the merged working branch. Per-branch gates do not prove the combination works. If they fail → Phase 3. Only then pick the next round.

### Gaps found during dispatch

Agents report gaps in their `--result`. Do not change tasks mid-round. Record the gaps and change tasks (`feinai edit`, new tasks via `feinai add`, `block`/`unblock`) only **between rounds**, after Step G, telling the user what changed.

---

## Phase 3 — Failure handling (blocking)

When a task fails OR a merge conflict appears:

**Stop the loop.** No new tasks dispatch until repair is complete.

### Repair sequence

1. **Attempt your own fix** — read the worktree, the error, the failed task description. If it's a clear typo or trivial issue, fix it inline.
2. **If stuck and an advisor tool is available** — call it with full context. Wait for the response.
3. **If still stuck → ask the user** — present:
   - What failed
   - What you tried
   - The advisor's suggestion (if available)
   - Ask: *"How to proceed? (a) I'll try the suggested fix, (b) escalate to a stronger model, (c) you take over"*

### After repair

- If you resolved it: remove its worktree and run `feinai reopen TASK-X` so it returns to pending (`release` only accepts `in_progress`). If you finished it yourself: `feinai reopen`, `feinai take`, then `feinai done`
- If user took over: stop. Tell them to relaunch dispatch with: `/feinai-dispatch SPEC-NNN`

**Never silently retry.** Always make the failure visible.

---

## Phase 4 — Completion

When `feinai list --spec SPEC-NNN --pending --json` returns empty:

1. Verify every task is `completed`:
   ```bash
   feinai list --spec SPEC-NNN --json
   ```
2. Run project-wide quality gates (from the plan)
3. Report to the user. List tasks whose description has a `## Manual verification` section (human/hardware check, or a gate that cannot run locally such as manual-only CI) separately as **done, needs your check**, with what to check; do not report them as plainly done. Also list the gaps recorded during dispatch.
   > SPEC-NNN complete. All N tasks done. Quality gates pass.
   > Done, needs your check: TASK-X (<what to verify>).
   > Mark spec done with: `feinai spec done SPEC-NNN --pr <num> --merged <date>` (when you merge to main).

---

## Rules

### Worktree rules (non-negotiable)

- ✅ Each task gets its own worktree under `.worktrees/`
- ✅ Subagent never switches branches, never works outside its worktree
- ✅ Worktree path is recorded in feinai (`worktree` field) immediately after `take`
- ❌ Never run `git checkout` on the main working tree during dispatch
- ❌ Never delete a worktree without first marking the task done/failed/released

### Parallelism rules

- The "same file = sequential" decision was made in `feinai-write-tasks` via `blocked_by`: if it says A→B→C, run them sequentially even in "parallel mode."
- "Parallel mode" only means: tasks with no inter-dependencies dispatch concurrently.

### Failure rules

- One failure = stop the world. Block the loop. Repair before continuing.
- Failed tasks keep their `worktree` field so you can inspect them.
- Never auto-retry. Repair → reopen → next loop iteration will re-pick.

### Subagent autonomy boundary

- Subagents read only their task payload (via `feinai show`)
- Subagents may not call other skills (they have no context)
- Subagents may not dispatch other subagents
- All decision-making about scope, parallelism, and failure handling stays in the dispatcher

---

## What NOT to do

- ❌ Skip Phase 0 (orphan detection) — you'll dispatch into half-broken state
- ❌ Dispatch without creating a worktree first
- ❌ Decide parallel vs sequential without asking the user
- ❌ Continue the loop while a task is failed
- ❌ Read every task description yourself — let the subagent do it via `feinai show`
- ❌ Modify tasks during a round — record gaps and change tasks only between rounds (see "Gaps found during dispatch"); if the spec itself needs changing, stop and tell the user

---

## Quick reference

| Need | Command |
|---|---|
| Find pending tasks | `feinai list --spec SPEC-N --pending --json` (ready = all blockers `completed`, see Phase 1) |
| Find orphans | `feinai list --spec SPEC-N --status in_progress --json` |
| Claim a task | `feinai take TASK-X` |
| Record worktree | `feinai edit TASK-X --worktree <path>` |
| Mark done | `feinai done TASK-X --result "..."` |
| Mark failed (keeps worktree) | `feinai fail TASK-X --error "..."` |
| Release an in_progress task | `feinai release TASK-X` |
| Reopen a failed task | `feinai reopen TASK-X` |
| Verify all done | `feinai list --spec SPEC-N --json` |
