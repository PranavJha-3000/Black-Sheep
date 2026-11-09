import { experimentManifest } from '@black-sheep/engine/experiment';
import { prisma } from './db';
import { parseExperimentRequest, runExperimentSpec } from './labCore';
import { anthropicCreate, type CreateMessage } from './providers/anthropic';
import { EXPERIMENT_POLL_MS } from '../config/game';

/**
 * The Research Lab runner (D-032). Experiment worlds are independent of the
 * live world: no shared state, no withWorldLock, no live tables. One
 * experiment runs at a time in this process; between runs the runner yields
 * to the event loop so the live 5 s tick keeps its schedule.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
/** The provider call for model brains, or null when no key is configured (as in server/world.ts). */
const createMessage: CreateMessage | null = ANTHROPIC_API_KEY ? anthropicCreate(ANTHROPIC_API_KEY) : null;

let busy = false;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A restart interrupts a running experiment; it is deterministic, so it simply runs again. */
export async function requeueInterrupted(): Promise<void> {
  await prisma.experiment.updateMany({ where: { status: 'running' }, data: { status: 'queued', startedAt: null } });
}

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
    try {
      // Re-validated: the stored spec is data, and the limits may have changed since it was queued.
      const parsed = parseExperimentRequest(JSON.parse(next.specJson), { providerConfigured: createMessage !== null });
      if (!parsed.ok) throw new Error(parsed.error);
      const result = await runExperimentSpec(parsed.spec, yieldToEventLoop, { create: createMessage });
      await prisma.experiment.update({
        where: { id: next.id },
        // The manifest is recomputed here so it describes the code and config that actually ran (a queued
        // experiment can outlive a redeploy).
        data: {
          status: 'done',
          manifestJson: JSON.stringify(experimentManifest(parsed.spec)),
          resultJson: JSON.stringify(result),
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      await prisma.experiment.update({
        where: { id: next.id },
        data: { status: 'failed', error: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
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
