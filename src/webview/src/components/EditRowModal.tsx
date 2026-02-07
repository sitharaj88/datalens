import { useState, useEffect, useRef } from 'react';
import type { IColumn } from '../types';

interface EditRowModalProps {
  title: string;
  columns: IColumn[];
  initialData?: Record<string, unknown>;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}

function getInputType(col: IColumn): 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json' | 'textarea' {
  const type = col.type.toUpperCase();
  const name = col.name.toLowerCase();

  if (type.includes('BOOL')) return 'boolean';
  if (type.includes('INT') || type.includes('REAL') || type.includes('FLOAT') ||
      type.includes('DOUBLE') || type.includes('NUMERIC') || type.includes('DECIMAL') ||
      type.includes('SERIAL')) return 'number';
  if (type === 'DATE' || (name.includes('date') && !name.includes('update'))) return 'date';
  if (type.includes('TIMESTAMP') || type.includes('DATETIME') || name.endsWith('_at')) return 'datetime';
  if (type.includes('JSON')) return 'json';
  if (type.includes('TEXT') || type.includes('CLOB') || name.includes('description') ||
      name.includes('body') || name.includes('content') || name.includes('bio')) return 'textarea';
  return 'text';
}

export function EditRowModal({
  title,
  columns,
  initialData,
  onSave,
  onCancel
}: EditRowModalProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [boolData, setBoolData] = useState<Record<string, boolean | null>>({});
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    const initial: Record<string, string> = {};
    const bools: Record<string, boolean | null> = {};

    for (const col of columns) {
      const inputType = getInputType(col);
      const value = initialData?.[col.name];

      if (inputType === 'boolean') {
        if (value === null || value === undefined) bools[col.name] = null;
        else bools[col.name] = Boolean(value) && value !== '0' && value !== 'false';
      } else if (value !== undefined && value !== null) {
        if (inputType === 'json' && typeof value === 'object') {
          initial[col.name] = JSON.stringify(value, null, 2);
        } else if (inputType === 'datetime' && typeof value === 'string') {
          // Convert to datetime-local format
          initial[col.name] = value.replace(' ', 'T').substring(0, 16);
        } else {
          initial[col.name] = String(value);
        }
      } else {
        initial[col.name] = col.defaultValue !== undefined ? String(col.defaultValue) : '';
      }
    }
    setFormData(initial);
    setBoolData(bools);

    setTimeout(() => {
      firstInputRef.current?.focus();
    }, 100);
  }, [columns, initialData]);

  const handleChange = (columnName: string, value: string) => {
    setFormData(prev => ({ ...prev, [columnName]: value }));
  };

  const handleBoolChange = (columnName: string, value: boolean | null) => {
    setBoolData(prev => ({ ...prev, [columnName]: value }));
  };

  const handleReset = (columnName: string) => {
    if (initialData && initialData[columnName] !== undefined) {
      const col = columns.find(c => c.name === columnName);
      if (col && getInputType(col) === 'boolean') {
        const val = initialData[columnName];
        setBoolData(prev => ({ ...prev, [columnName]: val === null ? null : Boolean(val) }));
      } else {
        setFormData(prev => ({ ...prev, [columnName]: String(initialData[columnName] ?? '') }));
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data: Record<string, unknown> = {};
    for (const col of columns) {
      if (col.autoIncrement && !initialData) continue;

      const inputType = getInputType(col);

      if (inputType === 'boolean') {
        const bval = boolData[col.name];
        if (bval === null && col.nullable) {
          data[col.name] = null;
        } else {
          data[col.name] = bval ?? false;
        }
        continue;
      }

      const value = formData[col.name];

      if (value === '' && col.nullable) {
        data[col.name] = null;
      } else if (value === '') {
        continue;
      } else {
        if (inputType === 'number') {
          data[col.name] = Number(value);
        } else if (inputType === 'json') {
          try { data[col.name] = JSON.parse(value); } catch { data[col.name] = value; }
        } else {
          data[col.name] = value;
        }
      }
    }

    onSave(data);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  const firstEditableIndex = columns.findIndex(col => !(col.autoIncrement && !initialData));

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onCancel}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {columns.map((col, index) => {
              const isDisabled = col.autoIncrement && !initialData;
              const isFirstEditable = index === firstEditableIndex;
              const inputType = getInputType(col);

              return (
                <div key={col.name} className="form-group">
                  <label className="form-label">
                    <span>{col.name}</span>
                    {col.primaryKey && <span className="pk-badge">PK</span>}
                    {!col.nullable && !col.autoIncrement && <span className="required">*</span>}
                    <span className="column-type" style={{ marginLeft: 'auto' }}>{col.type}</span>
                    {initialData && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleReset(col.name)}
                        title="Reset to original value"
                        style={{ padding: '0 4px', marginLeft: 4, minWidth: 'auto' }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M23 4v6h-6M1 20v-6h6" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      </button>
                    )}
                  </label>

                  {isDisabled ? (
                    <>
                      <input
                        type="text"
                        className="input"
                        value="(Auto-generated)"
                        disabled
                      />
                      <div className="form-hint">Auto-generated value</div>
                    </>
                  ) : inputType === 'boolean' ? (
                    <div className="flex items-center gap-3" style={{ height: 36 }}>
                      <button
                        type="button"
                        className={`toggle-switch ${boolData[col.name] === true ? 'active' : ''}`}
                        onClick={() => handleBoolChange(col.name, boolData[col.name] === true ? false : true)}
                        style={{
                          width: 44,
                          height: 24,
                          borderRadius: 12,
                          background: boolData[col.name] ? 'var(--accent-secondary)' : 'var(--bg-elevated)',
                          border: '1px solid var(--border-default)',
                          cursor: 'pointer',
                          position: 'relative',
                          transition: 'background 0.2s',
                        }}
                      >
                        <div style={{
                          width: 18,
                          height: 18,
                          borderRadius: 9,
                          background: 'white',
                          position: 'absolute',
                          top: 2,
                          left: boolData[col.name] ? 22 : 2,
                          transition: 'left 0.2s',
                        }} />
                      </button>
                      <span className="text-sm" style={{ color: boolData[col.name] ? 'var(--success-text)' : 'var(--text-tertiary)' }}>
                        {boolData[col.name] === null ? 'NULL' : boolData[col.name] ? 'TRUE' : 'FALSE'}
                      </span>
                      {col.nullable && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleBoolChange(col.name, null)}
                          style={{ fontSize: 11, padding: '2px 6px' }}
                        >
                          NULL
                        </button>
                      )}
                    </div>
                  ) : inputType === 'textarea' ? (
                    <textarea
                      ref={isFirstEditable ? firstInputRef as React.RefObject<HTMLTextAreaElement> : undefined}
                      className="input"
                      value={formData[col.name] || ''}
                      onChange={e => handleChange(col.name, e.target.value)}
                      placeholder={col.nullable ? 'NULL' : 'Required'}
                      rows={3}
                      style={{ resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }}
                    />
                  ) : inputType === 'json' ? (
                    <textarea
                      ref={isFirstEditable ? firstInputRef as React.RefObject<HTMLTextAreaElement> : undefined}
                      className="input"
                      value={formData[col.name] || ''}
                      onChange={e => handleChange(col.name, e.target.value)}
                      placeholder='{"key": "value"}'
                      rows={4}
                      style={{ resize: 'vertical', minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    />
                  ) : inputType === 'date' ? (
                    <input
                      ref={isFirstEditable ? firstInputRef as React.RefObject<HTMLInputElement> : undefined}
                      type="date"
                      className="input"
                      value={formData[col.name] || ''}
                      onChange={e => handleChange(col.name, e.target.value)}
                    />
                  ) : inputType === 'datetime' ? (
                    <input
                      ref={isFirstEditable ? firstInputRef as React.RefObject<HTMLInputElement> : undefined}
                      type="datetime-local"
                      className="input"
                      value={formData[col.name] || ''}
                      onChange={e => handleChange(col.name, e.target.value)}
                    />
                  ) : inputType === 'number' ? (
                    <input
                      ref={isFirstEditable ? firstInputRef as React.RefObject<HTMLInputElement> : undefined}
                      type="number"
                      className="input"
                      value={formData[col.name] || ''}
                      onChange={e => handleChange(col.name, e.target.value)}
                      placeholder={col.nullable ? 'NULL' : '0'}
                      step="any"
                    />
                  ) : (
                    <input
                      ref={isFirstEditable ? firstInputRef as React.RefObject<HTMLInputElement> : undefined}
                      type="text"
                      className="input"
                      value={formData[col.name] || ''}
                      onChange={e => handleChange(col.name, e.target.value)}
                      placeholder={col.nullable ? 'NULL' : 'Required'}
                      autoComplete="off"
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {initialData ? 'Save Changes' : 'Insert Row'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
