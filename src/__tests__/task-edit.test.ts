import { describe, it, expect, afterEach } from 'bun:test';
import { createTempDb } from './helpers';
import { addTask, editTask, getTask, blockTask, unblockTask } from '../tasks';
import { addSpec } from '../specs';

describe('editTask', () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  function setup() {
    const { db, cleanup: c } = createTempDb();
    cleanup = c;
    addSpec(db, { id: 'SPEC-1', title: 'Test spec' });
    addTask(db, {
      id: 'T-1', subject: 'original subject', spec_id: 'SPEC-1',
      description: 'original desc', packages: ['pkg-a'], quality_gates: ['cmd-a'],
    });
    return db;
  }

  it('edits subject', () => {
    const db = setup();
    const task = editTask(db, 'T-1', { subject: 'new subject' });
    expect(task.subject).toBe('new subject');
    expect(getTask(db, 'T-1')!.subject).toBe('new subject');
  });

  it('edits description', () => {
    const db = setup();
    const task = editTask(db, 'T-1', { description: 'new desc' });
    expect(task.description).toBe('new desc');
  });

  it('replaces quality_gates', () => {
    const db = setup();
    const task = editTask(db, 'T-1', { quality_gates: ['cmd-x', 'cmd-y'] });
    expect(task.quality_gates).toEqual(['cmd-x', 'cmd-y']);
  });

  it('replaces packages', () => {
    const db = setup();
    const task = editTask(db, 'T-1', { packages: ['pkg-x'] });
    expect(task.packages).toEqual(['pkg-x']);
  });

  it('clears blocked_by with --clear-blocked-by (editTask with blocked_by: [])', () => {
    const db = setup();
    editTask(db, 'T-1', { blocked_by: ['T-2'] });
    expect(getTask(db, 'T-1')!.blocked_by).toEqual(['T-2']);
    const task = editTask(db, 'T-1', { blocked_by: [] });
    expect(task.blocked_by).toEqual([]);
    expect(getTask(db, 'T-1')!.blocked_by).toEqual([]);
  });

  it('edits worktree path alone (no other fields required)', () => {
    const db = setup();
    const task = editTask(db, 'T-1', { worktree: '/tmp/worktrees/T-1' });
    expect(task.worktree).toBe('/tmp/worktrees/T-1');
    expect(getTask(db, 'T-1')!.worktree).toBe('/tmp/worktrees/T-1');
  });

  it('clears worktree with null', () => {
    const db = setup();
    editTask(db, 'T-1', { worktree: '/tmp/worktrees/T-1' });
    const task = editTask(db, 'T-1', { worktree: null });
    expect(task.worktree).toBeNull();
  });

  it('throws when no fields provided', () => {
    const db = setup();
    expect(() => editTask(db, 'T-1', {})).toThrow('provide at least one field');
  });

  it('throws for unknown task ID', () => {
    const db = setup();
    expect(() => editTask(db, 'NONEXISTENT', { subject: 'x' })).toThrow('not found');
  });

  it('records edit in audit log', () => {
    const db = setup();
    editTask(db, 'T-1', { subject: 'audited' }, 'test-actor');
    const event = db.prepare(
      "SELECT * FROM events WHERE entity_id = 'T-1' AND event_type = 'edited' ORDER BY id DESC LIMIT 1"
    ).get() as { actor: string; payload: string } | null;
    expect(event).not.toBeNull();
    expect(event!.actor).toBe('test-actor');
    const payload = JSON.parse(event!.payload);
    expect(payload.subject).toBe('audited');
  });
});

describe('unblockTask', () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  function setup() {
    const { db, cleanup: c } = createTempDb();
    cleanup = c;
    addSpec(db, { id: 'SPEC-1', title: 'Test spec' });
    addTask(db, {
      id: 'T-1', subject: 'task with deps', spec_id: 'SPEC-1',
      description: 'desc', packages: [], quality_gates: [],
      blocked_by: ['T-2', 'T-3'],
    });
    return db;
  }

  it('removes an existing dependency', () => {
    const db = setup();
    const task = unblockTask(db, 'T-1', 'T-2');
    expect(task.blocked_by).toEqual(['T-3']);
    expect(getTask(db, 'T-1')!.blocked_by).toEqual(['T-3']);
  });

  it('is idempotent when dependency does not exist', () => {
    const db = setup();
    const task = unblockTask(db, 'T-1', 'NONEXISTENT');
    expect(task.blocked_by).toEqual(['T-2', 'T-3']);
    expect(getTask(db, 'T-1')!.blocked_by).toEqual(['T-2', 'T-3']);
  });

  it('throws for unknown task ID', () => {
    const db = setup();
    expect(() => unblockTask(db, 'NONEXISTENT', 'T-2')).toThrow('not found');
  });

  it('block + unblock round-trip works', () => {
    const { db, cleanup: c } = createTempDb();
    cleanup = c;
    addSpec(db, { id: 'SPEC-1', title: 'Test spec' });
    addTask(db, {
      id: 'T-1', subject: 'round-trip', spec_id: 'SPEC-1',
      description: '', packages: [], quality_gates: [],
    });
    // Initially no deps
    expect(getTask(db, 'T-1')!.blocked_by).toEqual([]);
    // Block
    const blocked = blockTask(db, 'T-1', 'T-2');
    expect(blocked.blocked_by).toEqual(['T-2']);
    // Unblock
    const unblocked = unblockTask(db, 'T-1', 'T-2');
    expect(unblocked.blocked_by).toEqual([]);
  });
});
