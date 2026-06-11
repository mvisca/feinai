# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.6.3] - 2026-06-11

### Fixed
- `feinai --version` now reports the correct version number
- `feinai edit <TASK-ID> --worktree <path>` no longer throws "provide at least one field to edit" when `--worktree` is the only flag passed

## [0.5.0] - 2026-06-10

### Added
- `tasca git <cmd>` — safe git wrapper subcommand. Passes through to `opengit`, enforcing a worktree-only whitelist (blocks branch, merge, rebase, checkout, etc.)
- `opengit` shipped as a binary alongside `tasca` — `bun install -g tasca` now installs both
- `tasca unblock <TASK-ID> --dep <TASK-ID>` — remove a specific dependency from a task
- `tasca edit --clear-blocked-by` — clear all dependencies from a task
- Live Agents Monitor: working directory, repo name, and `.tasca` path shown per agent card
- Live Agents Monitor: presence indicator — gray dot when idle, green dot with ripple animation when agents are active
- Live Agents Monitor: elapsed time and spec ID per card
- `tasca init` now auto-adds `.tasca/` to `.gitignore` if in a git repo
- Skills: `tasca-implement` — claim one pending task, implement in isolated worktree, run quality gates, push to main

### Changed
- Dashboard is now English-only — removed i18n/language selector
- `tasca-implement` SKILL.md updated to use `tasca git` instead of `opengit` directly
- `package.json`: added `repository`, `homepage`, `bugs` fields

### Skills included
`tasca-sdd` · `tasca-write-spec` · `tasca-write-tasks` · `tasca-dispatch` · `tasca-implement`

---

## [0.4.0] - 2026-06-08

Initial public release. Core CLI with specs, plans, tasks, HTTP dashboard, and SDD skills.

### Features
- `tasca init / status / list / add / show / take / done / fail / block / release / reopen / edit`
- `tasca spec` — spec lifecycle (add, start, done, archive, set-content, edit)
- `tasca plan` — plan revisions per spec
- `tasca server` — HTTP dashboard + REST API + SSE live updates
- Live Agents Monitor — real-time view of in-progress tasks with worktree state
- Atomic `take` — SQL-level concurrency safety for parallel agents
- Append-only events audit log
- Skills: `tasca-sdd`, `tasca-write-spec`, `tasca-write-tasks`, `tasca-dispatch`
