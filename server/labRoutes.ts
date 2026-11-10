import { Router } from 'express';
import { experimentManifest } from '@black-sheep/engine/experiment';
import { prisma } from './db';
import { wrap } from './auth';
import { buildExperimentDetail, buildExperimentSummary, buildRunReplay, checkLabToken, configuredProviders, decisionFromRow, dryRunExperiment, findRun, parseExperimentRequest, parseNameFilter } from './labCore';
import { EXPERIMENT_REPLAY_MAX_DECISIONS } from '../config/game';
import { makeLeaderboardCache } from './leaderboardCore';
import { parseFundId } from './observerCore';

/**
 * RESEARCH LAB (VISION §10, §13; D-032, D-033). Reading experiments is public
 * observation; creating one is privileged and needs LAB_ADMIN_TOKEN.
 */
export const labRouter = Router();

const LIST_LIMIT = 50;

labRouter.get(
  '/experiments',
  wrap(async (req, res) => {
    const filter = parseNameFilter(req.query.name);
    if (!filter.ok) {
      res.status(400).json({ error: filter.error });
      return;
    }
    // Summary columns only: result blobs can be large and the list is polled.
    const rows = await prisma.experiment.findMany({
      where: filter.name === null ? undefined : { name: filter.name },
      orderBy: { id: 'desc' },
      take: LIST_LIMIT,
      select: { id: true, createdAt: true, name: true, status: true, variable: true, specJson: true, manifestJson: true, finishedAt: true },
    });
    res.json({ experiments: rows.map(buildExperimentSummary) });
  }),
);

const leaderboard = makeLeaderboardCache();

labRouter.get(
  '/leaderboard',
  wrap(async (_req, res) => {
    // Every finished brains experiment counts; no hand-picking. Public and polled, so the parse is cached.
    const where = { status: 'done', variable: 'brains' };
    const agg = await prisma.experiment.aggregate({ where, _count: { _all: true }, _max: { id: true } });
    const board = await leaderboard(`${agg._count._all}/${agg._max.id ?? 0}`, () => prisma.experiment.findMany({ where }));
    res.json({ leaderboard: board });
  }),
);

labRouter.get(
  '/experiments/:id',
  wrap(async (req, res) => {
    const id = parseFundId(req.params.id);
    const row = id === null ? null : await prisma.experiment.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'experiment not found' });
      return;
    }
    res.json(buildExperimentDetail(row));
  }),
);

labRouter.get(
  '/experiments/:id/runs/:arm/:seed',
  wrap(async (req, res) => {
    const id = parseFundId(req.params.id);
    const seed = Number(req.params.seed);
    const row = id === null || !Number.isInteger(seed) ? null : await prisma.experiment.findUnique({ where: { id } });
    if (!row || row.status !== 'done') {
      res.status(404).json({ error: row ? 'experiment has no finished runs yet' : 'experiment not found' });
      return;
    }
    // Validate the run against the stored result first so an unknown run costs no decision read.
    if (!findRun(row, req.params.arm, seed)) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    // Express already URL-decodes params, so the arm label (e.g. `brains=...`) arrives as stored.
    const arm = req.params.arm;
    // One extra row detects truncation without a count query.
    const rows = await prisma.experimentDecision.findMany({
      where: { experimentId: row.id, arm, seed },
      orderBy: [{ tick: 'asc' }, { id: 'asc' }],
      take: EXPERIMENT_REPLAY_MAX_DECISIONS + 1,
    });
    const replay = buildRunReplay(row, arm, seed, rows.map(decisionFromRow));
    if (!replay) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    res.json(replay);
  }),
);

labRouter.post(
  '/experiments',
  wrap(async (req, res) => {
    const auth = checkLabToken(req.headers.authorization, process.env.LAB_ADMIN_TOKEN);
    if (auth === 'disabled') {
      res.status(503).json({ error: 'Research Lab writes are disabled: LAB_ADMIN_TOKEN is not set on the server.' });
      return;
    }
    if (auth === 'unauthorized') {
      res.status(401).json({ error: 'A valid lab admin token is required to create experiments.' });
      return;
    }
    const providers = configuredProviders(process.env);
    // Dry run: same auth and validation, returns the worst-case estimate and stores nothing.
    if (req.query.dryRun === '1') {
      const dry = dryRunExperiment(req.body, { providers });
      if (!dry.ok) res.status(400).json({ error: dry.error });
      else res.json({ estimateUsd: dry.estimateUsd });
      return;
    }
    const parsed = parseExperimentRequest(req.body, { providers });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { spec } = parsed;
    const manifest = experimentManifest(spec);
    const row = await prisma.experiment.create({
      data: {
        name: spec.name,
        variable: spec.variable,
        specJson: JSON.stringify(spec),
        manifestJson: JSON.stringify(manifest),
        // Same engine rule as the manifest: a model-backed experiment is never re-queued after a restart.
        hasModelBrains: !manifest.policyOnly,
      },
    });
    res.status(201).json({ id: row.id });
  }),
);
