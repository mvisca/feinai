import type { DbInstance } from "./db";
import { recordEvent } from "./db";
import { getSpec, doneSpec, startSpec } from "./specs";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "deleted";

export interface Task {
  id: string;
  spec_id: string | null;
  subject: string;
  description: string | null;
  status: TaskStatus;
  owner: string | null;
  worktree: string | null;
  blocked_by: string[];
  packages: string[];
  quality_gates: string[];
  result: string | null;
  error: string | null;
  taken_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  spec_id: string | null;
  subject: string;
  description: string | null;
  status: TaskStatus;
  owner: string | null;
  worktree: string | null;
  blocked_by: string;
  packages: string;
  quality_gates: string;
  result: string | null;
  error: string | null;
  taken_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    blocked_by: JSON.parse(row.blocked_by),
    packages: JSON.parse(row.packages),
    quality_gates: JSON.parse(row.quality_gates),
  };
}

export interface ListFilter {
  status?: TaskStatus;
  spec_id?: string;
  owner?: string;
  pending?: boolean;
}

export function listTasks(db: DbInstance, filter: ListFilter = {}): Task[] {
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (filter.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  if (filter.pending) {
    where.push("status = ?");
    args.push("pending");
  }
  if (filter.spec_id) {
    where.push("spec_id = ?");
    args.push(filter.spec_id);
  }
  if (filter.owner) {
    where.push("owner = ?");
    args.push(filter.owner);
  }

  // Exclude tasks from archived specs so archived work leaves the active task list
  where.push("(spec_id IS NULL OR spec_id NOT IN (SELECT id FROM specs WHERE status = 'archivada'))");

  const sql =
    `SELECT * FROM tasks` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY id ASC`;

  const rows = db.prepare(sql).all(...args) as TaskRow[];
  return rows.map(rowToTask);
}

export function getTask(db: DbInstance, id: string): Task | null {
  const row = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as TaskRow | null;
  return row ? rowToTask(row) : null;
}

export interface AddTaskInput {
  id: string;
  subject: string;
  description?: string;
  spec_id?: string;
  packages?: string[];
  quality_gates?: string[];
  blocked_by?: string[];
}

export function addTask(db: DbInstance, input: AddTaskInput): Task {
  db.prepare(
    `INSERT INTO tasks (id, spec_id, subject, description, packages, quality_gates, blocked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.spec_id ?? null,
    input.subject,
    input.description ?? null,
    JSON.stringify(input.packages ?? []),
    JSON.stringify(input.quality_gates ?? []),
    JSON.stringify(input.blocked_by ?? []),
  );

  recordEvent(db, "task", input.id, "created", { subject: input.subject });

  const task = getTask(db, input.id);
  if (!task) throw new Error(`Failed to retrieve newly created task ${input.id}`);
  return task;
}

/**
 * Take a task atomically: update status only if currently 'pending'.
 * Returns the task with all info needed for execution.
 * Throws if task doesn't exist or is not pending.
 */
export function takeTask(
  db: DbInstance,
  id: string,
  owner: string,
): Task {
  const result = db
    .prepare(
      `UPDATE tasks
       SET status = 'in_progress',
           owner = ?,
           taken_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
    )
    .run(owner, id);

  if (result.changes === 0) {
    const existing = getTask(db, id);
    if (!existing) throw new Error(`Task ${id} not found`);
    throw new Error(
      `Task ${id} cannot be taken (status: ${existing.status}, owner: ${existing.owner ?? "none"})`,
    );
  }

  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} disappeared after take`);

  if (task.spec_id) {
    const spec = getSpec(db, task.spec_id);
    if (spec && spec.status === 'lista') {
      startSpec(db, task.spec_id, owner);
    }
  }

  recordEvent(db, "task", id, "taken", { owner }, owner);
  return task;
}

export function doneTask(
  db: DbInstance,
  id: string,
  result: string,
  actor: string | null = null,
): Task {
  const upd = db
    .prepare(
      `UPDATE tasks
       SET status = 'completed',
           result = ?,
           worktree = NULL,
           completed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND status = 'in_progress'`,
    )
    .run(result, id);

  if (upd.changes === 0) {
    const existing = getTask(db, id);
    if (!existing) throw new Error(`Task ${id} not found`);
    throw new Error(
      `Task ${id} cannot be marked done (status: ${existing.status})`,
    );
  }

  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} disappeared after done`);

  if (task.spec_id) {
    const remaining = db
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks
         WHERE spec_id = ? AND status IN ('pending', 'in_progress')`,
      )
      .get(task.spec_id) as { count: number };

    if (remaining.count === 0) {
      doneSpec(db, task.spec_id, {}, actor);
    }
  }

  recordEvent(db, "task", id, "completed", { result }, actor);
  return task;
}

