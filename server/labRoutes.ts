import { Router } from 'express';
import { experimentManifest } from '@black-sheep/engine/experiment';
import { prisma } from './db';
import { wrap } from './auth';
import { buildExperimentDetail, buildExperimentSummary, checkLabToken, parseExperimentRequest } from './labCore';
import { parseFundId } from './observerCore';

/**
 * RESEARCH LAB (VISION §10, §13; D-032, D-033). Reading experiments is public
 * observation; creating one is privileged and needs LAB_ADMIN_TOKEN.
 */
export const labRouter = Router();

const LIST_LIMIT = 50;

labRouter.get(
  '/experiments',
  wrap(async (_req, res) => {
    // Summary columns only: result blobs can be large and the list is polled.
    const rows = await prisma.experiment.findMany({
      orderBy: { id: 'desc' },
      take: LIST_LIMIT,
      select: { id: true, createdAt: true, name: true, status: true, variable: true, specJson: true, finishedAt: true },
    });
    res.json({ experiments: rows.map(buildExperimentSummary) });
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
    const parsed = parseExperimentRequest(req.body, { providerConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { spec } = parsed;
    const row = await prisma.experiment.create({
      data: {
        name: spec.name,
        variable: spec.variable,
        specJson: JSON.stringify(spec),
        manifestJson: JSON.stringify(experimentManifest(spec)),
      },
    });
    res.status(201).json({ id: row.id });
  }),
);
