/**
 * Agentic data workflow: an LLM plans and runs SQL step-by-step to satisfy a
 * natural-language goal, reading results between steps and refining.
 *
 * Provider-agnostic: it drives any chat model via a simple ReAct-style JSON
 * protocol (no native tool-calling required), so it works with OpenAI,
 * Anthropic, and local Ollama models alike.
 *
 * Safety is enforced by the host, not the model:
 *  - Writes are refused unless `allowWrites` is enabled.
 *  - Every executed statement passes through `runSql`, which applies the same
 *    destructive-operation guard (confirmation / typed-confirm) as manual runs.
 *  - A hard `maxSteps` cap bounds the loop.
 *
 * This module is pure (no VS Code dependency) so the loop is unit-testable with
 * a mock `chat` function.
 */
import type { ChatMessage } from './aiService';

export type AgentActionType = 'run_sql' | 'final';

export interface AgentStep {
  index: number;
  thought?: string;
  action: AgentActionType;
  sql?: string;
  /** Result summary or error/refusal text fed back to the model. */
  observation?: string;
  /** Present on the final step. */
  answer?: string;
  /** True if a write was refused or the user cancelled the destructive confirm. */
  refused?: boolean;
}

export interface RunSqlOutcome {
  ok: boolean;
  /** Compact, model-facing summary of the result or error. */
  summary: string;
  /** True if the user cancelled the destructive-operation confirmation. */
  cancelled?: boolean;
}

export interface AgentRunContext {
  goal: string;
  schemaContext: string;
  maxSteps: number;
  allowWrites: boolean;
  chat: (messages: ChatMessage[]) => Promise<string>;
  runSql: (sql: string) => Promise<RunSqlOutcome>;
  isWrite: (sql: string) => boolean;
  onStep?: (step: AgentStep) => void;
}

export interface AgentRunResult {
  steps: AgentStep[];
  answer: string;
  completed: boolean;
}

interface ParsedAction {
  thought?: string;
  action?: string;
  sql?: string;
  answer?: string;
}

const SYSTEM_PROMPT = (schemaContext: string, allowWrites: boolean) =>
  `You are a database analyst agent working through a real database. You accomplish the user's goal by running SQL one step at a time and reading the results before deciding the next step.

You MUST reply with a single JSON object and nothing else. Use one of these shapes:

To run a query:
{"thought": "<brief reasoning>", "action": "run_sql", "sql": "<one SQL statement>"}

When you have enough information to answer:
{"thought": "<brief reasoning>", "action": "final", "answer": "<the answer for the user, in markdown>"}

Rules:
- Run exactly ONE SQL statement per step. Do not include multiple statements.
- Prefer read-only queries (SELECT). ${allowWrites ? 'Data-modifying statements are allowed but will require user confirmation.' : 'Data-modifying statements (INSERT/UPDATE/DELETE/DDL) are DISABLED and will be refused — find a read-only way to achieve the goal or explain what you would do.'}
- Use the provided schema. Do not invent tables or columns.
- After each query you will receive an OBSERVATION with the results. Use it.
- Keep going until the goal is met, then return a "final" answer that directly answers the user.
- If the goal cannot be met, return a "final" answer explaining why.

Database schema:
${schemaContext || '(schema unavailable — discover it with read-only queries if needed)'}`;

/**
 * Extracts the first balanced JSON object from a model reply, tolerating
 * code fences and surrounding prose.
 */
export function parseAgentReply(raw: string): ParsedAction | null {
  if (!raw) {
    return null;
  }
  // Strip ```json fences if present.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenced) {
    candidates.push(fenced[1]);
  }
  candidates.push(raw);

  for (const text of candidates) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      continue;
    }
    const slice = text.slice(start, end + 1);
    try {
      const obj = JSON.parse(slice) as ParsedAction;
      if (obj && typeof obj === 'object') {
        return obj;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function runAgent(ctx: AgentRunContext): Promise<AgentRunResult> {
  const steps: AgentStep[] = [];
  const conversation: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT(ctx.schemaContext, ctx.allowWrites) },
    { role: 'user', content: `Goal: ${ctx.goal}` },
  ];

  const maxSteps = Math.max(1, Math.min(ctx.maxSteps || 8, 25));

  const emit = (step: AgentStep) => {
    steps.push(step);
    ctx.onStep?.(step);
  };

  for (let i = 0; i < maxSteps; i++) {
    const raw = await ctx.chat(conversation);
    const parsed = parseAgentReply(raw);

    // Could not parse — treat the raw text as the final answer.
    if (!parsed || (!parsed.action && !parsed.answer)) {
      const answer = parsed?.answer || raw.trim() || 'No response from the model.';
      emit({ index: i, action: 'final', answer });
      return { steps, answer, completed: true };
    }

    if (parsed.action === 'final' || (parsed.answer && parsed.action !== 'run_sql')) {
      const answer = parsed.answer || '';
      emit({ index: i, action: 'final', thought: parsed.thought, answer });
      return { steps, answer, completed: true };
    }

    if (parsed.action === 'run_sql' && parsed.sql) {
      const sql = parsed.sql.trim();

      // Enforce read-only mode at the host, regardless of what the model claims.
      if (!ctx.allowWrites && ctx.isWrite(sql)) {
        const observation =
          'REFUSED: write/DDL statements are disabled for the agent. Use a read-only (SELECT) approach instead.';
        emit({ index: i, action: 'run_sql', thought: parsed.thought, sql, observation, refused: true });
        conversation.push({ role: 'assistant', content: raw });
        conversation.push({ role: 'user', content: `OBSERVATION: ${observation}` });
        continue;
      }

      const outcome = await ctx.runSql(sql);
      const observation = outcome.cancelled
        ? 'CANCELLED: the user declined to run this statement. Try a different, safer approach or stop.'
        : outcome.summary;
      emit({
        index: i,
        action: 'run_sql',
        thought: parsed.thought,
        sql,
        observation,
        refused: outcome.cancelled,
      });
      conversation.push({ role: 'assistant', content: raw });
      conversation.push({ role: 'user', content: `OBSERVATION: ${observation}` });
      continue;
    }

    // Unrecognized action — nudge the model.
    conversation.push({ role: 'assistant', content: raw });
    conversation.push({
      role: 'user',
      content: 'OBSERVATION: invalid response. Reply with a single JSON object using "run_sql" or "final".',
    });
  }

  const answer =
    'Reached the maximum number of steps before completing the goal. Here is what was gathered above.';
  emit({ index: maxSteps, action: 'final', answer });
  return { steps, answer, completed: false };
}
