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

/**
 * `deepseek-flash`, off-peak, at the published USD rates converted at 7.13 — the model this endpoint actually serves.
 *
 * The probe of 2026-11-25 (`probe-endpoint.yml`, four requests of eight tokens) answered three questions and this
 * table is the third's consequence:
 *
 *   * the key reaches exactly two models, `deepseek-flash` and `deepseek-v4-pro`. **`deepseek-chat` is not among
 *     them** — it was retired, and a request for it is served by `deepseek-flash`, which the response's own `model`
 *     field confirms. Every artifact this programme wrote names a model the endpoint no longer offers;
 *   * the same body sent twice read `prompt_cache_hit_tokens: 0` both times on both models, so a prompt of this shape
 *     does not cache here and the 75 % saving `cost-structure-348.md` lists as open does not exist at any price;
 *   * the published rates are **$0.15 in / $0.60 out per million** off-peak, which at 7.13 is **1.07 / 4.28 CNY** —
 *     against the **2 / 8** this repository has been pricing with since the first arm.
 *
 * ## Which table a reading should use
 *
 * `DEEPSEEK_CHAT_RATES` for anything that has to be comparable with a published figure: every artifact in this
 * programme was priced at 2 / 8, and re-pricing them at the newer table would make a month of reports disagree with
 * each other for a reason that has nothing to do with the arms. `DEEPSEEK_FLASH_RATES` for what the next run will
 * cost. The gap is **1.87×**, and it is a correction to the ESTIMATE and not to any accuracy reading — token counts
 * are the endpoint's own, and the ratio of input to output does not move.
 */
export const DEEPSEEK_FLASH_RATES: TokenRates = { inputPerMillion: 1.07, outputPerMillion: 4.28 };