export function failTask(
  db: DbInstance,
  id: string,
  error: string,
  actor: string | null = null,
): Task {
  const upd = db
    .prepare(
      `UPDATE tasks
       SET status = 'failed',
           error = ?,
           updated_at = datetime('now')
       WHERE id = ? AND status = 'in_progress'`,
    )
    .run(error, id);

  if (upd.changes === 0) {
    const existing = getTask(db, id);
    if (!existing) throw new Error(`Task ${id} not found`);
    throw new Error(`Task ${id} cannot be failed (status: ${existing.status})`);
  }

  recordEvent(db, "task", id, "failed", { error }, actor);

  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} disappeared after fail`);
  return task;
}

export function releaseTask(
  db: DbInstance,
  id: string,
  actor: string | null = null,
): Task {
  const upd = db
    .prepare(
      `UPDATE tasks
       SET status = 'pending',
           owner = NULL,
           worktree = NULL,
           taken_at = NULL,
           updated_at = datetime('now')
       WHERE id = ? AND status = 'in_progress'`,
    )
    .run(id);

  if (upd.changes === 0) {
    const existing = getTask(db, id);
    if (!existing) throw new Error(`Task ${id} not found`);
    throw new Error(`Task ${id} cannot be released (status: ${existing.status})`);
  }

  recordEvent(db, "task", id, "released", {}, actor);

  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} disappeared after release`);
  return task;
}

export function reopenTask(
  db: DbInstance,
  id: string,
  actor: string | null = null,
): Task {
  const upd = db
    .prepare(
      `UPDATE tasks
       SET status = 'pending',
           updated_at = datetime('now')
       WHERE id = ? AND status IN ('completed', 'failed')`,
    )
    .run(id);

  if (upd.changes === 0) {
    const existing = getTask(db, id);
    if (!existing) throw new Error(`Task ${id} not found`);
    throw new Error(`Task ${id} cannot be reopened (status: ${existing.status})`);
  }

  recordEvent(db, "task", id, "reopened", {}, actor);

  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} disappeared after reopen`);
  return task;
}

export interface EditTaskInput {
  subject?: string;
  description?: string;
  packages?: string[];
  quality_gates?: string[];
  worktree?: string | null;
}

export function editTask(
  db: DbInstance,
  id: string,
  input: EditTaskInput,
  actor: string | null = null,
): Task {
  if (
    input.subject === undefined &&
    input.description === undefined &&
    input.packages === undefined &&
    input.quality_gates === undefined
  ) {
    throw new Error('editTask: provide at least one field to edit');
  }

  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} not found`);

  const sets: string[] = ["updated_at = datetime('now')"];
  const args: (string | null)[] = [];
  const changed: Record<string, unknown> = {};

  if (input.subject !== undefined) {
    sets.push('subject = ?');
    args.push(input.subject);
    changed.subject = input.subject;
  }
  if (input.description !== undefined) {
    sets.push('description = ?');
    args.push(input.description);
    changed.description = '(updated)'; // no loguear el body completo en events
  }
  if (input.packages !== undefined) {
    sets.push('packages = ?');
    args.push(JSON.stringify(input.packages));
    changed.packages = input.packages;
  }
  if (input.quality_gates !== undefined) {
    sets.push('quality_gates = ?');
    args.push(JSON.stringify(input.quality_gates));
    changed.quality_gates = input.quality_gates;
  }
  if ('worktree' in input) {
    sets.push('worktree = ?');
    args.push(input.worktree ?? null);
    changed.worktree = input.worktree ?? null;
  }

  args.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  recordEvent(db, 'task', id, 'edited', changed, actor);

  return getTask(db, id) as Task;
}

export function blockTask(
  db: DbInstance,
  id: string,
  blockedBy: string,
): Task {
  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} not found`);

  const blockedSet = new Set(task.blocked_by);
  blockedSet.add(blockedBy);
  const blockedArr = Array.from(blockedSet);

  db.prepare(
    `UPDATE tasks SET blocked_by = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(blockedArr), id);

  recordEvent(db, "task", id, "blocked", { blocked_by: blockedBy });

  return getTask(db, id) as Task;
}

export function unblockTask(
  db: DbInstance,
  id: string,
  depId: string,
): Task {
  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} not found`);

  const newDeps = task.blocked_by.filter((bid) => bid !== depId);

  db.prepare(
    `UPDATE tasks SET blocked_by = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(newDeps), id);

  recordEvent(db, "task", id, "unblocked", { removed: depId });

  return getTask(db, id) as Task;
}
