import { experimentManifest, type DecisionRecord } from '@black-sheep/engine/experiment';
import { prisma } from './db';
import type { ExperimentBudget, ProviderClients } from './labBrain';
import { configuredProviders, parseExperimentRequest, runExperimentSpec } from './labCore';
import { anthropicCreate } from './providers/anthropic';
import { openaiCompatFetch } from './providers/openaiCompat';
import { EXPERIMENT_POLL_MS } from '../config/game';

/**
 * The Research Lab runner (D-032). Experiment worlds are independent of the
 * live world: no shared state, no withWorldLock, no live tables. One
 * experiment runs at a time in this process; between runs the runner yields
 * to the event loop so the live 5 s tick keeps its schedule.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
/** One client per provider for model brains, null where no key is configured (as in server/world.ts). */
const clients: ProviderClients = {
  anthropic: ANTHROPIC_API_KEY ? anthropicCreate(ANTHROPIC_API_KEY) : null,
  openrouter: OPENROUTER_API_KEY ? openaiCompatFetch('https://openrouter.ai/api/v1', OPENROUTER_API_KEY) : null,
};
const providers = configuredProviders(process.env);

let busy = false;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A restart interrupts a running experiment. A policy-only one is deterministic, so it simply runs again;
 * a model-backed one would pay the provider twice, so it fails instead.
 */
export async function requeueInterrupted(): Promise<void> {
  // costUsd is deliberately not set: it already holds the spend persisted during the run.
  await prisma.experiment.updateMany({
    where: { status: 'running', hasModelBrains: true },
    data: { status: 'failed', error: 'interrupted by restart', finishedAt: new Date() },
  });
  await prisma.experiment.updateMany({ where: { status: 'running', hasModelBrains: false }, data: { status: 'queued', startedAt: null } });
}

/** One stored decision row. */
const decisionRow = (experimentId: number, arm: string, seed: number, r: DecisionRecord) => ({
  experimentId,
  arm,
  seed,
  tick: r.tick,
  fundKey: r.fundKey,
  source: r.source,
  model: r.model,
  action: r.decision.action,
  ticker: r.decision.ticker ?? null,
  dollarAmount: r.decision.dollarAmount ?? null,
  confidence: r.decision.confidence,
  reasoning: r.decision.reasoning,
  costUsd: r.costUsd,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  latencyMs: r.latencyMs,
  toolCallsJson: JSON.stringify(r.toolCalls),
  outcome: r.outcome,
});

/** Run the oldest queued experiment, if any. Returns whether one ran. */
export async function runNextExperiment(): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    const next = await prisma.experiment.findFirst({ where: { status: 'queued' }, orderBy: { id: 'asc' } });
    if (!next) return false;
    // Claim it; a row someone else claimed meanwhile is skipped.
    const claimed = await prisma.experiment.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    // Owned here, not by runExperimentSpec, so a failure of any kind still knows what was spent.
    const budget: ExperimentBudget = { limitUsd: 0, spentUsd: 0 };
    // One run's decisions, written in one createMany when the run changes or the experiment ends.
    let buffer: ReturnType<typeof decisionRow>[] = [];
    let bufferRun = '';
    const flush = async () => {
      const data = buffer;
      buffer = [];
      if (data.length) await prisma.experimentDecision.createMany({ data });
    };
    const onDecision = async (arm: string, seed: number, r: DecisionRecord) => {
      const run = `${arm}/${seed}`;
      if (run !== bufferRun) {
        await flush();
        bufferRun = run;
      }
      buffer.push(decisionRow(next.id, arm, seed, r));
      // Spend is persisted after every paid call (decisions are still batched per run), so a crash or
      // restart loses no recorded spend; requeueInterrupted leaves costUsd untouched.
      if (r.source !== 'policy') await prisma.experiment.update({ where: { id: next.id }, data: { costUsd: budget.spentUsd } });
    };
    try {
      // Re-validated: the stored spec is data, and the limits may have changed since it was queued.
      const parsed = parseExperimentRequest(JSON.parse(next.specJson), { providers });
      if (!parsed.ok) throw new Error(parsed.error);
      budget.limitUsd = parsed.spec.budgetUsd ?? 0;
      const result = await runExperimentSpec(parsed.spec, yieldToEventLoop, { clients, onDecision, budget });
      await flush();
      await prisma.experiment.update({
        where: { id: next.id },
        // The manifest is recomputed here so it describes the code and config that actually ran (a queued
        // experiment can outlive a redeploy).
        data: {
          status: 'done',
          manifestJson: JSON.stringify(experimentManifest(parsed.spec)),
          resultJson: JSON.stringify(result),
          costUsd: result.costUsd,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      // Decisions already paid for are kept, including the interrupted run's; a failed write must not stop the row failing.
      await flush().catch((e) => console.error('[lab] could not write experiment decisions', e));
      await prisma.experiment.update({
        where: { id: next.id },
        data: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          // Any failure, not only BudgetExhausted, records the spend actually incurred.
          costUsd: budget.spentUsd,
          finishedAt: new Date(),
        },
      });
    }
    return true;
  } finally {
    busy = false;
  }
}

/** Start polling for queued experiments. Returns a stop function. */
export function startExperimentRunner(): () => void {
  const ready = requeueInterrupted().catch((err) => console.error('[lab] could not re-queue interrupted experiments', err));
  const id = setInterval(() => {
    void ready.then(runNextExperiment).catch((err) => console.error('[lab] runner error', err));
  }, EXPERIMENT_POLL_MS);
  return () => clearInterval(id);
}
