import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface WorktreeStatus {
  exists: boolean;
  merged: boolean;
  gitClean: boolean;
  files: string[];
  lastCommit: string | null;
  branch: string | null;
  error: string | null;
}

export async function inspectWorktree(worktreePath: string | null): Promise<WorktreeStatus> {
  if (!worktreePath) {
    return {
      exists: false,
      merged: false,
      gitClean: false,
      files: [],
      lastCommit: null,
      branch: null,
      error: null,
    };
  }

  const resolved = resolve(worktreePath);
  if (!existsSync(resolved)) {
    return {
      exists: false,
      merged: false,
      gitClean: false,
      files: [],
      lastCommit: null,
      branch: null,
      error: null,
    };
  }

  try {
    // git status --short
    const statusResult = await Bun.$`git status --short`.cwd(resolved).quiet();
    const statusText = statusResult.text().trim();
    const files = statusText ? statusText.split("\n") : [];
    const gitClean = files.length === 0;

    // git log -1 --oneline
    let lastCommit: string | null = null;
    try {
      const logResult = await Bun.$`git log -1 --oneline`.cwd(resolved).quiet();
      lastCommit = logResult.text().trim() || null;
    } catch {
      lastCommit = null;
    }

    // git rev-parse --abbrev-ref HEAD
    let branch: string | null = null;
    try {
      const branchResult = await Bun.$`git rev-parse --abbrev-ref HEAD`.cwd(resolved).quiet();
      branch = branchResult.text().trim() || null;
    } catch {
      branch = null;
    }

    // Detect merged: check if branch is in main's merge history
    let merged = false;
    if (branch && branch !== "HEAD" && branch !== "main") {
      try {
        const mergedResult = await Bun.$`git branch --merged main`.cwd(resolved).quiet();
        const mergedBranches = mergedResult.text().trim().split("\n").map((b) => b.replace(/^\*\s*/, "").trim());
        merged = mergedBranches.includes(branch);
      } catch {
        merged = false;
      }
    }

    return {
      exists: true,
      merged,
      gitClean,
      files,
      lastCommit,
      branch,
      error: null,
    };
  } catch (err) {
    return {
      exists: true,
      merged: false,
      gitClean: false,
      files: [],
      lastCommit: null,
      branch: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
