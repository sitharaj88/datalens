import * as vscode from 'vscode';
import { assessDestructiveness } from './destructiveQueryGuard';
import type { ConnectionEnvironment } from '../../shared/types/database';

export interface ConfirmOptions {
  environment?: ConnectionEnvironment;
  connectionLabel: string;
}

/**
 * Prompts the user before running a destructive statement. Returns true when
 * the query may proceed. Production connections, and irreversible operations,
 * require an explicit typed confirmation. Respects the
 * `dbViewer.guardDestructiveQueries` setting.
 *
 * Shared by manual query execution (MessageRouter) and AI-issued statements
 * (agent + chat tools) so every path enforces the same guardrails.
 */
export async function confirmDestructiveQuery(sql: string, opts: ConfirmOptions): Promise<boolean> {
  const guardEnabled = vscode.workspace
    .getConfiguration('dbViewer')
    .get<boolean>('guardDestructiveQueries', true);
  if (!guardEnabled) {
    return true;
  }

  const assessment = assessDestructiveness(sql);
  if (assessment.level === 'none') {
    return true;
  }

  const isProduction = opts.environment === 'production';
  const requiresTypedConfirm = isProduction || assessment.irreversible;
  const detail = assessment.reasons.join('\n');

  if (!requiresTypedConfirm) {
    const pick = await vscode.window.showWarningMessage(
      `Run this statement against "${opts.connectionLabel}"?`,
      { modal: true, detail },
      'Run Query'
    );
    return pick === 'Run Query';
  }

  const phrase = isProduction ? 'RUN ON PRODUCTION' : 'RUN';
  const banner = isProduction
    ? `⚠ PRODUCTION connection "${opts.connectionLabel}".\n\n${detail}`
    : detail;

  const typed = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: `Confirm destructive operation on "${opts.connectionLabel}"`,
    prompt: `${banner}\n\nType "${phrase}" to proceed.`,
    placeHolder: phrase,
    validateInput: value =>
      value === phrase ? null : `Type "${phrase}" exactly to confirm, or press Escape to cancel.`,
  });

  return typed === phrase;
}
