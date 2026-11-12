import { decideByPolicy } from '@black-sheep/engine/policies';
import { armModelFunds, expandArms, type DecideFn, type DecisionRecord, type ExperimentSpec } from '@black-sheep/engine/experiment';
import { runFundTool } from '@black-sheep/engine/fundTools';
import { buildFundSystemPrompt, buildRivalUserMessage, shouldRivalReconsider } from '@black-sheep/engine/rivalLLM';
import type { RivalDecisionInput } from '@black-sheep/engine/rival';
import { MODEL_REGISTRY, type ModelId } from '../config/models';
import { DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE, MAX_TOOL_ROUNDS } from '../config/game';
import { estimateCallCostUsd } from './budget';
import { runDecisionLoop, type CreateMessage, type DecisionRequest } from './providers/anthropic';
import { runOpenAICompatLoop, type ChatFetch } from './providers/openaiCompat';

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

/** One client per provider; null when the server holds no key for it. */
export interface ProviderClients {
  anthropic: CreateMessage | null;
  openrouter: ChatFetch | null;
}

/** A fresh closure per run: `lastLlmInput` is per fund within one world. */
export function makeExperimentDecide(clients: ProviderClients, budget: ExperimentBudget): DecideFn {
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

    const req: DecisionRequest = {
      model,
      effort: MODEL_REGISTRY[model].effort,
      system: buildFundSystemPrompt(fund.profile),
      user: buildRivalUserMessage(input),
      maxRounds: MAX_TOOL_ROUNDS,
      maxTokens: DECISION_MAX_TOKENS,
      runTool: (name, args) => runFundTool(name, args, input, fund.profile),
    };
    const { provider } = MODEL_REGISTRY[model];
    // Defensive: parseExperimentRequest already rejects a brain whose provider has no key.
    const noKey = (): never => {
      throw new Error(`No key on the server for provider ${provider}.`);
    };
    // Both loops never throw; every exit carries the cost actually incurred.
    const loop = provider === 'openrouter'
      ? await runOpenAICompatLoop(clients.openrouter ?? noKey(), req)
      : await runDecisionLoop(clients.anthropic ?? noKey(), req);
    // An unreadable cost (NaN, negative, non-number) would make every later cap check false: charge the worst case instead.
    budget.spentUsd += typeof loop.costUsd === 'number' && Number.isFinite(loop.costUsd) && loop.costUsd >= 0 ? loop.costUsd : callEstimateUsd(model);
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
