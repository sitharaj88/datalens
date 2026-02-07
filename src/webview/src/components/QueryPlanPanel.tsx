import { useState, useMemo } from 'react';
import { useVscodeApi } from '../hooks/useVscodeApi';
import { toast } from './Toast';
import type { IQueryPlan } from '../types';

interface QueryPlanPanelProps {
  connectionId: string;
  query: string;
}

interface PlanNode {
  type: string;
  cost?: number;
  rows?: number;
  width?: number;
  details?: string;
  children?: PlanNode[];
}

function parsePlanNodes(plan: unknown): PlanNode[] {
  if (!plan) return [];

  // If it's already structured plan data
  if (Array.isArray(plan)) {
    return plan.map(parseSingleNode).filter(Boolean) as PlanNode[];
  }
  if (typeof plan === 'object' && plan !== null) {
    const node = parseSingleNode(plan);
    return node ? [node] : [];
  }
  return [];
}

function parseSingleNode(obj: unknown): PlanNode | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  // PostgreSQL EXPLAIN JSON format
  if ('Plan' in o) {
    return parseSingleNode(o['Plan']);
  }

  const type = String(o['Node Type'] || o['nodeType'] || o['type'] || o['Operation'] || 'Unknown');
  const cost = Number(o['Total Cost'] || o['totalCost'] || o['cost'] || 0);
  const rows = Number(o['Plan Rows'] || o['rows'] || o['estimatedRows'] || 0);
  const width = Number(o['Plan Width'] || o['width'] || 0);

  const detailParts: string[] = [];
  if (o['Relation Name']) detailParts.push(`Table: ${o['Relation Name']}`);
  if (o['Index Name']) detailParts.push(`Index: ${o['Index Name']}`);
  if (o['Filter']) detailParts.push(`Filter: ${o['Filter']}`);
  if (o['Join Type']) detailParts.push(`Join: ${o['Join Type']}`);
  if (o['Sort Key']) detailParts.push(`Sort: ${o['Sort Key']}`);
  if (o['detail']) detailParts.push(String(o['detail']));

  const children: PlanNode[] = [];
  if (Array.isArray(o['Plans'])) {
    for (const child of o['Plans']) {
      const childNode = parseSingleNode(child);
      if (childNode) children.push(childNode);
    }
  }

  return { type, cost, rows, width, details: detailParts.join(' | '), children };
}

function getCostColor(cost: number, maxCost: number): string {
  if (maxCost === 0) return 'var(--success-text)';
  const ratio = cost / maxCost;
  if (ratio < 0.3) return 'var(--success-text)';
  if (ratio < 0.7) return 'var(--warning-text)';
  return 'var(--error-text)';
}

function getMaxCost(nodes: PlanNode[]): number {
  let max = 0;
  for (const node of nodes) {
    if (node.cost && node.cost > max) max = node.cost;
    if (node.children) max = Math.max(max, getMaxCost(node.children));
  }
  return max;
}

function PlanNodeCard({ node, maxCost, depth = 0 }: { node: PlanNode; maxCost: number; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const costColor = getCostColor(node.cost || 0, maxCost);
  const costPercent = maxCost > 0 ? ((node.cost || 0) / maxCost) * 100 : 0;

  return (
    <div style={{ marginLeft: depth * 24, marginTop: depth > 0 ? 8 : 0 }}>
      <div
        className="plan-node"
        style={{
          padding: '10px 14px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-default)',
          borderLeft: `3px solid ${costColor}`,
          borderRadius: 'var(--radius-md)',
          cursor: node.children?.length ? 'pointer' : 'default',
        }}
        onClick={() => node.children?.length && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
          {node.children && node.children.length > 0 && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          )}
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{node.type}</span>
          {node.rows !== undefined && node.rows > 0 && (
            <span className="badge badge-default" style={{ fontSize: 10 }}>{node.rows.toLocaleString()} rows</span>
          )}
        </div>

        {/* Cost bar */}
        {node.cost !== undefined && node.cost > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div className="flex items-center gap-2" style={{ fontSize: 11 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Cost:</span>
              <div style={{ flex: 1, height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${costPercent}%`, height: '100%', background: costColor, borderRadius: 2 }} />
              </div>
              <span style={{ color: costColor, fontWeight: 500 }}>{node.cost.toFixed(1)}</span>
            </div>
          </div>
        )}

        {node.details && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{node.details}</div>
        )}
      </div>

      {expanded && node.children && node.children.map((child, i) => (
        <PlanNodeCard key={i} node={child} maxCost={maxCost} depth={depth + 1} />
      ))}
    </div>
  );
}

export function QueryPlanPanel({ connectionId, query }: QueryPlanPanelProps) {
  const vscode = useVscodeApi();
  const [plan, setPlan] = useState<IQueryPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'visual' | 'text' | 'raw'>('visual');

  const planNodes = useMemo(() => plan ? parsePlanNodes(plan.plan) : [], [plan]);
  const maxCost = useMemo(() => getMaxCost(planNodes), [planNodes]);

  const explainQuery = async () => {
    if (!query.trim() || !connectionId) return;

    setLoading(true);
    try {
      const response = await vscode.postMessage({
        type: 'EXPLAIN_QUERY',
        id: crypto.randomUUID(),
        payload: { connectionId, sql: query }
      });

      if (response.success) {
        setPlan(response.data as IQueryPlan);
      } else {
        toast.error('Explain Error', response.error || 'Failed to get query plan');
      }
    } catch (err) {
      toast.error('Explain Error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-primary">
        <div className="flex flex-col items-center gap-4">
          <div className="spinner" />
          <div className="text-secondary text-sm">Analyzing query plan...</div>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-primary gap-4">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
          <polyline points="7.5 19.79 7.5 14.6 3 12" />
          <polyline points="21 12 16.5 14.6 16.5 19.79" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
        <div className="text-secondary text-sm">Click "Explain" to analyze the query execution plan</div>
        <button className="btn btn-sm" onClick={explainQuery} disabled={!query.trim()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Explain Query
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-primary">
      <div className="toolbar">
        <div className="toolbar-section">
          <div className="toolbar-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
            <span>Query Execution Plan</span>
          </div>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-section">
          {(['visual', 'text', 'raw'] as const).map(mode => (
            <button
              key={mode}
              className={`btn btn-sm ${viewMode === mode ? '' : 'btn-ghost'}`}
              onClick={() => setViewMode(mode)}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {plan.estimatedCost !== undefined && (
          <>
            <div className="toolbar-divider" />
            <div className="toolbar-section">
              <span className="text-xs text-secondary">Total Cost:</span>
              <span className="text-xs" style={{ color: 'var(--warning-text)', fontWeight: 600 }}>
                {plan.estimatedCost.toFixed(2)}
              </span>
            </div>
          </>
        )}

        <div className="toolbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={explainQuery}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Re-analyze
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'visual' && planNodes.length > 0 ? (
          <div style={{ maxWidth: 800 }}>
            {planNodes.map((node, i) => (
              <PlanNodeCard key={i} node={node} maxCost={maxCost} />
            ))}
          </div>
        ) : viewMode === 'text' && plan.textRepresentation ? (
          <pre className="query-plan-text">{plan.textRepresentation}</pre>
        ) : (
          <pre className="query-plan-text">{JSON.stringify(plan.plan, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
