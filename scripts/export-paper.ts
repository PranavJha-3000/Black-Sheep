// Writes the paper's data, tables and figures from finished `study:*` experiments
// that match a committed paper/study/*.json spec (name and configHash).
//
//   npm run paper:export
import 'dotenv/config';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { prisma } from '../server/db';
import { estimateExperimentCostUsd } from '../server/labBrain';
import { buildPaperFiles, latestDoneStudy, matchPreregistered } from '../server/paperCore';
import { checkStudyPlan } from '../server/studyPlan';

const DIR = 'paper/study';
const fail = async (msg: string): Promise<never> => {
  console.error(msg);
  await prisma.$disconnect();
  process.exit(1);
};

// The pre-registered set, each spec parsed exactly as the lab API (and run-study) parses it today.
const plan = checkStudyPlan(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ path: `${DIR}/${f}`, spec: JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as unknown })),
  estimateExperimentCostUsd,
);
if (!plan.ok) await fail(plan.error);
const specs = plan.ok ? plan.perFile : [];

// Failed rows too: they are listed in paper/data/failed.csv with their error.
const all = await prisma.experiment.findMany({ where: { status: { in: ['done', 'failed'] }, name: { startsWith: 'study:' } }, orderBy: { id: 'asc' } });
const match = matchPreregistered(all, specs);
const experiments = match.ok ? match.matched : await fail(match.error);
for (const e of match.ok ? match.unmatched : []) console.log(`ignored #${e.id} ${e.name}: not a pre-registered spec`);
if (!experiments.some((e) => e.status === 'done')) await fail('No done experiments match a paper/study/*.json spec — run the study first.');
for (const e of latestDoneStudy(experiments).ignored) console.log(`ignored #${e.id} ${e.name}: a newer done experiment has the same name`);
for (const f of buildPaperFiles(experiments)) {
  mkdirSync(dirname(f.path), { recursive: true });
  writeFileSync(f.path, f.content);
  const lines = f.content.split('\n').length - 1;
  console.log(`${f.path}: ${f.path.endsWith('.csv') ? lines - 1 : lines} ${f.path.endsWith('.csv') ? 'rows' : 'lines'}`);
}
await prisma.$disconnect();
