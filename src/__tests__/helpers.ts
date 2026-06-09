import { initDb, openDb } from '../db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'tasca-test-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  initDb();
  const db = openDb();
  return {
    db,
    cleanup: () => {
      db.close();
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true });
    },
  };
}
