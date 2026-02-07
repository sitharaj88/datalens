import { useState, useEffect } from 'react';
import { useVscodeApi } from '../hooks/useVscodeApi';

interface LintWarning {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

interface LintPanelProps {
  connectionId: string;
  query: string;
}

const severityIcons: Record<string, JSX.Element> = {
  error: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d29922" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#388bfd" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

export function LintPanel({ connectionId, query }: LintPanelProps) {
  const vscode = useVscodeApi();
  const [warnings, setWarnings] = useState<LintWarning[]>([]);
  const [_loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setWarnings([]);
      return;
    }

    // Debounce lint check
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await vscode.postMessage({
          type: 'LINT_SQL' as any,
          id: crypto.randomUUID(),
          payload: { connectionId, sql: query }
        });

        if (response.success && Array.isArray(response.data)) {
          setWarnings(response.data as LintWarning[]);
        }
      } catch {
        // Ignore lint errors
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query, connectionId]);

  if (warnings.length === 0) return null;

  const errorCount = warnings.filter(w => w.severity === 'error').length;
  const warnCount = warnings.filter(w => w.severity === 'warning').length;
  const infoCount = warnings.filter(w => w.severity === 'info').length;

  return (
    <div className="lint-panel">
      <div className="lint-summary">
        {errorCount > 0 && <span className="lint-count error">{errorCount} error{errorCount > 1 ? 's' : ''}</span>}
        {warnCount > 0 && <span className="lint-count warning">{warnCount} warning{warnCount > 1 ? 's' : ''}</span>}
        {infoCount > 0 && <span className="lint-count info">{infoCount} hint{infoCount > 1 ? 's' : ''}</span>}
      </div>
      <div className="lint-warnings">
        {warnings.map((warning, i) => (
          <div key={i} className={`lint-warning ${warning.severity}`}>
            <div className="lint-icon">{severityIcons[warning.severity]}</div>
            <div className="lint-content">
              <div className="lint-message">{warning.message}</div>
              {warning.suggestion && (
                <div className="lint-suggestion">{warning.suggestion}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
