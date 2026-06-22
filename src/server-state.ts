import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { DbInstance } from "./db";

export interface ServerState {
  port: number;
  pid: number;
  started_at: string;
}

/**
 * Read the single server_state row from the DB.
 * Returns null if no row exists.
 */
export function readServerState(db: DbInstance): ServerState | null {
  const row = db
    .prepare("SELECT port, pid, started_at FROM server_state WHERE id = 1")
    .get() as { port: number; pid: number; started_at: string } | undefined;
  return row ?? null;
}

/**
 * Write (insert or replace) the server_state row.
 */
export function writeServerState(db: DbInstance, port: number, pid: number): void {
  db.run(
    `INSERT OR REPLACE INTO server_state (id, port, pid, started_at, updated_at)
     VALUES (1, ?, ?, datetime('now'), datetime('now'))`,
    port,
    pid,
  );
}

/**
 * Delete the server_state row.
 */
export function clearServerState(db: DbInstance): void {
  db.run("DELETE FROM server_state WHERE id = 1");
}

/**
 * Check whether the given port is in use by any process.
 * Uses lsof on Linux/macOS.
 */
export function isPortInUse(port: number): boolean {
  try {
    const result = spawnSync("lsof", ["-ti", `tcp:${port}`]);
    return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Scan upward from startPort until a free port is found.
 * Returns the first free port.
 */
export function findFreePort(startPort: number): number {
  let port = startPort;
  while (isPortInUse(port)) {
    port++;
    if (port > startPort + 100) {
      throw new Error(
        `No free port found after scanning from ${startPort} to ${port}`,
      );
    }
  }
  return port;
}

/**
 * Return the pid(s) listening on the given port.
 * Uses lsof -ti tcp:${port} and parses the output.
 * Returns an array of pids, empty if none.
 */
function pidsOnPort(port: number): number[] {
  try {
    const result = spawnSync("lsof", ["-ti", `tcp:${port}`]);
    if (result.exitCode !== 0) return [];
    const out = result.stdout.toString().trim();
    if (!out) return [];
    return out
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
  } catch {
    return [];
  }
}

/**
 * Check if a specific pid is running.
 * Uses kill(pid, 0) via /proc on Linux or kill command.
 */
function isPidRunning(pid: number): boolean {
  try {
    // kill(pid, 0) checks if the process exists without sending a signal
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

/**
 * Get the port that a specific pid is listening on.
 * Returns the port number or null if the pid has no tcp listeners.
 */
function portOfPid(pid: number): number | null {
  try {
    const result = spawnSync("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-p", String(pid)]);
    if (result.exitCode !== 0) return null;
    // Parse lsof output: find "TCP *:{port}" pattern
    const out = result.stdout.toString();
    const match = out.match(/TCP\s+\*:(\d+)/);
    if (match) return parseInt(match[1]!, 10);
    // Alternate format: "LISTEN" followed by port
    const altMatch = out.match(/:(\d+)\s.*LISTEN/);
    if (altMatch) return parseInt(altMatch[1]!, 10);
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate the server_state row for consistency.
 *
 * A row is considered valid only when:
 * - The stored pid is running AND
 * - That pid is listening on the stored port
 *
 * If the row is stale (in any way), it is deleted and false is returned.
 *
 * Returns { valid: boolean, record: ServerState | null }
 */
export function validateServerState(db: DbInstance): {
  valid: boolean;
  record: ServerState | null;
} {
  const record = readServerState(db);
  if (!record) return { valid: false, record: null };

  // Check if stored pid is running
  if (!isPidRunning(record.pid)) {
    clearServerState(db);
    return { valid: false, record: null };
  }

  // Check what pids are listening on the stored port
  const pids = pidsOnPort(record.port);
  if (pids.length === 0) {
    // Port has no listener at all
    clearServerState(db);
    return { valid: false, record: null };
  }
  if (!pids.includes(record.pid)) {
    // Port is busy but by a different pid
    clearServerState(db);
    return { valid: false, record: null };
  }

  // Check that the stored pid is listening on the stored port specifically
  const actualPort = portOfPid(record.pid);
  if (actualPort !== null && actualPort !== record.port) {
    // The pid is running but listening on a different port
    clearServerState(db);
    return { valid: false, record: null };
  }

  return { valid: true, record };
}

/**
 * Repair the server_state row: validate consistency, delete if stale.
 * Returns the valid record or null if stale/missing.
 */
export function repairServerState(db: DbInstance): ServerState | null {
  const { valid, record } = validateServerState(db);
  return valid ? record : null;
}
