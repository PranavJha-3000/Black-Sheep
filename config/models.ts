/*
 * Black Sheep — model registry (VISION §12).
 *
 * Every model a fund may be assigned, with the per-token pricing Stage 4's
 * cost meter multiplies usage by. Literal-only and dependency-free, like
 * config/game.ts, so the pure engine can import it.
 *
 * Prices are USD per million tokens. Anthropic entries: the Claude API
 * reference (2026-11). OpenRouter entries (Research Lab only, never the live
 * world): OpenRouter's /api/v1/models, confirmed 2026-11-10. Update them here
 * when the provider's price sheet changes.
 */

export const MODEL_REGISTRY = {
  'claude-opus-5-5': {
    provider: 'anthropic',
    displayName: 'Claude Opus 5.5',
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    /** Cache reads bill at this fraction of the input price (Opus 5.5: 0.05x). */
    cacheReadMultiplier: 0.05,
    /** 5-minute cache writes bill at this multiple of the input price. */
    cacheWriteMultiplier: 1.25,
    /** Opus 5.5 always thinks; effort bounds how much (output_config.effort). */
    effort: 'low',
  },
  'claude-sonnet-5-5': {
    provider: 'anthropic',
    displayName: 'Claude Sonnet 5.5',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    effort: 'low',
  },
  'claude-haiku-5-5': {
    provider: 'anthropic',
    displayName: 'Claude Haiku 5.5',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    effort: 'low',
  },
  // OpenRouter (OpenAI-compatible): no prompt caching is metered, and effort is not sent by that adapter.
  'openai/gpt-6.1-terra-pro': {
    provider: 'openrouter',
    displayName: 'GPT-6.1 Terra Pro',
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 5,
    cacheReadMultiplier: 1,
    cacheWriteMultiplier: 1,
    effort: 'low',
  },
  'google/gemini-3.8-flash': {
    provider: 'openrouter',
    displayName: 'Gemini 3.8 Flash',
    inputUsdPerMTok: 0.83,
    outputUsdPerMTok: 4.13,
    cacheReadMultiplier: 1,
    cacheWriteMultiplier: 1,
    effort: 'low',
  },
  'x-ai/grok-4.7': {
    provider: 'openrouter',
    displayName: 'Grok 4.7',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 6,
    cacheReadMultiplier: 1,
    cacheWriteMultiplier: 1,
    effort: 'low',
  },
} as const;

export type ModelId = keyof typeof MODEL_REGISTRY;
export type ModelProvider = (typeof MODEL_REGISTRY)[ModelId]['provider'];
/** Models the live world may use: Anthropic only (cross-vendor brains are Lab-only). */
export type AnthropicModelId = { [K in ModelId]: (typeof MODEL_REGISTRY)[K]['provider'] extends 'anthropic' ? K : never }[ModelId];

/** Model every registered fund uses unless its registry entry names another. */
export const DEFAULT_FUND_MODEL: AnthropicModelId = 'claude-opus-5-5';
