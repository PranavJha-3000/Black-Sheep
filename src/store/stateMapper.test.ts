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
      liquidationRivalContext: null,
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
    rivalHistory: [10_000_000],
    contested: [],
    confrontation: null,
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
    expect(p.rivalHistory).toHaveLength(2);
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
  it('fires an opposite confrontation once, then clears the marker on exit', () => {
    const price = seedCompanies().NOVA.price;
    const qty = Math.floor(8_000_000 / price);
    const decision: ApiRoomState['rival']['lastDecision'] = {
      action: 'short',
      ticker: 'NOVA',
      reasoning: 'Crowded long on NOVA; fading the move.',
      confidence: 0.8,
      fillPrice: price,
      realizedPnL: null,
      tickCountAt: 10,
      at: 'd1',
    };
    const p1 = projectState(wire({ longNovaShares: qty, decision }), blankPrev());
    expect(p1.confrontation?.kind).toBe('opposite');
    expect(p1.contested).toContain('NOVA');
    const p2 = projectState(wire({ longNovaShares: qty, decision }), {
      priceHistory: p1.priceHistory,
      navHistory: p1.navHistory,
      rivalHistory: p1.rivalHistory,
      contested: p1.contested,
      confrontation: null,
      rivalDecisionKey: p1.rivalDecisionKey,
    });
    expect(p2.confrontation).toBeNull();
    expect(p2.contested).toContain('NOVA');
    const p3 = projectState(wire({ longNovaShares: 0, decision }), {
      priceHistory: p2.priceHistory,
      navHistory: p2.navHistory,
      rivalHistory: p2.rivalHistory,
      contested: p2.contested,
      confrontation: null,
      rivalDecisionKey: p2.rivalDecisionKey,
    });
    expect(p3.contested).not.toContain('NOVA');
  });

  it('lets a rival_win escalate on an already-contested ticker', () => {
    const price = seedCompanies().NOVA.price;
    const qty = Math.floor(2_000_000 / price);
    const open: ApiRoomState['rival']['lastDecision'] = {
      action: 'short',
      ticker: 'NOVA',
      reasoning: 'Fading.',
      confidence: 0.7,
      fillPrice: price,
      realizedPnL: null,
      tickCountAt: 10,
      at: 'd1',
    };
    const p1 = projectState(wire({ longNovaShares: qty, decision: open }), blankPrev());
    expect(p1.contested).toContain('NOVA');
    const win: ApiRoomState['rival']['lastDecision'] = {
      action: 'close',
      ticker: 'NOVA',
      reasoning: 'Banked it against the crowd.',
      confidence: 0.9,
      fillPrice: 50,
      realizedPnL: 250_000,
      tickCountAt: 20,
      at: 'd2',
    };
    const uw = wire({ longNovaShares: qty, decision: win, tick: 20 });
    const nova = uw.market.companies.NOVA as Company;
    uw.market.companies.NOVA = { ...nova, price: nova.price * 0.9 } as Company;
    const p2 = projectState(uw, {
      priceHistory: p1.priceHistory,
      navHistory: p1.navHistory,
      rivalHistory: p1.rivalHistory,
      contested: p1.contested,
      confrontation: null,
      rivalDecisionKey: p1.rivalDecisionKey,
    });
    expect(p2.confrontation?.kind).toBe('rival_win');
  });

  it('never banners a rejected (unexecuted) rival decision', () => {
    const price = seedCompanies().NOVA.price;
    const qty = Math.floor(8_000_000 / price);
    const rejected: ApiRoomState['rival']['lastDecision'] = {
      action: 'short',
      ticker: 'NOVA',
      reasoning: 'Would fade, but no capital.',
      confidence: 0.6,
      fillPrice: null,
      realizedPnL: null,
      tickCountAt: 10,
      at: 'd9',
    };
    const p = projectState(wire({ longNovaShares: qty, decision: rejected }), blankPrev());
    expect(p.confrontation).toBeNull();
    expect(p.contested).not.toContain('NOVA');
  });
});
