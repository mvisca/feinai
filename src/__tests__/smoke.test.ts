import { describe, it, expect, afterEach } from 'bun:test';
import { createTempDb } from './helpers';

describe('tasca DB', () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  it('initializes without error', () => {
    const temp = createTempDb();
    cleanup = temp.cleanup;
    expect(temp.db).toBeDefined();
  });
});
