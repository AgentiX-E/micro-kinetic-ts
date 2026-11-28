/**
 * What an endpoint charges, as three numbers.
 *
 * Kept apart from the audit so a different provider is a different table rather than a different module: the
 * programme's LLM is behind a provider-agnostic boundary, and its PRICES have to be behind one too or the audit
 * silently becomes a DeepSeek audit.
 *
 * ## Three prices, because the cache is real and it is not a rounding term
 *
 * The rate card has a **cache-hit** input price, a **cache-miss** input price, and an output price, and on
 * `deepseek-flash` the first is **1/50th** of the second — so a table with two numbers cannot price a run. This module
 * learned that twice, in opposite directions:
 *
 *   * iteration 349 concluded from a four-request probe that **the cache serves nothing** — two byte-identical 191-token
 *     bodies both read `prompt_cache_hit_tokens: 0` — and withdrew 348's 75 % saving on that evidence.
 *   * iteration 351's acceptance run read **6 204 649 of 7 636 769 prompt tokens as cache hits: 81.25 %**, because a
 *     real investigation repeats a ~5 800-token system prompt across 1 062 calls and a 191-token probe does not.
 *
 * Both readings are correct and the second is the one that prices a workload. What the probe establishes is narrower
 * than it was published as: **a short prompt does not cache**. Automation that only ever recurs on long, stable
 * prefixes — which is every agent — hits at 81 %, and the record now proves it per call (`cacheHitTokens`).
 *
 * ## The tariff has two time tiers, and the old table was the peak one
 *
 * The published CNY card charges, per million tokens:
 *
 * | | off-peak | peak |
 * | --- | -------: | ---: |
 * | input, cache hit | 0.02 | 0.04 |
 * | input, cache miss | 1 | 2 |
 * | output | 4 | 8 |
 *
 * Peak is **exactly double**, Monday–Friday 01:00–04:00 and 06:00–10:00 UTC. So the **2 / 8** table every earlier
 * artifact was priced with is not an estimate and not a conversion error: **it is the peak column**, and the runs it
 * priced were mostly taken off-peak. That is a cleaner account than 349's "1.87× over-statement", which came from
 * converting the USD off-peak figures at 7.13 rather than reading the CNY card.
 */
export interface TokenRates {
  /** CNY per million prompt tokens, on a cache MISS. */
  readonly inputPerMillion: number;
  /** CNY per million completion tokens. */
  readonly outputPerMillion: number;
  /**
   * CNY per million prompt tokens, on a cache HIT.
   *
   * Optional, and its ABSENCE is a deliberate conservative bound rather than an oversight: a table that states only a
   * miss price bills every prompt token at that price, which is what the invoice would have been with no cache at all.
   * A reader who wants the cheaper reading has to name the hit price, so the two readings can never be confused.
   */
  readonly cacheHitPerMillion?: number;
}

/**
 * The peak tariff: 2 / 8 CNY per million, cache hit 0.04.
 *
 * Kept as the DEFAULT so that every figure this programme has published stays re-derivable from the artifact that
 * produced it. It is a real tariff and not a mistake — it is the column that applies between 01:00 and 04:00 and
 * between 06:00 and 10:00 UTC on weekdays, when several of the runs behind those figures were dispatched.
 */
export const DEEPSEEK_CHAT_RATES: TokenRates = {
  inputPerMillion: 2,
  outputPerMillion: 8,
  cacheHitPerMillion: 0.04,
};

/**
 * `deepseek-flash` off-peak — the model this endpoint actually serves, at the tariff most runs are taken under.
 *
 * Every number here is on the published CNY card, read rather than converted: 1 / 4 with a 0.02 cache-hit price. The
 * model name is `deepseek-flash` because that is what `GET /v1/models` returns and what the response's own `model`
 * field reports; a request naming `deepseek-chat` is still answered, by this model, at this price.
 */
export const DEEPSEEK_FLASH_RATES: TokenRates = {
  inputPerMillion: 1,
  outputPerMillion: 4,
  cacheHitPerMillion: 0.02,
};

/** Which of the card's two columns applies. Named rather than boolean because it is printed beside a price. */
export type Tariff = 'peak' | 'off-peak';

/**
 * The card's peak windows, in UTC, as `[from, to)` hours on a weekday.
 *
 * Half-open on purpose: a closed interval bills 04:00:00 at both tariffs, and the boundary is the one place nobody
 * looks for a 2× error.
 */
const PEAK_WINDOWS_UTC: readonly (readonly [number, number])[] = [
  [1, 4],
  [6, 10],
];

/**
 * Whether the peak column applies at `when`.
 *
 * The card charges peak on **weekdays** between **01:00 and 04:00** and between **06:00 and 10:00 UTC** — the schedule
 * `cache-hit-352.md` records. Read from the instant the run STARTED, which every artifact records as `startedAt`, so
 * repricing an artifact months later lands on the column it was billed under rather than on the current clock.
 */
export function isPeakTariff(when: Date): boolean {
  const day = when.getUTCDay();
  // 0 is Sunday and 6 is Saturday: the card discounts the whole weekend, inside the windows included.
  if (day === 0 || day === 6) return false;
  const minutes = when.getUTCHours() * 60 + when.getUTCMinutes();
  return PEAK_WINDOWS_UTC.some(([from, to]) => minutes >= from * 60 && minutes < to * 60);
}

/** The column in force at `when`, for a line that has to say which one it used. */
export function tariffAt(when: Date): Tariff {
  return isPeakTariff(when) ? 'peak' : 'off-peak';
}

/**
 * The card the endpoint bills at the tier in force at `when`.
 *
 * Identity, not a third table: the peak column of the served model's card IS {@link DEEPSEEK_CHAT_RATES} — 2 / 8 with a
 * 0.04 hit price, exactly double the off-peak column. A separate constant would let the two drift, and the drift would
 * be invisible until someone compared two runs taken at different hours.
 */
export function servedRatesAt(when: Date): TokenRates {
  return isPeakTariff(when) ? DEEPSEEK_CHAT_RATES : DEEPSEEK_FLASH_RATES;
}
