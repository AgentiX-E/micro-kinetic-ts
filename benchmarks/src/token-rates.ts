/**
 * What an endpoint charges, as two numbers.
 *
 * Kept apart from the audit so a different provider is a different table rather than a different module: the
 * programme's LLM is behind a provider-agnostic boundary, and its PRICES have to be behind one too or the audit
 * silently becomes a DeepSeek audit.
 *
 * ## Why the input rate is the cache-MISS rate
 *
 * `deepseek-chat` prices a prompt token at **2 CNY per million** on a cache miss and a fraction of that on a hit.
 * Run `45531140696` spent 20.81 CNY on 10 221 261 prompt and 46 085 completion tokens, which is exactly the miss
 * arithmetic — so **not one prefix was served from cache**, and the audit prices what was actually charged rather
 * than what the cheaper rate would have been. A rate table that quoted the hit price would report a bill 4×
 * smaller than the invoice and make every saving below look unnecessary.
 */
export interface TokenRates {
  /** CNY per million prompt tokens, on a cache miss. */
  readonly inputPerMillion: number;
  /** CNY per million completion tokens. */
  readonly outputPerMillion: number;
}

/** `deepseek-chat`, as invoiced: 2 CNY per million in, 8 per million out. */
export const DEEPSEEK_CHAT_RATES: TokenRates = { inputPerMillion: 2, outputPerMillion: 8 };
