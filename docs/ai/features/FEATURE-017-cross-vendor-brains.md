# FEATURE-017 · Stage 10 research study, Phase 5: cross-vendor brains
Status: built on branch `feat/stage10-research-study` (unmerged); NOT VERIFIED against a real provider (Gate G5 open: needs `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY`)

## Scope
In:
- `config/models.ts`: `provider` field and three OpenRouter models (`openai/gpt-6.1-terra-pro`, `google/gemini-3.8-flash`, `x-ai/grok-4.7`); `AnthropicModelId` keeps the live world Anthropic-only
- `server/providers/openaiCompat.ts`: fetch-based OpenAI-compatible decision loop, same `LoopResult` contract
- `labBrain` routes by provider with the same budget reserve and settle; `configuredProviders(env)` and the two provider-key errors

Out:
- Cross-vendor models in the live world
- Cross-vendor arms in the pre-registered H1 study (H1 stays Anthropic-only; `PREREGISTRATION.md` not amended)
- Reasoning/effort parity across vendors

## Plan
- [x] Tasks 8-9: provider loop, model config, routing, provider keys
- [x] Task 10: docs and handover

## Decisions
D-046 (routing, live world stays Anthropic, comparability limits), D-047 (pricing source and refresh rule)

## Verification
`npm test` (count in the Task 10 report); unit tests for the loop and routing.
Not verified: any real OpenRouter or Anthropic call (G5); that OpenRouter serves the requested model without a variant.
