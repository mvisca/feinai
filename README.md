# feinai — coordination layer for multi-agent teams

Working with AI agents on complex features is powerful — until the coordination overhead swallows the productivity. **feinai** is a task & spec manager built for multi-agent workflows: specs, plans, tasks, worktree isolation, and a live orchestration dashboard.

Agents claim tasks atomically, get exactly the context they need, and report results — all in single CLI calls. Humans watch a live dashboard showing which tasks exist, who's working on them, which files are being touched, and what the outcome was. State lives in a local SQLite file and never leaves your machine.

```bash
feinai take TASK-121-A
# → {id, subject, description, workplan, packages, quality_gates, worktree, ...}
# One call. Everything the agent needs to start.
```

## Install

Requires [Bun](https://bun.sh) 1.3+.

```bash
bun install -g feinai
```

This installs two binaries: `feinai` and `opengit` (safe git wrapper for parallel worktree workflows).

### PATH setup

Bun installs global binaries to `~/.bun/bin`. This directory is added to PATH in interactive terminals automatically. No extra steps needed for:
- Interactive terminal sessions
- Local AI agents (Claude Code, opencode running locally)

**Non-interactive SSH sessions only** (e.g. `ssh host 'feinai status'`) require `~/.bun/bin` to be on PATH. Fix with a one-time symlink (requires sudo):

```bash
sudo ln -sf ~/.bun/bin/feinai /usr/local/bin/feinai
sudo ln -sf ~/.bun/bin/opengit /usr/local/bin/opengit
sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun
```

Or use a login shell: `ssh host 'bash -lc "feinai status"'`

### Activate Claude Code skills

```bash
mkdir -p ~/.claude/skills
SKILLS="$(bun pm bin -g)/../lib/node_modules/feinai/skills"
for skill in feinai-sdd feinai-write-spec feinai-write-tasks feinai-dispatch feinai-implement; do
  ln -sf "$SKILLS/$skill" ~/.claude/skills/$skill
done
```

Skills activate automatically in projects that have `.tasca/tasca.db`.

## Quick start

```bash
# 1. Initialize feinai in your project
cd my-project
feinai init
# → Creates .tasca/tasca.db (auto-added to .gitignore)

# 2. Add a spec
feinai spec add SPEC-001 "User authentication" --content "## Goal\nAdd JWT auth..."

# 3. Add a plan
feinai plan add SPEC-001 --content "## Steps\n1. Schema\n2. Routes\n3. Tests"

# 4. Add tasks
feinai add TASK-001-A "Create auth schema" \
  --spec SPEC-001 \
  --desc "Define schema for users table..." \
  --gate "pnpm typecheck" \
  --gate "pnpm test -- --run"

# 5. Agent claims a task (atomic)
feinai take TASK-001-A
# Owner auto-detected as "{parent_process}:{pid}:{username}"
# Override via $FEINA_USER env var

# 6. Agent marks done
feinai done TASK-001-A --result "typecheck ✓ test ✓"
```

## Commands

| Command | Purpose |
|---|---|
| `feinai init` | Create `.tasca/tasca.db` in cwd |
| `feinai status` | Summary: pending / in_progress / completed counts |
| `feinai list [filters]` | List tasks with optional filters |
| `feinai add ID "subject"` | Create a new task |
| `feinai show ID` | Show full task detail |
| `feinai take ID` | Atomically claim a pending task |
| `feinai done ID --result "..."` | Mark task completed |
| `feinai fail ID --error "..."` | Mark task failed |
| `feinai block ID --by BLOCKER` | Add a dependency |
| `feinai unblock ID --dep BLOCKER` | Remove a dependency |
| `feinai spec add ID "title"` | Register a spec |
| `feinai spec list` | List all specs |
| `feinai spec show ID` | Spec details |
| `feinai spec start ID` | Mark spec as in progress |
| `feinai spec done ID --pr N` | Mark spec as completed |
| `feinai git <cmd>` | Safe git wrapper (worktree-only whitelist) |
| `feinai server [--port N]` | Start HTTP dashboard + REST API |

Run `feinai --help` for full flag reference.

## Dashboard

```bash
feinai server                  # http://127.0.0.1:8272
feinai server --port 9000      # custom port
feinai server -d               # background daemon
```

The dashboard is a self-contained HTML page (no external assets). Features:
- **Live Agents Monitor** — shows active agents, worktree path, repo, files being touched, elapsed time
- **Presence indicator** — green ripple when agents active, gray when idle
- **Real-time updates via SSE** — reacts instantly to CLI mutations
- **Action buttons** — take / done / fail tasks directly from UI
- **Full-text search** — across specs, plans, and tasks

## `feinai git` — safe git wrapper

`feinai git` enforces a worktree-only workflow for parallel agent safety. It blocks operations that would interfere with other agents working in parallel:

```bash
feinai git worktree add .worktrees/TASK-001 origin/main
feinai git add .
feinai git commit -m "feat: ..."
feinai git push origin HEAD:main
feinai git complete   # sync main after push
```

Blocked: `branch`, `checkout`, `merge`, `rebase`, `reset`, `fetch`, `pull`, `stash`, `clone`.

`opengit` is also available as a standalone command (installed alongside `feinai`).

## Claude Code skills

feinai ships five skills covering the full Spec-Driven Development cycle:

| Skill | Purpose |
|---|---|
| `feinai-sdd` | Master skill — activates when `.tasca/tasca.db` exists |
| `feinai-write-spec` | Writes spec + plan into feinai |
| `feinai-write-tasks` | Decomposes plan into atomic tasks with parallelism analysis |
| `feinai-dispatch` | Orchestrates subagents in git worktrees |
| `feinai-implement` | Claims and executes one task in an isolated worktree |

## Architecture

```
<project>/.tasca/tasca.db    local SQLite, auto-discovered like .git

Tables:
  specs   (id, title, status, content, plan versions...)
  tasks   (id, spec_id, subject, description, status, owner,
           blocked_by, packages, quality_gates, worktree, result, error...)
  events  (append-only audit log — actor, operation, timestamp)
```

feinai walks up the directory tree from `cwd` looking for `.tasca/tasca.db`, the same way git locates `.git`.

### Audit log

Every mutation records `{parent_process}:{pid}:{username}` (e.g. `claude:12345:m`, `opencode:67890:m`). Override with `$FEINA_USER`.

## License

MIT — built with ❤️ in Barcelona. *Feina* means "work" in Catalan.
