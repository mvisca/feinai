import { describe, it, expect, afterEach } from 'bun:test';
import { createTempDb } from './helpers';
import { addTask, editTask, getTask } from '../tasks';
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
