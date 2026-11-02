import { describe, expect, it, vi } from 'vitest';
import { runDecisionLoop, FALLBACK_BETA, type CreateMessage, type DecisionRequest } from './anthropic';
import type { ToolResult } from '@black-sheep/engine/fundTools';

type Block = Record<string, unknown>;

/** A minimal BetaMessage-shaped response. */
function msg(content: Block[], stop_reason = 'tool_use', usage = { input_tokens: 1000, output_tokens: 200 }, model = 'claude-opus-5-5') {
  return { id: 'm', type: 'message', role: 'assistant', model, content, stop_reason, usage } as never;
}
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: 'tool_use', id, name, input });
const text = (t: string): Block => ({ type: 'text', text: t });
const SUBMIT = { action: 'buy', ticker: 'NOVA', dollarAmount: 500_000, reasoning: 'cheap', confidence: 0.7 };

function req(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    model: 'claude-opus-5-5',
    effort: 'low',
    system: 'SYS',
    user: 'USER',
    maxRounds: 3,
    maxTokens: 4096,
    runTool: (name): ToolResult => (name === 'calculate_risk' ? { ok: true, output: { nav: 1 } } : { ok: false, output: { error: 'nope' } }),
    ...overrides,
  };
}

function fake(...responses: unknown[]): CreateMessage & ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  return fn as never;
}

describe('runDecisionLoop', () => {
  it('runs a research round, then accepts submit_decision', async () => {
    const create = fake(
      msg([{ type: 'thinking', thinking: '', signature: 's' }, toolUse('t1', 'calculate_risk', {})]),
      msg([toolUse('t2', 'submit_decision', SUBMIT)]),
    );
    const r = await runDecisionLoop(create, req());
    expect(r.outcome).toBe('decided');
    expect(r.decision).toMatchObject({ action: 'buy', ticker: 'NOVA', dollarAmount: 500_000 });
    expect(r.rounds).toBe(2);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ name: 'calculate_risk', ok: true });
    // Usage and cost are summed across both rounds.
    expect(r.usage.input_tokens).toBe(2000);
    expect(r.costUsd).toBeCloseTo((2 * (1000 * 4 + 200 * 20)) / 1e6, 10);
  });

  it('sends the model, effort, system, tools and the default-fallback beta; echoes the full assistant turn', async () => {
    const create = fake(msg([toolUse('t1', 'calculate_risk', {})]), msg([toolUse('t2', 'submit_decision', SUBMIT)]));
    await runDecisionLoop(create, req());
    const first = create.mock.calls[0][0];
    expect(first).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 4096, system: 'SYS', output_config: { effort: 'low' }, fallbacks: 'default' });
    expect(first.betas).toContain(FALLBACK_BETA);
    expect(first.tool_choice).toBeUndefined();
    expect(first.tools.map((t: { name: string }) => t.name)).toContain('submit_decision');
    const second = create.mock.calls[1][0];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1].role).toBe('assistant');
    expect(second.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
  });

  it('marks failed tool results as errors and keeps going', async () => {
    const create = fake(msg([toolUse('t1', 'drop_tables', {})]), msg([toolUse('t2', 'submit_decision', SUBMIT)]));
    const r = await runDecisionLoop(create, req());
    expect(r.outcome).toBe('decided');
    expect(r.toolCalls[0].ok).toBe(false);
    expect(create.mock.calls[1][0].messages[2].content[0].is_error).toBe(true);
  });

  it('accepts a bare JSON text answer', async () => {
    const r = await runDecisionLoop(fake(msg([text(JSON.stringify(SUBMIT))], 'end_turn')), req());
    expect(r.outcome).toBe('decided');
    expect(r.decision?.ticker).toBe('NOVA');
  });

  it('a refusal yields no decision', async () => {
    const r = await runDecisionLoop(fake(msg([], 'refusal')), req());
    expect(r).toMatchObject({ outcome: 'refusal', decision: null });
  });

  it('max_tokens with no decision is reported as such', async () => {
    const r = await runDecisionLoop(fake(msg([{ type: 'thinking', thinking: '', signature: 's' }], 'max_tokens')), req());
    expect(r).toMatchObject({ outcome: 'max_tokens', decision: null });
  });

  it('stops at the round cap and tells the model on its final round', async () => {
    const research = () => msg([toolUse(`t${Math.random()}`, 'calculate_risk', {})]);
    const create = fake(research(), research(), research());
    const r = await runDecisionLoop(create, req({ maxRounds: 3 }));
    expect(r).toMatchObject({ outcome: 'round_cap', decision: null, rounds: 3 });
    expect(create).toHaveBeenCalledTimes(3);
    const lastUser = create.mock.calls[2][0].messages.at(-1);
    expect(JSON.stringify(lastUser.content)).toContain('submit_decision now');
  });

  it('a malformed submit_decision is answered with an error and the model may retry', async () => {
    const create = fake(
      msg([toolUse('t1', 'submit_decision', { action: 'moon' })]),
      msg([toolUse('t2', 'submit_decision', SUBMIT)]),
    );
    const r = await runDecisionLoop(create, req());
    expect(r.outcome).toBe('decided');
    expect(create.mock.calls[1][0].messages[2].content[0].is_error).toBe(true);
  });

  it('a thrown SDK error ends the loop with outcome error and keeps the usage so far', async () => {
    const create = fake(msg([toolUse('t1', 'calculate_risk', {})]), new Error('overloaded'));
    const r = await runDecisionLoop(create, req());
    expect(r).toMatchObject({ outcome: 'error', decision: null, error: 'overloaded' });
    expect(r.usage.input_tokens).toBe(1000);
  });

  it('a throwing tool handler ends the loop with outcome error instead of throwing (review I-1)', async () => {
    const create = fake(msg([toolUse('t1', 'calculate_risk', {})]));
    const r = await runDecisionLoop(create, req({ runTool: () => { throw new Error('boom'); } }));
    expect(r).toMatchObject({ outcome: 'error', decision: null, error: 'boom' });
    expect(r.usage.input_tokens).toBe(1000);
  });

  it('a malformed SDK response (no usage) ends with outcome error', async () => {
    const bad = { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'end_turn' } as never;
    const r = await runDecisionLoop(fake(bad), req());
    expect(r.outcome).toBe('error');
  });

  it('prices each round by the model that actually served it', async () => {
    const r = await runDecisionLoop(
      fake(msg([toolUse('t2', 'submit_decision', SUBMIT)], 'tool_use', { input_tokens: 1_000_000, output_tokens: 0 }, 'claude-haiku-5-5')),
      req(),
    );
    expect(r.costUsd).toBeCloseTo(0.1, 10);
    expect(r.servedBy).toBe('claude-haiku-5-5');
  });
});
