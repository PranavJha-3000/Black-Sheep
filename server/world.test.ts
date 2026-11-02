import { describe, expect, it } from 'vitest';
import { getFundProfile } from '@black-sheep/engine/funds';
import { createRivalFund } from '@black-sheep/engine/rival';
import { agentObservation, type Agent } from './world';

const memory = [{ kind: 'episodic' as const, tickCountAt: 4, subject: 'NOVA', content: 'm', importance: 0.5, outcomeUsd: null }];

function agent(fundId: number, overrides: Partial<Agent> = {}): Agent {
  return {
    fundId,
    profile: getFundProfile('crown-meridian')!,
    fund: createRivalFund(10_000_000, 'quant'),
    pending: false,
    liquidated: false,
    lastLlmInput: null,
    memory: [],
    ...overrides,
  };
}

describe('agentObservation (what /world/state learns from the live agent)', () => {
  it('carries the agent memory, thinking flag and spend into the observer payload (review I-1)', () => {
    const o = agentObservation([agent(1, { memory, pending: true })], 1);
    expect(o.memory).toBe(memory);
    expect(o.thinking).toBe(true);
    expect(o.spend).toEqual({ todayUsd: 0, dailyBudgetUsd: 2 });
  });

  it('a fund without an agent is observed only: no memory, not thinking, no spend', () => {
    expect(agentObservation([agent(1)], 2)).toEqual({ thinking: false, spend: null, memory: [] });
  });

  it('a liquidated agent is never thinking', () => {
    expect(agentObservation([agent(1, { pending: true, liquidated: true })], 1).thinking).toBe(false);
  });
});
