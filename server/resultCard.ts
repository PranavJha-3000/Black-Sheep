import { Router } from 'express';
import { ImageResponse } from '@vercel/og';
import React from 'react';
import { markToMarket } from '@black-sheep/engine/portfolio';
import type { Direction } from '@black-sheep/engine/types';
import { prisma } from './db';
import { ensureWorld } from './world';

/**
 * Result-card endpoints — the cheapest legitimate distribution mechanic.
 *
 * GET /funds/:id/result-card       → JSON payload for rendering/sharing
 * GET /funds/:id/result-card.png   → 1200×630 PNG (OG/social-share ratio)
 *
 * Both are PUBLIC (no auth) by design: the link IS the share. The payload
 * exposes only aggregate stats (NAV, peak, cause) — never positions or cash,
 * so the information firewall holds even for unauthenticated viewers.
 */

export const resultCardRouter = Router();

/** Compute the result-card payload for any fund (liquidated or alive). */
async function buildResultCard(fundId: number) {
  const fund = await prisma.fund.findUnique({ where: { id: fundId } });
  if (!fund) return null;

  const w = await ensureWorld(fund.roomId);

  // Current NAV from live market.
  const open = await prisma.position.findMany({ where: { fundId, closedAt: null } });
  const ef = {
    cash: fund.cash,
    positions: open.map((p) => ({
      id: `db-${p.id}`,
      ticker: p.ticker,
      direction: (p.direction === 'short' ? 'short' : 'long') as Direction,
      quantity: p.quantity,
      entryPrice: p.entryPrice,
      entryTimestamp: p.entryTimestamp.getTime(),
      marginReserved: p.direction === 'short' ? 0.5 * p.quantity * p.entryPrice : 0,
    })),
    realizedPnL: 0,
    startingCapital: fund.startingCapital,
    history: [],
  };
  const nav = markToMarket(ef, w.market).nav;

  // Liquidation data (if any).
  const liquidation = await prisma.liquidationLog.findFirst({
    where: { fundId },
    orderBy: { timestamp: 'desc' },
  });

  // Best single trade: highest PnL across all closed positions.
  const closed = await prisma.position.findMany({ where: { fundId, closedAt: { not: null } } });
  let bestSingleTrade = 0;
  for (const p of closed) {
    if (p.exitPrice === null) continue;
    const raw = (p.exitPrice - p.entryPrice) * p.quantity;
    const pnl = p.direction === 'long' ? raw : -raw;
    if (pnl > bestSingleTrade) bestSingleTrade = pnl;
  }

  const peakNav = fund.peakNav > 0 ? fund.peakNav : fund.startingCapital;

  return {
    fundId: fund.id,
    name: fund.name,
    startingCapital: fund.startingCapital,
    peakNav,
    finalNav: liquidation ? liquidation.finalNav : nav,
    cause: liquidation ? liquidation.cause : 'Still trading',
    rivalContext: liquidation ? liquidation.rivalContext : null,
    durationTicks: liquidation ? liquidation.durationTicks : w.market.tickCount,
    bestSingleTrade,
    liquidated: fund.liquidated,
    generatedAt: Date.now(),
  };
}

