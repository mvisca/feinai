import { describe, it, expect, afterEach } from 'bun:test';
import { createTempDb } from './helpers';
import { addSpec, editSpec, getSpec } from '../specs';

describe('editSpec', () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  function setup() {
    const { db, cleanup: c } = createTempDb();
    cleanup = c;
    addSpec(db, { id: 'S-1', title: 'original title' });
    return db;
  }

  it('edits title', () => {
    const db = setup();
    const spec = editSpec(db, 'S-1', { title: 'new title' });
    expect(spec.title).toBe('new title');
    expect(getSpec(db, 'S-1')!.title).toBe('new title');
  });

  it('throws when no fields provided', () => {
    const db = setup();
    expect(() => editSpec(db, 'S-1', {})).toThrow('provide at least one field');
  });

  it('throws for unknown spec ID', () => {
    const db = setup();
    expect(() => editSpec(db, 'NONEXISTENT', { title: 'x' })).toThrow('not found');
  });

  it('records edit in audit log', () => {
    const db = setup();
    editSpec(db, 'S-1', { title: 'logged' }, 'test-actor');
    const event = db.prepare(
      "SELECT * FROM events WHERE entity_id = 'S-1' AND event_type = 'edited' ORDER BY id DESC LIMIT 1"
    ).get() as { actor: string; payload: string } | null;
    expect(event).not.toBeNull();
    expect(JSON.parse(event!.payload).title).toBe('logged');
  });
});
