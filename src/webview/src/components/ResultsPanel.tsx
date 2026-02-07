import { useState, useMemo, useCallback, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
} from '@tanstack/react-table';
import type { IQueryResult, IColumn } from '../types';
import { EditRowModal } from './EditRowModal';

interface ResultsPanelProps {
  result: IQueryResult | null;
  loading?: boolean;
  tableName?: string | null;
  columns?: IColumn[];
  onInsert?: (data: Record<string, unknown>) => void;
  onUpdate?: (data: Record<string, unknown>, where: Record<string, unknown>) => void;
  onDelete?: (where: Record<string, unknown>) => void;
  onRefresh?: () => void;
}

// Cell value renderer with type-based styling
function CellValue({ value, onCopy }: { value: unknown; onCopy?: () => void }) {
  if (value === null) {
    return <span className="cell-null" onClick={onCopy}>NULL</span>;
  }
  if (value === undefined) {
    return <span className="cell-null" onClick={onCopy}>—</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="cell-boolean" onClick={onCopy}>{value ? 'true' : 'false'}</span>;
  }
  if (typeof value === 'number') {
    return <span className="cell-number" onClick={onCopy}>{value.toLocaleString()}</span>;
  }
  if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
    return <span className="cell-date" onClick={onCopy}>{String(value)}</span>;
  }
  if (typeof value === 'object') {
    return <span className="font-mono text-xs" onClick={onCopy}>{JSON.stringify(value)}</span>;
  }
  return <span onClick={onCopy}>{String(value)}</span>;
}

