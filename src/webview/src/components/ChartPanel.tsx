import { useState, useMemo, useRef } from 'react';
import { useVscodeApi } from '../hooks/useVscodeApi';
import { toast } from './Toast';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import type { IQueryResult } from '../types';

type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'donut';
type AggregateFunction = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max';

interface ChartPanelProps {
  result: IQueryResult;
}

const COLORS = [
  '#388bfd', '#3fb950', '#d29922', '#f85149', '#a371f7',
  '#39d3c3', '#f0883e', '#8b949e', '#db61a2', '#7ee787',
];

const chartTypeIcons: Record<ChartType, JSX.Element> = {
  bar: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  line: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  area: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 20h18V4l-9 9-9-9v16z" />
    </svg>
  ),
  scatter: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7" cy="15" r="2" /><circle cx="12" cy="9" r="2" /><circle cx="17" cy="13" r="2" />
    </svg>
  ),
  pie: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  ),
  donut: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" />
    </svg>
  ),
};

export function ChartPanel({ result }: ChartPanelProps) {
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xAxisColumn, setXAxisColumn] = useState<string>('');
  const [yAxisColumns, setYAxisColumns] = useState<string[]>([]);
  const [aggregateFunc, setAggregateFunc] = useState<AggregateFunction>('none');
  const [groupByColumn, setGroupByColumn] = useState<string>('');
  const [maxRows, setMaxRows] = useState(500);
  const chartRef = useRef<HTMLDivElement>(null);
  const vscode = useVscodeApi();

  const numericColumns = useMemo(() =>
    result.columns.filter(col => {
      const t = col.type.toLowerCase();
      return t.includes('int') || t.includes('float') || t.includes('double') ||
             t.includes('decimal') || t.includes('numeric') || t.includes('real') || t === 'number';
    }),
    [result.columns]
  );

  const toggleYColumn = (colName: string) => {
    setYAxisColumns(prev =>
      prev.includes(colName)
        ? prev.filter(c => c !== colName)
        : [...prev, colName]
    );
  };

  const chartData = useMemo(() => {
    if (!xAxisColumn || yAxisColumns.length === 0) return [];

    let rows = result.rows;

    if (aggregateFunc !== 'none' && groupByColumn) {
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) {
        const key = String(row[groupByColumn] ?? 'Unknown');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      rows = Array.from(groups.entries()).map(([key, groupRows]) => {
        const aggregated: Record<string, unknown> = { [groupByColumn]: key };
        for (const yCol of yAxisColumns) {
          const values = groupRows.map(r => Number(r[yCol]) || 0);
          switch (aggregateFunc) {
            case 'sum': aggregated[yCol] = values.reduce((a, b) => a + b, 0); break;
            case 'avg': aggregated[yCol] = +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2); break;
            case 'count': aggregated[yCol] = values.length; break;
            case 'min': aggregated[yCol] = Math.min(...values); break;
            case 'max': aggregated[yCol] = Math.max(...values); break;
          }
        }
        return aggregated;
      });
    }

    return rows.slice(0, maxRows).map(row => {
      const item: Record<string, unknown> = { name: String(row[xAxisColumn] ?? '') };
      for (const yCol of yAxisColumns) {
        item[yCol] = Number(row[yCol]) || 0;
      }
      return item;
    });
  }, [result.rows, xAxisColumn, yAxisColumns, maxRows, aggregateFunc, groupByColumn]);

  const pieData = useMemo(() => {
    if (!xAxisColumn || yAxisColumns.length === 0) return [];
    const yCol = yAxisColumns[0];
    const aggregated = new Map<string, number>();
    for (const row of result.rows) {
      const key = String(row[xAxisColumn] ?? 'Unknown');
      const value = Number(row[yCol]) || 0;
      aggregated.set(key, (aggregated.get(key) || 0) + value);
    }
    return Array.from(aggregated.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
  }, [result.rows, xAxisColumn, yAxisColumns]);

  const handleExportChart = async () => {
    if (!chartRef.current) return;
    const svg = chartRef.current.querySelector('svg');
    if (!svg) {
      toast.error('Export Failed', 'No chart found to export');
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svg);
    const defaultName = `chart_${new Date().toISOString().slice(0, 10)}.svg`;

    try {
      const response = await vscode.postMessage({
        type: 'SAVE_FILE',
        id: crypto.randomUUID(),
        payload: { content: svgData, defaultName, fileType: 'svg' }
      });
      if (response.success) {
        toast.success('Chart Exported', 'SVG file saved successfully');
      } else {
        toast.error('Export Failed', response.error || 'Failed to save chart');
      }
    } catch {
      // Fallback: copy SVG to clipboard
      try {
        await navigator.clipboard.writeText(svgData);
        toast.success('Copied to Clipboard', 'SVG data copied (save dialog unavailable)');
      } catch {
        toast.error('Export Failed', 'Could not save or copy chart data');
      }
    }
  };

  if (result.rows.length === 0 || result.columns.length < 2) {
    return (
      <div className="empty-state flex-1 bg-primary">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
        </svg>
        <div className="empty-state-title">Insufficient Data</div>
        <div className="empty-state-description">Need at least 2 columns with data to create a chart</div>
      </div>
    );
  }

  const tooltipStyle = {
    contentStyle: { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: '8px 12px' },
    labelStyle: { color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 },
    itemStyle: { color: 'var(--text-secondary)', fontSize: 12 },
  };

  const renderChart = () => {
    const isPie = chartType === 'pie' || chartType === 'donut';

    if (isPie) {
      return (
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
            outerRadius={120}
            innerRadius={chartType === 'donut' ? 60 : 0}
            fill="var(--accent-primary)"
            dataKey="value"
            stroke="var(--bg-primary)"
            strokeWidth={2}
          >
            {pieData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ paddingTop: 16 }} />
        </PieChart>
      );
    }

    if (chartType === 'scatter') {
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-muted)" />
          <XAxis dataKey="name" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} name={xAxisColumn} />
          <YAxis stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} dataKey={yAxisColumns[0]} name={yAxisColumns[0]} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ paddingTop: 16 }} />
          {yAxisColumns.map((yCol, idx) => (
            <Scatter key={yCol} name={yCol} data={chartData} dataKey={yCol} fill={COLORS[idx % COLORS.length]} />
          ))}
        </ScatterChart>
      );
    }

    const commonXAxis = <XAxis dataKey="name" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} angle={-45} textAnchor="end" height={80} />;
    const commonYAxis = <YAxis stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />;

    if (chartType === 'bar') {
      return (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-muted)" />
          {commonXAxis}{commonYAxis}
          <Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ paddingTop: 16 }} />
          {yAxisColumns.map((yCol, idx) => (
            <Bar key={yCol} dataKey={yCol} fill={COLORS[idx % COLORS.length]} name={yCol} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      );
    }

    if (chartType === 'line') {
      return (
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-muted)" />
          {commonXAxis}{commonYAxis}
          <Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ paddingTop: 16 }} />
          {yAxisColumns.map((yCol, idx) => (
            <Line key={yCol} type="monotone" dataKey={yCol} stroke={COLORS[idx % COLORS.length]} strokeWidth={2}
              dot={{ r: 3, fill: COLORS[idx % COLORS.length], strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }} name={yCol} />
          ))}
        </LineChart>
      );
    }

    return (
      <AreaChart data={chartData}>
        <defs>
          {yAxisColumns.map((yCol, idx) => (
            <linearGradient key={yCol} id={`color-${yCol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS[idx % COLORS.length]} stopOpacity={0.3} />
              <stop offset="95%" stopColor={COLORS[idx % COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-muted)" />
        {commonXAxis}{commonYAxis}
        <Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ paddingTop: 16 }} />
        {yAxisColumns.map((yCol, idx) => (
          <Area key={yCol} type="monotone" dataKey={yCol} stroke={COLORS[idx % COLORS.length]} strokeWidth={2}
            fillOpacity={1} fill={`url(#color-${yCol})`} name={yCol} />
        ))}
      </AreaChart>
    );
  };

  const isPieType = chartType === 'pie' || chartType === 'donut';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-primary">
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="toolbar-section">
          <div className="toolbar-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <span>Visualization</span>
          </div>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-section">
          {(['bar', 'line', 'area', 'scatter', 'pie', 'donut'] as ChartType[]).map((type) => (
            <button key={type} className={`btn btn-icon btn-sm ${chartType === type ? '' : 'btn-ghost'}`}
              onClick={() => setChartType(type)} title={`${type.charAt(0).toUpperCase() + type.slice(1)} Chart`}>
              {chartTypeIcons[type]}
            </button>
          ))}
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-section">
          <label className="text-xs text-secondary mr-2">{isPieType ? 'Label:' : 'X-Axis:'}</label>
          <select className="input select" value={xAxisColumn} onChange={e => setXAxisColumn(e.target.value)} style={{ width: 130 }}>
            <option value="">Select...</option>
            {result.columns.map(col => <option key={col.name} value={col.name}>{col.name}</option>)}
          </select>
          <label className="text-xs text-secondary mr-2 ml-4">{isPieType ? 'Value:' : 'Y-Axis:'}</label>
          {isPieType ? (
            <select className="input select" value={yAxisColumns[0] || ''} onChange={e => setYAxisColumns(e.target.value ? [e.target.value] : [])} style={{ width: 130 }}>
              <option value="">Select...</option>
              {(numericColumns.length > 0 ? numericColumns : result.columns).map(col => (
                <option key={col.name} value={col.name}>{col.name}</option>
              ))}
            </select>
          ) : (
            <div className="toolbar-section" style={{ gap: 2, flexWrap: 'wrap' }}>
              {(numericColumns.length > 0 ? numericColumns : result.columns).slice(0, 8).map(col => (
                <button key={col.name} className={`btn btn-sm ${yAxisColumns.includes(col.name) ? '' : 'btn-ghost'}`}
                  onClick={() => toggleYColumn(col.name)} style={{ fontSize: 11, padding: '2px 8px' }}>
                  {col.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-section">
          <label className="text-xs text-secondary mr-2">Aggregate:</label>
          <select className="input select" value={aggregateFunc} onChange={e => setAggregateFunc(e.target.value as AggregateFunction)} style={{ width: 80 }}>
            <option value="none">None</option>
            <option value="sum">SUM</option>
            <option value="avg">AVG</option>
            <option value="count">COUNT</option>
            <option value="min">MIN</option>
            <option value="max">MAX</option>
          </select>
          {aggregateFunc !== 'none' && (
            <>
              <label className="text-xs text-secondary mr-2 ml-2">Group By:</label>
              <select className="input select" value={groupByColumn} onChange={e => setGroupByColumn(e.target.value)} style={{ width: 120 }}>
                <option value="">Select...</option>
                {result.columns.map(col => <option key={col.name} value={col.name}>{col.name}</option>)}
              </select>
            </>
          )}
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-section">
          {result.rows.length > maxRows && (
            <span className="text-xs" style={{ color: 'var(--warning-text)' }}>Showing {maxRows}/{result.rows.length}</span>
          )}
          <select className="input select" value={maxRows} onChange={e => setMaxRows(Number(e.target.value))} style={{ width: 80 }} title="Max rows">
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={handleExportChart} title="Export chart as SVG">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            SVG
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-auto" ref={chartRef}>
        {xAxisColumn && yAxisColumns.length > 0 ? (
          <div style={{ width: '100%', height: '100%', minHeight: 400 }}>
            <ResponsiveContainer>{renderChart()}</ResponsiveContainer>
          </div>
        ) : (
          <div className="empty-state" style={{ height: 360 }}>
            <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <div className="empty-state-title">Configure Your Chart</div>
            <div className="empty-state-description">Select an X-Axis column and one or more Y-Axis columns to visualize your data</div>
          </div>
        )}
      </div>
    </div>
  );
}
