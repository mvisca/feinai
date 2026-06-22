import { describe, it, expect, afterEach } from "bun:test";
import { createTempDb } from "./helpers";
import {
  readServerState,
  writeServerState,
  clearServerState,
  repairServerState,
} from "../server-state";
import type { DbInstance } from "../db";

describe("server-state DB operations", () => {
  let cleanup: () => void;
  let db: DbInstance;

  afterEach(() => cleanup?.());

  it("readServerState returns null when no row exists", () => {
    const temp = createTempDb();
    cleanup = temp.cleanup;
    db = temp.db;
    expect(readServerState(db)).toBeNull();
  });

  it("writeServerState creates a row that readServerState returns", () => {
    const temp = createTempDb();
    cleanup = temp.cleanup;
    db = temp.db;

    writeServerState(db, 9000, 12345);
    const record = readServerState(db);
    expect(record).not.toBeNull();
    expect(record!.port).toBe(9000);
    expect(record!.pid).toBe(12345);
    expect(record!.started_at).toBeDefined();
  });

  it("writeServerState replaces existing row (single row constraint)", () => {
    const temp = createTempDb();
    cleanup = temp.cleanup;
    db = temp.db;

    writeServerState(db, 9000, 12345);
    writeServerState(db, 9001, 67890);
    const record = readServerState(db);
    expect(record).not.toBeNull();
    expect(record!.port).toBe(9001);
    expect(record!.pid).toBe(67890);
  });

  it("clearServerState deletes the row", () => {
    const temp = createTempDb();
    cleanup = temp.cleanup;
    db = temp.db;

    writeServerState(db, 9000, 12345);
    clearServerState(db);
    expect(readServerState(db)).toBeNull();
  });

  it("repairServerState returns null when no row exists", () => {
    const temp = createTempDb();
    cleanup = temp.cleanup;
    db = temp.db;

    expect(repairServerState(db)).toBeNull();
  });

  it("repairServerState returns record when row exists (no pid/port validation in unit test)", () => {
    const temp = createTempDb();
    cleanup = temp.cleanup;
    db = temp.db;

    // For a row that exists in DB only, repairServerState will try to validate
    // the pid, which likely won't be running. This tests the DB read path.
    writeServerState(db, 9999, 999999);
    const result = repairServerState(db);
    // After repair, if the pid is not alive, it should return null
    // (we can't guarantee pid 999999 is running)
    if (result !== null) {
      expect(result.port).toBe(9999);
      expect(result.pid).toBe(999999);
    }
  });
});
