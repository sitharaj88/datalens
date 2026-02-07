import type { ISchemaMetadata } from '../types';

// Store schema metadata in the webview
let currentMetadata: ISchemaMetadata | null = null;

export function setSchemaMetadata(metadata: ISchemaMetadata | null) {
  currentMetadata = metadata;
}

export function getSchemaMetadata(): ISchemaMetadata | null {
  return currentMetadata;
}

// SQL Keywords for autocomplete
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON',
  'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE', 'ADD COLUMN', 'DROP COLUMN',
  'CREATE INDEX', 'DROP INDEX', 'CREATE VIEW', 'DROP VIEW',
  'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'UNIQUE', 'NOT NULL', 'DEFAULT',
  'INDEX', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS', 'NULL', 'IS NULL', 'IS NOT NULL',
  'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT',
  'EXISTS', 'ANY', 'ALL', 'COALESCE', 'NULLIF', 'CAST',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'EXPLAIN', 'ANALYZE', 'VACUUM', 'TRUNCATE',
  'WITH', 'RECURSIVE', 'LATERAL',
  'WINDOW', 'OVER', 'PARTITION BY', 'ROW_NUMBER', 'RANK', 'DENSE_RANK',
  'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
  'STRING_AGG', 'ARRAY_AGG', 'JSON_AGG', 'JSONB_AGG',
  'ILIKE', 'SIMILAR TO', 'REGEXP',
  'TRUE', 'FALSE',
];

// SQL functions
const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM', 'LENGTH', 'SUBSTRING', 'REPLACE', 'CONCAT',
  'ROUND', 'CEIL', 'FLOOR', 'ABS', 'MOD', 'POWER', 'SQRT',
  'NOW', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'DATE', 'EXTRACT', 'DATE_TRUNC',
  'COALESCE', 'NULLIF', 'CAST', 'CONVERT',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE',
  'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
  'JSON_EXTRACT', 'JSON_ARRAY', 'JSON_OBJECT',
  'IF', 'IIF', 'IFNULL', 'NVL',
];

type Monaco = typeof import('monaco-editor');

/**
 * Get the table name context from the current cursor position.
 * Looks backwards for FROM/JOIN table references to suggest columns.
 */
function getTableContext(textUntilPosition: string): string[] {
  const tables: string[] = [];

  // Match FROM table, JOIN table patterns
  const fromMatch = textUntilPosition.match(/(?:FROM|JOIN)\s+["'`]?(\w+)["'`]?/gi);
  if (fromMatch) {
    for (const match of fromMatch) {
      const tableMatch = match.match(/(?:FROM|JOIN)\s+["'`]?(\w+)["'`]?/i);
      if (tableMatch) {
        tables.push(tableMatch[1]);
      }
    }
  }

  return tables;
}

/**
 * Determine what kind of completions are most relevant
 * based on the SQL text before the cursor.
 */
function getCompletionContext(textUntilPosition: string): 'table' | 'column' | 'keyword' | 'function' {
  const upperText = textUntilPosition.toUpperCase().trimEnd();

  // After FROM, JOIN -> suggest tables
  if (/(?:FROM|JOIN|INTO|UPDATE|TABLE)\s*$/i.test(upperText)) {
    return 'table';
  }

  // After SELECT, WHERE, ON, SET, ORDER BY, GROUP BY -> suggest columns
  if (/(?:SELECT|WHERE|AND|OR|ON|SET|BY|HAVING)\s*$/i.test(upperText)) {
    return 'column';
  }

  // After a dot -> column of specific table
  if (/\w+\.\s*$/i.test(upperText)) {
    return 'column';
  }

  return 'keyword';
}

export function registerAutocompleteProvider(monaco: Monaco) {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const suggestions: any[] = [];
      const context = getCompletionContext(textUntilPosition);

      // Dot completion - table.column
      const lineText = model.getLineContent(position.lineNumber);
      const textBeforeCursor = lineText.substring(0, position.column - 1);
      const dotMatch = textBeforeCursor.match(/(\w+)\.\s*$/);

      if (dotMatch && currentMetadata) {
        const tableName = dotMatch[1];
        const table = currentMetadata.tables.find(
          t => t.name.toLowerCase() === tableName.toLowerCase()
        );
        if (table) {
          for (const col of table.columns) {
            suggestions.push({
              label: col.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${col.type}${col.nullable ? '' : ' NOT NULL'}${col.primaryKey ? ' PK' : ''}`,
              insertText: col.name,
              range,
              sortText: `0_${col.name}`,
            });
          }
          return { suggestions };
        }
      }

      // Table completions
      if (currentMetadata && (context === 'table' || context === 'column')) {
        for (const table of currentMetadata.tables) {
          suggestions.push({
            label: table.name,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: `Table (${table.columns.length} columns)`,
            insertText: table.name,
            range,
            sortText: context === 'table' ? `0_${table.name}` : `2_${table.name}`,
          });
        }

        // View completions
        if (currentMetadata.views) {
          for (const view of currentMetadata.views) {
            suggestions.push({
              label: view,
              kind: monaco.languages.CompletionItemKind.Interface,
              detail: 'View',
              insertText: view,
              range,
              sortText: context === 'table' ? `1_${view}` : `3_${view}`,
            });
          }
        }
      }

      // Column completions from table context
      if (currentMetadata && (context === 'column')) {
        const referencedTables = getTableContext(textUntilPosition);

        for (const tableName of referencedTables) {
          const table = currentMetadata.tables.find(
            t => t.name.toLowerCase() === tableName.toLowerCase()
          );
          if (table) {
            for (const col of table.columns) {
              suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${tableName}.${col.name} (${col.type})`,
                insertText: col.name,
                range,
                sortText: `0_${col.name}`,
              });
            }
          }
        }
      }

      // SQL keyword completions
      for (const keyword of SQL_KEYWORDS) {
        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          range,
          sortText: `5_${keyword}`,
        });
      }

      // SQL function completions
      for (const func of SQL_FUNCTIONS) {
        suggestions.push({
          label: func,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${func}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: `4_${func}`,
        });
      }

      return { suggestions };
    },
  });
}
