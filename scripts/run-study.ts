// Prices the pre-registered study and, only with --confirm, submits it to the lab API.
//
//   npm run study:run                 dry run: per-file and total worst-case $
//   npm run study:run -- --confirm    POST every paper/study/*.json not already queued, running or done (spends money)
//
// Env (with --confirm): LAB_ADMIN_TOKEN (required), LAB_API_URL (default http://localhost:3001).
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { estimateExperimentCostUsd } from '../server/labBrain';
import { checkStudyPlan, pendingSubmissions } from '../server/studyPlan';

const PREREG = 'paper/PREREGISTRATION.md';
const DIR = 'paper/study';

// The commit is the pre-registration timestamp: refuse unless the prereg and every study spec are tracked and unmodified.
const COMMIT_FIRST = `Commit ${PREREG} and ${DIR}/ before running the study.`;
try {
  execFileSync('git', ['ls-files', '--error-unmatch', PREREG], { stdio: 'ignore' });
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', PREREG, DIR], { stdio: 'ignore' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', DIR], { encoding: 'utf8' });
  if (untracked.trim()) throw new Error(`untracked: ${untracked.trim().split('\n').join(', ')}`);
} catch (err) {
  console.error(COMMIT_FIRST);
  console.error(`(${(err as Error).message.split('\n')[0]})`);
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
const api = `${process.env.LAB_API_URL ?? 'http://localhost:3001'}/lab/experiments`;
const TIMEOUT_MS = 30_000;

const submitted: string[] = [];
const stop = (msg: string): never => {
  console.error(msg);
  console.error(`Stopped. Submitted this run ${submitted.length}: ${submitted.join(', ') || 'none'}`);
  process.exit(1);
};

// Resume: look up every name first; anything already queued, running or done is not paid for again.
const existing: { name: string; id: number; status: string; configHash: string | null }[] = [];
for (const f of files) {
  const name = String((f.spec as { name?: unknown }).name);
  const res = await fetch(`${api}?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((err: Error) =>
    stop(`${f.path}: lookup failed (${err.message}).`),
  );
  if (!res.ok) stop(`${f.path}: lookup HTTP ${res.status} ${await res.text()}`);
  existing.push(...((await res.json()) as { experiments: { name: string; id: number; status: string; configHash: string | null }[] }).experiments);
}

// A same-named experiment with another config is refused before anything is submitted.
const pending = pendingSubmissions(files.map((f, i) => ({ ...f, configHash: plan.perFile[i].configHash })), existing);
const items = pending.ok ? pending.items : stop(pending.error);

// Sequential, stop on the first failure; re-running resumes from where it stopped.
for (const { file: f, skip } of items) {
  if (skip) {
    console.log(`skip ${f.path} (already #${skip.id} ${skip.status})`);
    continue;
  }
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(f.spec),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: Error) => stop(`${f.path}: request failed (${err.message}); re-run to resume, it skips anything the server did create.`));
  const body = await res.text();
  if (!res.ok) stop(`${f.path}: HTTP ${res.status} ${body}`);
  submitted.push(f.path);
  console.log(`${f.path} -> ${body}`);
}
console.log(`Submitted this run: ${submitted.length}.`);
