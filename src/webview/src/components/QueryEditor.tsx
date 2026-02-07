import { useState, useCallback, useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useQueryHistory, formatRelativeTime } from '../hooks/useQueryHistory';
import { formatShortcut } from '../hooks/useKeyboardShortcuts';
import { registerAutocompleteProvider, setSchemaMetadata } from '../services/autocompleteProvider';
import { useVscodeApi } from '../hooks/useVscodeApi';
import { useSettingsStore } from '../store/settingsStore';
import type { ThemeMode } from '../store/settingsStore';
import { SnippetPicker } from './SnippetPicker';
import type { ISchemaMetadata } from '../types';

function getMonacoTheme(theme: ThemeMode): string {
  if (theme === 'light') return 'vs';
  if (theme === 'dark') return 'vs-dark';
  // system: check prefers-color-scheme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'vs' : 'vs-dark';
}

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: (query: string) => void;
  loading?: boolean;
  connectionId: string;
}

export function QueryEditor({ value, onChange, onRun, loading, connectionId }: QueryEditorProps) {
  const { editorHeight, setEditorHeight, editorFontSize, wordWrap, showLineNumbers, theme } = useSettingsStore();
  const [showHistory, setShowHistory] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autocompleteDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const vscode = useVscodeApi();

  const { getRecentQueries } = useQueryHistory();
  const recentQueries = getRecentQueries(connectionId, 15);

  // Fetch schema metadata for autocomplete when connection changes
  useEffect(() => {
    if (!connectionId) {
      setSchemaMetadata(null);
      return;
    }

    const fetchSchema = async () => {
      try {
        const response = await vscode.postMessage({
          type: 'GET_SCHEMA_METADATA',
          id: crypto.randomUUID(),
          payload: { connectionId }
        });
        if (response.success && response.data) {
          setSchemaMetadata(response.data as ISchemaMetadata);
        }
      } catch {
        // Schema fetch may fail for some connections - that's OK
      }
    };

    fetchSchema();
  }, [connectionId, vscode]);

  const handleEditorChange = useCallback((newValue: string | undefined) => {
    onChange(newValue || '');
  }, [onChange]);

  // Get the SQL statement at the current cursor position
  const getStatementAtCursor = useCallback((): string => {
    const ed = editorRef.current;
    if (!ed) return value;

    const model = ed.getModel();
    const position = ed.getPosition();
    if (!model || !position) return value;

    const fullText = model.getValue();
    const offset = model.getOffsetAt(position);

    // Find statement boundaries by splitting on semicolons
    // but respecting string literals
    const statements: { start: number; end: number; text: string }[] = [];
    let current = '';
    let start = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < fullText.length; i++) {
      const ch = fullText[i];
      if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
      else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
      else if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
        const text = current.trim();
        if (text.length > 0) {
          statements.push({ start, end: i, text });
        }
        current = '';
        start = i + 1;
        continue;
      }
      current += ch;
    }
    // Last statement without semicolon
    const remaining = current.trim();
    if (remaining.length > 0) {
      statements.push({ start, end: fullText.length, text: remaining });
    }

    // Find which statement the cursor is in
    for (const stmt of statements) {
      if (offset >= stmt.start && offset <= stmt.end + 1) {
        return stmt.text;
      }
    }

    // Fallback to full text
    return fullText.trim();
  }, [value]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Register schema-aware autocomplete provider (replaces basic keyword completion)
    if (autocompleteDisposableRef.current) {
      autocompleteDisposableRef.current.dispose();
    }
    autocompleteDisposableRef.current = registerAutocompleteProvider(monaco);

    // Run statement at cursor (Ctrl+Enter)
    editor.addAction({
      id: 'run-query',
      label: 'Run Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const selection = editor.getSelection();
        const model = editor.getModel();
        const selectedText = selection && model ? model.getValueInRange(selection).trim() : '';

        if (selectedText) {
          onRun(selectedText);
        } else {
          // Run statement at cursor
          const stmt = getStatementAtCursor();
          if (stmt) onRun(stmt);
        }
      },
    });

    // Run all statements (Ctrl+Shift+Enter)
    editor.addAction({
      id: 'run-all',
      label: 'Run All Statements',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => {
        const text = editor.getValue().trim();
        if (text) onRun(text);
      },
    });

    // Format SQL (Ctrl+Shift+F)
    editor.addAction({
      id: 'format-query',
      label: 'Format Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      run: () => {
        const formatted = formatSQL(editor.getValue());
        editor.setValue(formatted);
      },
    });

    const editorModel = editor.getModel();
    if (editorModel) {
      editorModel.updateOptions({ tabSize: 2 });
    }
  };

  // Cleanup autocomplete provider on unmount
  useEffect(() => {
    return () => {
      if (autocompleteDisposableRef.current) {
        autocompleteDisposableRef.current.dispose();
      }
    };
  }, []);

  const handleRunClick = () => {
    if (value.trim()) {
      onRun(value);
    }
  };

  const handleRunAtCursor = () => {
    const stmt = getStatementAtCursor();
    if (stmt) onRun(stmt);
  };

  const handleHistorySelect = (query: string) => {
    onChange(query);
    setShowHistory(false);
    editorRef.current?.focus();
  };

  const handleSnippetSelect = (snippet: string) => {
    const ed = editorRef.current;
    if (ed) {
      const position = ed.getPosition();
      const model = ed.getModel();
      if (position && model) {
        // Insert at cursor position
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        };
        ed.executeEdits('snippet-insert', [{
          range,
          text: snippet,
        }]);
        ed.focus();
        return;
      }
    }
    // Fallback: replace entire content
    onChange(snippet);
  };

  // Close history dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const runShortcut = formatShortcut({ key: 'Enter', ctrl: true });
  const multiStatementCount = value.split(';').filter(s => s.trim().length > 0 && !s.trim().startsWith('--')).length;

  return (
    <div ref={containerRef} className="query-editor-container relative">
      {/* Toolbar */}
      <div className="query-toolbar">
        <div className="toolbar-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span>SQL Editor</span>
        </div>

        <div className="toolbar-divider" />

        <div className="query-actions">
          {multiStatementCount > 1 ? (
            <>
              <button
                className="btn btn-sm"
                onClick={handleRunAtCursor}
                disabled={loading || !value.trim()}
                title={`Run statement at cursor (${runShortcut})`}
              >
                {loading ? (
                  <>
                    <div className="spinner spinner-sm" />
                    <span>Executing...</span>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21" />
                    </svg>
                    <span>Run</span>
                    <kbd className="kbd">{runShortcut}</kbd>
                  </>
                )}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleRunClick}
                disabled={loading || !value.trim()}
                title={`Run all ${multiStatementCount} statements (Ctrl+Shift+Enter)`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21" fill="currentColor" />
                  <line x1="22" y1="3" x2="22" y2="21" />
                </svg>
                <span>Run All ({multiStatementCount})</span>
              </button>
            </>
          ) : (
            <button
              className="btn"
              onClick={handleRunClick}
              disabled={loading || !value.trim()}
            >
              {loading ? (
                <>
                  <div className="spinner spinner-sm" />
                  <span>Executing...</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21" />
                  </svg>
                  <span>Run Query</span>
                  <kbd className="kbd">{runShortcut}</kbd>
                </>
              )}
            </button>
          )}

          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setShowHistory(!showHistory)}
            title="Query History"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>

          {/* Snippet Picker */}
          <SnippetPicker onSelect={handleSnippetSelect} />

          <button
            className="btn btn-ghost btn-icon"
            onClick={() => {
              const formatted = formatSQL(value);
              onChange(formatted);
            }}
            title="Format SQL (Ctrl+Shift+F)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="21" y1="10" x2="3" y2="10" />
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="21" y1="14" x2="3" y2="14" />
              <line x1="21" y1="18" x2="3" y2="18" />
            </svg>
          </button>

          <button
            className="btn btn-ghost btn-icon"
            onClick={() => onChange('')}
            title="Clear Editor"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>

        <div className="toolbar-spacer" />

        <div className="query-info">
          <span>{value.length} characters</span>
          <span>•</span>
          <span>{value.split('\n').length} lines</span>
          {multiStatementCount > 1 && (
            <>
              <span>•</span>
              <span>{multiStatementCount} statements</span>
            </>
          )}
        </div>
      </div>

      {/* Query History Dropdown */}
      {showHistory && recentQueries.length > 0 && (
        <div className="history-panel">
          <div className="px-4 py-2 border-b text-xs font-semibold text-secondary" style={{ borderColor: 'var(--border-default)' }}>
            Recent Queries
          </div>
          {recentQueries.map((item) => (
            <div
              key={item.id}
              className="history-item"
              onClick={() => handleHistorySelect(item.query)}
            >
              <div className="history-item-query">{item.query}</div>
              <div className="history-item-time">{formatRelativeTime(item.timestamp)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Monaco Editor */}
      <div style={{ height: editorHeight, background: 'var(--bg-primary)' }}>
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={value}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          theme={getMonacoTheme(theme)}
          options={{
            minimap: { enabled: false },
            fontSize: editorFontSize,
            fontFamily: "var(--font-mono)",
            fontLigatures: true,
            lineNumbers: showLineNumbers ? 'on' : 'off',
            scrollBeyondLastLine: false,
            wordWrap: wordWrap ? 'on' : 'off',
            automaticLayout: true,
            tabSize: 2,
            padding: { top: 16, bottom: 16 },
            renderLineHighlight: 'line',
            lineHeight: 22,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            suggest: {
              showKeywords: true,
              showSnippets: true,
            },
            quickSuggestions: {
              other: true,
              comments: false,
              strings: false,
            },
          }}
        />
      </div>

      {/* Resize Handle */}
      <div
        className="resize-handle"
        onMouseDown={(e) => {
          const startY = e.clientY;
          const startHeight = editorHeight;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientY - startY;
            const newHeight = Math.max(120, Math.min(500, startHeight + delta));
            setEditorHeight(newHeight);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />
    </div>
  );
}

// Improved SQL formatter with proper clause indentation
function formatSQL(sql: string): string {
  // Normalize whitespace
  let text = sql.replace(/\s+/g, ' ').trim();

  // Keywords to uppercase
  const uppercaseKeywords = [
    'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
    'ON', 'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC',
    'LIMIT', 'OFFSET', 'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
    'CREATE INDEX', 'DROP INDEX',
    'AS', 'IN', 'LIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL',
    'NULL', 'NOT NULL', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES',
    'DEFAULT', 'UNIQUE', 'CHECK', 'CASCADE',
    'BEGIN', 'COMMIT', 'ROLLBACK',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'EXISTS', 'ANY', 'ALL',
    'WITH', 'RECURSIVE',
    'OVER', 'PARTITION BY', 'WINDOW',
    'EXPLAIN', 'ANALYZE',
    'IF NOT EXISTS', 'IF EXISTS',
  ];

  // Sort by length descending so longer keywords match first
  const sortedKeywords = [...uppercaseKeywords].sort((a, b) => b.length - a.length);

  for (const keyword of sortedKeywords) {
    const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    text = text.replace(regex, keyword);
  }

  // Major clause keywords get newlines
  const newlineBefore = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING',
    'LIMIT', 'OFFSET',
    'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'JOIN',
    'UNION ALL', 'UNION', 'EXCEPT', 'INTERSECT',
    'SET', 'VALUES',
    'ON',
  ];

  // Sort so multi-word comes first
  const sortedNewline = [...newlineBefore].sort((a, b) => b.length - a.length);

  for (const keyword of sortedNewline) {
    const escapedKw = keyword.replace(/\s+/g, '\\s+');
    const regex = new RegExp(`(?<!^)\\s+${escapedKw}\\b`, 'g');
    text = text.replace(regex, `\n${keyword}`);
  }

  // Indent sub-clauses
  const indentKeywords = new Set(['AND', 'OR']);

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const formatted: string[] = [];

  for (const line of lines) {
    const firstWord = line.split(/\s+/)[0];

    if (indentKeywords.has(firstWord)) {
      formatted.push('  ' + line);
    } else if (firstWord === 'ON') {
      formatted.push('  ' + line);
    } else {
      formatted.push(line);
    }
  }

  // Add comma formatting for SELECT columns
  const result: string[] = [];
  for (const line of formatted) {
    if (line.startsWith('SELECT ') && line.includes(',')) {
      const selectPart = line.substring(7);
      const cols = splitOutsideParens(selectPart, ',');
      if (cols.length > 1) {
        result.push('SELECT');
        cols.forEach((col, i) => {
          result.push('  ' + col.trim() + (i < cols.length - 1 ? ',' : ''));
        });
        continue;
      }
    }
    result.push(line);
  }

  return result.join('\n');
}

function splitOutsideParens(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === delimiter && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}
