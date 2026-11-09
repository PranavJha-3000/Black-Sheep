import { describe, expect, it, vi } from 'vitest';
import { initialSimState } from '@black-sheep/engine/experiment';
import { decideByPolicy } from '@black-sheep/engine/policies';
import { buildDecisionInput } from '@black-sheep/engine/rival';
import { BudgetExhausted, estimateExperimentCostUsd, makeExperimentDecide, type ExperimentBudget } from './labBrain';
import { estimateCallCostUsd } from './budget';
import type { CreateMessage } from './providers/anthropic';
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

/** One model fund in a fresh world, and the input it would decide on. */
function ctx() {
  const s = initialSimState({ funds: ['crown-meridian'], directorMode: 'none', decisionEveryTicks: null, ticks: 10, brains: { 'crown-meridian': MODEL } }, 1);
  const fund = s.funds[0];
  return { fund, input: buildDecisionInput(fund.fund, s.market, s.recentEvents, s.market.recentFlow), tick: 1 };
}

describe('makeExperimentDecide', () => {
  it('reuses the policy when nothing material changed', async () => {
    const create = stub(decided());
    const decide = makeExperimentDecide(create, { limitUsd: 10, spentUsd: 0 });
    const c = ctx();
    expect((await decide(c)).source).toBe('llm');
    const second = await decide(c);
    expect(second).toMatchObject({ source: 'policy', model: null, costUsd: 0, decision: decideByPolicy(c.fund.profile, c.input) });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('records fallback when the loop returns no decision', async () => {
    const create = stub(msg([{ type: 'text', text: 'I would rather not say.' }], 'end_turn'));
    const c = ctx();
    const r = await makeExperimentDecide(create, { limitUsd: 10, spentUsd: 0 })(c);
    expect(r.source).toBe('fallback');
    expect(r.decision).toEqual(decideByPolicy(c.fund.profile, c.input));
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.outcome).toBe('no_decision');
  });

  it('stops before the call that would exceed the budget', async () => {
    const create = stub(decided());
    const budget: ExperimentBudget = { limitUsd: ONE_CALL * 0.99, spentUsd: 0 };
    const err = await makeExperimentDecide(create, budget)(ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExhausted);
    expect((err as BudgetExhausted).message).toBe('budget exhausted at $0.00');
    expect(create).not.toHaveBeenCalled();
    expect(budget.spentUsd).toBe(0);
  });

  it('adds actual cost to the budget', async () => {
    const create = stub(decided());
    const budget: ExperimentBudget = { limitUsd: 10, spentUsd: 0.5 };
    const r = await makeExperimentDecide(create, budget)(ctx());
    expect(r.costUsd).toBeGreaterThan(0);
    expect(budget.spentUsd).toBeCloseTo(0.5 + r.costUsd, 12);
  });

  it('allows a call whose worst case exactly fits the remaining budget', async () => {
    const create = stub(decided());
    await makeExperimentDecide(create, { limitUsd: ONE_CALL, spentUsd: 0 })(ctx());
    expect(create).toHaveBeenCalledTimes(1);
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
