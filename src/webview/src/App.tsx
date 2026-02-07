import { useEffect, useCallback } from 'react';
import { QueryEditor } from './components/QueryEditor';
import { ResultsPanel } from './components/ResultsPanel';
import { ChartPanel } from './components/ChartPanel';
import { TabBar } from './components/TabBar';
import { TransactionBar } from './components/TransactionBar';
import { QueryPlanPanel } from './components/QueryPlanPanel';
import { LintPanel } from './components/LintPanel';
import { WelcomePanel } from './components/WelcomePanel';
import { ToastContainer, toast } from './components/Toast';
import { useVscodeApi } from './hooks/useVscodeApi';
import { useTabStore } from './store/tabStore';
import { useSettingsStore } from './store/settingsStore';
import { useQueryHistory } from './hooks/useQueryHistory';
import { useKeyboardShortcuts, formatShortcut } from './hooks/useKeyboardShortcuts';
import type { IQueryResult, IColumn } from './types';

declare global {
  interface Window {
    initialState?: {
      connectionId: string;
      tableName: string | null;
    };
  }
}

function App() {
  const vscode = useVscodeApi();
  const { tabs, addTab, updateTab } = useTabStore();
  const activeTab = useTabStore(state => state.tabs.find(t => t.id === state.activeTabId));
  const { addQuery } = useQueryHistory();
  const { theme, setTheme } = useSettingsStore();

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const cycleTheme = () => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
  };

  // Initialize from window state
  useEffect(() => {
    if (window.initialState) {
      const { connectionId, tableName } = window.initialState;

      if (tableName) {
        addTab({
          title: tableName,
          connectionId,
          tableName,
          query: `SELECT * FROM "${tableName}" LIMIT 100`,
        });
      } else {
        addTab({ title: 'New Query', connectionId });
      }
    } else {
      // No initial state - just add empty tab
      if (tabs.length === 0) {
        addTab({ title: 'New Query' });
      }
    }
  }, []); // Only run once

  // Load columns when active tab's table changes
  useEffect(() => {
    if (activeTab?.connectionId && activeTab?.tableName) {
      loadColumns(activeTab.id, activeTab.connectionId, activeTab.tableName);
      // Auto-load table data for new tabs
      if (!activeTab.result && !activeTab.loading) {
        loadTableData(activeTab.id, activeTab.connectionId, activeTab.tableName);
      }
    }
  }, [activeTab?.connectionId, activeTab?.tableName]);

  const loadColumns = async (tabId: string, connectionId: string, tableName: string) => {
    try {
      const response = await vscode.postMessage({
        type: 'GET_COLUMNS',
        id: crypto.randomUUID(),
        payload: { connectionId, table: tableName }
      });
      if (response.success) {
        updateTab(tabId, { columns: response.data as IColumn[] });
      }
    } catch { /* ignore */ }
  };

  const loadTableData = async (tabId: string, connectionId: string, tableName: string) => {
    updateTab(tabId, { loading: true, error: null });
    try {
      const response = await vscode.postMessage({
        type: 'GET_TABLE_DATA',
        id: crypto.randomUUID(),
        payload: { connectionId, table: tableName, options: { limit: 100 } }
      });
      if (response.success) {
        updateTab(tabId, { result: response.data as IQueryResult, loading: false });
      } else {
        updateTab(tabId, { error: response.error || 'Failed to load data', loading: false });
        toast.error('Load Failed', response.error || 'Failed to load table data');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateTab(tabId, { error: message, loading: false });
      toast.error('Connection Error', message);
    }
  };

  const handleRunQuery = useCallback(async (sql: string) => {
    if (!activeTab?.connectionId || !sql.trim()) return;
    const tabId = activeTab.id;
    const connectionId = activeTab.connectionId;

    updateTab(tabId, { loading: true, error: null });
    const startTime = Date.now();

    try {
      const response = await vscode.postMessage({
        type: 'EXECUTE_QUERY',
        id: crypto.randomUUID(),
        payload: { connectionId, sql }
      });

      const executionTime = Date.now() - startTime;

      if (response.success) {
        const queryResult = response.data as IQueryResult;
        updateTab(tabId, { result: queryResult, loading: false });
        addQuery({ query: sql, connectionId, executionTime: queryResult.executionTime || executionTime, rowCount: queryResult.rowCount });
        if (queryResult.affectedRows !== undefined) {
          toast.success('Query Executed', `${queryResult.affectedRows} row(s) affected`);
        }
      } else {
        updateTab(tabId, { error: response.error || 'Query failed', loading: false });
        addQuery({ query: sql, connectionId, error: response.error });
        toast.error('Query Failed', response.error || 'Query execution failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateTab(tabId, { error: message, loading: false });
      addQuery({ query: sql, connectionId, error: message });
      toast.error('Execution Error', message);
    }
  }, [activeTab?.id, activeTab?.connectionId, vscode, addQuery, updateTab]);

  const handleInsertRow = async (data: Record<string, unknown>) => {
    if (!activeTab?.connectionId || !activeTab?.tableName) return;
    updateTab(activeTab.id, { loading: true, error: null });
    try {
      const response = await vscode.postMessage({
        type: 'INSERT_ROW',
        id: crypto.randomUUID(),
        payload: { connectionId: activeTab.connectionId, table: activeTab.tableName, data }
      });
      if (response.success) {
        await loadTableData(activeTab.id, activeTab.connectionId, activeTab.tableName);
        toast.success('Row Inserted', 'New row has been added successfully');
      } else {
        updateTab(activeTab.id, { error: response.error || 'Insert failed', loading: false });
        toast.error('Insert Failed', response.error || 'Failed to insert row');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateTab(activeTab.id, { error: message, loading: false });
      toast.error('Insert Error', message);
    }
  };

  const handleUpdateRow = async (data: Record<string, unknown>, where: Record<string, unknown>) => {
    if (!activeTab?.connectionId || !activeTab?.tableName) return;
    updateTab(activeTab.id, { loading: true, error: null });
    try {
      const response = await vscode.postMessage({
        type: 'UPDATE_ROW',
        id: crypto.randomUUID(),
        payload: { connectionId: activeTab.connectionId, table: activeTab.tableName, data, where }
      });
      if (response.success) {
        await loadTableData(activeTab.id, activeTab.connectionId, activeTab.tableName);
        toast.success('Row Updated', 'Changes have been saved successfully');
      } else {
        updateTab(activeTab.id, { error: response.error || 'Update failed', loading: false });
        toast.error('Update Failed', response.error || 'Failed to update row');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateTab(activeTab.id, { error: message, loading: false });
      toast.error('Update Error', message);
    }
  };

  const handleDeleteRow = async (where: Record<string, unknown>) => {
    if (!activeTab?.connectionId || !activeTab?.tableName) return;
    updateTab(activeTab.id, { loading: true, error: null });
    try {
      const response = await vscode.postMessage({
        type: 'DELETE_ROW',
        id: crypto.randomUUID(),
        payload: { connectionId: activeTab.connectionId, table: activeTab.tableName, where }
      });
      if (response.success) {
        await loadTableData(activeTab.id, activeTab.connectionId, activeTab.tableName);
        toast.success('Row Deleted', 'Row has been removed successfully');
      } else {
        updateTab(activeTab.id, { error: response.error || 'Delete failed', loading: false });
        toast.error('Delete Failed', response.error || 'Failed to delete row');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateTab(activeTab.id, { error: message, loading: false });
      toast.error('Delete Error', message);
    }
  };

  const handleQueryChange = (value: string) => {
    if (activeTab) {
      updateTab(activeTab.id, { query: value, isDirty: true });
    }
  };

  const handleExport = async (format: 'csv' | 'json' | 'sql' | 'markdown') => {
    if (!activeTab?.result) return;
    const result = activeTab.result;

    let content: string;
    let extension: string;

    if (format === 'csv') {
      const headers = result.columns.map(col => col.name).join(',');
      const rows = result.rows.map(row =>
        result.columns.map(col => {
          const value = row[col.name];
          if (value === null || value === undefined) return '';
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return String(value);
        }).join(',')
      );
      content = [headers, ...rows].join('\n');
      extension = 'csv';
    } else if (format === 'json') {
      content = JSON.stringify(result.rows, null, 2);
      extension = 'json';
    } else if (format === 'sql') {
      const tableName = activeTab.tableName || 'exported_table';
      const lines = result.rows.map(row => {
        const cols = result.columns.map(c => `"${c.name}"`).join(', ');
        const vals = result.columns.map(c => {
          const v = row[c.name];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(', ');
        return `INSERT INTO "${tableName}" (${cols}) VALUES (${vals});`;
      });
      content = lines.join('\n');
      extension = 'sql';
    } else {
      // markdown
      const headers = result.columns.map(c => c.name);
      const headerRow = '| ' + headers.join(' | ') + ' |';
      const separatorRow = '| ' + headers.map(() => '---').join(' | ') + ' |';
      const dataRows = result.rows.map(row =>
        '| ' + result.columns.map(c => {
          const v = row[c.name];
          if (v === null || v === undefined) return 'NULL';
          return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
        }).join(' | ') + ' |'
      );
      content = [headerRow, separatorRow, ...dataRows].join('\n');
      extension = 'md';
    }

    const defaultName = `${activeTab.tableName || 'query_result'}_${new Date().toISOString().slice(0, 10)}.${extension}`;

    try {
      const response = await vscode.postMessage({
        type: 'SAVE_FILE',
        id: crypto.randomUUID(),
        payload: { content, defaultName, fileType: extension }
      });
      if (response.success) {
        toast.success('Export Complete', `Data exported as ${format.toUpperCase()}`);
      } else if (response.error !== 'Save cancelled') {
        toast.error('Export Failed', response.error || 'Failed to save file');
      }
    } catch {
      toast.error('Export Failed', 'Could not save export file');
    }
  };

  const setActiveView = (view: 'data' | 'chart' | 'plan') => {
    if (activeTab) {
      updateTab(activeTab.id, { activeView: view });
    }
  };

  // Keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'r', ctrl: true, description: 'Refresh data', action: () => {
      if (activeTab?.connectionId && activeTab?.tableName) {
        loadTableData(activeTab.id, activeTab.connectionId, activeTab.tableName);
      }
    }},
    { key: '1', ctrl: true, description: 'Data tab', action: () => setActiveView('data') },
    { key: '2', ctrl: true, description: 'Chart tab', action: () => setActiveView('chart') },
    { key: '3', ctrl: true, description: 'Plan tab', action: () => setActiveView('plan') },
    { key: 't', ctrl: true, description: 'New tab', action: () => addTab({ title: 'New Query', connectionId: activeTab?.connectionId || undefined }) },
    { key: 'w', ctrl: true, description: 'Close tab', action: () => { if (activeTab) useTabStore.getState().removeTab(activeTab.id); } },
  ]);

  const activeView = activeTab?.activeView || 'data';

  return (
    <div className="flex flex-col h-full bg-primary">
      {/* Tab Bar */}
      <TabBar />

      {activeTab ? (
        <>
          {/* Query Editor */}
          <QueryEditor
            value={activeTab.query}
            onChange={handleQueryChange}
            onRun={handleRunQuery}
            loading={activeTab.loading}
            connectionId={activeTab.connectionId || ''}
          />

          {/* Lint Panel */}
          {activeTab.connectionId && activeTab.query.trim() && (
            <LintPanel
              connectionId={activeTab.connectionId}
              query={activeTab.query}
            />
          )}

          {/* Error Banner */}
          {activeTab.error && (
            <div className="message error" style={{ margin: '12px 16px', marginBottom: 0 }}>
              <svg className="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1">{activeTab.error}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => updateTab(activeTab.id, { error: null })} style={{ padding: '4px 8px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {/* View Tabs */}
          <div className="tabs-container">
            <div className="tabs">
              <button className={`tab ${activeView === 'data' ? 'active' : ''}`} onClick={() => setActiveView('data')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                Data
                <kbd className="kbd" style={{ marginLeft: 8 }}>{formatShortcut({ key: '1', ctrl: true })}</kbd>
              </button>
              <button className={`tab ${activeView === 'chart' ? 'active' : ''}`} onClick={() => setActiveView('chart')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                Chart
                <kbd className="kbd" style={{ marginLeft: 8 }}>{formatShortcut({ key: '2', ctrl: true })}</kbd>
              </button>
              <button className={`tab ${activeView === 'plan' ? 'active' : ''}`} onClick={() => setActiveView('plan')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
                Plan
                <kbd className="kbd" style={{ marginLeft: 8 }}>{formatShortcut({ key: '3', ctrl: true })}</kbd>
              </button>
            </div>

            <div className="toolbar-spacer" />

            {/* Transaction Bar */}
            {activeTab.connectionId && (
              <div className="toolbar-section" style={{ paddingRight: 8 }}>
                <TransactionBar
                  connectionId={activeTab.connectionId}
                  onTransactionEnd={() => {
                    if (activeTab.connectionId && activeTab.tableName) {
                      loadTableData(activeTab.id, activeTab.connectionId, activeTab.tableName);
                    }
                  }}
                />
              </div>
            )}

            {/* Export Buttons */}
            {activeTab.result && activeTab.result.rows.length > 0 && activeView === 'data' && (
              <div className="toolbar-section" style={{ paddingRight: 16, gap: 2 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => handleExport('csv')} title="Export as CSV">
                  CSV
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleExport('json')} title="Export as JSON">
                  JSON
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleExport('sql')} title="Export as SQL INSERT statements">
                  SQL
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleExport('markdown')} title="Export as Markdown table">
                  MD
                </button>
              </div>
            )}
          </div>

          {/* Content Area */}
          {activeView === 'data' ? (
            <ResultsPanel
              result={activeTab.result}
              loading={activeTab.loading}
              tableName={activeTab.tableName}
              columns={activeTab.columns}
              onInsert={activeTab.tableName ? handleInsertRow : undefined}
              onUpdate={activeTab.tableName ? handleUpdateRow : undefined}
              onDelete={activeTab.tableName ? handleDeleteRow : undefined}
              onRefresh={activeTab.tableName && activeTab.connectionId ? () => loadTableData(activeTab.id, activeTab.connectionId!, activeTab.tableName!) : undefined}
            />
          ) : activeView === 'chart' ? (
            activeTab.result ? <ChartPanel result={activeTab.result} /> : (
              <div className="empty-state flex-1 bg-primary">
                <div className="empty-state-title">No Data</div>
                <div className="empty-state-description">Run a query first to visualize results</div>
              </div>
            )
          ) : (
            <QueryPlanPanel connectionId={activeTab.connectionId || ''} query={activeTab.query} />
          )}
        </>
      ) : (
        <WelcomePanel onQuerySelect={(query) => {
          addTab({ title: 'New Query', query });
        }} />
      )}

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-item">
          <div className={`status-dot ${activeTab?.connectionId ? '' : 'warning'}`} />
          <span>{activeTab?.connectionId ? 'Connected' : 'No Connection'}</span>
          {activeTab?.result && (
            <>
              <span style={{ margin: '0 8px', color: 'var(--border-default)' }}>|</span>
              <span>{activeTab.result.rowCount.toLocaleString()} row(s)</span>
              {activeTab.result.executionTime !== undefined && (
                <span style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>{activeTab.result.executionTime}ms</span>
              )}
            </>
          )}
        </div>
        <div className="status-item">
          {activeTab?.tableName && (
            <span className="badge badge-primary">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              {activeTab.tableName}
            </span>
          )}
          {activeTab && !activeTab.tableName && <span>Query Mode</span>}
          {!activeTab && <span>No Tab</span>}
          <button
            className="btn btn-ghost btn-sm"
            onClick={cycleTheme}
            title={`Theme: ${theme} (click to change)`}
            style={{ marginLeft: 8, padding: '2px 6px', fontSize: 11 }}
          >
            {theme === 'dark' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : theme === 'light' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            )}
            {theme}
          </button>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}

export default App;
