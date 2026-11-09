import { decideByPolicy } from '@black-sheep/engine/policies';
import { expandArms, type ArmConfig, type DecideFn, type DecisionRecord, type ExperimentSpec } from '@black-sheep/engine/experiment';
import { getFundProfile } from '@black-sheep/engine/funds';
import { runFundTool } from '@black-sheep/engine/fundTools';
import { buildFundSystemPrompt, buildRivalUserMessage, shouldRivalReconsider } from '@black-sheep/engine/rivalLLM';
import type { RivalDecisionInput } from '@black-sheep/engine/rival';
import { MODEL_REGISTRY, type ModelId } from '../config/models';
import { DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE, MAX_TOOL_ROUNDS } from '../config/game';
import { estimateCallCostUsd } from './budget';
import { runDecisionLoop, type CreateMessage } from './providers/anthropic';

/**
 * labBrain — model-backed fund brains for Research Lab experiments (D-032).
 * Same gate, prompts and tool loop as the live world (server/world.ts
 * chooseDecision), but metered against ONE hard per-experiment budget instead
 * of the daily ledger: every call reserves its worst-case cost first, and the
 * experiment stops (BudgetExhausted) before a call that could exceed it.
 */

export class BudgetExhausted extends Error {
  constructor(public spentUsd: number) {
    super(`budget exhausted at $${spentUsd.toFixed(2)}`);
    this.name = 'BudgetExhausted';
  }
}

export interface ExperimentBudget {
  limitUsd: number;
  spentUsd: number;
}

/** Worst-case cost of one model decision (every round at max_tokens). */
const callEstimateUsd = (model: ModelId) => estimateCallCostUsd(model, MAX_TOOL_ROUNDS, DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE);

/** Roster funds in this arm that a model decides for, with their effective cadence. */
export function armModelFunds(arm: ArmConfig): { key: string; model: ModelId; every: number }[] {
  return arm.funds.flatMap((key) => {
    const brain = arm.brains?.[key];
    const profile = getFundProfile(key);
    if (!brain || brain === 'policy' || !profile) return [];
    return [{ key, model: brain, every: arm.decisionEveryTicks ?? profile.decisionEveryTicks }];
  });
}

/** Worst case for the whole spec: every model fund calls on every decision slot of every run. */
export function estimateExperimentCostUsd(spec: ExperimentSpec): number {
  let total = 0;
  for (const { config } of expandArms(spec)) {
    for (const f of armModelFunds(config)) {
      // ceil, not floor: an offset slot can fit one more decision than ticks/every.
      total += spec.seeds.length * Math.ceil(config.ticks / f.every) * callEstimateUsd(f.model);
    }
  }
  return total;
}

/** A fresh closure per run: `lastLlmInput` is per fund within one world. */
export function makeExperimentDecide(create: CreateMessage, budget: ExperimentBudget): DecideFn {
  const lastLlmInput = new Map<string, RivalDecisionInput>();
  return async ({ fund, input }) => {
    const key = fund.profile.key;
    const policy = (): Omit<DecisionRecord, 'tick' | 'fundKey'> => ({
      source: 'policy', model: null, decision: decideByPolicy(fund.profile, input),
      costUsd: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, toolCalls: [], outcome: null,
    });
    // Price moves alone don't wake the model (same gate as the live world).
    if (fund.brain === 'policy' || !shouldRivalReconsider(input, lastLlmInput.get(key) ?? null)) return policy();

    const model = fund.brain;
    if (budget.spentUsd + callEstimateUsd(model) > budget.limitUsd) throw new BudgetExhausted(budget.spentUsd);

    // runDecisionLoop never throws; every exit carries the cost actually incurred.
    const loop = await runDecisionLoop(create, {
      model,
      effort: MODEL_REGISTRY[model].effort,
      system: buildFundSystemPrompt(fund.profile),
      user: buildRivalUserMessage(input),
      maxRounds: MAX_TOOL_ROUNDS,
      maxTokens: DECISION_MAX_TOKENS,
      runTool: (name, args) => runFundTool(name, args, input, fund.profile),
    });
    budget.spentUsd += loop.costUsd;
    lastLlmInput.set(key, input);

    return {
      source: loop.decision ? 'llm' : 'fallback',
      model: loop.servedBy ?? model,
      decision: loop.decision ?? decideByPolicy(fund.profile, input),
      costUsd: loop.costUsd,
      inputTokens: loop.usage.input_tokens,
      outputTokens: loop.usage.output_tokens,
      latencyMs: loop.latencyMs,
      toolCalls: loop.toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
      outcome: loop.outcome,
    };
  };
}
