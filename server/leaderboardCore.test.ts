import { describe, expect, it } from 'vitest';
import { buildLeaderboard, makeLeaderboardCache } from './leaderboardCore';
import type { ExperimentRow } from './labCore';
import { STARTING_CAPITAL } from '../config/game';

const M = 'claude-opus-5-5';
const armLabel = (b: Record<string, string>) => `brains=${Object.keys(b).length ? Object.entries(b).map(([k, v]) => `${k}:${v}`).join('+') : 'policy'}`;
const nav = (ret: number) => [STARTING_CAPITAL, STARTING_CAPITAL * (1 + ret)];

/** One subject fund 'f': arm policy vs arm model; per-seed returns for each. */
function row(id: number, policyRets: number[], modelRets: number[], over: Partial<ExperimentRow> = {}, seedOffset = 0, modelSrc = { policy: 0, llm: 2, fallback: 0 }): ExperimentRow {
  const values: Record<string, string>[] = [{}, { f: M }];
  const mk = (rets: number[], cost: number, src: typeof modelSrc) =>
    rets.map((r, i) => ({ seed: i + 1 + seedOffset, digest: 'd', liquidated: [], navs: { f: nav(r), opp: nav(0.5) }, events: [], sources: { f: src }, costUsd: cost }));
  return {
    id, createdAt: new Date(), name: 'x', status: 'done', variable: 'brains', error: null, startedAt: null, finishedAt: null, manifestJson: '{}',
    specJson: JSON.stringify({ name: 'x', variable: 'brains', values, base: { funds: ['f', 'opp'] }, seeds: policyRets.map((_, i) => i + 1) }),
    resultJson: JSON.stringify({ runs: [{ label: armLabel(values[0]), runs: mk(policyRets, 0, { policy: 2, llm: 0, fallback: 0 }) }, { label: armLabel(values[1]), runs: mk(modelRets, 1, modelSrc) }] }),
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

  it('counts evidence in pairs, not runs, for model rows', () => {
    // 6 model runs but only 1 has a baseline partner: ranked on one pair, so it must be flagged.
    const r = row(1, [0], [0.3]);
    const spec = JSON.parse(r.specJson);
    spec.values = [{ f: M }];
    const unpaired = { ...r, id: 2, specJson: JSON.stringify(spec), resultJson: JSON.stringify({ runs: [JSON.parse(row(2, [], [0.1, 0.1, 0.1, 0.1, 0.1], {}, 10).resultJson!).runs[1]] }) };
    const m = buildLeaderboard([r, unpaired]).find((x) => x.brain === M)!;
    expect(m.runs).toBe(6);
    expect(m.pairedVsPolicy!.pairs).toBe(1);
    expect(m.insufficient).toBe(true);
  });

  it('reports the fallback rate over model decisions', () => {
    const m = buildLeaderboard([row(1, [0, 0], [0.1, 0.1], {}, 0, { policy: 5, llm: 3, fallback: 1 })]).find((x) => x.brain === M)!;
    expect(m.fallbackRate).toBeCloseTo(1 / 4);
    expect(buildLeaderboard([row(1, [0], [0.1])]).find((x) => x.brain === 'policy')!.fallbackRate).toBeNull();
  });

  it('drops model runs with no model decision at all', () => {
    // A bad key or outage: every call fell back, so the run measured the policy, not the model.
    const dead = row(2, [0, 0], [0.9, 0.9], {}, 0, { policy: 5, llm: 0, fallback: 4 });
    const lb = buildLeaderboard([row(1, [0], [0.1]), dead]);
    const m = lb.find((x) => x.brain === M)!;
    expect(m.runs).toBe(1);
    expect(m.experiments).toBe(1);
    expect(m.meanReturn).toBeCloseTo(0.1);
    // The baseline policy runs of that experiment still count.
    expect(lb.find((x) => x.brain === 'policy')!.runs).toBe(3);
    expect(buildLeaderboard([dead]).some((x) => x.brain === M)).toBe(false);
  });
});

describe('makeLeaderboardCache', () => {
  it('rebuilds only when the key changes', async () => {
    const cache = makeLeaderboardCache();
    let loads = 0;
    const load = async () => (loads++, [row(1, [0], [0.1])]);
    const a = await cache('1/1', load);
    expect(await cache('1/1', load)).toBe(a);
    expect(loads).toBe(1);
    await cache('2/2', load);
    expect(loads).toBe(2);
  });
});
