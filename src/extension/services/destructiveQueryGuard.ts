/**
 * Classifies SQL statements by how destructive they are, so the extension can
 * require confirmation before running risky operations. This is a pure module
 * (no VS Code dependency) to keep it unit-testable.
 */

export type DestructiveLevel = 'none' | 'caution' | 'danger';

export interface DestructiveAssessment {
  level: DestructiveLevel;
  /** Human-readable reasons, highest severity first. */
  reasons: string[];
  /** True when the operation is irreversible even inside a transaction (DROP/TRUNCATE on most engines). */
  irreversible: boolean;
}

/**
 * Strips string literals and comments so keyword matching doesn't trip on
 * values like `'DROP a table'`. Intentionally simple — good enough for
 * heuristic classification, not a full SQL parser.
 */
function sanitize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/'(?:[^']|'')*'/g, "''") // single-quoted strings
    .replace(/"(?:[^"]|"")*"/g, '""'); // double-quoted identifiers/strings
}

const hasWhere = (s: string): boolean => /\bWHERE\b/i.test(s);

/**
 * Returns true if the statement writes/changes data or schema (not a pure read).
 * Used to enforce read-only mode for the AI agent.
 */
export function isWriteStatement(sql: string): boolean {
  const clean = sanitize(sql);
  return /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|MERGE|GRANT|REVOKE|UPSERT|RENAME|COMMENT\s+ON|CALL|EXEC|EXECUTE)\b/i.test(
    clean
  );
}

export function assessDestructiveness(sql: string): DestructiveAssessment {
  const clean = sanitize(sql);
  const reasons: string[] = [];
  let level: DestructiveLevel = 'none';
  let irreversible = false;

  const raise = (next: DestructiveLevel) => {
    const rank: Record<DestructiveLevel, number> = { none: 0, caution: 1, danger: 2 };
    if (rank[next] > rank[level]) {
      level = next;
    }
  };

  // DROP DATABASE/SCHEMA/TABLE/VIEW/INDEX — irreversible.
  if (/\bDROP\s+(DATABASE|SCHEMA|TABLE|VIEW|INDEX|COLLECTION)\b/i.test(clean)) {
    reasons.push('DROP permanently removes a database object and cannot be undone.');
    raise('danger');
    irreversible = true;
  }

  // TRUNCATE — empties a table; not rollback-able on many engines (MySQL, Oracle).
  if (/\bTRUNCATE\b/i.test(clean)) {
    reasons.push('TRUNCATE removes all rows and cannot be rolled back on some databases.');
    raise('danger');
    irreversible = true;
  }

  // DELETE without WHERE — wipes a table.
  if (/\bDELETE\s+FROM\b/i.test(clean)) {
    if (!hasWhere(clean)) {
      reasons.push('DELETE without a WHERE clause removes every row in the table.');
      raise('danger');
    } else {
      reasons.push('DELETE modifies data.');
      raise('caution');
    }
  }

  // UPDATE without WHERE — rewrites every row.
  if (/\bUPDATE\b/i.test(clean) && /\bSET\b/i.test(clean)) {
    if (!hasWhere(clean)) {
      reasons.push('UPDATE without a WHERE clause modifies every row in the table.');
      raise('danger');
    } else {
      reasons.push('UPDATE modifies data.');
      raise('caution');
    }
  }

  // ALTER TABLE — schema change.
  if (/\bALTER\s+(TABLE|DATABASE|SCHEMA)\b/i.test(clean)) {
    reasons.push('ALTER changes the schema, which may be hard to reverse.');
    raise('caution');
  }

  return { level, reasons, irreversible };
}
