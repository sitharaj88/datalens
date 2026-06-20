import { useState } from 'react';
import { useVscodeApi } from '../hooks/useVscodeApi';
import { toast } from './Toast';

interface NLQueryBarProps {
  connectionId: string;
  onSQLGenerated: (sql: string) => void;
}

type Mode = 'generate' | 'agent';

interface AgentStep {
  index: number;
  thought?: string;
  action: 'run_sql' | 'final';
  sql?: string;
  observation?: string;
  answer?: string;
  refused?: boolean;
}

interface AgentRunResult {
  steps: AgentStep[];
  answer: string;
  completed: boolean;
}

export function NLQueryBar({ connectionId, onSQLGenerated }: NLQueryBarProps) {
  const vscode = useVscodeApi();
  const [mode, setMode] = useState<Mode>('generate');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);

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

  const handleRunAgent = async () => {
    if (!prompt.trim() || !connectionId) return;

    setLoading(true);
    setSteps([]);
    setAnswer(null);
    try {
      const response = await vscode.postMessage<AgentRunResult>(
        {
          type: 'AI_AGENT_RUN' as any,
          id: crypto.randomUUID(),
          payload: { connectionId, goal: prompt.trim() }
        },
        {
          timeout: 0, // agent runs are multi-step and can take a while
          onProgress: (data) => setSteps((prev) => [...prev, data as AgentStep]),
        }
      );

      if (response.success && response.data) {
        setSteps(response.data.steps);
        setAnswer(response.data.answer);
        if (!response.data.completed) {
          toast.error('Agent stopped', 'Reached the step limit before finishing');
        }
      } else {
        toast.error('Agent Failed', response.error || 'The agent could not complete the task');
      }
    } catch (err) {
      toast.error('AI Error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRun = () => (mode === 'agent' ? handleRunAgent() : handleGenerate());

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRun();
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
        title="Ask AI to generate SQL or run an agent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>Ask AI</span>
      </button>
    );
  }

  return (
    <div className="nl-query-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="nl-query-mode" style={{ display: 'flex', gap: 4 }}>
          <button
            className={`btn btn-sm ${mode === 'generate' ? '' : 'btn-ghost'}`}
            onClick={() => setMode('generate')}
            title="Generate a single SQL query from your description"
          >
            Generate
          </button>
          <button
            className={`btn btn-sm ${mode === 'agent' ? '' : 'btn-ghost'}`}
            onClick={() => setMode('agent')}
            title="Let the AI run multiple steps to accomplish a goal"
          >
            Agent
          </button>
        </div>
        <input
          type="text"
          className="nl-query-input"
          placeholder={
            mode === 'agent'
              ? "Describe a goal... (e.g., 'Find which 3 products drove the most revenue last quarter')"
              : "Describe what you want to query... (e.g., 'Show top 10 customers by total orders')"
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={{ flex: 1 }}
        />
        <button className="btn btn-sm" onClick={handleRun} disabled={loading || !prompt.trim()}>
          {loading ? (
            <div className="spinner spinner-sm" />
          ) : mode === 'agent' ? (
            'Run Agent'
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

      {mode === 'agent' && (steps.length > 0 || answer) && (
        <div
          className="nl-agent-log"
          style={{
            maxHeight: 320,
            overflowY: 'auto',
            border: '1px solid var(--vscode-panel-border, rgba(128,128,128,0.3))',
            borderRadius: 4,
            padding: 8,
            fontSize: 12,
          }}
        >
          {steps.map((step, i) => (
            <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(128,128,128,0.15)' }}>
              <div style={{ opacity: 0.7, marginBottom: 2 }}>
                Step {i + 1} · {step.action === 'final' ? 'answer' : 'run query'}
                {step.refused ? ' · refused' : ''}
              </div>
              {step.thought && <div style={{ fontStyle: 'italic', opacity: 0.85 }}>{step.thought}</div>}
              {step.sql && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 4 }}>
                  <pre
                    style={{
                      flex: 1,
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'var(--vscode-editor-font-family, monospace)',
                      background: 'rgba(128,128,128,0.12)',
                      padding: 6,
                      borderRadius: 3,
                    }}
                  >
                    {step.sql}
                  </pre>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onSQLGenerated(step.sql!)}
                    title="Insert this SQL into the editor"
                  >
                    Insert
                  </button>
                </div>
              )}
              {step.observation && (
                <div style={{ opacity: 0.75, marginTop: 4, whiteSpace: 'pre-wrap' }}>↳ {step.observation}</div>
              )}
            </div>
          ))}
          {loading && <div className="spinner spinner-sm" />}
          {answer && (
            <div style={{ marginTop: 4 }}>
              <div style={{ opacity: 0.7, marginBottom: 2 }}>Answer</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{answer}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