/** Format a dollar amount for the result card (e.g. "$10.0M", "-$250K"). */
function fmtResultCard(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1_000_000) s = `$${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) s = `$${(abs / 1_000).toFixed(0)}K`;
  else s = `$${abs.toFixed(0)}`;

  return neg ? `-${s}` : s;
}

// ---------------------------------------------------------------------------
// GET /funds/:id/result-card — JSON payload
// ---------------------------------------------------------------------------
resultCardRouter.get('/:id/result-card', async (req, res) => {
  const fundId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(fundId) || fundId <= 0) {
    res.status(400).json({ error: 'Invalid fund id.' });
    return;
  }
  const card = await buildResultCard(fundId);
  if (!card) {
    res.status(404).json({ error: 'Fund not found.' });
    return;
  }
  res.json(card);
});

// ---------------------------------------------------------------------------
// GET /funds/:id/result-card.png — 1200×630 shareable image
// ---------------------------------------------------------------------------
resultCardRouter.get('/:id/result-card.png', async (req, res) => {
  const fundId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(fundId) || fundId <= 0) {
    res.status(400).json({ error: 'Invalid fund id.' });
    return;
  }
  const card = await buildResultCard(fundId);
  if (!card) {
    res.status(404).json({ error: 'Fund not found.' });
    return;
  }

  const pnl = card.finalNav - card.startingCapital;
  const pnlPct = (pnl / card.startingCapital) * 100;
  const isUp = pnl >= 0;

  const image = new ImageResponse(
    React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#0a0a0a',
        padding: '48px',
        fontFamily: 'monospace',
        color: '#e0e0e0',
      },
    }, [
      // Header
      React.createElement('div', {
        key: 'header',
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      }, [
        React.createElement('span', { key: 'logo', style: { fontSize: '20px', letterSpacing: '3px', color: '#555555' } }, 'BLACK SHEEP'),
        React.createElement('span', {
          key: 'status',
          style: { fontSize: '16px', letterSpacing: '2px', color: card.liquidated ? '#ff3131' : '#00ff41' },
        }, card.liquidated ? 'FUND LIQUIDATED' : 'FUND SNAPSHOT'),
      ]),
      // Fund name
      React.createElement('div', { key: 'name', style: { fontSize: '32px', fontWeight: 'bold', marginTop: '24px' } }, card.name),
      // Stats row
      React.createElement('div', {
        key: 'stats',
        style: { display: 'flex', gap: '48px', marginTop: '32px' },
      }, [
        statBlock('STARTING CAPITAL', fmtResultCard(card.startingCapital), '#e0e0e0'),
        statBlock('PEAK NAV', fmtResultCard(card.peakNav), '#00ff41'),
        statBlock(card.liquidated ? 'FINAL NAV' : 'CURRENT NAV', fmtResultCard(card.finalNav), isUp ? '#00ff41' : '#ff3131'),
      ]),
      // PnL headline
      React.createElement('div', {
        key: 'pnl',
        style: { fontSize: '48px', fontWeight: 'bold', marginTop: '24px', color: isUp ? '#00ff41' : '#ff3131' },
      }, `${isUp ? '+' : ''}${fmtResultCard(pnl)} (${isUp ? '+' : ''}${pnlPct.toFixed(1)}%)`),
      // Cause of death
      card.cause ? React.createElement('div', {
        key: 'cause',
        style: { fontSize: '18px', marginTop: '16px', color: '#ff9800', maxWidth: '900px' },
      }, card.liquidated ? `Cause: ${card.cause}` : card.cause) : null,
      // Rival context
      card.rivalContext ? React.createElement('div', {
        key: 'rival',
        style: { fontSize: '15px', marginTop: '8px', color: '#ff3131', maxWidth: '900px' },
      }, card.rivalContext) : null,
      // Footer
      React.createElement('div', {
        key: 'footer',
        style: {
          display: 'flex', gap: '32px', marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid #1a1a1a',
        },
      }, [
        statBlock('BEST SINGLE TRADE', `+${fmtResultCard(card.bestSingleTrade)}`, '#00ff41'),
        statBlock('DURATION', `${card.durationTicks} ticks`, '#e0e0e0'),
      ]),
    ]),
    { width: 1200, height: 630 },
  );

  const buffer = await image.arrayBuffer();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.send(Buffer.from(buffer));
});

/** Build a label+value stat block for the result card. */
function statBlock(label: string, value: string, color: string) {
  return React.createElement('div', { key: label }, [
    React.createElement('div', { key: 'l', style: { fontSize: '13px', color: '#555555', letterSpacing: '2px' } }, label),
    React.createElement('div', { key: 'v', style: { fontSize: '24px', marginTop: '4px', color } }, value),
  ]);
}
