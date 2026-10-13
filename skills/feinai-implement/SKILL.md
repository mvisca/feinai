---
name: feinai-implement
description: Use when a feinai task needs to be executed. Claims one pending task from feinai, implements it in an isolated worktree, runs quality gates, and pushes to main. Designed to be dispatched by feinai-dispatch or run standalone for a single task.
---

# feinai-implement

Claim one pending task from feinai, implement it in an isolated worktree, run quality gates, push to main.

## Preconditions

1. `feinai status` succeeds and there is at least one pending task
2. Current working directory is a clean git repo
3. `git status` works

If any fails: stop and report. Do not improvise.

---

## On startup

1. `feinai list --pending --json` — find the first available task (no pending blockers)
2. If none exists → respond "No pending tasks" and stop
3. `feinai take <TASK-ID> --owner implement-agent` — claim it atomically
4. If the task has `spec_id` → `feinai spec content <SPEC-ID>` for context
5. If the task has `blocked_by` with uncompleted tasks → release with `feinai release <TASK-ID>` and stop

Read `AGENTS.md` of the project for architecture and project-specific conventions.

---

## Execute the task

**Step 1 — Isolated worktree:**
```bash
git worktree add .worktrees/<TASK-ID> origin/main
cd .worktrees/<TASK-ID>
```

**Step 2 — Worktree setup:**
Install dependencies if the project requires them. Check `AGENTS.md` of the project for the exact command.

**Step 3 — Read before writing:**
- The full task description (`feinai show <TASK-ID>`)
- The files you will touch — read them before editing
- If there is a **Workplan** in the description → follow those steps in exact order

**Step 4 — Implement:**
Exactly what the task says. No more, no less.
- Do not touch files outside the task scope
- If a file "to create" already exists → extend it instead of overwriting if it already contains valid content

**Step 5 — Commit:**
One commit per task. Conventional commits:
```
feat(scope): concise description
```
Types: `feat`, `fix`, `refactor`, `test`, `chore`.

**Step 6 — Quality gates:**
Run the gates defined in the task (`quality_gates`). If the task does not specify them, check `AGENTS.md` of the project for default gates.

**Step 7 — Close:**

Gates pass:
```bash
# From the worktree — include feinai.db in the task commit:
feinai done <TASK-ID> --result "gates ✓"
git add .feinai/feinai.db
git commit --amend --no-edit

git push origin HEAD:main
```

If push is rejected (another agent pushed first — conflict on `.feinai/feinai.db`):
```bash
# Accept origin's db (it's the authoritative state), re-apply done, re-push:
git fetch origin main
git checkout origin/main -- .feinai/feinai.db
feinai done <TASK-ID> --result "gates ✓"
git add .feinai/feinai.db
git commit --amend --no-edit
git push origin HEAD:main
```

Push succeeds:
```bash
# From the repo root:
git worktree remove .worktrees/<TASK-ID>
git pull --ff-only
```

Gates fail → follow "If something fails".

**Done = 3 observable facts:**
1. Quality gates pass without errors
2. The task files exist with correct content
3. Clean commit on `main` and task status `completed` in feinai

---

## If something fails

Gates fail, push fails, or error at any step:

1. **Do not clean the worktree**
2. Push to a backup branch:
   ```bash
   git push origin HEAD:backup/<TASK-ID>
   ```
3. Mark the task as failed:
   ```bash
   feinai fail <TASK-ID> --error "<exact command + relevant output>"
   ```
4. Leave the worktree intact for manual recovery

---

## Git — worktree-safe conventions

Other agents work in parallel worktrees. Use plain `git`, restricted to these operations (`gh` is not needed).

**Allowed:**
- `git worktree add/list/lock/unlock`
- `git add`, `commit`, `push`, `status`, `diff`, `log`, `show`
- `git fetch origin main` and `git checkout origin/main -- .feinai/feinai.db` — only for the DB conflict step
- `git pull --ff-only` — syncs local main after push (only from repo root)

**Prohibited:**
- `git branch`, `switch`, or `checkout` of branches — never switch branches
- `git merge`, `rebase`, `reset`, `cherry-pick`
- `git remote`, `clone`, `stash`, `tag`
- `git worktree remove` — only after successful push

If a git command fails → **STOP**. Do not retry with workarounds. Report to the user.

---

## Absolute rules

**Do not modify:**
- `AGENTS.md`, `CLAUDE.md`
- CI/CD, infrastructure, or secret configuration files (`.env`, `.env.*`)
- The feinai DB directly

**Code:**
- No `any` without a justified comment on the same line
- If a test fails: fix either the test or the implementation. Never silence, skip, or add workarounds to make the gate "pass"
- If the cause is not obvious → **STOP**, report to the user with the exact command and the full output