// Row detail expansion panel
function RowDetailPanel({ row, columns }: { row: Record<string, unknown>; columns: IColumn[] }) {
  return (
    <div className="row-detail-panel" style={{
      background: 'var(--bg-elevated)',
      borderBottom: '1px solid var(--border-default)',
      padding: '12px 16px',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: '8px',
      maxHeight: 300,
      overflowY: 'auto',
    }}>
      {columns.map(col => {
        const value = row[col.name];
        const isJson = typeof value === 'object' && value !== null;
        return (
          <div key={col.name} style={{ padding: '6px 8px', borderRadius: 4, background: 'var(--bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>{col.name}</span>
              {col.primaryKey && <span className="pk-badge" style={{ fontSize: 9 }}>PK</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-placeholder)' }}>{col.type}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all', maxHeight: 120, overflow: 'auto' }}>
              {isJson ? (
                <pre style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(value, null, 2)}
                </pre>
              ) : value === null ? (
                <span className="cell-null">NULL</span>
              ) : (
                String(value)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ResultsPanel({
  result,
  loading,
  tableName,
  columns: tableColumns = [],
  onInsert,
  onUpdate,
  onDelete,
  onRefresh
}: ResultsPanelProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [_copiedCell, setCopiedCell] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: Record<string, unknown>; value: unknown; colName: string } | null>(null);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  const columnHelper = createColumnHelper<Record<string, unknown>>();

  const columns = useMemo(() => {
    if (!result?.columns.length) return [];

    return result.columns.map(col =>
      columnHelper.accessor(row => row[col.name], {
        id: col.name,
        header: ({ column }) => (
          <div className="column-header">
            <span>{col.name}</span>
            {col.primaryKey && <span className="pk-badge">PK</span>}
            <span className="column-type">{col.type}</span>
            {column.getIsSorted() && (
              <span className="sort-indicator">
                {column.getIsSorted() === 'asc' ? '↑' : '↓'}
              </span>
            )}
          </div>
        ),
        cell: info => {
          const cellId = `${info.row.id}-${col.name}`;
          return (
            <CellValue
              value={info.getValue()}
              onCopy={() => handleCellCopy(info.getValue(), cellId)}
            />
          );
        },
        enableSorting: true,
        enableColumnFilter: true,
      })
    );
  }, [result?.columns]);

  const table = useReactTable({
    data: result?.rows || [],
    columns,
    state: { sorting, globalFilter, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: {
      pagination: { pageSize: 50 }
    }
  });

  const handleCellCopy = useCallback(async (value: unknown, cellId: string) => {
    const text = value === null ? 'NULL' : value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCell(cellId);
      setTimeout(() => setCopiedCell(null), 1500);
    } catch {
      // Fallback for non-HTTPS contexts
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, row: Record<string, unknown>, value: unknown, colName: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, row, value, colName });
  }, []);

  const handleContextAction = useCallback(async (action: string) => {
    if (!contextMenu) return;
    const { row, value, colName } = contextMenu;

    let text = '';
    switch (action) {
      case 'copy-value':
        text = value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        break;
      case 'copy-row-json':
        text = JSON.stringify(row, null, 2);
        break;
      case 'copy-column':
        text = (result?.rows || []).map(r => {
          const v = r[colName];
          return v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        }).join('\n');
        break;
      case 'copy-insert': {
        const tbl = tableName || 'table_name';
        const cols = result?.columns.map(c => `"${c.name}"`).join(', ') || '';
        const vals = result?.columns.map(c => {
          const v = row[c.name];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(', ') || '';
        text = `INSERT INTO "${tbl}" (${cols}) VALUES (${vals});`;
        break;
      }
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch { /* fallback */ }
    setContextMenu(null);
  }, [contextMenu, result, tableName]);

  const getPrimaryKeyValues = useCallback((row: Record<string, unknown>): Record<string, unknown> => {
    const pkColumns = tableColumns.filter(c => c.primaryKey);
    if (pkColumns.length === 0) {
      return row;
    }
    const where: Record<string, unknown> = {};
    for (const col of pkColumns) {
      where[col.name] = row[col.name];
    }
    return where;
  }, [tableColumns]);

  const handleRowClick = (row: Record<string, unknown>, rowId: string) => {
    if (selectedRow === row) {
      setSelectedRow(null);
      setExpandedRowId(null);
    } else {
      setSelectedRow(row);
      setExpandedRowId(rowId);
    }
  };

  const handleRowDoubleClick = (row: Record<string, unknown>) => {
    if (onUpdate && tableName) {
      setSelectedRow(row);
      setShowEditModal(true);
    }
  };

  const handleInsert = (data: Record<string, unknown>) => {
    onInsert?.(data);
    setShowInsertModal(false);
  };

  const handleUpdate = (data: Record<string, unknown>) => {
    if (selectedRow) {
      onUpdate?.(data, getPrimaryKeyValues(selectedRow));
    }
    setShowEditModal(false);
    setSelectedRow(null);
  };

  const handleDelete = () => {
    if (selectedRow && onDelete) {
      if (confirm('Are you sure you want to delete this row? This action cannot be undone.')) {
        onDelete(getPrimaryKeyValues(selectedRow));
        setSelectedRow(null);
        setExpandedRowId(null);
      }
    }
  };

  const activeFilterCount = columnFilters.length + (globalFilter ? 1 : 0);

  // Loading State
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-primary">
        <div className="flex flex-col items-center gap-4">
          <div className="spinner" />
          <div className="text-secondary text-sm">Executing query...</div>
        </div>
      </div>
    );
  }

  // Empty State
  if (!result) {
    return (
      <div className="empty-state flex-1 bg-primary">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <div className="empty-state-title">No Results</div>
        <div className="empty-state-description">
          Write a SQL query and click Run to see results here
        </div>
      </div>
    );
  }

  // Error State
  if (result.error) {
    return (
      <div className="flex-1 p-4 bg-primary">
        <div className="message error">
          <svg className="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <div>
            <div className="font-semibold mb-1">Query Error</div>
            <div className="text-sm opacity-90">{result.error}</div>
          </div>
        </div>
      </div>
    );
  }

  // Affected Rows State (for INSERT/UPDATE/DELETE)
  if (result.affectedRows !== undefined && result.rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-primary">
        <div className="message success">
          <svg className="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div>
            <div className="font-semibold">Query Executed Successfully</div>
            <div className="text-sm opacity-90">
              {result.affectedRows} row(s) affected in {result.executionTime}ms
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-primary min-h-0">
      {/* Table Toolbar */}
      <div className="toolbar">
        <div className="toolbar-section">
          {tableName && (
            <>
              <div className="toolbar-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                <span>{tableName}</span>
              </div>
              <div className="toolbar-divider" />
            </>
          )}

          {/* Search */}
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)',
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="input select"
              placeholder="Search results..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              style={{ paddingLeft: 32, width: 200 }}
            />
            {activeFilterCount > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setGlobalFilter(''); setColumnFilters([]); }}
                style={{ marginLeft: 4, fontSize: 11, color: 'var(--accent-primary)' }}
                title="Clear all filters"
              >
                {activeFilterCount} filter(s) active — Clear
              </button>
            )}
          </div>
        </div>

        <div className="toolbar-spacer" />

        <div className="toolbar-section">
          {/* Column Visibility Picker */}
          <div className="relative" ref={columnPickerRef}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              title="Toggle column visibility"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Columns
            </button>
            {showColumnPicker && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                zIndex: 300,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 6,
                padding: 8,
                minWidth: 200,
                maxHeight: 320,
                overflowY: 'auto',
                boxShadow: 'var(--shadow-lg)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => {
                    const allVisible: VisibilityState = {};
                    result.columns.forEach(c => { allVisible[c.name] = true; });
                    setColumnVisibility(allVisible);
                  }}>Show All</button>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setColumnVisibility({})}>Reset</button>
                </div>
                {result.columns.map(col => {
                  const isVisible = columnVisibility[col.name] !== false;
                  return (
                    <label key={col.name} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--text-primary)',
                    }}>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => {
                          setColumnVisibility(prev => ({
                            ...prev,
                            [col.name]: !isVisible,
                          }));
                        }}
                        style={{ accentColor: 'var(--accent-primary)' }}
                      />
                      <span>{col.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>{col.type}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {onRefresh && (
            <button className="btn btn-ghost btn-sm" onClick={onRefresh}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Refresh
            </button>
          )}

          {onInsert && (
            <button className="btn btn-sm" onClick={() => setShowInsertModal(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Insert Row
            </button>
          )}

          {selectedRow && onUpdate && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowEditModal(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}

          {selectedRow && onDelete && (
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={header.column.getIsSorted() ? 'sorted' : ''}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '48px 16px' }}>
                  <div className="text-secondary">No data matching your search</div>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <>
                  <tr
                    key={row.id}
                    onClick={() => handleRowClick(row.original, row.id)}
                    onDoubleClick={() => handleRowDoubleClick(row.original)}
                    onContextMenu={(e) => {
                      const cellEl = (e.target as HTMLElement).closest('td');
                      const cellIndex = cellEl ? Array.from(cellEl.parentElement?.children || []).indexOf(cellEl) : 0;
                      const visibleCols = table.getVisibleFlatColumns();
                      const colName = visibleCols[cellIndex]?.id || '';
                      handleContextMenu(e, row.original, row.original[colName], colName);
                    }}
                    className={selectedRow === row.original ? 'selected' : ''}
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {expandedRowId === row.id && selectedRow === row.original && (
                    <tr key={`${row.id}-detail`}>
                      <td colSpan={row.getVisibleCells().length} style={{ padding: 0 }}>
                        <RowDetailPanel row={row.original} columns={result.columns} />
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 400 }} onClick={() => setContextMenu(null)} />
          <div style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 401,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            padding: 4,
            minWidth: 180,
            boxShadow: 'var(--shadow-lg)',
          }}>
            {[
              { key: 'copy-value', label: 'Copy Value' },
              { key: 'copy-row-json', label: 'Copy Row as JSON' },
              { key: 'copy-column', label: 'Copy Column Values' },
              { key: 'copy-insert', label: 'Copy as INSERT' },
            ].map(item => (
              <button
                key={item.key}
                onClick={() => handleContextAction(item.key)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 12px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Pagination */}
      <div className="pagination">
        <button
          className="pagination-btn"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
          title="First Page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="11 17 6 12 11 7" />
            <polyline points="18 17 13 12 18 7" />
          </svg>
        </button>
        <button
          className="pagination-btn"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          title="Previous Page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span className="pagination-info">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
          <span className="text-muted ml-2">
            ({table.getFilteredRowModel().rows.length} rows)
          </span>
        </span>

        <button
          className="pagination-btn"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          title="Next Page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          className="pagination-btn"
          onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
          title="Last Page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>

        <div className="toolbar-spacer" />

        <select
          className="input select"
          value={table.getState().pagination.pageSize}
          onChange={e => table.setPageSize(Number(e.target.value))}
          style={{ width: 'auto' }}
        >
          {[25, 50, 100, 200, 500, 1000].map(pageSize => (
            <option key={pageSize} value={pageSize}>
              {pageSize} rows
            </option>
          ))}
        </select>
      </div>

      {/* Insert Modal */}
      {showInsertModal && (
        <EditRowModal
          title="Insert New Row"
          columns={tableColumns}
          onSave={handleInsert}
          onCancel={() => setShowInsertModal(false)}
        />
      )}

      {/* Edit Modal */}
      {showEditModal && selectedRow && (
        <EditRowModal
          title="Edit Row"
          columns={tableColumns}
          initialData={selectedRow}
          onSave={handleUpdate}
          onCancel={() => {
            setShowEditModal(false);
            setSelectedRow(null);
          }}
        />
      )}
    </div>
  );
}
