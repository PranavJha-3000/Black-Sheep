/*
 * Black Sheep — model registry (VISION §12).
 *
 * Every model a fund may be assigned, with the per-token pricing Stage 4's
 * cost meter multiplies usage by. Literal-only and dependency-free, like
 * config/game.ts, so the pure engine can import it.
 *
 * Prices are USD per million tokens, from the Claude API reference
 * (2026-11). Update them here when the provider's price sheet changes.
 */

export const MODEL_REGISTRY = {
  'claude-opus-5-5': {
    provider: 'anthropic',
    displayName: 'Claude Opus 5.5',
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    /** Opus 5.5 always thinks; effort bounds how much (output_config.effort). */
    effort: 'low',
  },
  'claude-sonnet-5-5': {
    provider: 'anthropic',
    displayName: 'Claude Sonnet 5.5',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    effort: 'low',
  },
  'claude-haiku-5-5': {
    provider: 'anthropic',
    displayName: 'Claude Haiku 5.5',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    effort: 'low',
  },
} as const;

export type ModelId = keyof typeof MODEL_REGISTRY;

/** Model every registered fund uses unless its registry entry names another. */
export const DEFAULT_FUND_MODEL: ModelId = 'claude-opus-5-5';
