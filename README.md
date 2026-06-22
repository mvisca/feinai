# feinai

Local coordination layer for multi‑agent coding workflows.

When multiple coding agents work on the same repo, things break long before the model runs out of IQ: duplicated work, inconsistent task state, agents trampling each other's branches, and no clear visibility into what is happening where.

**feinai** focuses on one thing: make that coordination deterministic, auditable, and safe for your git repo – locally, without a cloud service.

---

## Why feinai

Multi‑agent development breaks down without coordination infrastructure. Skills and prompts get agents started, but they do not solve the ugly parts of running several agents in parallel:

- **Token waste on shared Markdown.** Agents reading `QUEUE.md` or `BACKLOG.md` to find their next task burn context on irrelevant state. A 200‑line plan file costs tokens every time – most of it noise for any given agent. feinai gives each agent exactly what it needs in a single call.
- **Inconsistent task state.** Two agents claim the same task. One overwrites the other's work. You find out when the merge fails. `feinai take` is an atomic SQL operation – if two agents race, one wins and one gets rejected. No duplicates, no silent overwrites.
- **No isolation in git.** Agents sharing a branch corrupt each other's work mid‑task. `feinai-dispatch` puts every agent in its own git worktree, linked to a specific task, visible in the dashboard. Work is isolated until it's ready to merge.
- **Zero visibility.** You don't know which agent is doing what, which files it touched, how long it has been running, or whether it's stuck. The feinai dashboard shows all of this live.
- **Skills hit a ceiling.** Skills and prompt instructions are probabilistic – the model can ignore them, misinterpret them, or hallucinate state. Deterministic coordination requires a tool, not a suggestion. feinai makes the workflow atomic, auditable, and race‑free at the infrastructure level.

---

## What feinai is

feinai is a **CLI + HTTP API + dashboard** that acts as the single source of truth for multi‑agent development workflows on a git repo.

It manages four core primitives:

- **Specs** – what to build and why.
- **Plans** – how to build it.
- **Tasks** – atomic units of work, with dependencies, quality gates, and worktree links.
- **Events** – append‑only audit log of every state change.

Agents never read raw Markdown queues. They ask feinai for work:

```sh
feinai take TASK-121-A
# → {id, subject, description, workplan, packages, quality_gates, worktree, ...}
# One call. Everything the agent needs. Nothing it doesn't.
```

State lives in a local SQLite file. No cloud, no external service, no account.

---

## Core concepts

- **Specs**  
  High‑level product requirements: why a feature exists and what "done" means. Specs link to plans and tasks.

- **Plans**  
  Versioned implementation plans for a spec. A plan explains how to build it – steps, trade‑offs, constraints.

- **Tasks**  
  Atomic units of work with:
  - An ID (`TASK-001-A`)
  - Subject and description
  - Optional `blocked_by` dependencies
  - `quality_gates` (commands/tests that must pass)
  - A dedicated git worktree path

- **Events**  
  Append‑only log of everything that happens: `{parent_process}:{pid}:{user}`, timestamps, transitions. Every mutation to specs, plans, tasks or worktrees is recorded.

- **Worktrees**  
  Each task gets its own git worktree. Agents commit and push from there. The main branch stays clean until the work is ready to integrate.

---

## Runtime & footprint

- Implemented on top of **Bun 1.3+**.
- Installs two binaries:
  - `feinai` – main CLI + embedded HTTP server and dashboard.
  - `opengit` – safe git wrapper for parallel worktrees.
- Stores all state in a single SQLite file: `.feinai/feinai.db`, discovered by walking up from the current directory (like `.git`).

No background services are required beyond the optional dashboard server.

---

## Supply chain & safety

feinai is designed to be "boring" infrastructure:

- **Local‑only state.** All coordination lives in `.feinai/feinai.db` in your repo. There is no remote backend.
- **Explicit operations.** Every change to specs, plans, tasks and worktrees goes through the CLI or HTTP API and is logged in `events`.
- **Safe git workflow.** `feinai git` wraps git and blocks operations that can corrupt parallel worktrees (branch, checkout, merge, rebase, reset, fetch, pull, clone).
- **Auditability.** Every task has a clear chain: spec → plan → task → worktree → events. Every agent identity can be traced (`$FEINAI_USER` override supported).

---

## Using feinai with coding agents

feinai is built to sit **under** coding agents (Claude Code, pi‑style harnesses, etc.) as a coordination layer.

