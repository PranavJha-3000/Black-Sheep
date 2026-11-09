import { describe, expect, it } from 'vitest';
import { holm } from '@black-sheep/engine/stats';
import { STARTING_CAPITAL } from '../config/game';
import { buildPaperFiles, pairedContrasts, studyRows, svgForest, texTable, toCsv, type Contrast, type StudyRow } from './paperCore';

const M = 'claude-opus-5-5';
const nav = (ret: number) => [STARTING_CAPITAL, STARTING_CAPITAL * (1 + ret)];

/** Two arms (policy baseline, model) of subject fund 'f'; returns[arm][i] for seeds seedStart+i. */
function exp(id: number, name: string, policy: number[], model: number[], seedStart = 1) {
  const values = [{}, { f: M }];
  const mk = (rets: number[], src: object) =>
    rets.map((r, i) => ({ seed: seedStart + i, digest: 'd', liquidated: [], navs: { f: nav(r), opp: nav(0.5) }, sources: { f: src }, costUsd: 1 }));
  return {
    id,
    name,
    specJson: JSON.stringify({ name: 'x', variable: 'brains', values, base: { funds: ['f', 'opp'] }, seeds: policy.map((_, i) => seedStart + i) }),
    resultJson: JSON.stringify({
      runs: [
        { label: 'brains=policy', runs: mk(policy, { policy: 2, llm: 0, fallback: 0 }) },
        { label: `brains=f:${M}`, runs: mk(model, { policy: 0, llm: 3, fallback: 1 }) },
      ],
    }),
  };
}

const row = (over: Partial<StudyRow>): StudyRow => ({
  hypothesis: 'H1', experimentId: 1, configHash: 'abc', arm: 'a', fundKey: 'f', seed: 1, totalReturnPct: 0, maxDrawdownPct: 0, sharpe: null,
  survived: true, fallbackRate: null, costUsd: 0, decisions: 0, behaviour: { actionEntropy: null, riskCompliance: null, repeatedErrorRate: null, shockDeRisk: null, tradeRate: null },
  ...over,
});

describe('studyRows', () => {
  it('skips non-study and malformed experiments', () => {
    const good = exp(1, 'study:H1:a', [0, 0], [0.1, 0.1]);
    const rows = studyRows([good, exp(2, 'lab:other', [0], [0.1]), { ...exp(3, 'study:H1:b', [0], [0.1]), resultJson: '{bad' }, { ...exp(4, 'study:H1:c', [0], [0.1]), specJson: null }]);
    expect(new Set(rows.map((r) => r.experimentId))).toEqual(new Set([1]));
    expect(rows).toHaveLength(4); // 2 arms x 2 seeds, subject fund only
    const m = rows.find((r) => r.arm.includes(M))!;
    expect(m.fallbackRate).toBeCloseTo(0.25);
    expect(m.totalReturnPct).toBeCloseTo(10);
    expect(m.behaviour.tradeRate).toBeNull();
    expect(m.configHash).toMatch(/^[0-9a-f]{8}$/);
  });
  it('prefers stored full-resolution metrics and behaviour over the downsampled navs', () => {
    const e = exp(1, 'study:H1:a', [0], [0.1]);
    const res = JSON.parse(e.resultJson);
    const beh = { actionEntropy: 0.5, riskCompliance: 1, repeatedErrorRate: 0, shockDeRisk: null, tradeRate: 0.2 };
    res.runs[0].runs[0].metrics = { f: { totalReturnPct: 42, maxDrawdownPct: 7, sharpe: 1.5 } };
    res.runs[0].runs[0].behaviour = { f: beh };
    const [r] = studyRows([{ ...e, resultJson: JSON.stringify(res) }]);
    expect(r).toMatchObject({ totalReturnPct: 42, maxDrawdownPct: 7, sharpe: 1.5, behaviour: beh });
  });
});

