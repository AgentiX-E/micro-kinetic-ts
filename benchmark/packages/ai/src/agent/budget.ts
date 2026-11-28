/**
 * The three gates that bound an agentic layer, and the arithmetic that makes them exact.
 *
 * Money is counted in **integer micro-dollars**, not in floating point. A budget of one cent is reached by
 * accumulating thousands of calls of ~$0.000004, and a float accumulator drifts: the gate would trip one call
 * early on some runs and one call late on others, so a rerun of the same corpus would bill differently and an
 * ablation would compare two runs that used different budgets. `tokens × pricePerMillion` is already micro-dollars
 * — 9 000 tokens at $0.27/M is 2 430 µ$ — so the multiplication is exact and the rounding happens once, at the
 * point a real number has to be reported.
 *
 * The gates are a **tripwire, not an error**. When one fires the loop stops and the engine's own answer is
 * returned: a layer that fails a case because it ran out of money would make the score a function of the budget
 * rather than of the method, which is the comparison this repository exists to keep honest.
 *
 * Zero IO, no clock: a caller drives the loop and records what each round cost.
 */

/** What one budget allows. All three are independent; the first to be reached stops the loop. */
export interface BudgetLimits {
  /** Model round trips. The binding gate in practice — an agent that needs more rounds is usually searching. */
  readonly rounds: number;
  /** Total tokens, input plus output. */
  readonly tokens: number;
  /** Total spend in micro-dollars (1 µ$ = $0.000001). Integer by construction, never accumulated as a float. */
  readonly microUsd: number;
}

/** What has been spent so far. Same units as {@link BudgetLimits}. */
export interface BudgetSpend {
  readonly rounds: number;
  readonly tokens: number;
  readonly microUsd: number;
}

/** Which gate a round would cross. */
export const GATE_TRIPS = ['rounds', 'tokens', 'usd'] as const;

/** One of {@link GATE_TRIPS}. */
export type GateTrip = (typeof GATE_TRIPS)[number];

/** What one round is about to cost. */
export interface RoundCost {
  readonly tokens: number;
  readonly microUsd: number;
}

/** Price of a model, per million tokens. */
export interface ModelPrice {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

/**
 * Converts a token count at a per-million price into micro-dollars.
 *
 * `tokens × pricePerMillion` is exact in integer arithmetic because a million tokens at `p` dollars per million
 * is `p` dollars, i.e. `p × 10^6` micro-dollars, and `tokens/10^6 × p × 10^6 = tokens × p`. Rounding once here
 * keeps the accumulated total an integer sum of integers.
 *
 * @param tokens - Token count.
 * @param pricePerMillion - Dollars per million tokens.
 * @returns Micro-dollars, rounded to the nearest integer.
 */
export function tokenCost(tokens: number, pricePerMillion: number): number {
  return Math.round(tokens * pricePerMillion);
}

/**
 * Cost of one round trip in micro-dollars.
 *
 * @param tokens - Input and output counts, priced separately because output is ~4× input at every provider.
 * @param price - The model's price table.
 * @returns Micro-dollars, rounded once at the end.
 */
export function roundCost(
  tokens: { readonly input: number; readonly output: number },
  price: ModelPrice,
): RoundCost {
  return {
    tokens: tokens.input + tokens.output,
    microUsd:
      tokenCost(tokens.input, price.inputPerMillion) +
      tokenCost(tokens.output, price.outputPerMillion),
  };
}

/** Formatting helper: micro-dollars as a dollar string with six decimals, which is the finest unit a gate uses. */
export function formatMicroUsd(microUsd: number): string {
  return (microUsd / 1_000_000).toFixed(6);
}

/**
 * Refuses a budget specification that cannot mean what it says.
 *
 * The specification is `rounds,tokens,usd` — the shape a workflow input can carry on one line. Every rejection is
 * a case where a permissive parse would produce a budget that silently allows something else: a missing field
 * would become `NaN`, which compares false against every gate and therefore allows unbounded spend.
 *
 * @param spec - The comma-separated specification.
 * @returns The parsed limits.
 * @throws RangeError when a field is absent, non-finite, negative, or a non-integer round count.
 */
export function parseBudget(spec: string): BudgetLimits {
  const parts = spec.split(',');
  if (parts.length !== 3) {
    throw new RangeError(`--agentic-budget wants rounds,tokens,usd; got ${parts.length} field(s)`);
  }
  const [roundsText, tokensText, usdText] = parts as [string, string, string];
  const rounds = Number(roundsText);
  const tokens = Number(tokensText);
  const usd = Number(usdText);
  if (!Number.isInteger(rounds) || rounds < 0) {
    throw new RangeError(
      `--agentic-budget rounds must be a non-negative integer; got '${roundsText}'`,
    );
  }
  if (!Number.isFinite(tokens) || tokens < 0) {
    throw new RangeError(
      `--agentic-budget tokens must be a non-negative number; got '${tokensText}'`,
    );
  }
  if (!Number.isFinite(usd) || usd < 0) {
    throw new RangeError(`--agentic-budget usd must be a non-negative number; got '${usdText}'`);
  }
  return { rounds, tokens, microUsd: Math.round(usd * 1_000_000) };
}

/**
 * A ledger of what an agent has spent, and a gate that says whether it may spend again.
 *
 * @example
 * const budget = new AgentBudget(DEFAULT_ELIMINATOR_BUDGET);
 * while (!budget.exhausted && budget.admits(cost) === null) {
 *   budget.record(cost);
 * }
 */
export class AgentBudget {
  readonly limits: BudgetLimits;
  #spend: BudgetSpend = { rounds: 0, tokens: 0, microUsd: 0 };

