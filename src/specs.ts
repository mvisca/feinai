import type { DbInstance } from "./db";
import { recordEvent } from "./db";

export type SpecStatus = "lista" | "en_progreso" | "hecha" | "archivada";

export interface Spec {
  id: string;
  numero: number | null;
  title: string;
  status: SpecStatus;
  content: string | null;
  pr: string | null;
  merged_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: number;
  spec_id: string;
  content: string;
  version: number;
  created_at: string;
}

export interface AddSpecInput {
  id: string;
  title: string;
  numero?: number;
  content?: string;
}

export function listSpecs(db: DbInstance, status?: SpecStatus): Spec[] {
  const sql = status
    ? "SELECT * FROM specs WHERE status = ? ORDER BY numero ASC"
    : "SELECT * FROM specs ORDER BY numero ASC";
  const args = status ? [status] : [];
  return db.prepare(sql).all(...args) as Spec[];
}

export function getSpec(db: DbInstance, id: string): Spec | null {
  return db.prepare("SELECT * FROM specs WHERE id = ?").get(id) as Spec | null;
}

export function addSpec(db: DbInstance, input: AddSpecInput, actor: string | null = null): Spec {
  // Auto-extract numero from id if not provided (e.g., SPEC-121 → 121)
  let numero = input.numero;
  if (numero === undefined) {
    const match = input.id.match(/(\d+)$/);
    numero = match ? Number(match[1]) : null as unknown as number;
  }

  db.prepare(
    `INSERT INTO specs (id, numero, title, content)
     VALUES (?, ?, ?, ?)`,
  ).run(input.id, numero ?? null, input.title, input.content ?? null);

  recordEvent(db, "spec", input.id, "created", { title: input.title }, actor);

  return getSpec(db, input.id) as Spec;
}

export function startSpec(db: DbInstance, id: string, actor: string | null = null): Spec {
  const upd = db
    .prepare(
      `UPDATE specs SET status = 'en_progreso', updated_at = datetime('now')
       WHERE id = ? AND status = 'lista'`,
    )
    .run(id);

  if (upd.changes === 0) {
    const existing = getSpec(db, id);
    if (!existing) throw new Error(`Spec ${id} not found`);
    throw new Error(`Spec ${id} cannot be started (status: ${existing.status})`);
  }

  recordEvent(db, "spec", id, "started", null, actor);
  return getSpec(db, id) as Spec;
}