describe('pairedContrasts', () => {
  it('pools pairs across seed-block experiments', () => {
    const rows = studyRows([exp(1, 'study:H1:a', [0, 0, 0, 0, 0], [0.1, 0.1, 0.1, 0.1, 0.1], 1), exp(2, 'study:H1:b', [0, 0, 0, 0, 0], [0.2, 0.2, 0.2, 0.2, 0.2], 6)]);
    const [c] = pairedContrasts(rows, 'H1', 'brains=policy');
    expect(c.n).toBe(10);
    expect(c.meanDiff).toBeCloseTo(15);
  });

  it('applies Holm across arms', () => {
    // 10 pairs: 10/10, 9/10 and 8/10 wins give distinct sign-test p-values.
    const rows: StudyRow[] = [];
    for (let s = 1; s <= 10; s++) {
      rows.push(row({ arm: 'base', seed: s }));
      [10, 9, 8].forEach((wins, i) => rows.push(row({ arm: `arm${i}`, seed: s, totalReturnPct: s <= wins ? 1 : -1 })));
    }
    const out = pairedContrasts(rows, 'H1', 'base');
    const expected = holm(out.map((c) => c.pSign));
    out.forEach((c, i) => expect(c.pHolm).toBeCloseTo(expected[i], 12));
    expect(out[0].pHolm).toBeCloseTo((2 / 1024) * 3, 10);
    expect(out[2].pHolm).toBeGreaterThanOrEqual(out[2].pSign);
  });
});

describe('formatters', () => {
  const contrasts: Contrast[] = [
    { arm: 'a & b <x>', n: 10, meanDiff: 1.5, ci: [0.5, 2.5], pSign: 0.03, pHolm: 0.09 },
    { arm: 'c', n: 10, meanDiff: -1, ci: [-2, 0.2], pSign: 0.5, pHolm: 0.5 },
  ];

  it('toCsv escapes commas and quotes', () => {
    const csv = toCsv([row({ arm: 'x,"y"' })]);
    const [head, line] = csv.split('\n');
    expect(head).toContain('behaviour_tradeRate');
    expect(line).toContain('"x,""y"""');
  });

  it('texTable starts with the provenance tag and escapes & and %', () => {
    const tex = texTable(contrasts, '50% of A & B', 'tab:x', 'exp=1 cfg=abc');
    expect(tex.split('\n')[0]).toBe('% exp=1 cfg=abc');
    expect(tex).toContain('\\toprule');
    expect(tex).toContain('a \\& b <x>');
    expect(tex).toContain('50\\% of A \\& B');
    expect(tex).toContain('0.0900');
  });

  it('svgForest is well-formed and contains one circle per arm', () => {
    const svg = svgForest(contrasts, 'T & U', 'exp=1 cfg=abc');
    expect(svg.startsWith('<!-- exp=1 cfg=abc -->')).toBe(true);
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg).toContain('height="160"');
    expect(svg).toContain('a &amp; b &lt;x&gt;');
    expect(svgForest(contrasts, 'T & U', 'exp=1 cfg=abc')).toBe(svg);
  });
});

describe('texTable edge cases', () => {
  it('prints a dash instead of a degenerate CI when n < 2, and escapes ^ and ~', () => {
    const tex = texTable([{ arm: 'a^b~c', n: 1, meanDiff: 1, ci: [1, 1], pSign: 1, pHolm: 1 }], 'c', 'l', 't');
    expect(tex).toContain('—');
    expect(tex).not.toContain('[1.00, 1.00]');
    expect(tex).toContain('a\\textasciicircum{}b\\textasciitilde{}c');
  });
});

describe('buildPaperFiles', () => {
  it('emits csv, a table and forest per hypothesis, returns figure for H1 only, all tagged', () => {
    const files = buildPaperFiles([exp(1, 'study:H1:a', [0, 0, 0], [0.1, 0.1, 0.1]), exp(2, 'study:H3:a', [0, 0, 0], [0.2, 0.2, 0.2])]);
    expect(files.map((f) => f.path)).toEqual([
      'paper/data/study.csv', 'paper/tables/H1.tex', 'paper/figures/H1-forest.svg', 'paper/figures/H1-returns.svg', 'paper/tables/H3.tex', 'paper/figures/H3-forest.svg',
    ]);
    expect(files[1].content.split('\n')[0]).toMatch(/^% exp=1 cfg=[0-9a-f]{8}$/);
    expect(files[5].content.split('\n')[0]).toMatch(/^<!-- exp=2 cfg=[0-9a-f]{8} -->$/);
    expect(files[3].content.match(/<polyline /g)).toHaveLength(2);
  });
});
