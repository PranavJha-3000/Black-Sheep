import { mulberry32 } from './market';

/** Percentile bootstrap CI of the mean; null below two values. */
export function bootstrapMeanCI(
  xs: number[],
  { iters = 2000, alpha = 0.05, seed = 1 }: { iters?: number; alpha?: number; seed?: number } = {},
): [number, number] | null {
  if (xs.length < 2) return null;
  const rand = mulberry32(seed);
  const n = xs.length;
  const means: number[] = [];
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += xs[Math.floor(rand() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(iters - 1, Math.max(0, Math.floor(q * iters)))];
  return [at(alpha / 2), at(1 - alpha / 2)];
}

/** Exact two-sided binomial sign test (p = 0.5). Callers drop ties from n. */
export function signTestP(wins: number, n: number): number {
  if (n <= 0) return 1;
  const k = Math.min(wins, n - wins);
  // Sum C(n,i)/2^n for i<=k, building each term from the last.
  let term = 0.5 ** n;
  let tail = term;
  for (let i = 1; i <= k; i++) {
    term = (term * (n - i + 1)) / i;
    tail += term;
  }
  return Math.min(1, 2 * tail);
}

/** Holm step-down adjusted p-values, in input order. */
export function holm(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((_, i) => i).sort((a, b) => ps[a] - ps[b]);
  const out = new Array<number>(m);
  let running = 0;
  order.forEach((idx, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * ps[idx]));
    out[idx] = running;
  });
  return out;
}
