import { describe, expect, it } from 'vitest';
import { projectState } from './stateMapper';
import type { ProjectionPrev } from './stateMapper';
import type { Ticker } from '@black-sheep/engine/types';
import { createInitialMarket } from '@black-sheep/engine/market';
import { buildWorldStatePayload, type EventInput, type FundInput } from '../../server/worldCore';
import { STARTING_CAPITAL } from '../../config/game';

const TICKERS = ['NOVA', 'TITAN', 'ORBL', 'HELX', 'APXB', 'PULSE'] as const;

function fund(id: number, overrides: Partial<FundInput> = {}): FundInput {
  return {
    id,
    name: `FUND ${id}`,
    cash: STARTING_CAPITAL,
    startingCapital: STARTING_CAPITAL,
    peakNav: STARTING_CAPITAL,
    liquidated: false,
    liquidationCause: null,
    thinking: false,
    openPositions: [],
    lastDecision: null,
    ...overrides,
  };
}

/** A real server payload, built by the same function GET /world/state uses. */
function payload(funds: FundInput[], events: EventInput[] = []) {
  const market = createInitialMarket();
  market.tickCount = 10;
  return buildWorldStatePayload({ name: 'live', seed: 1 }, market, funds, events);
}

function seededPrev(): ProjectionPrev {
  const priceHistory = {} as ProjectionPrev['priceHistory'];
  for (const t of TICKERS) priceHistory[t as Ticker] = [100];
  return { priceHistory, navHistory: [STARTING_CAPITAL], rivalDecisionKey: '' };
}

const EMPTY_PREV: ProjectionPrev = { priceHistory: {} as ProjectionPrev['priceHistory'], navHistory: [], rivalDecisionKey: '' };

describe('stateMapper (poll → terminal projection)', () => {
  it('projects prices, fund and NAV from the wire', () => {
    const p = projectState(payload([fund(1)]), seededPrev());
    expect(p.tickCount).toBe(10);
    expect(p.companies.NOVA.price).toBeGreaterThan(0);
    expect(p.nav).toBe(STARTING_CAPITAL);
    expect(p.priceHistory.NOVA).toHaveLength(2);
    expect(p.rivalFund.personality).toBe('contrarian');
    expect(p.rivalFund.lastDecision).toBeNull();
  });

  it('maps market events into the news feed with tick timestamps', () => {
    const p = projectState(
      payload(
        [fund(1)],
        [
          {
            id: 9,
            type: 'company',
            ticker: 'NOVA',
            headline: 'Nova breakthrough',
            priceImpactPercent: 4,
            tickCountAt: 8,
            timestamp: new Date(0),
          },
        ],
      ),
      seededPrev(),
    );
    expect(p.events).toHaveLength(1);
    expect(p.events[0].id).toBe('evt-9');
    expect(p.events[0].timestamp).toBe(8);
    expect(p.events[0].headline).toContain('breakthrough');
  });

  it('projects an empty world (no funds yet) without crashing', () => {
    const raw = buildWorldStatePayload({ name: 'live', seed: 1 }, createInitialMarket(), [], []);
    const p = projectState(raw, EMPTY_PREV);
    expect(p.fundId).toBeNull();
    expect(p.nav).toBe(STARTING_CAPITAL);
    expect(p.fund.positions).toEqual([]);
    expect(p.rivalFund.lastDecision).toBeNull();
  });

  it('surfaces a liquidated focus fund with its cause', () => {
    const p = projectState(
      payload([fund(1, { liquidated: true, liquidationCause: 'Excessive leverage' })]),
      seededPrev(),
    );
    expect(p.liquidated).toBe(true);
    expect(p.liquidationCause).toBe('Excessive leverage');
  });

  it('summarises every fund for the funds strip, in id order', () => {
    const p = projectState(
      payload([
        fund(7, { name: 'CROWN MERIDIAN', thinking: true }),
        fund(2, { name: 'STERLING & VALE', cash: 11_000_000 }),
        fund(4, { name: 'APEX CAPITAL', liquidated: true }),
      ]),
      seededPrev(),
    );
    expect(p.funds.map((f) => f.id)).toEqual([2, 4, 7]);
    expect(p.funds[0]).toMatchObject({ name: 'STERLING & VALE', personality: 'cautious', model: 'claude-opus-5-5' });
    expect(p.funds[0].pnlPct).toBeCloseTo(10, 6);
    expect(p.funds[1]).toMatchObject({ personality: null, model: null, liquidated: true });
    expect(p.funds[2].thinking).toBe(true);
  });

  it('carries spend vs budget and the last decision source into the strip', () => {
    const decision = {
      action: 'buy', ticker: 'NOVA', reasoning: 'r', confidence: 0.6, fillPrice: 100, realizedPnL: null,
      tickCountAt: 10, timestamp: new Date(0), source: 'llm', model: 'claude-opus-5-5',
    };
    const p = projectState(
      payload([fund(1, { name: 'CROWN MERIDIAN', spend: { todayUsd: 0.5, dailyBudgetUsd: 2 }, lastDecision: decision }), fund(2)]),
      seededPrev(),
    );
    expect(p.funds[0]).toMatchObject({ spendUsd: 0.5, budgetUsd: 2, lastSource: 'llm' });
    expect(p.funds[1]).toMatchObject({ spendUsd: null, budgetUsd: null, lastSource: null });
  });

  it('focuses the lowest-id registered fund over a legacy unregistered one', () => {
    const p = projectState(payload([fund(1, { name: 'APEX CAPITAL' }), fund(5, { name: 'HALDEN WHITMORE' })]), seededPrev());
    expect(p.fundId).toBe(5);
    expect(p.name).toBe('HALDEN WHITMORE');
  });

  it('focuses the lowest-id fund and maps its last decision', () => {
    const decision = {
      action: 'short',
      ticker: 'NOVA',
      reasoning: 'fade NOVA',
      confidence: 0.6,
      fillPrice: 100,
      realizedPnL: null,
      tickCountAt: 10,
      timestamp: new Date(0),
    };
    const p = projectState(
      payload([fund(9), fund(3, { lastDecision: decision, thinking: true })]),
      seededPrev(),
    );
    expect(p.fundId).toBe(3);
    expect(p.rivalFund.lastDecision?.reasoning).toBe('fade NOVA');
    expect(p.rivalThinking).toBe(true);
  });
});
