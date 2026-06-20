import { describe, it, expect, vi } from 'vitest';
import { runAgent, parseAgentReply, type AgentRunContext } from '../aiAgentService';
import { isWriteStatement } from '../destructiveQueryGuard';

/** Builds a context whose chat() returns the scripted replies in order. */
function makeCtx(replies: string[], overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  const queue = [...replies];
  return {
    goal: 'test goal',
    schemaContext: 'CREATE TABLE t (id int);',
    maxSteps: 8,
    allowWrites: false,
    chat: vi.fn(async () => queue.shift() ?? '{"action":"final","answer":"done"}'),
    runSql: vi.fn(async () => ({ ok: true, summary: '1 row(s). Rows: [{"id":1}]' })),
    isWrite: isWriteStatement,
    ...overrides,
  };
}

describe('parseAgentReply', () => {
  it('parses a bare JSON object', () => {
    expect(parseAgentReply('{"action":"final","answer":"hi"}')).toEqual({ action: 'final', answer: 'hi' });
  });

  it('parses JSON inside ```json fences', () => {
    const r = parseAgentReply('```json\n{"action":"run_sql","sql":"SELECT 1"}\n```');
    expect(r?.action).toBe('run_sql');
    expect(r?.sql).toBe('SELECT 1');
  });

  it('extracts JSON embedded in prose', () => {
    const r = parseAgentReply('Sure! {"action":"final","answer":"x"} hope that helps');
    expect(r?.answer).toBe('x');
  });

  it('returns null when there is no JSON', () => {
    expect(parseAgentReply('no json here')).toBeNull();
  });
});

describe('runAgent', () => {
  it('returns immediately on a final action', async () => {
    const ctx = makeCtx(['{"action":"final","answer":"the answer"}']);
    const result = await runAgent(ctx);
    expect(result.completed).toBe(true);
    expect(result.answer).toBe('the answer');
    expect(result.steps).toHaveLength(1);
    expect(ctx.runSql).not.toHaveBeenCalled();
  });

  it('runs SQL then finalizes, feeding observations back', async () => {
    const ctx = makeCtx([
      '{"action":"run_sql","sql":"SELECT * FROM t"}',
      '{"action":"final","answer":"there is 1 row"}',
    ]);
    const result = await runAgent(ctx);
    expect(ctx.runSql).toHaveBeenCalledWith('SELECT * FROM t');
    expect(result.completed).toBe(true);
    expect(result.answer).toBe('there is 1 row');
    expect(result.steps[0].action).toBe('run_sql');
    expect(result.steps[0].observation).toContain('1 row');
  });

  it('refuses writes when allowWrites is false, without calling runSql', async () => {
    const ctx = makeCtx([
      '{"action":"run_sql","sql":"DELETE FROM t"}',
      '{"action":"final","answer":"stopped"}',
    ]);
    const result = await runAgent(ctx);
    expect(ctx.runSql).not.toHaveBeenCalled();
    expect(result.steps[0].refused).toBe(true);
    expect(result.steps[0].observation).toContain('REFUSED');
  });

  it('allows writes when allowWrites is true', async () => {
    const runSql = vi.fn(async () => ({ ok: true, summary: '1 row(s) affected.' }));
    const ctx = makeCtx(
      ['{"action":"run_sql","sql":"DELETE FROM t WHERE id=1"}', '{"action":"final","answer":"deleted"}'],
      { allowWrites: true, runSql }
    );
    await runAgent(ctx);
    expect(runSql).toHaveBeenCalledWith('DELETE FROM t WHERE id=1');
  });

  it('surfaces user cancellation as an observation', async () => {
    const runSql = vi.fn(async () => ({ ok: false, cancelled: true, summary: 'User cancelled this statement.' }));
    const ctx = makeCtx(
      ['{"action":"run_sql","sql":"DROP TABLE t"}', '{"action":"final","answer":"ok"}'],
      { allowWrites: true, runSql }
    );
    const result = await runAgent(ctx);
    expect(result.steps[0].refused).toBe(true);
    expect(result.steps[0].observation).toContain('CANCELLED');
  });

  it('stops at maxSteps and reports incomplete', async () => {
    const ctx = makeCtx([], {
      maxSteps: 3,
      chat: vi.fn(async () => '{"action":"run_sql","sql":"SELECT 1"}'),
    });
    const result = await runAgent(ctx);
    expect(result.completed).toBe(false);
    // 3 run_sql steps + 1 synthetic final
    expect(result.steps.filter((s) => s.action === 'run_sql')).toHaveLength(3);
  });

  it('treats unparseable replies as the final answer', async () => {
    const ctx = makeCtx(['I could not produce JSON but the answer is 42']);
    const result = await runAgent(ctx);
    expect(result.completed).toBe(true);
    expect(result.answer).toContain('42');
  });

  it('emits a step for each onStep callback', async () => {
    const onStep = vi.fn();
    const ctx = makeCtx(
      ['{"action":"run_sql","sql":"SELECT 1"}', '{"action":"final","answer":"ok"}'],
      { onStep }
    );
    await runAgent(ctx);
    expect(onStep).toHaveBeenCalledTimes(2);
  });
});
