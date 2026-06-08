import { describe, it, expect, afterEach } from 'bun:test';
import { createTempDb } from './helpers';
import { addTask, takeTask, doneTask, getTask } from '../tasks';
import { addSpec, getSpec, doneSpec } from '../specs';

describe('task ↔ spec status transitions', () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  function setup() {
    const { db, cleanup: c } = createTempDb();
    cleanup = c;
    return db;
  }

  it('takeTask moves spec to en_progreso when it was lista', () => {
    const db = setup();
    addSpec(db, { id: 'SPEC-1', title: 'Test' });
    addTask(db, { id: 'T-1', subject: 'Task', spec_id: 'SPEC-1' });

    takeTask(db, 'T-1', 'agent');
    expect(getSpec(db, 'SPEC-1')!.status).toBe('en_progreso');
  });

  it('takeTask does not move spec if it is already en_progreso', () => {
    const db = setup();
    addSpec(db, { id: 'SPEC-2', title: 'Test' });
    addTask(db, { id: 'T-2a', subject: 'Task A', spec_id: 'SPEC-2' });
    addTask(db, { id: 'T-2b', subject: 'Task B', spec_id: 'SPEC-2' });

    takeTask(db, 'T-2a', 'agent');
    expect(getSpec(db, 'SPEC-2')!.status).toBe('en_progreso');

    takeTask(db, 'T-2b', 'agent');
    expect(getSpec(db, 'SPEC-2')!.status).toBe('en_progreso');
  });

  it('takeTask does nothing when task has no spec_id', () => {
    const db = setup();
    addTask(db, { id: 'T-3', subject: 'Orphan task' });
    takeTask(db, 'T-3', 'agent');
    expect(getTask(db, 'T-3')!.status).toBe('in_progress');
  });

  it('doneTask moves spec to hecha when no pending/in_progress tasks remain', () => {
    const db = setup();
    addSpec(db, { id: 'SPEC-4', title: 'Test' });
    addTask(db, { id: 'T-4', subject: 'Task', spec_id: 'SPEC-4' });

    takeTask(db, 'T-4', 'agent');
    doneTask(db, 'T-4', 'ok', 'agent');

    expect(getSpec(db, 'SPEC-4')!.status).toBe('hecha');
  });

  it('doneTask does not move spec when other tasks remain pending', () => {
    const db = setup();
    addSpec(db, { id: 'SPEC-5', title: 'Test' });
    addTask(db, { id: 'T-5a', subject: 'Task A', spec_id: 'SPEC-5' });
    addTask(db, { id: 'T-5b', subject: 'Task B', spec_id: 'SPEC-5' });

    takeTask(db, 'T-5a', 'agent');
    doneTask(db, 'T-5a', 'ok', 'agent');

    expect(getSpec(db, 'SPEC-5')!.status).toBe('en_progreso');
  });

  it('doneTask does not move spec when other tasks remain in_progress', () => {
    const db = setup();
    addSpec(db, { id: 'SPEC-6', title: 'Test' });
    addTask(db, { id: 'T-6a', subject: 'Task A', spec_id: 'SPEC-6' });
    addTask(db, { id: 'T-6b', subject: 'Task B', spec_id: 'SPEC-6' });

    takeTask(db, 'T-6a', 'agent');
    takeTask(db, 'T-6b', 'agent');
    doneTask(db, 'T-6a', 'ok', 'agent');

    expect(getSpec(db, 'SPEC-6')!.status).toBe('en_progreso');
  });

  it('doneTask does not move spec when tasks are failed', () => {
    const db = setup();
    addSpec(db, { id: 'SPEC-7', title: 'Test' });
    addTask(db, { id: 'T-7a', subject: 'Task A', spec_id: 'SPEC-7' });
    addTask(db, { id: 'T-7b', subject: 'Task B', spec_id: 'SPEC-7' });

    takeTask(db, 'T-7a', 'agent');
    takeTask(db, 'T-7b', 'agent');
    doneTask(db, 'T-7a', 'ok', 'agent');

    // T-7b still in_progress, so spec stays en_progreso
    expect(getSpec(db, 'SPEC-7')!.status).toBe('en_progreso');
  });

  it('doneTask does nothing when task has no spec_id', () => {
    const db = setup();
    addTask(db, { id: 'T-8', subject: 'Orphan task' });
    takeTask(db, 'T-8', 'agent');
    doneTask(db, 'T-8', 'ok', 'agent');
    expect(getTask(db, 'T-8')!.status).toBe('completed');
  });

  it('doneTask does not move spec if it was already hecha', () => {
    const db = setup();
    addSpec(db, { id: 'SPEC-9', title: 'Test' });
    addTask(db, { id: 'T-9', subject: 'Task', spec_id: 'SPEC-9' });

    takeTask(db, 'T-9', 'agent');
    doneTask(db, 'T-9', 'ok', 'agent');
    expect(getSpec(db, 'SPEC-9')!.status).toBe('hecha');

    // Adding a new task and completing it should keep spec as hecha
    addTask(db, { id: 'T-9b', subject: 'Task B', spec_id: 'SPEC-9' });
    takeTask(db, 'T-9b', 'agent');
    doneTask(db, 'T-9b', 'ok', 'agent');
    expect(getSpec(db, 'SPEC-9')!.status).toBe('hecha');
  });
});
