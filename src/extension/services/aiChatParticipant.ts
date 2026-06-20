import * as vscode from 'vscode';
import type { ConnectionService } from './connectionService';
import type { AIService } from './aiService';
import { chatWithLmModel } from './aiService';
import { runAgent, type AgentStep } from './aiAgentService';
import { isWriteStatement } from './destructiveQueryGuard';
import { confirmDestructiveQuery } from './queryConfirmation';
import { summarizeQueryResult } from './resultSummary';
import { SchemaCache } from './schemaCache';
import type { IDatabaseAdapter } from '../database/interfaces/IAdapter';
import type { IConnectionConfig } from '../../shared/types/database';

const CHAT_PARTICIPANT_ID = 'datalens.chat';

interface ActiveConnection {
  connection: IConnectionConfig;
  adapter: IDatabaseAdapter;
}

/** Returns the first currently-connected database, or undefined if none. */
function getActiveConnection(connectionService: ConnectionService): ActiveConnection | undefined {
  const connection = connectionService
    .getAllConnections()
    .find(c => connectionService.isConnected(c.id));
  if (!connection) {
    return undefined;
  }
  const adapter = connectionService.getAdapter(connection.id);
  if (!adapter?.isConnected()) {
    return undefined;
  }
  return { connection, adapter };
}

function renderStep(step: AgentStep): string {
  if (step.action === 'final') {
    return '';
  }
  const lines: string[] = [];
  if (step.thought) {
    lines.push(`*${step.thought}*`);
  }
  if (step.sql) {
    lines.push('```sql\n' + step.sql + '\n```');
  }
  if (step.observation) {
    const obs = step.observation.length > 600 ? step.observation.slice(0, 600) + '…' : step.observation;
    lines.push(`> ${obs.replace(/\n/g, '\n> ')}`);
  }
  return lines.join('\n\n') + '\n\n';
}

/**
 * Registers the `@datalens` chat participant. Users can ask natural-language
 * questions in the Copilot Chat panel; DataLens runs the agent loop against the
 * active connection using the chat-selected model, streaming each step.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  connectionService: ConnectionService,
  aiService: AIService
): void {
  const handler: vscode.ChatRequestHandler = async (request, _ctx, stream, token) => {
    const active = getActiveConnection(connectionService);
    if (!active) {
      stream.markdown(
        'No active database connection. Open the **DataLens** panel and connect to a database first.'
      );
      return;
    }
    const { connection, adapter } = active;

    const config = vscode.workspace.getConfiguration('dbViewer.ai');
    const maxSteps = config.get<number>('agentMaxSteps', 8);
    const allowWrites = config.get<boolean>('agentAllowWrites', false);

    const metadata = await SchemaCache.getInstance().getMetadata(connection.id);
    const schemaContext = metadata ? aiService.formatSchemaContext(metadata) : '';

    stream.progress(`Working against "${connection.name}"…`);

    const result = await runAgent({
      goal: request.prompt,
      schemaContext,
      maxSteps,
      allowWrites,
      chat: msgs => chatWithLmModel(request.model, msgs, token),
      isWrite: isWriteStatement,
      runSql: async (sql: string) => {
        const ok = await confirmDestructiveQuery(sql, {
          environment: connection.environment,
          connectionLabel: connection.name,
        });
        if (!ok) {
          return { ok: false, cancelled: true, summary: 'User cancelled this statement.' };
        }
        const r = await adapter.executeQuery(sql);
        if (r.error) {
          return { ok: false, summary: `Error: ${r.error}` };
        }
        return { ok: true, summary: summarizeQueryResult(r) };
      },
      onStep: step => {
        const rendered = renderStep(step);
        if (rendered) {
          stream.markdown(rendered);
        }
      },
    });

    stream.markdown(result.answer || '_No answer produced._');
  };

  const participant = vscode.chat.createChatParticipant(CHAT_PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('database');
  context.subscriptions.push(participant);
}

/**
 * Registers language-model tools so Copilot Chat / agent mode can query the
 * active DataLens connection. `run_sql` is read-only; writes are rejected.
 */
export function registerLanguageModelTools(
  context: vscode.ExtensionContext,
  connectionService: ConnectionService
): void {
  const textResult = (text: string) =>
    new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);

  context.subscriptions.push(
    vscode.lm.registerTool<{ sql: string }>('datalens_run_sql', {
      prepareInvocation: async options => {
        const active = getActiveConnection(connectionService);
        const where = active ? `"${active.connection.name}"` : 'the active connection';
        return { invocationMessage: `Querying ${where}: ${options.input.sql}` };
      },
      invoke: async options => {
        const active = getActiveConnection(connectionService);
        if (!active) {
          return textResult('No active DataLens database connection. Connect to a database first.');
        }
        const sql = options.input.sql?.trim();
        if (!sql) {
          return textResult('No SQL provided.');
        }
        if (isWriteStatement(sql)) {
          return textResult(
            'Refused: this tool only runs read-only queries (SELECT/SHOW/EXPLAIN). Use the DataLens UI for writes.'
          );
        }
        const r = await active.adapter.executeQuery(sql);
        if (r.error) {
          return textResult(`Error: ${r.error}`);
        }
        return textResult(summarizeQueryResult(r, 50, 8000));
      },
    })
  );

  context.subscriptions.push(
    vscode.lm.registerTool('datalens_get_schema', {
      invoke: async () => {
        const active = getActiveConnection(connectionService);
        if (!active) {
          return textResult('No active DataLens database connection. Connect to a database first.');
        }
        const metadata = await SchemaCache.getInstance().getMetadata(active.connection.id);
        if (!metadata) {
          return textResult('Schema metadata is unavailable for the active connection.');
        }
        return textResult(JSON.stringify(metadata));
      },
    })
  );
}
