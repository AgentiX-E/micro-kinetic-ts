/**
 * The line beside the artifact has to be the bill, not a bound presented as one.
 *
 * The runner prints exactly one cost sentence, and a human reads it before any table. For four iterations that sentence
 * was `tokens P+C · est. ¥X at the declared prices`, computed as `P × 2 + C × 8` — the peak column, with every prompt
 * token billed as a cache miss. Run `45595943761` cost **1.69 CNY** and its own last line said **15.55**, a factor of
 * **9.2**. The audit priced the same artifact correctly the whole time; the two arithmetics simply never met.
 *
 * So the sentence is no longer written in the runner. It is `billLine`, built from the same `costOf` the audit uses, and
 * these cases hold the two together: the first one parses the ¥ figure back out of the printed string and compares it
 * with `auditCost` on the same rows. If the runner's line and the audit's table can ever disagree again, it is because
 * this file stopped being run.
 */

import { describe, expect, it } from 'vitest';

import { auditCost, billLine, billNote, costOf, type CostRow } from '../src/cost-model.js';
import { DEEPSEEK_CHAT_RATES, DEEPSEEK_FLASH_RATES } from '../src/token-rates.js';

/** A row as an artifact writes it: the corpus average, answered by the model, correct. */
function row(over: Partial<CostRow> = {}): CostRow {
  return {
    datapack: 'x',
    promptTokens: 7_188,
    completionTokens: 32,
    answeredBy: 'model',
    correct: true,
    engineWinner: 'svc',
    engineMargin: 0.5,
    truth: ['svc'],
    ...over,
  };
}

/** The ¥ figure a printed bill line carries, as a number. */
function quoted(line: string): number {
  const match = /est\. ¥(-?\d+\.\d\d)/.exec(line);
  if (match === null) throw new Error(`no price in \`${line}\``);
  return Number(match[1]);
}

/** The tokens an arm spent, in the shape the bill reads. Absent `cacheHitTokens` means unrecorded, not zero. */
function totals(
  over: Partial<{
    promptTokens: number;
    completionTokens: number;
    cacheHitTokens: number | null;
  }> = {},
): { promptTokens: number; completionTokens: number; cacheHitTokens?: number | null } {
  return { promptTokens: 7_188, completionTokens: 32, ...over };
}

