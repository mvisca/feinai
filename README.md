# tasca

Working with AI agents on complex features is powerful — until the coordination overhead swallows the productivity. I was using markdown files (`QUEUE.md`, `SPECS-QUEUE.md`, plan checklists) to track specs and tasks across sessions. The files grew without bound. Agents had to read the whole thing to extract a handful of lines. Context windows filled with stale state. Keeping files current after each task required discipline I didn't always have, and the more agents worked in parallel, the more likely a file was to be inconsistent.

So I built **tasca**: a dual-interface tool (CLI + HTTP API) that serves both humans and agents. Agents claim tasks atomically, get exactly the context they need, and report results — all in single calls. Humans watch a live dashboard that shows which tasks exist, who's working on them, which files are being touched, and what the final outcome was. The underlying state lives in a local SQLite file and never leaves your machine.

It ships with a set of [Claude Code superpowers](https://github.com/anthropics/superpowers) skills — `tasca-sdd`, `tasca-write-spec`, `tasca-write-tasks`, `tasca-dispatch` — that replace the markdown-file side-effects of the SDD workflow with atomic CLI calls. The skills are drop-in replacements: if a project has `.tasca/tasca.db`, Claude uses tasca; otherwise it falls back to regular superpowers markdown flow.

```bash
tasca take TASK-121-A
# → {id, subject, description, workplan, packages, quality_gates, worktree, ...}
# One call. Everything the agent needs to start.
```

## Why tasca

- **Atomic commands** — `take` returns the full task payload (subject + description + workplan + quality gates) in a single response.
- **Concurrency-safe** — `take` is an atomic SQL UPDATE; two agents can't claim the same task.
- **Queryable** — filter by status, owner, spec without parsing markdown.
- **Auditable** — every operation is logged in an append-only events table.
- **Local-first** — SQLite file at `.tasca/tasks.db`, no server, no cloud.

## Status

Alpha. Built for use in real SDD workflows; API may change before 1.0.

## Install

Requires [Bun](https://bun.sh) 1.3+.

```bash
# From source (recommended during alpha)
git clone https://github.com/mvisca/tasca
cd tasca
bun install
bun link  # registers `tasca` as global command
```

### Activate the Claude Code skill

`tasca` ships with a Claude Code skill (`tasca-sdd`) that teaches Claude to use
the CLI in superpowers SDD workflows (brainstorming, writing-plans,
subagent-driven-development) instead of writing markdown files under
`docs/superpowers/`.

```bash
# Link the skill into your global Claude skills directory
mkdir -p ~/.claude/skills
ln -sfn "$(pwd)/skills/tasca-sdd" ~/.claude/skills/tasca-sdd
```

The skill activates automatically in projects that have `.tasca/tasca.db`. In
projects without tasca, Claude falls back to the regular superpowers markdown
flow.

Future install paths (post-alpha):
- `npm install -g tasca` (with Bun installed)
- Pre-compiled binaries from GitHub Releases (with checksums)
- Claude Code marketplace plugin (bundles CLI + skill)

## Quick start

```bash
# 1. Initialize a tasca DB in your project
cd my-project
tasca init
# → Creates .tasca/tasca.db

# 2. Register a spec with its markdown content (typically done by brainstorming skill)
tasca spec add SPEC-001 "User authentication" \
  --file specs/001-auth/spec.md
# OR via stdin:
cat specs/001-auth/spec.md | tasca spec add SPEC-001 "User authentication" --stdin

# 3. Register the implementation plan (typically done by writing-plans skill)
cat plan.md | tasca plan add SPEC-001 --stdin

# 4. Add tasks (typically done by writing-plans skill)
tasca add TASK-001-A "Create auth schema" \
  --spec SPEC-001 \
  --desc "Define Drizzle schema for users table..." \
  --package "@app/auth" \
  --gate "pnpm typecheck" \
  --gate "pnpm test -- --run"

# 5. Agent takes the task (atomic — returns full task JSON in single call)
tasca take TASK-001-A
# Owner is auto-detected as "{parent_process}:{pid}:{username}"
# Override via $TASCA_USER env var

# 6. Agent marks done
tasca done TASK-001-A --result "typecheck ✓ test ✓"

# 7. Export content when needed
tasca spec content SPEC-001 > /tmp/spec.md
tasca plan show SPEC-001 > /tmp/plan.md
```

## Commands

| Command | Purpose |
|---|---|
| `tasca init` | Create `.tasca/tasks.db` in cwd |
| `tasca status` | Summary: pending / in_progress / completed counts |
| `tasca list [filters]` | List tasks with optional filters |
| `tasca add ID "subject"` | Create a new task |
| `tasca show ID` | Show full task detail |
| `tasca take ID` | Atomically claim a pending task |
| `tasca done ID --result "..."` | Mark task completed |
| `tasca fail ID --error "..."` | Mark task failed |
| `tasca block ID --by BLOCKER` | Add a dependency |
| `tasca spec add ID "title"` | Register a spec |
| `tasca spec list` | List all specs |
| `tasca spec show ID` | Spec details |
| `tasca spec start ID` | Mark spec as in progress |
| `tasca spec done ID --pr N` | Mark spec as completed |
| `tasca server [--port N]` | Start HTTP dashboard + REST API |

Run `tasca --help` for full flag reference.

## Dashboard & API

```bash
tasca server                  # starts on http://127.0.0.1:8272 (TASC on phone keypad)
tasca server --port 8080      # custom port
```

The dashboard is a single self-contained HTML page (no external assets, ships
inside the compiled binary). Features:

- **Real-time updates via SSE** — no polling; dashboard reacts instantly to CLI mutations from any process
- **Markdown rendering** — spec content, plans, descriptions all render properly
- **Action buttons** — take / done / fail tasks and start / done specs directly from the UI
- **Create from UI** — new spec / new task forms with markdown editor
- **Full-text search** — searches across specs (title + content) and tasks (subject + description)
- **Live indicator** — green pulse = SSE connected, red = disconnected

### REST API

#### Read endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/status` | Stats: counts per status |
| GET | `/api/specs` | Specs with task summary and latest plan version |
| GET | `/api/specs/:id` | Spec + tasks + plans + latest plan content |
| GET | `/api/specs/:id/content` | Raw markdown of the spec |
| GET | `/api/specs/:id/plan` | Raw markdown of the latest plan |
| GET | `/api/tasks?status=&spec=&owner=` | Filtered task list |
| GET | `/api/tasks/:id` | Single task |
| GET | `/api/events?limit=N` | Recent audit log entries |
| GET | `/api/search?q=...` | Search specs and tasks |
| GET | `/api/events/stream` | SSE stream of new events as they happen |

#### Mutation endpoints (since v0.4)

| Method | Path | Body |
|---|---|---|
| POST | `/api/specs` | `{id, title, content?}` |
| POST | `/api/specs/:id/start` | `{}` |
| POST | `/api/specs/:id/done` | `{pr?, merged_date?}` |
| POST | `/api/specs/:id/content` | `{content}` (replace) |
| POST | `/api/specs/:id/plans` | `{content}` (new version) |
| POST | `/api/tasks` | `{id, subject, description?, spec_id?, packages?, quality_gates?, blocked_by?}` |
| POST | `/api/tasks/:id/take` | `{owner?}` (atomic; rejects if not pending) |
| POST | `/api/tasks/:id/done` | `{result}` |
| POST | `/api/tasks/:id/fail` | `{error}` |
| POST | `/api/tasks/:id/block` | `{by}` |

Set the `X-Tasca-Actor` header to identify yourself in the audit log
(e.g. `X-Tasca-Actor: dashboard`, `X-Tasca-Actor: ci-bot`). If unset, the
server infers actor from the User-Agent.

### Security notes

The server binds to `127.0.0.1` by default — no external access. There is no
authentication built in; the model assumes the local machine is trusted (same
as a dev server). If you bind to `0.0.0.0`, put it behind a reverse proxy with
auth.

## Output formats

```bash
tasca list                # auto: color if TTY, plain otherwise
tasca list --plain        # explicit plain (no ANSI codes)
tasca list --json         # JSON for agents and scripts
```

## Integration with Claude Code superpowers

The `tasca` CLI is designed to replace the markdown side-effects of the [superpowers](https://github.com/anthropics/superpowers) SDD skills:

| Superpowers skill | What it does today | With tasca |
|---|---|---|
| `brainstorming` | Writes `docs/superpowers/specs/*.md` | Calls `tasca spec add SPEC-X --path ...` |
| `writing-plans` | Writes `docs/superpowers/plans/*.md` with task checkboxes | Calls `tasca add TASK-X --spec SPEC-X --desc ...` for each task |
| `subagent-driven-development` | Reads plan markdown repeatedly per subagent | Each subagent calls `tasca take TASK-X` once and gets everything |

A companion `tasca-for-superpowers` skill/plugin (TBD) will provide the glue.

## Architecture

```
~/.tasca/                          (future) global config
<project>/.tasca/tasca.db          local SQLite, auto-discovered like .git

Tables:
  specs  (id, numero, title, status, content TEXT, pr, merged_date, ...)
  plans  (id, spec_id FK, content TEXT, version, created_at)
         indexed on spec_id for fast lookup; unique(spec_id, version)
  tasks  (id, spec_id, subject, description, status, owner,
          blocked_by, packages, quality_gates, result, error, ...)
  events (append-only audit log of every operation, with actor)
```

`tasca` walks up the directory tree from `cwd` looking for `.tasca/tasca.db`, the same way git locates `.git`. This means you can run `tasca` commands from any subdirectory of your project.

### Why the content lives in the DB

`tasca` stores the actual markdown of specs and plans inside SQLite, not as paths to external files. This means:
- `tasca` is the single source of truth — no risk of broken paths or moved files
- Plans can have multiple versions tracked (revisions during refinement)
- Export to markdown is trivial: `tasca spec content SPEC-X > spec.md`
- An agent calling `tasca spec content SPEC-X` gets the same bytes the human gets, deterministically

### Audit log

Every mutation records an event in the `events` table with an `actor` identifier of the form `{parent_process}:{pid}:{username}` (e.g., `claude:12345:m`, `opencode:67890:m`, `bash:99999:m`). Override with `$TASCA_USER` for explicit agent identity.

## License

MIT
