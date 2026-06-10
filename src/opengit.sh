#!/bin/bash
# opengit - Safe git wrapper for OpenCode worktree-only workflow
#
# This script enforces a whitelist of git commands and blocks operations
# that could interfere with parallel worktree-based work by other agents.
#
# CRITICAL: OpenCode must use `opengit` instead of `git` for all operations.
# Other agents work in worktrees simultaneously — no branch changes allowed.

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ─────────────────────────────────────────────────────────────────────────
# Allowed commands (whitelist-only)
# ─────────────────────────────────────────────────────────────────────────

# Worktree operations (primary workflow)
ALLOW_WORKTREE=1

# Read-only operations (status checks)
ALLOW_STATUS=1
ALLOW_DIFF=1
ALLOW_LOG=1
ALLOW_SHOW=1

# Worktree lifecycle operations (add files, commit, push)
ALLOW_ADD=1
ALLOW_COMMIT=1
ALLOW_PUSH=1

# ─────────────────────────────────────────────────────────────────────────
# Prohibited commands (explicit deny list)
# ─────────────────────────────────────────────────────────────────────────

PROHIBITED=(
  "branch"         # No creating/deleting branches — use worktrees only
  "checkout"       # No switching branches — stays in worktree
  "switch"         # No switching branches — stays in worktree
  "merge"          # No merging — prevents conflicts during parallel work
  "rebase"         # No rebasing — prevents conflicts during parallel work
  "reset"          # No destructive resets — preserves work
  "tag"            # No tags — infrastructure operation, not workflow
  "stash"          # No stashing — preserves all work in worktree
  "cherry-pick"    # No cherry-picking — use proper merge instead
  "fetch"          # No fetch — could introduce divergence
  "pull"           # No pull — pull = fetch + merge, both problematic
  "remote"         # No remote management — infrastructure operation
  "clone"          # No clone — infrastructure operation
  "rm"             # No rm — use standard shell tools
  "mv"             # No mv — use standard shell tools
  "clean"          # No clean — destructive, use explicit commands
)

# ─────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────

die() {
  echo -e "${RED}Error: $*${NC}" >&2
  exit 1
}

warn() {
  echo -e "${YELLOW}Warning: $*${NC}" >&2
}

# ─────────────────────────────────────────────────────────────────────────
# Main logic
# ─────────────────────────────────────────────────────────────────────────

if [ $# -eq 0 ]; then
  die "opengit requires a command (e.g., 'opengit worktree add', 'opengit commit -m ...')"
fi

cmd="$1"

# Check if command is prohibited
for prohibited_cmd in "${PROHIBITED[@]}"; do
  if [ "$cmd" = "$prohibited_cmd" ]; then
    die "'$cmd' is not allowed in worktree-only workflow (other agents work in parallel worktrees)"
  fi
done

# Dispatch to allowed commands
case "$cmd" in
  worktree)
    # All worktree subcommands allowed: add, remove, list, lock, unlock
    exec /usr/bin/git "$@"
    ;;
  status|diff|log|show)
    # Read-only status commands
    exec /usr/bin/git "$@"
    ;;
  add)
    # Stage files for commit (required in worktree lifecycle)
    exec /usr/bin/git "$@"
    ;;
  commit)
    # Create commits (required in worktree lifecycle)
    exec /usr/bin/git "$@"
    ;;
  push)
    # Push commits to remote (required in worktree lifecycle)
    exec /usr/bin/git "$@"
    ;;
  complete)
    # Sync main branch after a worktree push. Run from repo root.
    exec /usr/bin/git pull --ff-only
    ;;
  *)
    die "unknown or disallowed git command '$cmd' (not in whitelist)"
    ;;
esac
