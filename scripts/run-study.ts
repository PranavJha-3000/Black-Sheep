// Prices the pre-registered study and, only with --confirm, submits it to the lab API.
//
//   npm run study:run                 dry run: per-file and total worst-case $
//   npm run study:run -- --confirm    POST every paper/study/*.json (spends money)
//
// Env (with --confirm): LAB_ADMIN_TOKEN (required), LAB_API_URL (default http://localhost:3001).
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { estimateExperimentCostUsd } from '../server/labBrain';
import { checkStudyPlan } from '../server/studyPlan';

const PREREG = 'paper/PREREGISTRATION.md';
const DIR = 'paper/study';

// The commit is the pre-registration timestamp: refuse unless it is tracked and unmodified.
try {
  execFileSync('git', ['ls-files', '--error-unmatch', PREREG], { stdio: 'ignore' });
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', PREREG], { stdio: 'ignore' });
} catch {
  console.error(`Commit ${PREREG} before running the study.`);
  process.exit(1);
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  .map((f) => ({ path: `${DIR}/${f}`, spec: JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as unknown }));

const plan = checkStudyPlan(files, estimateExperimentCostUsd);
if (!plan.ok) {
  console.error(plan.error);
  process.exit(1);
}
for (const f of plan.perFile) console.log(`${f.path}  $${f.usd.toFixed(2)}`);
console.log(`${plan.perFile.length} experiments, total worst case $${plan.totalUsd.toFixed(2)}`);

if (!process.argv.includes('--confirm')) {
  console.log('Dry run. Re-run with --confirm to submit (spends money up to the total above).');
  process.exit(0);
}

const token = process.env.LAB_ADMIN_TOKEN;
if (!token) {
  console.error('LAB_ADMIN_TOKEN is not set; the lab API refuses writes without it. Nothing was submitted.');
  process.exit(1);
}
const url = `${process.env.LAB_API_URL ?? 'http://localhost:3001'}/lab/experiments`;

// Sequential, stop on the first failure so a partial submission is easy to resume by hand.
const submitted: string[] = [];
const stop = (msg: string): never => {
  console.error(msg);
  console.error(`Stopped. Submitted ${submitted.length}/${files.length}: ${submitted.join(', ') || 'none'}`);
  process.exit(1);
};
for (const f of files) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(f.spec),
  }).catch((err: Error) => stop(`${f.path}: request failed (${err.message}).`));
  const body = await res.text();
  if (!res.ok) stop(`${f.path}: HTTP ${res.status} ${body}`);
  submitted.push(f.path);
  console.log(`${f.path} -> ${body}`);
}
console.log(`Submitted ${submitted.length}/${files.length}.`);
