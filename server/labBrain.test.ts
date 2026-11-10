import { describe, expect, it, vi } from 'vitest';
import { initialSimState } from '@black-sheep/engine/experiment';
import { decideByPolicy } from '@black-sheep/engine/policies';
import { buildDecisionInput } from '@black-sheep/engine/rival';
import { BudgetExhausted, estimateExperimentCostUsd, makeExperimentDecide, type ExperimentBudget } from './labBrain';
import { estimateCallCostUsd } from './budget';
import type { CreateMessage } from './providers/anthropic';
import type { ChatFetch } from './providers/openaiCompat';
import { DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE, MAX_TOOL_ROUNDS } from '../config/game';

const MODEL = 'claude-haiku-5-5';
const ONE_CALL = estimateCallCostUsd(MODEL, MAX_TOOL_ROUNDS, DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE);

function msg(content: Record<string, unknown>[], stop_reason = 'tool_use') {
  return { id: 'm', type: 'message', role: 'assistant', model: MODEL, content, stop_reason, usage: { input_tokens: 1000, output_tokens: 200 } } as never;
}
const decided = () => msg([{ type: 'tool_use', id: 't', name: 'submit_decision', input: { action: 'hold', reasoning: 'calm', confidence: 0.5 } }]);
const stub = (...responses: unknown[]) => {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  return fn as CreateMessage & ReturnType<typeof vi.fn>;
};

const OR_MODEL = 'x-ai/grok-4.7';
/** An OpenRouter chat reply that submits a hold. */
const chatDecided = () => ({
  status: 200,
  json: {
    model: OR_MODEL,
    choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c', function: { name: 'submit_decision', arguments: JSON.stringify({ action: 'hold', reasoning: 'calm', confidence: 0.5 }) } }] } }],
    usage: { prompt_tokens: 1000, completion_tokens: 200 },
  },
});
const chatStub = () => vi.fn(async () => chatDecided()) as ChatFetch & ReturnType<typeof vi.fn>;

/** One model fund in a fresh world, and the input it would decide on. */
function ctx(model: string = MODEL) {
  const s = initialSimState({ funds: ['crown-meridian'], directorMode: 'none', decisionEveryTicks: null, ticks: 10, brains: { 'crown-meridian': model as typeof MODEL } }, 1);
  const fund = s.funds[0];
  return { fund, input: buildDecisionInput(fund.fund, s.market, s.recentEvents, s.market.recentFlow), tick: 1 };
}

describe('makeExperimentDecide', () => {
  it('reuses the policy when nothing material changed', async () => {
    const create = stub(decided());
    const decide = makeExperimentDecide({ anthropic: create, openrouter: null }, { limitUsd: 10, spentUsd: 0 });
    const c = ctx();
    expect((await decide(c)).source).toBe('llm');
    const second = await decide(c);
    expect(second).toMatchObject({ source: 'policy', model: null, costUsd: 0, decision: decideByPolicy(c.fund.profile, c.input) });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('records fallback when the loop returns no decision', async () => {
    const create = stub(msg([{ type: 'text', text: 'I would rather not say.' }], 'end_turn'));
    const c = ctx();
    const r = await makeExperimentDecide({ anthropic: create, openrouter: null }, { limitUsd: 10, spentUsd: 0 })(c);
    expect(r.source).toBe('fallback');
    expect(r.decision).toEqual(decideByPolicy(c.fund.profile, c.input));
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.outcome).toBe('no_decision');
  });

  it('stops before the call that would exceed the budget', async () => {
    const create = stub(decided());
    const budget: ExperimentBudget = { limitUsd: ONE_CALL * 0.99, spentUsd: 0 };
    const err = await makeExperimentDecide({ anthropic: create, openrouter: null }, budget)(ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExhausted);
    expect((err as BudgetExhausted).message).toBe('budget exhausted at $0.00');
    expect(create).not.toHaveBeenCalled();
    expect(budget.spentUsd).toBe(0);
  });

  it('adds actual cost to the budget', async () => {
    const create = stub(decided());
    const budget: ExperimentBudget = { limitUsd: 10, spentUsd: 0.5 };
    const r = await makeExperimentDecide({ anthropic: create, openrouter: null }, budget)(ctx());
    expect(r.costUsd).toBeGreaterThan(0);
    expect(budget.spentUsd).toBeCloseTo(0.5 + r.costUsd, 12);
  });

  it('allows a call whose worst case exactly fits the remaining budget', async () => {
    const create = stub(decided());
    await makeExperimentDecide({ anthropic: create, openrouter: null }, { limitUsd: ONE_CALL, spentUsd: 0 })(ctx());
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('makeExperimentDecide: providers', () => {
  it('routes openrouter models to the chat adapter and anthropic models to the SDK loop', async () => {
    const create = stub(decided());
    const chat = chatStub();
    const clients = { anthropic: create, openrouter: chat };
    const or = await makeExperimentDecide(clients, { limitUsd: 10, spentUsd: 0 })(ctx(OR_MODEL));
    expect(or).toMatchObject({ source: 'llm', model: OR_MODEL });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect((chat.mock.calls[0] as unknown[])[0]).toMatchObject({ model: OR_MODEL });

    const an = await makeExperimentDecide(clients, { limitUsd: 10, spentUsd: 0 })(ctx());
    expect(an).toMatchObject({ source: 'llm', model: MODEL });
    expect(create).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('meters openrouter cost against the same experiment budget', async () => {
    // $2/$6 per MTok: 1000 in + 200 out = $0.0032.
    const budget: ExperimentBudget = { limitUsd: 10, spentUsd: 0.5 };
    const r = await makeExperimentDecide({ anthropic: null, openrouter: chatStub() }, budget)(ctx(OR_MODEL));
    expect(r.costUsd).toBeCloseTo(0.0032, 12);
    expect(budget.spentUsd).toBeCloseTo(0.5 + 0.0032, 12);

    // The worst-case reservation applies to openrouter calls too.
    const chat = chatStub();
    const oneCall = estimateCallCostUsd(OR_MODEL, MAX_TOOL_ROUNDS, DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE);
    const err = await makeExperimentDecide({ anthropic: null, openrouter: chat }, { limitUsd: oneCall * 0.99, spentUsd: 0 })(ctx(OR_MODEL)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExhausted);
    expect(chat).not.toHaveBeenCalled();
  });

  it('throws the no-key error when the needed client is missing', async () => {
    const err = await makeExperimentDecide({ anthropic: stub(decided()), openrouter: null }, { limitUsd: 10, spentUsd: 0 })(ctx(OR_MODEL)).catch((e: unknown) => e);
    expect((err as Error).message).toBe('No key on the server for provider openrouter.');
  });
});

describe('estimateExperimentCostUsd', () => {
  it('counts only model funds in each arm, per seed and decision slot', () => {
    const base = { funds: ['crown-meridian', 'sterling-vale'], directorMode: 'none' as const, decisionEveryTicks: 10, ticks: 100 };
    const spec = {
      name: 'm', base, variable: 'brains' as const, seeds: [1, 2],
      values: [{}, { 'crown-meridian': MODEL }],
    };
    // arm 1: no model funds; arm 2: one model fund × 2 seeds × 10 slots.
    expect(estimateExperimentCostUsd(spec)).toBeCloseTo(2 * 10 * ONE_CALL, 12);
    expect(estimateExperimentCostUsd({ ...spec, variable: 'directorMode', values: ['none', 'rule'] })).toBe(0);
  });
});
