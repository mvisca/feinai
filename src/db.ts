import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { openSqlite, type DbAdapter } from "./sqlite-adapter";

const DB_DIR = ".feinai";
const DB_FILE = "feinai.db";

// v0.5.x migration: rename .tasca/tasca.db → .feinai/feinai.db
// TODO: remove in v0.7
function migrateLegacyDir(dir: string): void {
  const legacyDir = join(dir, ".tasca");
  const legacyDb = join(legacyDir, "tasca.db");
  const newDir = join(dir, ".feinai");
  const newDb = join(newDir, "feinai.db");
  if (!existsSync(legacyDb) || existsSync(newDb)) return;

  // Prompt user — only works in TTY contexts
  if (process.stdout.isTTY) {
    process.stdout.write(
      `\n⚠  Found legacy .tasca/tasca.db at ${legacyDir}\n` +
      `   Rename to .feinai/feinai.db? [Y/n] `
    );
    const buf = Buffer.alloc(4);
    let answer = "y";
    try {
      const n = require("node:fs").readSync(0, buf, 0, 4, null);
      answer = buf.slice(0, n).toString().trim().toLowerCase() || "y";
    } catch {}
    if (answer !== "y" && answer !== "") {
      process.stdout.write("Skipped. Run 'feinai init' to create a new DB.\n\n");
      return;
    }
  } else {
    // Non-interactive (agent/CI): migrate silently
  }

  if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true });
  renameSync(legacyDb, newDb);
  try { require("node:fs").rmdirSync(legacyDir); } catch {}
  if (process.stdout.isTTY) {
    process.stdout.write(`✓ Migrated to .feinai/feinai.db\n\n`);
  }
}

export type DbInstance = DbAdapter;

/**
 * Schema split into individual statements so we can use db.run() per statement
 * (avoiding the deprecated db.exec(sql, ...bindings) overload).
 */
const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS specs (
    id           TEXT PRIMARY KEY,
    numero       INTEGER,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'lista',
    content      TEXT,
    pr           TEXT,
    merged_date  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    spec_id     TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE ON UPDATE CASCADE,
    content     TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(spec_id, version)
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    spec_id       TEXT REFERENCES specs(id) ON DELETE SET NULL ON UPDATE CASCADE,
    subject       TEXT NOT NULL,
    description   TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    owner         TEXT,
    blocked_by    TEXT NOT NULL DEFAULT '[]',
    packages      TEXT NOT NULL DEFAULT '[]',
    quality_gates TEXT NOT NULL DEFAULT '[]',
    result        TEXT,
    error         TEXT,
    taken_at      TEXT,
    completed_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type  TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    actor        TEXT,
    payload      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_spec_id ON tasks(spec_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner)`,
  `CREATE INDEX IF NOT EXISTS idx_plans_spec_id ON plans(spec_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id)`,

  // Trigger: propagate spec id renames to the polymorphic events audit log.
  // (events.entity_id has no FK — it covers tasks, specs, and plans — so
  //  ON UPDATE CASCADE is not possible; a trigger is the only option.)
  `CREATE TRIGGER IF NOT EXISTS trg_specs_rename_events
   AFTER UPDATE OF id ON specs
   WHEN OLD.id != NEW.id
   BEGIN
     UPDATE events SET entity_id = NEW.id
     WHERE entity_type = 'spec' AND entity_id = OLD.id;
   END`,
];

// Migration: recreate tables that need new FK constraints (ON UPDATE CASCADE).
// SQLite does not support ALTER COLUMN — the only way is recreate + copy.
// Each migration is idempotent: guarded by a user_version pragma bump.
const MIGRATIONS: Array<{ version: number; stmts: string[] }> = [
  {
    version: 1,
    stmts: [
      `ALTER TABLE plans RENAME TO _plans_old`,
      `CREATE TABLE plans (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        spec_id     TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE ON UPDATE CASCADE,
        content     TEXT NOT NULL,
        version     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(spec_id, version)
      )`,
      `INSERT INTO plans SELECT * FROM _plans_old`,
      `DROP TABLE _plans_old`,
      `ALTER TABLE tasks RENAME TO _tasks_old`,
      `CREATE TABLE tasks (
        id            TEXT PRIMARY KEY,
        spec_id       TEXT REFERENCES specs(id) ON DELETE SET NULL ON UPDATE CASCADE,
        subject       TEXT NOT NULL,
        description   TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        owner         TEXT,
        blocked_by    TEXT NOT NULL DEFAULT '[]',
        packages      TEXT NOT NULL DEFAULT '[]',
        quality_gates TEXT NOT NULL DEFAULT '[]',
        result        TEXT,
        error         TEXT,
        taken_at      TEXT,
        completed_at  TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `INSERT INTO tasks SELECT * FROM _tasks_old`,
      `DROP TABLE _tasks_old`,
    ],
  },
  {
    version: 2,
    stmts: [
      `ALTER TABLE tasks ADD COLUMN worktree TEXT`,
    ],
  },
];

function applyMigrations(db: DbInstance): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.run("PRAGMA foreign_keys = OFF");
    for (const stmt of migration.stmts) db.run(stmt);
    db.run(`PRAGMA user_version = ${migration.version}`);
    db.run("PRAGMA foreign_keys = ON");
  }
}

function applySchema(db: DbInstance): void {
  for (const stmt of SCHEMA_STATEMENTS) {
    db.run(stmt);
  }
  applyMigrations(db);
}

/**
 * Find .feinai/feinai.db by walking up from cwd, like git does with .git.
 * Returns null if no DB exists in the tree above the starting directory.
 */
export function findDbPath(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir);
  while (true) {
    // migrate legacy .tasca/tasca.db → .feinai/feinai.db if found
    migrateLegacyDir(current);
    const candidate = join(current, DB_DIR, DB_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Initialize a new feinai DB in the given directory (default: cwd).
 * Returns the absolute path of the created DB file.
 */
export function initDb(dir: string = process.cwd()): string {
  const tascaDir = join(dir, DB_DIR);
  const dbPath = join(tascaDir, DB_FILE);

  if (!existsSync(tascaDir)) {
    mkdirSync(tascaDir, { recursive: true });
  }

  const db = openSqlite(dbPath, { create: true });
  db.run("PRAGMA foreign_keys = ON;");
  applySchema(db);
  db.close();

  return dbPath;
}

/**
 * Open the DB found by auto-discovery, or throw if none exists.
 */
export function openDb(): DbInstance {
  const path = findDbPath();
  if (!path) {
    throw new Error(
      `No feinai DB found. Run 'feinai init' to create one in the current directory.`,
    );
  }
  const db = openSqlite(path);
  db.run("PRAGMA foreign_keys = ON;");
  // Apply any new statements that didn't exist when DB was created (safe due to IF NOT EXISTS).
  applySchema(db);
  return db;
}

/**
 * Record an event in the events log (append-only audit trail).
 */
export function recordEvent(
  db: DbInstance,
  entityType: "task" | "spec" | "plan",
  entityId: string,
  eventType: string,
  payload: object | null = null,
  actor: string | null = null,
): void {
  db.prepare(
    `INSERT INTO events (entity_type, entity_id, event_type, actor, payload)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    entityType,
    entityId,
    eventType,
    actor,
    payload ? JSON.stringify(payload) : null,
  );
}
