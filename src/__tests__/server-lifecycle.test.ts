import { describe, it, expect, afterEach } from "bun:test";
import { resolve } from "node:path";
import { createTempDb } from "./helpers";
import {
  readServerState,
  writeServerState,
  repairServerState,
  findFreePort,
  isPortInUse,
} from "../server-state";
import type { DbInstance } from "../db";

const cliPath = resolve(import.meta.dir, "..", "cli.ts");

function runCli(args: string[], cwd: string) {
  return Bun.spawn([process.execPath, cliPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function runCliSync(args: string[], cwd: string) {
  return Bun.spawnSync([process.execPath, cliPath, ...args], { cwd });
}

async function waitForServerUp(
  pid: number,
  port: number,
  timeout = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      // not alive yet
    }
    if (alive && isPortInUse(port)) {
      // Give the server a moment to finish writing its DB row.
      await new Promise((r) => setTimeout(r, 50));
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `Server ${pid} on port ${port} did not start within ${timeout}ms`,
  );
}

async function waitForServerDown(port: number, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!isPortInUse(port)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Port ${port} is still in use after ${timeout}ms`);
}

describe("server lifecycle", () => {
  let cleanup: (() => void) | undefined;
  let projectDir: string;
  let db: DbInstance;
  let nextBasePort = 18372;

  afterEach(async () => {
    if (projectDir) {
      try {
        runCliSync(["server", "--down"], projectDir);
      } catch {
        // ignore cleanup failures
      }
    }
    cleanup?.();
    cleanup = undefined;
    projectDir = "";
    db = undefined as unknown as DbInstance;
  });

  function initProject() {
    const temp = createTempDb();
    cleanup = temp.cleanup;
    projectDir = process.cwd();
    db = temp.db;
    return temp;
  }

  function reservePort(): number {
    const port = findFreePort(nextBasePort);
    nextBasePort = port + 1;
    return port;
  }

  it("daemon startup writes the child pid to the DB before the parent exits", async () => {
    initProject();
    const port = reservePort();

    const proc = runCli(["server", "-d", "--port", String(port)], projectDir);
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const record = readServerState(db);
    expect(record).not.toBeNull();
    expect(record!.port).toBe(port);
    expect(record!.pid).not.toBe(proc.pid);

    await waitForServerUp(record!.pid, port);
  });

  it("rejects a second daemon server for the same project immediately", async () => {
    initProject();
    const port = reservePort();

    const first = runCli(["server", "-d", "--port", String(port)], projectDir);
    await first.exited;
    const record = readServerState(db);
    expect(record).not.toBeNull();
    await waitForServerUp(record!.pid, port);

    const second = runCli(["server", "-d", "--port", String(port + 1)], projectDir);
    const secondExit = await second.exited;
    expect(secondExit).not.toBe(0);

    const still = readServerState(db);
    expect(still?.pid).toBe(record!.pid);
  });

  it("server --down stops the registered server and clears the DB row", async () => {
    initProject();
    const port = reservePort();

    const up = runCli(["server", "-d", "--port", String(port)], projectDir);
    await up.exited;
    const record = readServerState(db);
    expect(record).not.toBeNull();
    await waitForServerUp(record!.pid, port);

    const down = runCliSync(["server", "--down"], projectDir);
    expect(down.exitCode).toBe(0);
    await waitForServerDown(port);
    expect(readServerState(db)).toBeNull();
  });

  it("server --down also kills unregistered servers with matching project CWD", async () => {
    initProject();
    const port = reservePort();

    // Spawn an orphan server directly. It listens but does not write the DB row.
    const orphan = Bun.spawn(
      [process.execPath, cliPath, "server", "--port", String(port), "--no-preflight"],
      { cwd: projectDir, detached: true, stdout: "ignore", stderr: "ignore" },
    );
    await waitForServerUp(orphan.pid, port);
    expect(readServerState(db)).toBeNull();

    const down = runCliSync(["server", "--down"], projectDir);
    expect(down.exitCode).toBe(0);
    await waitForServerDown(port);
  });

  it("SIGTERM on a running server clears the DB row", async () => {
    initProject();
    const port = reservePort();

    const up = runCli(["server", "-d", "--port", String(port)], projectDir);
    await up.exited;
    const record = readServerState(db);
    expect(record).not.toBeNull();
    await waitForServerUp(record!.pid, port);

    process.kill(record!.pid, "SIGTERM");
    await waitForServerDown(port);
    expect(readServerState(db)).toBeNull();
  });

  it("SIGINT on a running server clears the DB row", async () => {
    initProject();
    const port = reservePort();

    const proc = runCli(["server", "--port", String(port)], projectDir);
    await waitForServerUp(proc.pid, port);
    expect(readServerState(db)).not.toBeNull();

    process.kill(proc.pid, "SIGINT");
    await waitForServerDown(port);
    expect(readServerState(db)).toBeNull();
  });

  it("repairServerState removes a stale row for a dead pid", () => {
    initProject();
    writeServerState(db, reservePort(), 999999);
    expect(repairServerState(db)).toBeNull();
    expect(readServerState(db)).toBeNull();
  });
});
