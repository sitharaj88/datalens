import { describe, it, expect } from 'vitest';
import { assessDestructiveness, isWriteStatement } from '../destructiveQueryGuard';

describe('assessDestructiveness', () => {
  it('treats plain SELECT as non-destructive', () => {
    const r = assessDestructiveness('SELECT * FROM users WHERE id = 1');
    expect(r.level).toBe('none');
    expect(r.irreversible).toBe(false);
  });

  it('flags DROP TABLE as irreversible danger', () => {
    const r = assessDestructiveness('DROP TABLE users');
    expect(r.level).toBe('danger');
    expect(r.irreversible).toBe(true);
  });

  it('flags TRUNCATE as irreversible danger', () => {
    const r = assessDestructiveness('TRUNCATE TABLE events');
    expect(r.level).toBe('danger');
    expect(r.irreversible).toBe(true);
  });

  it('flags DELETE without WHERE as danger', () => {
    const r = assessDestructiveness('DELETE FROM orders');
    expect(r.level).toBe('danger');
  });

  it('treats DELETE with WHERE as caution', () => {
    const r = assessDestructiveness('DELETE FROM orders WHERE id = 5');
    expect(r.level).toBe('caution');
  });

  it('flags UPDATE without WHERE as danger', () => {
    const r = assessDestructiveness('UPDATE users SET active = false');
    expect(r.level).toBe('danger');
  });

  it('treats UPDATE with WHERE as caution', () => {
    const r = assessDestructiveness("UPDATE users SET active = false WHERE id = 1");
    expect(r.level).toBe('caution');
  });

  it('does not trip on keywords inside string literals', () => {
    const r = assessDestructiveness("SELECT 'please DROP TABLE later' AS note FROM tasks");
    expect(r.level).toBe('none');
  });

  it('ignores keywords inside comments', () => {
    const r = assessDestructiveness('SELECT 1 -- DROP TABLE users\n');
    expect(r.level).toBe('none');
  });

  it('takes the most severe operation in a multi-statement script', () => {
    const r = assessDestructiveness('UPDATE t SET x=1 WHERE id=1; DROP TABLE t;');
    expect(r.level).toBe('danger');
    expect(r.irreversible).toBe(true);
  });

  it('flags ALTER TABLE as caution', () => {
    const r = assessDestructiveness('ALTER TABLE users ADD COLUMN age int');
    expect(r.level).toBe('caution');
  });
});

describe('isWriteStatement', () => {
  it('treats SELECT as read-only', () => {
    expect(isWriteStatement('SELECT * FROM users WHERE id = 1')).toBe(false);
  });

  it('treats WITH ... SELECT as read-only', () => {
    expect(isWriteStatement('WITH t AS (SELECT 1) SELECT * FROM t')).toBe(false);
  });

  it.each(['INSERT INTO t VALUES (1)', 'UPDATE t SET x=1', 'DELETE FROM t', 'DROP TABLE t', 'CREATE TABLE t (id int)', 'ALTER TABLE t ADD c int', 'TRUNCATE t'])(
    'flags %s as a write',
    (sql) => {
      expect(isWriteStatement(sql)).toBe(true);
    }
  );

  it('does not flag write keywords inside string literals', () => {
    expect(isWriteStatement("SELECT 'insert into archive' AS note FROM logs")).toBe(false);
  });
});
