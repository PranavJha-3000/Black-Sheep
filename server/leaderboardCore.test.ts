import { describe, expect, it } from 'vitest';
import { buildLeaderboard } from './leaderboardCore';
import type { ExperimentRow } from './labCore';
import { STARTING_CAPITAL } from '../config/game';

const M = 'claude-opus-5-5';
const armLabel = (b: Record<string, string>) => `brains=${Object.keys(b).length ? Object.entries(b).map(([k, v]) => `${k}:${v}`).join('+') : 'policy'}`;
const nav = (ret: number) => [STARTING_CAPITAL, STARTING_CAPITAL * (1 + ret)];

/** One subject fund 'f': arm policy vs arm model; per-seed returns for each. */
function row(id: number, policyRets: number[], modelRets: number[], over: Partial<ExperimentRow> = {}, seedOffset = 0): ExperimentRow {
  const values: Record<string, string>[] = [{}, { f: M }];
  const mk = (rets: number[], cost: number) =>
    rets.map((r, i) => ({ seed: i + 1 + seedOffset, digest: 'd', liquidated: [], navs: { f: nav(r), opp: nav(0.5) }, events: [], sources: { f: { policy: 0, llm: 2, fallback: 0 } }, costUsd: cost }));
  return {
    id, createdAt: new Date(), name: 'x', status: 'done', variable: 'brains', error: null, startedAt: null, finishedAt: null, manifestJson: '{}',
    specJson: JSON.stringify({ name: 'x', variable: 'brains', values, base: { funds: ['f', 'opp'] }, seeds: policyRets.map((_, i) => i + 1) }),
    resultJson: JSON.stringify({ runs: [{ label: armLabel(values[0]), runs: mk(policyRets, 0) }, { label: armLabel(values[1]), runs: mk(modelRets, 1) }] }),
    ...over,
  };
}

describe('buildLeaderboard', () => {
  it('counts every done brains experiment', () => {
    const lb = buildLeaderboard([row(1, [0, 0, 0], [0.1, 0.1, 0.1]), row(2, [0, 0], [0.2, 0.2])]);
    const m = lb.find((r) => r.brain === M)!;
    expect(m.experiments).toBe(2);
    expect(m.runs).toBe(5);
    expect(m.pairedVsPolicy!.pairs).toBe(5);
    expect(m.meanCostPerDecision).toBeCloseTo(1 / 2);
    expect(lb.find((r) => r.brain === 'policy')!.pairedVsPolicy).toBeNull();
    expect(lb[0].brain).toBe(M);
    // Opponent fund 'opp' (0.5 return) never enters the Policy row.
    expect(lb.find((r) => r.brain === 'policy')!.meanReturn).toBeCloseTo(0);
  });

  it('ignores failed and non-brains experiments', () => {
    const lb = buildLeaderboard([row(1, [0], [0.1], { status: 'failed' }), row(2, [0], [0.1], { variable: 'funds' }), row(3, [0], [0.1], { resultJson: JSON.stringify({ runs: [{ label: 'a', runs: [{ seed: 1 }] }] }) })]);
    expect(lb).toEqual([]);
  });

  it('pairs only within the same experiment and seed', () => {
    // Same seed in both experiments; exp 2's 0.9 policy return must not leak into exp 1's pair.
    // Exp 3 has no baseline arm: its sample (same seed) must stay unpaired rather than borrow exp 1's partner.
    const r3 = row(3, [0], [0.5]);
    const spec3 = JSON.parse(r3.specJson);
    spec3.values = [{ f: M }];
    const noBaseline = { ...r3, specJson: JSON.stringify(spec3), resultJson: JSON.stringify({ runs: [JSON.parse(r3.resultJson!).runs[1]] }) };
    const lb = buildLeaderboard([row(1, [0], [0.3]), row(2, [0.9], [0.9]), noBaseline]);
    const p = lb.find((r) => r.brain === M)!.pairedVsPolicy!;
    expect(p.pairs).toBe(2);
    expect(p.meanDiff).toBeCloseTo(0.15); // (0.3 + 0)/2
    expect(p.wins).toBe(1);
    expect(lb.find((x) => x.brain === M)!.runs).toBe(3);
  });

  it('pairs only against the all-policy baseline arm', () => {
    const r = row(1, [0], [0.3]);
    const spec = JSON.parse(r.specJson);
    spec.values = [{ f: M }]; // no baseline arm at all
    const lb = buildLeaderboard([{ ...r, specJson: JSON.stringify(spec), resultJson: JSON.stringify({ runs: [JSON.parse(r.resultJson!).runs[1]] }) }]);
    expect(lb.find((x) => x.brain === M)!.pairedVsPolicy).toBeNull();
  });

  it('marks rows under 5 runs insufficient', () => {
    const lb = buildLeaderboard([row(1, [0, 0, 0, 0], [0.1, 0.1, 0.1, 0.1]), row(2, [0, 0], [0, 0])]);
    expect(lb.find((r) => r.brain === M)!.insufficient).toBe(false);
    expect(buildLeaderboard([row(1, [0, 0], [0.1, 0.1])]).every((r) => r.insufficient)).toBe(true);
  });
});
