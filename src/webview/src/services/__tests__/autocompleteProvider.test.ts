import { describe, it, expect } from 'vitest';
import { parseSources, parseCteNames, resolveTable } from '../autocompleteProvider';
import type { ISchemaMetadata } from '../../types';

const metadata: ISchemaMetadata = {
  tables: [
    { name: 'users', columns: [{ name: 'id', type: 'int' }, { name: 'email', type: 'text' }] },
    { name: 'orders', columns: [{ name: 'id', type: 'int' }, { name: 'user_id', type: 'int' }] },
  ],
  views: [],
};

describe('parseSources', () => {
  it('parses a bare table', () => {
    expect(parseSources('SELECT * FROM users')).toEqual([{ table: 'users', alias: undefined }]);
  });

  it('parses an implicit alias', () => {
    expect(parseSources('SELECT * FROM users u')).toEqual([{ table: 'users', alias: 'u' }]);
  });

  it('parses an explicit AS alias', () => {
    expect(parseSources('SELECT * FROM users AS u')).toEqual([{ table: 'users', alias: 'u' }]);
  });

  it('parses aliases across a JOIN', () => {
    const sources = parseSources('SELECT * FROM users u JOIN orders o ON o.user_id = u.id');
    expect(sources).toEqual([
      { table: 'users', alias: 'u' },
      { table: 'orders', alias: 'o' },
    ]);
  });

  it('does not mistake a trailing keyword for an alias', () => {
    const sources = parseSources('SELECT * FROM users WHERE id = 1');
    expect(sources).toEqual([{ table: 'users', alias: undefined }]);
  });

  it('keeps schema-qualified table names', () => {
    expect(parseSources('SELECT * FROM public.users u')).toEqual([
      { table: 'public.users', alias: 'u' },
    ]);
  });
});

describe('parseCteNames', () => {
  it('parses a single CTE', () => {
    expect(parseCteNames('WITH recent AS (SELECT 1) SELECT * FROM recent')).toEqual(['recent']);
  });

  it('parses multiple CTEs', () => {
    const names = parseCteNames('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a');
    expect(names).toEqual(['a', 'b']);
  });
});

describe('resolveTable', () => {
  const sources = parseSources('SELECT * FROM users u JOIN orders o ON o.user_id = u.id');

  it('resolves an alias to its table', () => {
    expect(resolveTable('u', sources, metadata)?.name).toBe('users');
    expect(resolveTable('o', sources, metadata)?.name).toBe('orders');
  });

  it('resolves a bare table name', () => {
    expect(resolveTable('orders', sources, metadata)?.name).toBe('orders');
  });

  it('resolves a schema-qualified name to its bare table', () => {
    const s = parseSources('SELECT * FROM public.users');
    expect(resolveTable('public.users', s, metadata)?.name).toBe('users');
  });

  it('returns undefined for an unknown name', () => {
    expect(resolveTable('nonexistent', sources, metadata)).toBeUndefined();
  });
});
