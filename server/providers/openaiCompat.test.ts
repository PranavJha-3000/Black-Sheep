import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolResult } from '@black-sheep/engine/fundTools';
import type { DecisionRequest } from './anthropic';
import { costOfUsage } from '../budget';
import { LLM_MAX_RETRIES } from '../../config/game';
import { openaiCompatFetch, runOpenAICompatLoop, type ChatFetch } from './openaiCompat';

const MODEL = 'openai/gpt-test';
const SUBMIT = { action: 'buy', ticker: 'NOVA', dollarAmount: 500_000, reasoning: 'cheap', confidence: 0.7 };
const call = (id: string, name: string, args: string) => ({ id, type: 'function', function: { name, arguments: args } });
const reply = (message: Record<string, unknown>, finish = 'tool_calls', usage = { prompt_tokens: 1000, completion_tokens: 200 }) => ({
  status: 200,
  json: { model: MODEL, choices: [{ finish_reason: finish, message: { role: 'assistant', content: null, ...message } }], usage },
});
const sleep = async () => {};
type Sent = { messages: { role: string; content: string }[] };

function req(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    model: MODEL, effort: 'low', system: 'SYS', user: 'USER', maxRounds: 3, maxTokens: 4096,
    runTool: (name): ToolResult => (name === 'calculate_risk' ? { ok: true, output: { nav: 1 } } : { ok: false, output: { error: 'nope' } }),
    ...overrides,
  };
}
function fake(...responses: ({ status: number; json: unknown } | Error)[]): ChatFetch & ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  return fn as never;
}

