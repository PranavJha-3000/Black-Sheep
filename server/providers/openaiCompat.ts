import { FUND_TOOLS, parseSubmittedDecision, SUBMIT_DECISION } from '@black-sheep/engine/fundTools';
import { parseDecisionText } from '@black-sheep/engine/rivalLLM';
import type { RivalDecision } from '@black-sheep/engine/rival';
import { LLM_MAX_RETRIES, LLM_TIMEOUT_MS } from '../../config/game';
import { costOfUsage } from '../budget';
import type { DecisionRequest, LoopOutcome, LoopResult, MeteredUsage, ToolCallRecord } from './anthropic';

/**
 * OpenAI-compatible provider adapter (OpenRouter chat completions). Same
 * contract as anthropic.ts `runDecisionLoop`: bounded tool loop, summed
 * usage/cost, never throws. `chat` is injected so the loop needs no network.
 */

export type ChatFetch = (body: unknown) => Promise<{ status: number; json: unknown }>;

/** The real call. `json` is null when the body is not JSON. The key is never logged or echoed. */
export function openaiCompatFetch(baseUrl: string, apiKey: string): ChatFetch {
  return async (body) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-Title': 'Black Sheep' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // non-JSON body stays null
    }
    return { status: res.status, json };
  };
}

const PROVIDER_TOOLS = FUND_TOOLS.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

interface ChatToolCall {
  id: string;
  function: { name: string; arguments: string };
}
interface ChatResponse {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null; tool_calls?: ChatToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const clip = (s: string): string => s.slice(0, 200);
const isRetryable = (status: number): boolean => status === 429 || status >= 500;

export async function runOpenAICompatLoop(
  chat: ChatFetch,
  req: DecisionRequest,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<LoopResult> {
  const started = Date.now();
  const usage: MeteredUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const toolCalls: ToolCallRecord[] = [];
  const messages: unknown[] = [{ role: 'system', content: req.system }, { role: 'user', content: req.user }];
  let costUsd = 0;
  let servedBy: string | null = null;
  let stopReason: string | null = null;
  let rounds = 0;

  const done = (outcome: LoopOutcome, decision: RivalDecision | null = null, error?: string): LoopResult => ({
    outcome, decision, usage, costUsd, servedBy, stopReason, rounds, toolCalls, latencyMs: Date.now() - started, ...(error ? { error } : {}),
  });

  /** One request with 429/5xx/thrown-fetch retries; returns a response or an error string. */
  async function call(): Promise<{ res: ChatResponse } | { error: string }> {
    const body = { model: req.model, max_tokens: req.maxTokens, messages: [...messages], tools: PROVIDER_TOOLS, tool_choice: 'auto' };
    for (let attempt = 0; ; attempt++) {
      let status = 0;
      let json: unknown = null;
      let thrown: string | null = null;
      try {
        ({ status, json } = await chat(body));
      } catch (err) {
        thrown = clip(err instanceof Error ? err.message : String(err));
      }
      if (thrown === null && status >= 200 && status < 300) {
        return json && typeof json === 'object' ? { res: json as ChatResponse } : { error: `HTTP ${status}: response was not JSON` };
      }
      const retryable = thrown !== null || isRetryable(status);
      if (!retryable || attempt >= LLM_MAX_RETRIES) {
        return { error: thrown !== null ? `request failed: ${thrown}` : `HTTP ${status}: ${clip(JSON.stringify(json) ?? '')}` };
      }
      await sleep(500 * (attempt + 1));
    }
  }

  try {
    while (rounds < req.maxRounds) {
      rounds++;
      const r = await call();
      if ('error' in r) return done('error', null, r.error);
      const { res } = r;

      servedBy = res.model ?? servedBy;
      const u = { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 };
      usage.input_tokens += u.input_tokens;
      usage.output_tokens += u.output_tokens;
      // Priced on the requested model: OpenRouter may return dated variants the registry lacks.
      costUsd += costOfUsage(req.model, u);

      const choice = res.choices?.[0];
      if (!choice?.message) return done('error', null, 'response had no choices');
      stopReason = choice.finish_reason ?? null;
      const calls = choice.message.tool_calls ?? [];

      // Parse arguments once; a parse failure is reported back to the model.
      const parsed = calls.map((c) => {
        try {
          return { c, args: JSON.parse(c.function.arguments || '{}') as unknown, bad: false };
        } catch {
          return { c, args: null, bad: true };
        }
      });
      const submitted = parsed.find((p) => p.c.function.name === SUBMIT_DECISION && !p.bad);
      const decision = submitted ? parseSubmittedDecision(submitted.args) : null;
      if (decision) return done('decided', decision);

      if (calls.length === 0) {
        const fromText = choice.message.content ? parseDecisionText(choice.message.content) : null;
        if (fromText) return done('decided', fromText);
        return done(stopReason === 'length' ? 'max_tokens' : 'no_decision');
      }
      // Truncated output means truncated tool-call arguments; end honestly rather than loop on them.
      if (stopReason === 'length') return done('max_tokens');

      // Out of rounds: research the model asked for could never be reported back.
      if (rounds === req.maxRounds) break;

      messages.push({ role: 'assistant', ...choice.message });
      for (const p of parsed) {
        let output: unknown;
        if (p.bad) {
          output = { error: 'Malformed tool arguments: not valid JSON.' };
          // submit_decision is never recorded (matches the Anthropic loop).
          if (p.c.function.name !== SUBMIT_DECISION) toolCalls.push({ name: p.c.function.name, input: p.c.function.arguments, output, ok: false, latencyMs: 0 });
        } else if (p.c.function.name === SUBMIT_DECISION) {
          output = { error: 'Malformed decision: action must be buy|short|close|hold with reasoning and a numeric confidence.' };
        } else {
          const t0 = Date.now();
          const tr = req.runTool(p.c.function.name, p.args);
          output = tr.output;
          toolCalls.push({ name: p.c.function.name, input: p.args, output, ok: tr.ok, latencyMs: Date.now() - t0 });
        }
        messages.push({ role: 'tool', tool_call_id: p.c.id, content: JSON.stringify(output) });
      }
      if (rounds === req.maxRounds - 1) messages.push({ role: 'user', content: 'Final round: call submit_decision now.' });
    }
    return done('round_cap');
  } catch (err) {
    return done('error', null, clip(err instanceof Error ? err.message : String(err)));
  }
}
