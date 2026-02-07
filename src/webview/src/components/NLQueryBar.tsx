import { useState } from 'react';
import { useVscodeApi } from '../hooks/useVscodeApi';
import { toast } from './Toast';

interface NLQueryBarProps {
  connectionId: string;
  onSQLGenerated: (sql: string) => void;
}

export function NLQueryBar({ connectionId, onSQLGenerated }: NLQueryBarProps) {
  const vscode = useVscodeApi();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim() || !connectionId) return;

    setLoading(true);
    try {
      const response = await vscode.postMessage({
        type: 'NL_TO_SQL' as any,
        id: crypto.randomUUID(),
        payload: { connectionId, prompt: prompt.trim() }
      });

      if (response.success && response.data) {
        onSQLGenerated(response.data as string);
        toast.success('SQL Generated', 'Query generated from your description');
      } else {
        toast.error('Generation Failed', response.error || 'Failed to generate SQL');
      }
    } catch (err) {
      toast.error('AI Error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
    if (e.key === 'Escape') {
      setIsExpanded(false);
    }
  };

  if (!isExpanded) {
    return (
      <button
        className="nl-query-toggle"
        onClick={() => setIsExpanded(true)}
        title="Ask AI to generate SQL"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>Ask AI</span>
      </button>
    );
  }

  return (
    <div className="nl-query-bar">
      <div className="nl-query-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <input
        type="text"
        className="nl-query-input"
        placeholder="Describe what you want to query... (e.g., 'Show top 10 customers by total orders')"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
      />
      <button
        className="btn btn-sm"
        onClick={handleGenerate}
        disabled={loading || !prompt.trim()}
      >
        {loading ? (
          <div className="spinner spinner-sm" />
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10" />
            </svg>
            Generate
          </>
        )}
      </button>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => setIsExpanded(false)}
        title="Close AI bar"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
