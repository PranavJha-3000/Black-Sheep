// Writes the paper's data, tables and figures from finished `study:*` experiments.
//
//   npm run paper:export
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { prisma } from '../server/db';
import { buildPaperFiles, latestDoneStudy } from '../server/paperCore';

// Failed rows too: they are listed in paper/data/failed.csv with their error.
const experiments = await prisma.experiment.findMany({ where: { status: { in: ['done', 'failed'] }, name: { startsWith: 'study:' } }, orderBy: { id: 'asc' } });
if (!experiments.some((e) => e.status === 'done')) {
  console.error('No done experiments named study:* — run the study first.');
  await prisma.$disconnect();
  process.exit(1);
}
for (const e of latestDoneStudy(experiments).ignored) console.log(`ignored #${e.id} ${e.name}: a newer done experiment has the same name`);
for (const f of buildPaperFiles(experiments)) {
  mkdirSync(dirname(f.path), { recursive: true });
  writeFileSync(f.path, f.content);
  const lines = f.content.split('\n').length - 1;
  console.log(`${f.path}: ${f.path.endsWith('.csv') ? lines - 1 : lines} ${f.path.endsWith('.csv') ? 'rows' : 'lines'}`);
}
await prisma.$disconnect();
