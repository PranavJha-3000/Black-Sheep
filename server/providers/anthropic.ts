import Anthropic from '@anthropic-ai/sdk';
import { FUND_TOOLS, parseSubmittedDecision, SUBMIT_DECISION, type ToolResult } from '@black-sheep/engine/fundTools';
import { parseDecisionText } from '@black-sheep/engine/rivalLLM';
import type { RivalDecision } from '@black-sheep/engine/rival';
import { costOfUsage } from '../budget';

/**
 * The Anthropic provider adapter (VISION §14: server-side provider adapters).
 *
 * The only place a fund's brain talks to a model. It runs a bounded manual
 * tool loop: the model researches with read-only tools (routed to the pure
 * engine handlers via `runTool`) and finishes by calling submit_decision.
 * Every exit — decision, refusal, max_tokens, round cap, SDK error — returns
 * a LoopResult with summed usage and cost; the caller falls back to the
 * fund's policy whenever `decision` is null. Never throws.
 *
 * `create` is injected so the loop is unit-testable without a network.
 */

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResultParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export type CreateMessage = (params: CreateParams) => Promise<Message>;

/** Server-side refusal fallback, `fallbacks: "default"` form (Claude API reference). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface DecisionRequest {
  model: string;
  effort: 'low' | 'medium' | 'high';
  system: string;
  user: string;
  maxRounds: number;
  maxTokens: number;
  runTool: (name: string, args: unknown) => ToolResult;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  latencyMs: number;
}

export type LoopOutcome = 'decided' | 'refusal' | 'max_tokens' | 'round_cap' | 'no_decision' | 'error';

/** Usage summed across rounds (cache fields always present). */
export interface MeteredUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface LoopResult {
  outcome: LoopOutcome;
  decision: RivalDecision | null;
  usage: MeteredUsage;
  costUsd: number;
  /** Model that served the last round (differs from the request after a fallback). */
  servedBy: string | null;
  stopReason: string | null;
  rounds: number;
  toolCalls: ToolCallRecord[];
  latencyMs: number;
  error?: string;
}

/** The real SDK call. The client reads ANTHROPIC_API_KEY from the environment. */
export function anthropicCreate(apiKey: string): CreateMessage {
  const client = new Anthropic({ apiKey });
  return (params) => client.beta.messages.create(params);
}

const PROVIDER_TOOLS = FUND_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

export async function runDecisionLoop(create: CreateMessage, req: DecisionRequest): Promise<LoopResult> {
  const started = Date.now();
  const usage: MeteredUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const toolCalls: ToolCallRecord[] = [];
  const messages: MessageParam[] = [{ role: 'user', content: req.user }];
  let costUsd = 0;
  let servedBy: string | null = null;
  let stopReason: string | null = null;
  let rounds = 0;

  const done = (outcome: LoopOutcome, decision: RivalDecision | null = null, error?: string): LoopResult => ({
    outcome, decision, usage, costUsd, servedBy, stopReason, rounds, toolCalls, latencyMs: Date.now() - started, ...(error ? { error } : {}),
  });

  while (rounds < req.maxRounds) {
    rounds++;
    let res: Message;
    try {
      res = await create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [...messages],
        tools: PROVIDER_TOOLS,
        output_config: { effort: req.effort },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      });
    } catch (err) {
      return done('error', null, err instanceof Error ? err.message : String(err));
    }

    servedBy = res.model;
    stopReason = res.stop_reason;
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    usage.cache_read_input_tokens += res.usage.cache_read_input_tokens ?? 0;
    usage.cache_creation_input_tokens += res.usage.cache_creation_input_tokens ?? 0;
    costUsd += costOfUsage(res.model, res.usage);

    if (res.stop_reason === 'refusal') return done('refusal');

    const toolUses = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
    const submitted = toolUses.find((b) => b.name === SUBMIT_DECISION);
    const decision = submitted ? parseSubmittedDecision(submitted.input) : null;
    if (decision) return done('decided', decision);

    if (toolUses.length === 0) {
      const textBlock = res.content.find((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text');
      const fromText = textBlock ? parseDecisionText(textBlock.text) : null;
      if (fromText) return done('decided', fromText);
      return done(res.stop_reason === 'max_tokens' ? 'max_tokens' : 'no_decision');
    }

    // Out of rounds: research the model asked for could never be reported back.
    if (rounds === req.maxRounds) break;

    // Echo the full assistant turn (thinking blocks included) and answer every tool call.
    messages.push({ role: 'assistant', content: res.content });
    const results: (ToolResultParam | { type: 'text'; text: string })[] = toolUses.map((b) => {
      if (b.name === SUBMIT_DECISION) {
        return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'Malformed decision: action must be buy|short|close|hold with reasoning and a numeric confidence.' };
      }
      const t0 = Date.now();
      const r = req.runTool(b.name, b.input);
      toolCalls.push({ name: b.name, input: b.input, output: r.output, ok: r.ok, latencyMs: Date.now() - t0 });
      return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(r.output), ...(r.ok ? {} : { is_error: true }) };
    });
    if (rounds === req.maxRounds - 1) {
      results.push({ type: 'text', text: 'Final round: call submit_decision now.' });
    }
    messages.push({ role: 'user', content: results });
  }
  return done('round_cap');
}
