import { describe, expect, it } from 'vitest';
import { projectState } from './stateMapper';
import type { ApiRoomState, ProjectionPrev } from './stateMapper';
import type { Company, Ticker } from '@black-sheep/engine/types';
import { createInitialMarket } from '@black-sheep/engine/market';

const TICKERS = ['NOVA', 'TITAN', 'ORBL', 'HELX', 'APXB', 'PULSE'] as const;

function seedCompanies(): Record<Ticker, Company> {
  const m = createInitialMarket();
  return m.companies as Record<Ticker, Company>;
}

/** Build a minimal wire state the mapper can project. */
function wire(over: {
  tick?: number;
  longNovaShares?: number;
  decision?: ApiRoomState['rival']['lastDecision'];
}): ApiRoomState {
  const companies = seedCompanies();
  const price = companies.NOVA.price;
  const qty = over.longNovaShares ?? 0;
  return {
    room: { code: 'ABC123', status: 'active', maxPlayers: 4, tickCount: over.tick ?? 10 },
    market: { timestamp: over.tick ?? 10, companies: companies as unknown as Record<string, Company> },
    funds: [
      { id: 1, name: 'YOU', userId: 7, nav: 10_000_000, netExposure: 0 },
      { id: 2, name: 'APEX CAPITAL', userId: null, nav: 10_000_000, netExposure: 0 },
    ],
    me: {
      fundId: 1,
      name: 'YOU',
      cash: 10_000_000 - qty * price,
      availCash: 10_000_000 - qty * price,
      nav: 10_000_000,
      startingCapital: 10_000_000,
      liquidated: false,
      liquidationCause: null,
      positions:
        qty > 0
          ? [
              {
                id: 'p1',
                ticker: 'NOVA',
                direction: 'long',
                quantity: qty,
                entryPrice: price,
                entryTimestamp: 1,
                marginReserved: 0,
                price,
                pnl: 0,
              },
            ]
          : [],
    },
    flow: { NOVA: 8_000_000 },
    rival: { name: 'APEX CAPITAL', thinking: false, lastDecision: over.decision ?? null },
    recentEvents: [],
  };
}

function blankPrev(): ProjectionPrev {
  const priceHistory = {} as ProjectionPrev['priceHistory'];
  for (const t of TICKERS) priceHistory[t] = [100];
  return {
    priceHistory,
    navHistory: [10_000_000],
    rivalDecisionKey: '',
  };
}

describe('stateMapper (poll → terminal projection)', () => {
  it('projects prices, fund, NAV, and rival NAV from the wire', () => {
    const p = projectState(wire({}), blankPrev());
    expect(p.tickCount).toBe(10);
    expect(p.companies.NOVA.price).toBeGreaterThan(0);
    expect(p.nav).toBeGreaterThan(0);
    expect(p.rivalNav).toBe(10_000_000);
    expect(p.priceHistory.NOVA).toHaveLength(2);
    expect(p.rivalFund.personality).toBe('contrarian');
    expect(p.rivalFund.lastDecision).toBeNull();
  });

  it('maps market events into the news feed with tick timestamps', () => {
    const base = wire({});
    base.recentEvents = [
      {
        id: 9,
        type: 'company',
        ticker: 'NOVA',
        headline: 'Nova breakthrough',
        priceImpactPercent: 4,
        tickCountAt: 8,
        at: 't',
      },
    ];
    const p = projectState(base, blankPrev());
    expect(p.events).toHaveLength(1);
    expect(p.events[0].id).toBe('evt-9');
    expect(p.events[0].timestamp).toBe(8);
    expect(p.events[0].headline).toContain('breakthrough');
  });
});