export function doneSpec(
  db: DbInstance,
  id: string,
  opts: { pr?: string; merged_date?: string } = {},
  actor: string | null = null,
): Spec {
  const upd = db
    .prepare(
      `UPDATE specs SET status = 'hecha',
        pr = COALESCE(?, pr),
        merged_date = COALESCE(?, merged_date),
        updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(opts.pr ?? null, opts.merged_date ?? null, id);

  if (upd.changes === 0) {
    throw new Error(`Spec ${id} not found`);
  }

  recordEvent(db, "spec", id, "completed", opts, actor);
  return getSpec(db, id) as Spec;
}

/**
 * Update the spec's markdown content. Useful when brainstorming refines a spec.
 */
export function setSpecContent(
  db: DbInstance,
  id: string,
  content: string,
  actor: string | null = null,
): Spec {
  const upd = db
    .prepare(
      `UPDATE specs SET content = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .run(content, id);

  if (upd.changes === 0) throw new Error(`Spec ${id} not found`);
  recordEvent(db, "spec", id, "content_updated", { bytes: content.length }, actor);
  return getSpec(db, id) as Spec;
}

export interface EditSpecInput {
  title?: string;
}

export function editSpec(
  db: DbInstance,
  id: string,
  input: EditSpecInput,
  actor: string | null = null,
): Spec {
  if (input.title === undefined) {
    throw new Error('editSpec: provide at least one field to edit');
  }

  const spec = getSpec(db, id);
  if (!spec) throw new Error(`Spec ${id} not found`);

  const sets: string[] = ["updated_at = datetime('now')"];
  const args: (string | null)[] = [];
  const changed: Record<string, unknown> = {};

  if (input.title !== undefined) {
    sets.push('title = ?');
    args.push(input.title);
    changed.title = input.title;
  }

  args.push(id);
  db.prepare(`UPDATE specs SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  recordEvent(db, 'spec', id, 'edited', changed, actor);

  return getSpec(db, id) as Spec;
}

/**
 * Add a new plan revision for a spec. Each new plan gets the next version number.
 */
export function addPlan(
  db: DbInstance,
  specId: string,
  content: string,
  actor: string | null = null,
): Plan {
  const spec = getSpec(db, specId);
  if (!spec) throw new Error(`Spec ${specId} not found`);

  const row = db
    .prepare(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM plans WHERE spec_id = ?`,
    )
    .get(specId) as { max_version: number };

  const nextVersion = row.max_version + 1;

  const insert = db
    .prepare(
      `INSERT INTO plans (spec_id, content, version) VALUES (?, ?, ?)
       RETURNING *`,
    )
    .get(specId, content, nextVersion) as Plan;

  recordEvent(
    db,
    "plan",
    String(insert.id),
    "created",
    { spec_id: specId, version: nextVersion, bytes: content.length },
    actor,
  );

  return insert;
}

/**
 * Get the latest plan for a spec, or null if no plan exists.
 */
export function getLatestPlan(db: DbInstance, specId: string): Plan | null {
  return db
    .prepare(
      `SELECT * FROM plans WHERE spec_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(specId) as Plan | null;
}

/**
 * Get all plans for a spec (history), ordered oldest → newest.
 */
export function listPlans(db: DbInstance, specId: string): Plan[] {
  return db
    .prepare(`SELECT * FROM plans WHERE spec_id = ? ORDER BY version ASC`)
    .all(specId) as Plan[];
}

/**
 * Archive a spec and unassign its tasks so they disappear from active task lists.
 */
export function archiveSpec(
  db: DbInstance,
  id: string,
  actor: string | null = null,
): Spec {
  const spec = getSpec(db, id);
  if (!spec) throw new Error(`Spec ${id} not found`);

  const upd = db
    .prepare(
      `UPDATE specs SET status = 'archivada', updated_at = datetime('now') WHERE id = ?`,
    )
    .run(id);

  if (upd.changes === 0) throw new Error(`Spec ${id} could not be archived`);

  // Unassign owner and set status to pending for all related tasks so they leave active lists
  db.prepare(
    `UPDATE tasks SET status = 'pending', owner = NULL, taken_at = NULL, updated_at = datetime('now') WHERE spec_id = ?`,
  ).run(id);

  recordEvent(db, "spec", id, "archived", { title: spec.title }, actor);
  return getSpec(db, id) as Spec;
}

/**
 * Unarchive a spec — restore it to active work.
 */
export function unarchiveSpec(
  db: DbInstance,
  id: string,
  actor: string | null = null,
): Spec {
  const spec = getSpec(db, id);
  if (!spec) throw new Error(`Spec ${id} not found`);

  const upd = db
    .prepare(
      `UPDATE specs SET status = 'lista', updated_at = datetime('now') WHERE id = ? AND status = 'archivada'`,
    )
    .run(id);

  if (upd.changes === 0) throw new Error(`Spec ${id} is not archived`);

  recordEvent(db, "spec", id, "unarchived", { title: spec.title }, actor);
  return getSpec(db, id) as Spec;
}

/**
 * Delete a spec and all related data (plans, tasks) in cascade.
 */
export function deleteSpec(
  db: DbInstance,
  id: string,
  actor: string | null = null,
): { deleted: boolean } {
  const spec = getSpec(db, id);
  if (!spec) throw new Error(`Spec ${id} not found`);

  // Delete related tasks first (foreign key, though SQLite may not enforce without PRAGMA)
  db.prepare(`DELETE FROM tasks WHERE spec_id = ?`).run(id);
  // Delete plans
  db.prepare(`DELETE FROM plans WHERE spec_id = ?`).run(id);
  // Delete spec
  db.prepare(`DELETE FROM specs WHERE id = ?`).run(id);

  recordEvent(db, "spec", id, "deleted", { title: spec.title }, actor);
  return { deleted: true };
}