describe('the bill line', () => {
  it('prices the acceptance run at what it cost, on one line that names the column', () => {
    // Run `45595943761`'s own token counts: 6 204 649 of 7 636 769 prompt tokens served from cache, 34 277 generated.
    // Off-peak: 6 204 649 × 0.02 + 1 432 120 × 1 + 34 277 × 4 = 1.693 CNY. The old line said 15.55.
    const run = totals({
      promptTokens: 7_636_769,
      completionTokens: 34_277,
      cacheHitTokens: 6_204_649,
    });
    expect(billLine(run, DEEPSEEK_FLASH_RATES, 'off-peak')).toBe(
      'tokens 7636769+34277 · 81.25 % served from cache · ' +
        'est. ¥1.69 at the off-peak column (1 / 4 / hit 0.02)',
    );
    // The counterfactual is printed rather than dropped: it is the number the artifact's own line used to carry, and a
    // reader comparing this report with an older one has to be able to see where the 9.2× went.
    expect(billNote(run, DEEPSEEK_FLASH_RATES)).toBe(
      '  with every prompt at the miss price the same run would read ¥7.77 — the number the two-number line printed',
    );
  });

  it('prints the number the audit computes, on rows the audit also sees', () => {
    // The invariant this file exists for. `auditCost` prices row by row (the split is per case); the line is printed
    // from the arm's summed tokens. Those are two arithmetics, and they have to agree on the same artifact.
    const rows = [
      row({ promptTokens: 7_100, completionTokens: 30, cacheHitTokens: 5_800 }),
      row({ promptTokens: 7_400, completionTokens: 34, cacheHitTokens: 6_100 }),
      row({ promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, answeredBy: 'certainty' }),
    ];
    const summary = {
      promptTokens: rows.reduce((sum, one) => sum + one.promptTokens, 0),
      completionTokens: rows.reduce((sum, one) => sum + one.completionTokens, 0),
      cacheHitTokens: rows.reduce((sum, one) => sum + (one.cacheHitTokens ?? 0), 0),
    };
    for (const [rates, tariff] of [
      [DEEPSEEK_FLASH_RATES, 'off-peak'],
      [DEEPSEEK_CHAT_RATES, 'peak'],
    ] as const) {
      expect(quoted(billLine(summary, rates, tariff))).toBe(
        Number(auditCost(rows, rates).total.toFixed(2)),
      );
    }
  });

  it('says the cache was unrecorded instead of reporting a share it cannot know', () => {
    // An artifact written before the column existed. `cacheHitTokens: null` is `not measured`, and the price that
    // follows is a bound — the invoice with no cache at all — which the line and the note both have to say out loud.
    const run = totals({ cacheHitTokens: null });
    expect(billLine(run, DEEPSEEK_FLASH_RATES, 'off-peak')).toBe(
      'tokens 7188+32 · cache unrecorded · est. ¥0.01 at the off-peak column (1 / 4 / hit 0.02)',
    );
    expect(billNote(run, DEEPSEEK_FLASH_RATES)).toBe(
      '  no row recorded a cache, so ¥0.01 bills every prompt at the miss price — a bound, not an invoice',
    );
  });

  it('bills the miss price when the table names no hit price, and says the figure is a bound', () => {
    // The conservative direction has to be reachable without asking for it: a two-number table bills every prompt at
    // the miss price, which is what the invoice would have been with no cache at all.
    const run = totals({ promptTokens: 1_000_000, completionTokens: 0, cacheHitTokens: 900_000 });
    const table = { inputPerMillion: 1, outputPerMillion: 4 };
    expect(billLine(run, table, 'off-peak')).toBe(
      'tokens 1000000+0 · 90.00 % served from cache · est. ¥1.00 at the off-peak column (1 / 4, no hit price)',
    );
    expect(billNote(run, table)).toBe(
      '  the table names no hit price, so ¥1.00 bills every prompt at the miss price — a bound, not a discount',
    );
  });

  it('clamps a corrupt hit count rather than paying a negative input', () => {
    // `prompt_cache_hit_tokens` is a subset of `prompt_tokens`, so a row that says otherwise is corrupt. Billing the
    // difference would turn the corruption into a discount, and the audit already clamps — so the line has to clamp
    // too, or the two would diverge exactly on the file nobody trusts.
    const corrupt = row({ promptTokens: 1_000, completionTokens: 0, cacheHitTokens: 5_000 });
    const summary = {
      promptTokens: 1_000,
      completionTokens: 0,
      cacheHitTokens: Math.min(5_000, 1_000),
    };
    expect(quoted(billLine(summary, DEEPSEEK_FLASH_RATES, 'off-peak'))).toBe(
      Number(auditCost([corrupt], DEEPSEEK_FLASH_RATES).total.toFixed(2)),
    );
    expect(quoted(billLine(summary, DEEPSEEK_FLASH_RATES, 'off-peak'))).toBe(
      Number(costOf(summary, DEEPSEEK_FLASH_RATES).toFixed(2)),
    );
  });

  it('prices a run that called nothing at zero, without a NaN share', () => {
    // The floor's whole point is that some cases never call, and a run of only those is a legal artifact. 0 tokens is
    // a price, not a division by zero.
    const silent = totals({ promptTokens: 0, completionTokens: 0, cacheHitTokens: 0 });
    expect(billLine(silent, DEEPSEEK_FLASH_RATES, 'off-peak')).toBe(
      'tokens 0+0 · 0.00 % served from cache · est. ¥0.00 at the off-peak column (1 / 4 / hit 0.02)',
    );
    expect(billNote(silent, DEEPSEEK_FLASH_RATES)).toBe(null);
  });

  it('names the column it used, so a peak reading cannot be mistaken for an off-peak one', () => {
    // The two columns are 2× apart. The tier is computed from the artifact's own `startedAt`, and a line that printed
    // a price without its column would be unreadable a fortnight later, when the same run is repriced.
    const run = totals({ promptTokens: 1_000_000, completionTokens: 0, cacheHitTokens: 0 });
    expect(billLine(run, DEEPSEEK_CHAT_RATES, 'peak')).toContain(
      'at the peak column (2 / 8 / hit 0.04)',
    );
    expect(billLine(run, DEEPSEEK_FLASH_RATES, 'off-peak')).toContain(
      'at the off-peak column (1 / 4 / hit 0.02)',
    );
    // No cache recorded means no counterfactual to print: the line IS the no-cache reading.
    expect(billNote(totals({ cacheHitTokens: undefined }), DEEPSEEK_CHAT_RATES)).toContain(
      'a bound',
    );
  });
});
