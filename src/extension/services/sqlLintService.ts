export interface LintWarning {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export class SQLLintService {
  lint(sql: string): LintWarning[] {
    const warnings: LintWarning[] = [];
    const lines = sql.split('\n');

    // Check for SELECT *
    if (/\bSELECT\s+\*/i.test(sql)) {
      const line = lines.findIndex(l => /\bSELECT\s+\*/i.test(l));
      warnings.push({
        severity: 'warning',
        message: 'Avoid SELECT * - specify column names explicitly for better performance and clarity',
        line: line >= 0 ? line + 1 : undefined,
        suggestion: 'Replace * with specific column names',
      });
    }

    // Check for UPDATE without WHERE
    if (/\bUPDATE\b/i.test(sql) && !/\bWHERE\b/i.test(sql)) {
      warnings.push({
        severity: 'error',
        message: 'UPDATE without WHERE clause will modify all rows in the table',
        suggestion: 'Add a WHERE clause to limit affected rows',
      });
    }

    // Check for DELETE without WHERE
    if (/\bDELETE\s+FROM\b/i.test(sql) && !/\bWHERE\b/i.test(sql)) {
      warnings.push({
        severity: 'error',
        message: 'DELETE without WHERE clause will remove all rows from the table',
        suggestion: 'Add a WHERE clause to limit deleted rows',
      });
    }

    // Check for DROP TABLE
    if (/\bDROP\s+TABLE\b/i.test(sql)) {
      warnings.push({
        severity: 'error',
        message: 'DROP TABLE is a destructive operation that cannot be undone',
        suggestion: 'Consider using DROP TABLE IF EXISTS and ensure you have backups',
      });
    }

    // Check for TRUNCATE
    if (/\bTRUNCATE\b/i.test(sql)) {
      warnings.push({
        severity: 'warning',
        message: 'TRUNCATE removes all rows and cannot be rolled back in some databases',
        suggestion: 'Use DELETE with WHERE for targeted removal',
      });
    }

    // Check for non-parameterized values in WHERE (potential SQL injection)
    if (/WHERE\s+.*?=\s*'[^']*'/i.test(sql)) {
      warnings.push({
        severity: 'info',
        message: 'Consider using parameterized queries instead of inline string values',
        suggestion: 'Use prepared statements with parameters for better security',
      });
    }

    // Check for missing LIMIT on SELECT
    if (/\bSELECT\b/i.test(sql) && !/\bLIMIT\b/i.test(sql) && !/\bTOP\b/i.test(sql) && !/\bFETCH\s+(?:FIRST|NEXT)\b/i.test(sql)) {
      if (!/\bCOUNT\s*\(/i.test(sql) && !/\bINSERT\b/i.test(sql) && !/\bCREATE\b/i.test(sql)) {
        warnings.push({
          severity: 'info',
          message: 'SELECT without LIMIT may return a large number of rows',
          suggestion: 'Add LIMIT clause to restrict result set size',
        });
      }
    }

    // Check for ORDER BY with column number
    if (/\bORDER\s+BY\s+\d+/i.test(sql)) {
      warnings.push({
        severity: 'info',
        message: 'Using column numbers in ORDER BY is fragile and harder to read',
        suggestion: 'Use column names instead of ordinal positions',
      });
    }

    // Check for != instead of <>
    if (/!=/.test(sql)) {
      warnings.push({
        severity: 'info',
        message: '!= is non-standard SQL. <> is the ANSI standard not-equal operator',
        suggestion: 'Consider using <> for better portability',
      });
    }

    // Check for implicit joins (comma-separated tables)
    if (/\bFROM\s+\w+\s*,\s*\w+/i.test(sql) && !/\bJOIN\b/i.test(sql)) {
      warnings.push({
        severity: 'warning',
        message: 'Implicit joins (comma syntax) are harder to read and maintain',
        suggestion: 'Use explicit JOIN syntax for clearer intent',
      });
    }

    // Check for LIKE without index hint
    if (/\bLIKE\s+'%/i.test(sql)) {
      warnings.push({
        severity: 'warning',
        message: 'LIKE pattern starting with % cannot use indexes efficiently',
        suggestion: 'Consider full-text search or rearrange the pattern if possible',
      });
    }

    return warnings;
  }
}
