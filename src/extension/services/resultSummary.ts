import type { IQueryResult } from '../../shared/types/database';

/**
 * Produces a compact, model-facing summary of a query result for AI consumption
 * (agent loop and chat tools). Bounds the payload so large result sets don't
 * blow the model's context window.
 */
export function summarizeQueryResult(result: IQueryResult, maxRows = 20, maxChars = 4000): string {
  if (result.affectedRows !== undefined && (!result.rows || result.rows.length === 0)) {
    return `OK. ${result.affectedRows} row(s) affected.`;
  }
  const rows = result.rows ?? [];
  const previewRows = rows.slice(0, maxRows);
  let preview = '';
  try {
    preview = JSON.stringify(previewRows);
  } catch {
    preview = '[unserializable rows]';
  }
  if (preview.length > maxChars) {
    preview = preview.slice(0, maxChars) + '…(truncated)';
  }
  const more = rows.length > previewRows.length ? ` (showing first ${previewRows.length} of ${rows.length})` : '';
  const columns = result.columns.map(c => c.name).join(', ');
  return `${rows.length} row(s)${more}. Columns: ${columns}. Rows: ${preview}`;
}
