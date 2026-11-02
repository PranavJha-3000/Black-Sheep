import { MODEL_REGISTRY } from '../config/models';

/**
 * budget — provider pricing and the spend ledger (VISION §12).
 *
 * Pure (no prisma, no clock reads): the caller passes `now`. "No agent should
 * continue making API calls after its budget is exhausted" is enforced by
 * reserving the worst-case cost BEFORE a call; reservations count against
 * both the fund's and the global daily limit until they are settled with the
 * real cost (or released when the call never happened). The server is the
 * single writer (D-016), so an in-process ledger is atomic.
 */

/** The usage fields a provider response reports (Anthropic `usage` shape). */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

type Pricing = (typeof MODEL_REGISTRY)[keyof typeof MODEL_REGISTRY];

function pricingFor(model: string): Pricing {
  const known = (MODEL_REGISTRY as Record<string, Pricing | undefined>)[model];
  if (known) return known;
  // Unknown model: never meter it as free — charge the most expensive rate.
  return Object.values(MODEL_REGISTRY).reduce((a, b) => (b.outputUsdPerMTok > a.outputUsdPerMTok ? b : a));
}

/** Exact USD cost of one response's usage. */
export function costOfUsage(model: string, u: Usage): number {
  const p = pricingFor(model);
  const inUsd = p.inputUsdPerMTok;
  return (
    (u.input_tokens * inUsd +
      u.output_tokens * p.outputUsdPerMTok +
      (u.cache_read_input_tokens ?? 0) * inUsd * p.cacheReadMultiplier +
      (u.cache_creation_input_tokens ?? 0) * inUsd * p.cacheWriteMultiplier) /
    1_000_000
  );
}

/**
 * Worst-case cost of a decision: every round uses max_tokens, and round k
 * re-sends the prompt plus all k−1 earlier assistant turns (thinking included).
 * Tool results are small JSON and are covered by the prompt estimate.
 */
export function estimateCallCostUsd(model: string, rounds: number, maxTokens: number, promptTokens: number): number {
  const input = rounds * promptTokens + (maxTokens * rounds * (rounds - 1)) / 2;
  return costOfUsage(model, { input_tokens: input, output_tokens: rounds * maxTokens });
}

export interface Reservation {
  id: number;
  fundId: number;
  amountUsd: number;
  /** UTC day the reservation was taken on. */
  day: string;
}

const dayOf = (now: Date): string => now.toISOString().slice(0, 10);

export class BudgetLedger {
  private day = '';
  private settled = new Map<number, number>();
  private active = new Map<number, Reservation>();
  private nextId = 1;

  constructor(
    private readonly globalLimitUsd: number,
    private readonly maxConcurrent: number,
  ) {}

  /** Load what each fund already spent today (from the persisted call log). */
  seed(spentByFund: Record<number, number>, now: Date): void {
    this.day = dayOf(now);
    this.settled = new Map(Object.entries(spentByFund).map(([k, v]) => [Number(k), v]));
  }

  /** Reserve `estimateUsd` for a call, or null if any limit would be breached. */
  reserve(fundId: number, fundLimitUsd: number, estimateUsd: number, now: Date): Reservation | null {
    this.rollover(now);
    if (this.active.size >= this.maxConcurrent) return null;
    if (this.spentToday(fundId, now) + estimateUsd > fundLimitUsd) return null;
    if (this.totalToday() + estimateUsd > this.globalLimitUsd) return null;
    const r: Reservation = { id: this.nextId++, fundId, amountUsd: estimateUsd, day: this.day };
    this.active.set(r.id, r);
    return r;
  }

  /** The call finished: replace the estimate with what it really cost. */
  settle(r: Reservation, actualUsd: number, now: Date): void {
    if (!this.active.delete(r.id)) return;
    this.rollover(now);
    // A call that straddled midnight is history; it does not eat today's budget.
    if (r.day !== this.day) return;
    this.settled.set(r.fundId, (this.settled.get(r.fundId) ?? 0) + actualUsd);
  }

  /** The call never happened (or cost nothing): free the reservation. */
  release(r: Reservation): void {
    this.active.delete(r.id);
  }

  /** Settled spend plus today's held reservations for one fund. */
  spentToday(fundId: number, now: Date): number {
    this.rollover(now);
    let held = 0;
    for (const r of this.active.values()) if (r.fundId === fundId && r.day === this.day) held += r.amountUsd;
    return (this.settled.get(fundId) ?? 0) + held;
  }

  /** True when another reservation would be refused by the concurrency cap alone. */
  atCapacity(): boolean {
    return this.active.size >= this.maxConcurrent;
  }

  inFlight(): number {
    return this.active.size;
  }

  private totalToday(): number {
    let total = 0;
    for (const v of this.settled.values()) total += v;
    for (const r of this.active.values()) if (r.day === this.day) total += r.amountUsd;
    return total;
  }

  private rollover(now: Date): void {
    const d = dayOf(now);
    if (d === this.day) return;
    this.day = d;
    this.settled = new Map();
  }
}