A typical pattern:

1. Human or design agent writes a spec and plan.
2. feinai decomposes the plan into tasks with dependencies and quality gates.
3. Worker agents:
   - Call `feinai take` to claim a task atomically.
   - Work in the dedicated worktree for that task.
   - Run quality gates (tests, linters, typechecks).
   - Mark the task as `done` or `fail` with a structured result.
4. A human (or integration agent) reviews and merges.

Agents don't parse `QUEUE.md`. They talk to a small local coordination service instead.

---

## Claude Code skills

feinai ships three Claude Code skills covering the full development loop. They activate automatically when `.feinai/feinai.db` is present:

| Skill               | Purpose                                                                          |
|---------------------|----------------------------------------------------------------------------------|
| `feinai-write-spec` | Full pipeline: spec + plan + tasks. With no argument runs the complete flow; with a SPEC-ID argument regenerates tasks only (use when iterating on an existing plan) |
| `feinai-dispatch`   | Orchestrates subagents in isolated git worktrees                                 |
| `feinai-implement`  | Claims and executes one task end‑to‑end                                          |

Together they cover: design → spec → plan → tasks → parallel execution → merge.

### Activating skills in Claude Code

```sh
mkdir -p ~/.claude/skills
SKILLS=~/.bun/install/global/node_modules/feinai/skills

for skill in feinai-write-spec feinai-dispatch feinai-implement; do
  ln -sf "$SKILLS/$skill" ~/.claude/skills/$skill
done
```

---

## Installation

Requires [Bun](https://bun.sh/) 1.3+.

```sh
bun install -g feinai
```

This installs:

- `feinai`
- `opengit` (safe git wrapper for parallel worktrees)

### PATH setup (non‑interactive SSH)

In interactive shells and for local agents (Claude Code, opencode) it should work out of the box.

For non‑interactive SSH sessions (e.g. `ssh host 'feinai status'`), you may need a one‑time setup:

```sh
sudo ln -sf ~/.bun/bin/feinai /usr/local/bin/feinai
sudo ln -sf ~/.bun/bin/opengit /usr/local/bin/opengit
sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun
```

---

## Quick start

```sh
cd my-project

# Initialize local state
feinai init              # creates .feinai/feinai.db, adds to .gitignore

# Add a spec and plan
feinai spec add SPEC-001 "User authentication" --content "..."
feinai plan add SPEC-001 --content "..."

# Create a task with a quality gate
feinai add TASK-001-A "Create auth schema" \
  --spec SPEC-001 \
  --gate "pnpm typecheck"

# Agent claims a task (atomic)
feinai take TASK-001-A   # returns full task payload as JSON

# Agent completes work
feinai done TASK-001-A --result "typecheck ✓"

# Start dashboard server
feinai server            # live dashboard at http://127.0.0.1:8272
```

---

## Commands

High‑level CLI:

```text
feinai init                        Create .feinai/feinai.db
feinai status                      Show counts: pending / in_progress / completed
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

Run:

```sh
feinai server -d          # background, port 8272
feinai server --port 9000 # custom port
```

The dashboard shows per agent:

- Current task ID
- Worktree path and repo
- Files being modified
- Elapsed time

Active agents ripple in green, idle ones in gray. Updates stream in real time via SSE.

---

## `feinai git`

`feinai git` is a safety wrapper around git for parallel worktrees.

Allowed operations include:

```sh
feinai git worktree add .worktrees/TASK-001 origin/main
feinai git add .
feinai git commit -m "feat: ..."
feinai git push origin HEAD:main
feinai git complete   # sync main after push
```

The following are blocked when they would break the parallel workflow:

- `branch`
- `checkout`
- `merge`
- `rebase`
- `reset`
- `fetch`
- `pull`
- `clone`

Use your normal git tooling inside each worktree; use `feinai git` when operating on shared branches.

---

## Architecture

```text
<project>/.feinai/feinai.db    # local SQLite database (discovered like .git)

specs   — what to build
plans   — how to build it (versioned)
tasks   — atomic work units with blocked_by, quality_gates, worktree
events  — append-only audit log: {parent_process}:{pid}:{user}
```

Every mutation is logged. Every agent is identified. You can override identity using:

```sh
export FEINAI_USER="ci-bot-01"
```

---

## License

MIT — built with ❤️ in Barcelona.

"Feina" means "work" in Catalan. feinai is a tiny piece of infrastructure to keep that work coordinated.
