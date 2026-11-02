/*
 * Black Sheep — fund registry (VISION §5, §6).
 *
 * The AI hedge funds that live in the world. A fund's identity — name,
 * mandate, strategy, model, risk limit and decision cadence — is
 * configuration, not code: adding a fund is adding an entry here.
 *
 * Literal-only and dependency-free (same rule as config/game.ts). The engine
 * wraps these entries in the typed FundProfile (packages/engine/src/funds.ts).
 *
 * `name` is the fund's identity in the world: the server matches registry
 * entries to Fund rows by name (unique per world), so renaming an entry starts
 * a new fund rather than relabelling an old one's track record.
 */

export const FUND_REGISTRY = [
  {
    key: 'sterling-vale',
    name: 'STERLING & VALE',
    personality: 'cautious',
    mandate: 'Preserve capital and compound steadily through value and macro discipline.',
    strategy:
      'Buys quality, low-volatility names on dips; takes profit early and cuts losers fast. Rarely shorts.',
    model: 'claude-opus-5-5',
    maxPositionFraction: 0.12,
    decisionEveryTicks: 10,
    dailyBudgetUsd: 2,
    decisionOffset: 0,
  },
  {
    key: 'halden-whitmore',
    name: 'HALDEN WHITMORE',
    personality: 'aggressive',
    mandate: 'Generate outsized returns by shorting broken stories and overextended rallies.',
    strategy:
      'Event-driven short seller: hits names after negative news and fades parabolic moves; sizes up on conviction.',
    model: 'claude-opus-5-5',
    maxPositionFraction: 0.2,
    decisionEveryTicks: 10,
    dailyBudgetUsd: 2,
    decisionOffset: 3,
  },
  {
    key: 'crown-meridian',
    name: 'CROWN MERIDIAN',
    personality: 'quant',
    mandate: 'Harvest systematic edge from order flow without narrative bias.',
    strategy:
      'Systematic flow-momentum: follows the strongest net flow relative to liquidity and exits when flow reverses.',
    model: 'claude-opus-5-5',
    maxPositionFraction: 0.15,
    decisionEveryTicks: 10,
    dailyBudgetUsd: 2,
    decisionOffset: 6,
  },
] as const;
