# FEATURE-004 · Server-authoritative liquidation + shareable result cards
Status: shipped (code complete; live-DB E2E blocked on WSL/Docker)

## Scope
In:
- Server-side force-liquidation of player funds that breach margin, during the world tick loop (not client-triggered — tab-close cannot dodge it)
- `LiquidationLog` persistence with cause-of-death + optional rival-context line
- Rival-context derivation: replay recent `RivalDecisionLog` through `detectConfrontation` to surface "liquidated shortly after APEX went short <TKR>" narratives
- All-time-high `Fund.peakNav` tracking (tick loop + post-trade hook)
- `GET /funds/:id/result-card` (public JSON) + `GET /funds/:id/result-card.png` (public 1200×630 PNG via `@vercel/og`)
- SHARE button on `LiquidationScreen` (green, copies card URL) and a new always-accessible `FundSummaryPanel` sidebar

Out (explicitly not in this phase):
- Opaque share tokens / private cards (card URLs are guessable but aggregate-only — see D-013)
- NAV-based liquidation threshold (engine exposes margin-based `checkLiquidation` only)
- Custom bundled font for the PNG (satori default used; TTF-load path documented)
- Result-card image for a fund mid-session beyond the JSON (the PNG endpoint covers this, but no OG meta-tag injection into a shareable HTML page yet)

## Plan
- [x] Schema: `Fund.liquidated`, `Fund.peakNav`, `LiquidationLog` model, `Room.liquidations` relation; `prisma generate`
- [x] `server/world.ts`: `liquidatePlayerFunds`, `computeRivalContext`, `trackPeakNav`, `engineFundFromRows` helper; call site in `tickWorld` after `w.market = next`
- [x] `server/rooms.ts`: `/state` returns `me.liquidated`/`liquidationCause`/`liquidationRivalContext`; `updatePeakNav` post-trade hook
- [x] `server/resultCard.ts`: `buildResultCard` + JSON route + PNG route (`React.createElement` + `ImageResponse`)
- [x] `server/index.ts`: mount `resultCardRouter` at `/funds`
- [x] `package.json`: add `@vercel/og` + `react`
- [x] Client: store fields, stateMapper mapping, `LiquidationScreen` rival line + SHARE, `FundSummaryPanel`, `Terminal` sidebar mount
- [x] Docs: HANDOVER, FLOW, ARCHITECTURE, DECISIONS (D-012/D-013), TEST_CHECKLIST, this file

## Decisions
- D-012 (server-authoritative liquidation, rival context via shared detector)
- D-013 (public result-card endpoints, `@vercel/og` over `node-canvas`)

## Verification
Static (done): `npx tsc --noEmit` (root+server) PASS; `npm test` 84/84; `npm run lint` PASS; `npm run build` ✓ 1.53s; `npx prisma generate` ✓.
Live (blocked on WSL/Docker): crowd a short to breach margin with the tab closed → server force-closes + logs; hit both result-card endpoints; SHARE copies the URL. Full list in TEST_CHECKLIST.md → "Phase 3 — server-authoritative liquidation + result cards".
