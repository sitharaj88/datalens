import { useQueryHistory, formatRelativeTime } from '../hooks/useQueryHistory';
import { formatShortcut } from '../hooks/useKeyboardShortcuts';

interface WelcomePanelProps {
  onQuerySelect?: (query: string) => void;
}

export function WelcomePanel({ onQuerySelect }: WelcomePanelProps) {
  const { getRecentQueries } = useQueryHistory();
  const recentQueries = getRecentQueries('', 8);

  const shortcuts = [
    { keys: { key: 'Enter', ctrl: true }, label: 'Run Query' },
    { keys: { key: 't', ctrl: true }, label: 'New Tab' },
    { keys: { key: 'w', ctrl: true }, label: 'Close Tab' },
    { keys: { key: 'r', ctrl: true }, label: 'Refresh Data' },
    { keys: { key: 'F', ctrl: true, shift: true }, label: 'Format SQL' },
    { keys: { key: '1', ctrl: true }, label: 'Data View' },
    { keys: { key: '2', ctrl: true }, label: 'Chart View' },
    { keys: { key: '3', ctrl: true }, label: 'Plan View' },
  ];

  return (
    <div className="welcome-panel">
      <div className="welcome-content">
        <div className="welcome-logo">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        </div>
        <h1 className="welcome-title">Database Viewer Pro</h1>
        <p className="welcome-subtitle">A world-class multi-database viewer</p>

        <div className="welcome-features">
          <div className="welcome-feature">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <div>
              <strong>15 Database Types</strong>
              <span>PostgreSQL, MySQL, SQLite, MongoDB, Redis, Neo4j, and more</span>
            </div>
          </div>
          <div className="welcome-feature">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <div>
              <strong>AI-Powered Queries</strong>
              <span>Natural language to SQL with OpenAI, Anthropic, or Ollama</span>
            </div>
          </div>
          <div className="welcome-feature">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M13 6h3a2 2 0 0 1 2 2v7" />
              <line x1="6" y1="9" x2="6" y2="21" />
            </svg>
            <div>
              <strong>Schema Visualization</strong>
              <span>ERD diagrams, query plans, and schema browsing</span>
            </div>
          </div>
          <div className="welcome-feature">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <div>
              <strong>Data Visualization</strong>
              <span>Bar, line, area, scatter, pie, and donut charts with aggregation</span>
            </div>
          </div>
        </div>

        {/* Recent Queries */}
        {recentQueries.length > 0 && onQuerySelect && (
          <div className="welcome-recent">
            <h3>Recent Queries</h3>
            <div className="recent-queries-list">
              {recentQueries.map((item) => (
                <button
                  key={item.id}
                  className="recent-query-item"
                  onClick={() => onQuerySelect(item.query)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="recent-query-text">{item.query}</span>
                  <span className="recent-query-time">{formatRelativeTime(item.timestamp)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="welcome-shortcuts">
          <h3>Keyboard Shortcuts</h3>
          <div className="shortcut-list">
            {shortcuts.map((shortcut, i) => (
              <div key={i} className="shortcut-item">
                <kbd>{formatShortcut(shortcut.keys)}</kbd>
                <span>{shortcut.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