describe('runOpenAICompatLoop', () => {
  it('decides via submit_decision in one round', async () => {
    const chat = fake(reply({ tool_calls: [call('a', 'submit_decision', JSON.stringify(SUBMIT))] }));
    const r = await runOpenAICompatLoop(chat, req(), sleep);
    expect(r.outcome).toBe('decided');
    expect(r.decision?.action).toBe('buy');
    expect(r.servedBy).toBe(MODEL);
    const body = chat.mock.calls[0][0] as Record<string, unknown>;
    expect(body.tool_choice).toBe('auto');
    expect(body.max_tokens).toBe(4096);
  });

  it('runs a research tool then decides', async () => {
    const chat = fake(
      reply({ tool_calls: [call('a', 'calculate_risk', '{}')] }),
      reply({ tool_calls: [call('b', 'submit_decision', JSON.stringify(SUBMIT))] }),
    );
    const r = await runOpenAICompatLoop(chat, req(), sleep);
    expect(r.outcome).toBe('decided');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ name: 'calculate_risk', ok: true });
    const second = chat.mock.calls[1][0] as Sent;
    expect(second.messages.find((m) => m.role === 'tool')?.content).toBe('{"nav":1}');
  });

  it('malformed tool arguments are reported to the model, not thrown', async () => {
    const chat = fake(
      reply({ tool_calls: [call('a', 'calculate_risk', '{oops')] }),
      reply({ tool_calls: [call('b', 'submit_decision', JSON.stringify(SUBMIT))] }),
    );
    const runTool = vi.fn();
    const r = await runOpenAICompatLoop(chat, req({ runTool }), sleep);
    expect(runTool).not.toHaveBeenCalled();
    expect(r.toolCalls[0]).toMatchObject({ ok: false });
    expect(r.outcome).toBe('decided');
    const second = chat.mock.calls[1][0] as Sent;
    expect(second.messages.find((m) => m.role === 'tool')?.content).toContain('error');
  });

  it('retries a 429 then succeeds', async () => {
    const waits: number[] = [];
    const chat = fake({ status: 429, json: { error: 'slow down' } }, reply({ tool_calls: [call('a', 'submit_decision', JSON.stringify(SUBMIT))] }));
    const r = await runOpenAICompatLoop(chat, req(), async (ms) => {
      waits.push(ms);
    });
    expect(r.outcome).toBe('decided');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([500]);
  });

  it('gives outcome error after retries are exhausted and never throws', async () => {
    const chat = fake(...Array.from({ length: LLM_MAX_RETRIES + 1 }, () => ({ status: 503, json: { error: 'x'.repeat(500) } })));
    const r = await runOpenAICompatLoop(chat, req(), sleep);
    expect(r.outcome).toBe('error');
    expect(chat).toHaveBeenCalledTimes(LLM_MAX_RETRIES + 1);
    expect(r.error!.length).toBeLessThan(260);

    const thrown = await runOpenAICompatLoop(fake(...Array.from({ length: LLM_MAX_RETRIES + 1 }, () => new Error('boom'))), req(), sleep);
    expect(thrown.outcome).toBe('error');
  });

  it('sums usage and cost across rounds', async () => {
    const chat = fake(
      reply({ tool_calls: [call('a', 'calculate_risk', '{}')] }),
      reply({ tool_calls: [call('b', 'submit_decision', JSON.stringify(SUBMIT))] }, 'tool_calls', { prompt_tokens: 500, completion_tokens: 100 }),
    );
    const r = await runOpenAICompatLoop(chat, req(), sleep);
    expect(r.usage).toEqual({ input_tokens: 1500, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    const expected = costOfUsage(MODEL, { input_tokens: 1000, output_tokens: 200 }) + costOfUsage(MODEL, { input_tokens: 500, output_tokens: 100 });
    expect(r.costUsd).toBeCloseTo(expected, 10);
  });

  it('prices on the requested model, not the served variant', async () => {
    const res = reply({ tool_calls: [call('a', 'submit_decision', JSON.stringify(SUBMIT))] });
    (res.json as { model: string }).model = 'openai/gpt-test-20261110';
    const r = await runOpenAICompatLoop(fake(res), req(), sleep);
    expect(r.servedBy).toBe('openai/gpt-test-20261110');
    expect(r.costUsd).toBeCloseTo(costOfUsage(MODEL, { input_tokens: 1000, output_tokens: 200 }), 10);
  });

  it('treats empty tool arguments as no arguments', async () => {
    const chat = fake(
      reply({ tool_calls: [call('a', 'inspect_portfolio', '')] }),
      reply({ tool_calls: [call('b', 'submit_decision', JSON.stringify(SUBMIT))] }),
    );
    const runTool = vi.fn((): ToolResult => ({ ok: true, output: { ok: 1 } }));
    const r = await runOpenAICompatLoop(chat, req({ runTool }), sleep);
    expect(runTool).toHaveBeenCalledWith('inspect_portfolio', {});
    expect(r.toolCalls[0]).toMatchObject({ name: 'inspect_portfolio', ok: true });
  });

  it('does not record an unparseable submit_decision in toolCalls', async () => {
    const chat = fake(
      reply({ tool_calls: [call('a', 'submit_decision', '{oops')] }),
      reply({ tool_calls: [call('b', 'submit_decision', JSON.stringify(SUBMIT))] }),
    );
    const r = await runOpenAICompatLoop(chat, req(), sleep);
    expect(r.outcome).toBe('decided');
    expect(r.toolCalls).toHaveLength(0);
  });

  it('length finish with tool calls ends as max_tokens', async () => {
    const chat = fake(reply({ tool_calls: [call('a', 'calculate_risk', '{"tru')] }, 'length'));
    const r = await runOpenAICompatLoop(chat, req(), sleep);
    expect(r.outcome).toBe('max_tokens');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('a text answer with no decision is no_decision', async () => {
    const r = await runOpenAICompatLoop(fake(reply({ content: 'I am not sure.' }, 'stop')), req(), sleep);
    expect(r.outcome).toBe('no_decision');
  });

  it('nudges on the final round', async () => {
    const chat = fake(
      reply({ tool_calls: [call('a', 'calculate_risk', '{}')] }),
      reply({ tool_calls: [call('b', 'calculate_risk', '{}')] }),
      reply({ tool_calls: [call('c', 'submit_decision', JSON.stringify(SUBMIT))] }),
    );
    await runOpenAICompatLoop(chat, req({ maxRounds: 3 }), sleep);
    const first = chat.mock.calls[1][0] as Sent;
    const second = chat.mock.calls[2][0] as Sent;
    expect(first.messages.some((m) => m.content === 'Final round: call submit_decision now.')).toBe(false);
    expect(second.messages.at(-1)).toEqual({ role: 'user', content: 'Final round: call submit_decision now.' });
  });

  it('round cap ends with round_cap', async () => {
    const chat = fake(...Array.from({ length: 2 }, () => reply({ tool_calls: [call('a', 'calculate_risk', '{}')] })));
    const r = await runOpenAICompatLoop(chat, req({ maxRounds: 2 }), sleep);
    expect(r.outcome).toBe('round_cap');
    expect(r.rounds).toBe(2);
  });
});

describe('openaiCompatFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /chat/completions with auth headers and returns null json for non-JSON bodies', async () => {
    const f = vi.fn().mockResolvedValue({ status: 502, text: async () => '<html>bad gateway</html>' });
    vi.stubGlobal('fetch', f);
    const out = await openaiCompatFetch('https://or.test/api/v1', 'sk-SECRET')({ a: 1 });
    expect(out).toEqual({ status: 502, json: null });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://or.test/api/v1/chat/completions');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-SECRET', 'X-Title': 'Black Sheep' });
  });

  it('never echoes the key in loop errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, text: async () => '{"error":"bad key"}' }));
    const r = await runOpenAICompatLoop(openaiCompatFetch('https://or.test/api/v1', 'sk-SECRET'), req(), sleep);
    expect(r.outcome).toBe('error');
    expect(r.error).not.toContain('sk-SECRET');
  });
});