  /**
   * @param limits - What the run may spend in total.
   */
  constructor(limits: BudgetLimits) {
    this.limits = limits;
  }

  /** What has been spent. A copy, so a caller cannot rewrite the ledger. */
  get spend(): BudgetSpend {
    return { ...this.#spend };
  }

  /** True when no further round can be afforded, whatever it costs. */
  get exhausted(): boolean {
    return (
      this.#spend.rounds >= this.limits.rounds ||
      this.#spend.tokens >= this.limits.tokens ||
      this.#spend.microUsd >= this.limits.microUsd
    );
  }

  /**
   * Says whether one more round fits, WITHOUT spending it.
   *
   * Separating the question from the act is what lets a caller decide to fall back to the engine's answer before
   * paying for a call it would then have to discard.
   *
   * @param cost - What the round would cost.
   * @returns The gate that would be crossed, or `null` when the round fits.
   */
  admits(cost: RoundCost): GateTrip | null {
    if (this.#spend.rounds + 1 > this.limits.rounds) return 'rounds';
    if (this.#spend.tokens + cost.tokens > this.limits.tokens) return 'tokens';
    if (this.#spend.microUsd + cost.microUsd > this.limits.microUsd) return 'usd';
    return null;
  }

  /**
   * Records a round that happened. Refuses to overdraw, because a ledger that silently allows it makes
   * {@link exhausted} a lie.
   *
   * @param cost - What the round cost.
   * @throws RangeError when the round does not fit, which means {@link admits} was not consulted.
   */
  record(cost: RoundCost): void {
    const trip = this.admits(cost);
    if (trip !== null) {
      throw new RangeError(`agentic budget exceeded on ${trip} before recording a round`);
    }
    this.#spend = {
      rounds: this.#spend.rounds + 1,
      tokens: this.#spend.tokens + cost.tokens,
      microUsd: this.#spend.microUsd + cost.microUsd,
    };
  }
}

/**
 * The eliminator's default: three rounds, nine thousand tokens, one cent.
 *
 * Three rounds because eliminating four competitors needs at most three comparisons and a fourth round is the
 * signature of a search that is not converging — `arXiv:2608.21310` Finding 3 measures exactly that: incorrect
 * runs take up to 11.4 MORE rounds than correct ones, so the extra budget buys nothing. Nine thousand tokens
 * because the fingerprint is bounded (§3 of the plan) and 9k is its measured ceiling with three rounds of history.
 */
export const DEFAULT_ELIMINATOR_BUDGET: BudgetLimits = {
  rounds: 3,
  tokens: 9_000,
  microUsd: 10_000,
};

/**
 * The investigator's default: twelve rounds, sixty thousand tokens, five cents.
 *
 * Twelve rather than the published 45–54 because the free-lunch portion of that budget is the part spent reading
 * telemetry the engine has already summarised. If the ceiling turns out to be twelve rounds, that is a finding
 * about the benchmark's evidence density and it belongs in the report — which is why the number is a default and
 * not a constant.
 */
export const DEFAULT_INVESTIGATOR_BUDGET: BudgetLimits = {
  rounds: 12,
  tokens: 60_000,
  microUsd: 50_000,
};

/**
 * DeepSeek's list price, used to translate tokens into the gate's micro-dollars.
 *
 * A price table rather than a vendor SDK, so the model stays swappable: `--agentic-model` selects a price entry
 * and a provider name, and neither is known to the loop.
 */
export const DEEPSEEK_PRICE: ModelPrice = { inputPerMillion: 0.27, outputPerMillion: 1.1 };
