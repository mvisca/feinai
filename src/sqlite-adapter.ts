/**
 * SQLite backend detection and thin adapter.
 *
 * Tries backends in order (least to most external deps):
 *   1. bun:sqlite      — built-in when running under Bun
 *   2. node:sqlite     — built-in since Node 22.5 (experimental)
 *   3. better-sqlite3  — npm optional dependency
 *
 * All three share the same synchronous .prepare().run/.get/.all API,
 * so the adapter surface is minimal.
 */

export interface Statement {
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

export interface DbAdapter {
  prepare(sql: string): Statement;
  run(sql: string, ...args: unknown[]): void;
  close(): void;
}

type DbConstructor = (path: string, options?: { create?: boolean }) => DbAdapter;

// ---- backend loaders -------------------------------------------------------

function loadBun(): DbConstructor | null {
  try {
    // Only attempt if we're actually running under Bun
    if (typeof (globalThis as unknown as { Bun?: unknown }).Bun === "undefined") return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Database } = require("bun:sqlite") as { Database: new (path: string, opts?: { create?: boolean }) => DbAdapter };
    return (path, opts) => new Database(path, opts);
  } catch {
    return null;
  }
}

function loadNodeSqlite(): DbConstructor | null {
  try {
    // node:sqlite is available in Node 22.5+ (experimental)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string, opts?: { open?: boolean }) => {
        prepare(sql: string): {
          run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
          get(...args: unknown[]): unknown;
          all(...args: unknown[]): unknown[];
        };
        exec(sql: string): void;
        close(): void;
      };
    };
    return (path, opts) => {
      const raw = new DatabaseSync(path, { open: opts?.create !== false });
      return {
        prepare: (sql) => raw.prepare(sql),
        run: (sql, ...args) => {
          if (args.length === 0) {
            raw.exec(sql);
          } else {
            raw.prepare(sql).run(...args);
          }
        },
        close: () => raw.close(),
      };
    };
  } catch {
    return null;
  }
}

function loadBetterSqlite3(): DbConstructor | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require("better-sqlite3") as new (path: string, opts?: { readonly?: boolean }) => {
      prepare(sql: string): Statement;
      exec(sql: string): void;
      close(): void;
    };
    return (path) => {
      const raw = new BetterSqlite3(path);
      return {
        prepare: (sql) => raw.prepare(sql),
        run: (sql, ...args) => {
          if (args.length === 0) {
            raw.exec(sql);
          } else {
            raw.prepare(sql).run(...args);
          }
        },
        close: () => raw.close(),
      };
    };
  } catch {
    return null;
  }
}

// ---- public API ------------------------------------------------------------

let _constructor: DbConstructor | null | undefined = undefined;

export function getSqliteConstructor(): DbConstructor {
  if (_constructor !== undefined) return _constructor!;

  _constructor =
    loadBun() ??
    loadNodeSqlite() ??
    loadBetterSqlite3() ??
    null;

  if (!_constructor) {
    console.error(`
Error: No SQLite backend found. tasca requires one of:
  • Bun 1.0+       (current runtime)
  • Node.js 22.5+  (built-in node:sqlite)
  • better-sqlite3 (npm install -g better-sqlite3)
`);
    process.exit(1);
  }

  return _constructor;
}

export function openSqlite(path: string, opts?: { create?: boolean }): DbAdapter {
  return getSqliteConstructor()(path, opts);
}
