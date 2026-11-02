import { describe, expect, it } from 'vitest';
import { FUND_TOOLS, parseSubmittedDecision, runFundTool, SUBMIT_DECISION } from './fundTools';
import { getFundProfile } from './funds';
import { createInitialMarket } from './market';
import { openPosition } from './portfolio';
import { buildDecisionInput, createRivalFund, type RivalDecisionInput } from './rival';
import type { MarketEvent } from './types';

const PROFILE = getFundProfile('crown-meridian')!;

function input(withPosition = false, events: MarketEvent[] = []): RivalDecisionInput {
  const m = createInitialMarket();
  m.tickCount = 20;
  m.timestamp = 20;
  let fund = createRivalFund(10_000_000, 'quant');
  if (withPosition) fund = { ...fund, ...openPosition(fund, 'NOVA', 'long', 1_000_000, m.companies.NOVA.price) };
  return buildDecisionInput(fund, m, events, []);
}

describe('recall_memory tool', () => {
  it('returns the fund own memories newest first, filtered, and an empty list without memory', () => {
    const memory = [
      { kind: 'episodic' as const, tickCountAt: 1, subject: 'NOVA', content: 'a', importance: 0.5, outcomeUsd: null },
      { kind: 'relationship' as const, tickCountAt: 2, subject: 'HALDEN WHITMORE', content: 'b', importance: 0.6, outcomeUsd: null },
      { kind: 'episodic' as const, tickCountAt: 3, subject: 'NOVA', content: 'c', importance: 0.5, outcomeUsd: null },
    ];
    const r = runFundTool('recall_memory', { subject: 'NOVA' }, { ...input(), memory }, PROFILE);
    expect(r).toEqual({ ok: true, output: [memory[2], memory[0]] });
    const k = runFundTool('recall_memory', { kind: 'relationship' }, { ...input(), memory }, PROFILE);
    expect(k.output).toEqual([memory[1]]);
    expect(runFundTool('recall_memory', {}, input(), PROFILE)).toEqual({ ok: true, output: [] });
  });

  it('rejects an unknown kind', () => {
    expect(runFundTool('recall_memory', { kind: 'secrets' }, input(), PROFILE).ok).toBe(false);
  });
});

describe('fund tools', () => {
  it('declares strict schemas for every tool, including the terminal submit_decision', () => {
    const names = FUND_TOOLS.map((t) => t.name);
    expect(names).toEqual(['inspect_company', 'inspect_portfolio', 'calculate_risk', 'recent_events', 'recall_memory', SUBMIT_DECISION]);
    for (const t of FUND_TOOLS) {
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.additionalProperties).toBe(false);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it('inspect_company returns fundamentals, flow, peers and that ticker’s events', () => {
    const ev: MarketEvent = { id: 'e', type: 'company', ticker: 'HELX', headline: 'trial', priceImpactPercent: 4, timestamp: 19 };
    const r = runFundTool('inspect_company', { ticker: 'HELX' }, input(false, [ev]), PROFILE);
    expect(r.ok).toBe(true);
    const out = r.output as { ticker: string; sector: string; peers: string[]; events: unknown[]; volatility: number };
    expect(out.ticker).toBe('HELX');
    expect(out.peers).toContain('CURA');
    expect(out.events).toHaveLength(1);
    expect(out.volatility).toBeGreaterThan(0);
  });

  it('inspect_company rejects an unknown ticker', () => {
    expect(runFundTool('inspect_company', { ticker: 'ZZZ' }, input(), PROFILE).ok).toBe(false);
    expect(runFundTool('inspect_company', {}, input(), PROFILE).ok).toBe(false);
  });

  it('inspect_portfolio shows only the fund’s own book with marked P&L', () => {
    const r = runFundTool('inspect_portfolio', {}, input(true), PROFILE);
    const out = r.output as { cash: number; positions: { ticker: string; pnl: number }[] };
    expect(r.ok).toBe(true);
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0].ticker).toBe('NOVA');
    expect(JSON.stringify(out)).not.toMatch(/fundId|otherFunds/);
  });

  it('calculate_risk reports NAV, exposure and the largest allowed new position', () => {
    const out = runFundTool('calculate_risk', {}, input(true), PROFILE).output as {
      nav: number; grossExposure: number; maxNewPositionDollars: number;
    };
    expect(out.nav).toBeCloseTo(10_000_000, 0);
    expect(out.grossExposure).toBeCloseTo(1_000_000, 0);
    expect(out.maxNewPositionDollars).toBeLessThanOrEqual(out.nav * PROFILE.maxPositionFraction);
    expect(out.maxNewPositionDollars).toBeGreaterThan(0);
  });

  it('recent_events filters by ticker when asked', () => {
    const evs: MarketEvent[] = [
      { id: 'a', type: 'company', ticker: 'NOVA', headline: 'x', priceImpactPercent: 1, timestamp: 1 },
      { id: 'b', type: 'macro', headline: 'y', priceImpactPercent: -1, timestamp: 2 },
    ];
    expect((runFundTool('recent_events', {}, input(false, evs), PROFILE).output as unknown[]).length).toBe(2);
    expect((runFundTool('recent_events', { ticker: 'NOVA' }, input(false, evs), PROFILE).output as unknown[]).length).toBe(1);
  });

  it('an unknown tool fails without throwing', () => {
    const r = runFundTool('drop_database', {}, input(), PROFILE);
    expect(r.ok).toBe(false);
  });

  describe('parseSubmittedDecision', () => {
    it('accepts a well-formed decision and clamps confidence', () => {
      expect(parseSubmittedDecision({ action: 'buy', ticker: 'NOVA', dollarAmount: 500_000.7, reasoning: 'r', confidence: 3 })).toEqual({
        action: 'buy', ticker: 'NOVA', dollarAmount: 500_000, reasoning: 'r', confidence: 1,
      });
    });

    it('rejects bad shapes', () => {
      expect(parseSubmittedDecision(null)).toBeNull();
      expect(parseSubmittedDecision({ action: 'yolo', reasoning: 'r', confidence: 0.5 })).toBeNull();
      expect(parseSubmittedDecision({ action: 'hold', confidence: 0.5 })).toBeNull();
      expect(parseSubmittedDecision({ action: 'hold', reasoning: 'r', confidence: 'high' })).toBeNull();
    });
  });
});
