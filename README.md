# feinai

**Multi-agent development breaks down without coordination infrastructure.**

Skills and prompts get agents started. They don't solve what happens when five agents run in parallel: stale state, token waste reading giant markdown files, tasks claimed twice, agents stepping on each other's work, no visibility into what's actually happening.

feinai is the missing layer.

---

## The problems it solves

**Token waste.** Agents reading `QUEUE.md` or `BACKLOG.md` to find their next task burn context on irrelevant state. A 200-line plan file costs tokens every time — most of it noise for any given agent. feinai gives each agent exactly what it needs in a single call.

**Inconsistent task state.** Two agents claim the same task. One overwrites the other's work. You find out when the merge fails. feinai's `take` is an atomic SQL operation — if two agents race, one wins and one gets rejected. No duplicates, no silent overwrites.

**No isolation.** Agents sharing a branch corrupt each other's work mid-task. feinai-dispatch puts every agent in its own git worktree, linked to a specific task, visible in the dashboard. Work is isolated until it's ready to merge.

**Zero visibility.** You don't know which agent is doing what, which files it touched, how long it's been running, or whether it's stuck. The feinai dashboard shows all of this live.

**Skill-based approaches hit a ceiling.** Skills and prompt instructions are probabilistic — the model can ignore them, misinterpret them, or hallucinate state. Deterministic coordination requires a tool, not a suggestion. feinai makes the workflow atomic, auditable, and race-free at the infrastructure level.

---

## What feinai is

A CLI + HTTP API + dashboard that serves as the single source of truth for multi-agent development workflows.

- **Specs** — what to build and why
- **Plans** — how to build it
- **Tasks** — atomic units of work, with dependencies, quality gates, and worktree links
- **Dashboard** — live view of every agent, every worktree, every file being touched

```bash
feinai take TASK-121-A
# → {id, subject, description, workplan, packages, quality_gates, worktree, ...}
# One call. Everything the agent needs. Nothing it doesn't.
```

State lives in a local SQLite file. No cloud, no server, no account.

---

## Install

Requires [Bun](https://bun.sh) 1.3+.

```bash
bun install -g feinai
```

Installs two binaries: `feinai` and `opengit` (safe git wrapper for parallel worktrees).

### PATH setup

Works out of the box in interactive terminals and for local AI agents (Claude Code, opencode).

**Non-interactive SSH sessions only** (e.g. `ssh host 'feinai status'`) need a one-time fix:

```bash
sudo ln -sf ~/.bun/bin/feinai /usr/local/bin/feinai
sudo ln -sf ~/.bun/bin/opengit /usr/local/bin/opengit
sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun
```

### Activate Claude Code skills

```bash
mkdir -p ~/.claude/skills
SKILLS=~/.bun/install/global/node_modules/feinai/skills
for skill in feinai-sdd feinai-write-spec feinai-write-tasks feinai-dispatch feinai-implement; do
  ln -sf "$SKILLS/$skill" ~/.claude/skills/$skill
done
```

---

## Quick start

```bash
cd my-project
feinai init              # creates .tasca/tasca.db, adds to .gitignore

feinai spec add SPEC-001 "User authentication" --content "..."
feinai plan add SPEC-001 --content "..."
feinai add TASK-001-A "Create auth schema" --spec SPEC-001 --gate "pnpm typecheck"

feinai take TASK-001-A   # atomic claim — returns full task payload
feinai done TASK-001-A --result "typecheck ✓"

feinai server            # live dashboard at http://127.0.0.1:8272
```

---

## Skills

feinai ships five Claude Code skills covering the full development lifecycle:

| Skill | Purpose |
|---|---|
| `feinai-sdd` | Activates when `.tasca/tasca.db` exists — teaches Claude the workflow |
| `feinai-write-spec` | Writes spec + plan into feinai from a design conversation |
| `feinai-write-tasks` | Decomposes plan into atomic tasks with parallelism analysis |
| `feinai-dispatch` | Orchestrates subagents in isolated git worktrees |
| `feinai-implement` | Claims and executes one task end-to-end |

Full lifecycle: design → spec → tasks → parallel execution → merge.

---

## Commands

```
feinai init                        Create .tasca/tasca.db
feinai status                      Pending / in_progress / completed counts
feinai list [--pending] [--spec X] List tasks
feinai add ID "subject"            Create task
feinai take ID                     Atomic claim — returns full task JSON
feinai done ID --result "..."      Mark completed
feinai fail ID --error "..."       Mark failed
feinai release ID                  Release back to pending
feinai spec add/list/show/done     Spec lifecycle
feinai plan add/show               Plan versions
feinai git <cmd>                   Safe git wrapper (blocks merge/rebase/checkout)
feinai server [--port N] [-d]      Dashboard + REST API
```

---

## Dashboard

```bash
feinai server -d          # background, port 8272
feinai server --port 9000 # custom port
```

Shows per agent: task ID, worktree path, repo, files being modified, elapsed time. Green ripple when agents are active, gray when idle. Real-time via SSE.

---

## `feinai git`

Safe git wrapper that enforces worktree-only workflow. Blocks operations that break parallel work:

```bash
feinai git worktree add .worktrees/TASK-001 origin/main
feinai git add . && feinai git commit -m "feat: ..."
feinai git push origin HEAD:main
feinai git complete   # sync main after push
```

Blocked: `branch`, `checkout`, `merge`, `rebase`, `reset`, `fetch`, `pull`, `clone`.

---

## Architecture

```
<project>/.tasca/tasca.db    local SQLite, walks up from cwd like .git

specs   — what to build
plans   — how to build it (versioned)
tasks   — atomic work units with blocked_by, quality_gates, worktree
events  — append-only audit log: {parent_process}:{pid}:{user}
```

Every mutation is logged. Every agent is identified. Override identity with `$FEINAI_USER`.

---

## License

MIT — built with ❤️ in Barcelona. *Feina* means "work" in Catalan.
