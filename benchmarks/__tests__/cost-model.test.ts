import { describe, expect, it } from 'vitest';

import {
  DEEPSEEK_CHAT_RATES,
  auditCost,
  byCostThenName,
  costOf,
  lossFreeFloor,
  ruleEdges,
  skipAt,
  type CostRow,
} from '../src/cost-model.js';
import { DEEPSEEK_FLASH_RATES, DEEPSEEK_CHAT_RATES as RATES_DIRECT } from '../src/token-rates.js';

/**
 * A row as an artifact writes it, in the fields the audit reads.
 *
 * The default is a case the model answered correctly at the corpus's own average (7 188 prompt tokens, 32
 * completion), so a test that changes one field changes exactly one thing.
 */
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

describe('the rate table', () => {
  it('carries the served model at 1.87 times less than the table every artifact was priced with', () => {
    // Not a discount the programme collected: a correction to an estimate. The endpoint serves `deepseek-flash` at
    // 0.15 / 0.60 USD per million, and 2 / 8 CNY is 1.87x that after conversion — so every figure this repository has
    // published as "CNY" is an upper bound, and the ratio is stated here so it cannot drift.
    expect(DEEPSEEK_CHAT_RATES.inputPerMillion / DEEPSEEK_FLASH_RATES.inputPerMillion).toBeCloseTo(
      1.87,
      1,
    );
    expect(
      DEEPSEEK_CHAT_RATES.outputPerMillion / DEEPSEEK_FLASH_RATES.outputPerMillion,
    ).toBeCloseTo(1.87, 1);
  });

  it('is one table, re-exported rather than restated', () => {
    // The audit imports the rates from `token-rates` and re-exports them for callers that only need the audit. Two
    // tables would drift silently: a provider change would move one price and leave the other billing at the old one.
    expect(DEEPSEEK_CHAT_RATES).toEqual(RATES_DIRECT);
  });
});

describe('costOf', () => {
  it('prices input and output separately, at the published rates', () => {
    // 1 M input at 2 and 1 M output at 8: the two columns are not interchangeable, and a single blended rate
    // would hide the 222:1 ratio that dominates this corpus.
    const cost = costOf(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      DEEPSEEK_CHAT_RATES,
    );
    expect(cost).toBeCloseTo(10, 9);
  });

  it('reproduces the invoice of the full-corpus run from its own token columns', () => {
    // The 20.81 CNY of run 45531140696, from 10 221 261 prompt and 46 085 completion tokens. This is the
    // arithmetic that identifies the bill as 98.2 % input rather than leaving it as a claim.
    const cost = costOf(
      { promptTokens: 10_221_261, completionTokens: 46_085 },
      DEEPSEEK_CHAT_RATES,
    );
    expect(cost).toBeCloseTo(20.81, 2);
  });

  it('refuses a rate that would make the bill negative or free', () => {
    expect(() =>
      costOf({ promptTokens: 1, completionTokens: 1 }, { inputPerMillion: 0, outputPerMillion: 8 }),
    ).toThrow(/inputPerMillion/);
    expect(() =>
      costOf(
        { promptTokens: 1, completionTokens: 1 },
        { inputPerMillion: 2, outputPerMillion: -1 },
      ),
    ).toThrow(/outputPerMillion/);
  });
});

describe('auditCost', () => {
  it('names the input share, which is the number the savings live in', () => {
    const audit = auditCost([row({ promptTokens: 9_000_000, completionTokens: 100_000 })]);
    expect(audit.inputShare).toBeGreaterThan(0.95);
    expect(audit.inputTokens).toBe(9_000_000);
  });

  it('groups by who settled the case, because a case the model did not settle is not a model cost', () => {
    const audit = auditCost([
      row({ datapack: 'a', answeredBy: 'model' }),
      row({ datapack: 'b', answeredBy: 'model' }),
      row({ datapack: 'c', answeredBy: 'prior' }),
    ]);
    const by = new Map(audit.strata.map((s) => [s.by, s]));
    expect(by.get('model')?.cases).toBe(2);
    expect(by.get('prior')?.cases).toBe(1);
    // Sorted by cost descending, so the largest line is the first one a reader sees.
    expect(audit.strata[0]!.by).toBe('model');
  });

  it('reports per-case cost, which is the only figure comparable across corpora', () => {
    const audit = auditCost([row({ promptTokens: 500_000, completionTokens: 0 })]);
    expect(audit.perCase).toBeCloseTo(1, 9);
  });

  it('refuses an empty artifact rather than reporting a zero average over no cases', () => {
    expect(() => auditCost([])).toThrow(/no rows/);
  });

  it('counts an unattributed row under its own name instead of dropping it', () => {
    const audit = auditCost([row({ answeredBy: null })]);
    expect(audit.strata.map((s) => s.by)).toEqual(['unattributed']);
  });
});

describe('skipAt', () => {
  it('prices the cases a floor would not call the model on, and what that costs in accuracy', () => {
    const rows = [
      row({ datapack: 'a', engineMargin: 2, correct: true }),
      row({ datapack: 'b', engineMargin: 1.2, correct: false, truth: ['svc'] }),
      row({ datapack: 'c', engineMargin: 0.2, correct: true }),
    ];
    const reading = skipAt(rows, 1);
    expect(reading.skipped).toBe(2);
    // Skipped cases answer with the engine's winner, so `b` becomes right: the delta is +1, not −1.
    expect(reading.gains).toBe(1);
    expect(reading.losses).toBe(0);
    expect(reading.delta).toBe(1);
    expect(reading.saved).toBeGreaterThan(0);
    expect(reading.accuracy).toBeCloseTo(1, 9);
  });

  it('separates a repair from a break, because a net zero over 30 and 30 is not a no-op', () => {
    // The single number `delta` cannot tell a rule that changes no answer from a rule that changes two and happens
    // to sum to nothing. The pair can, and the next corpus moves the second one.
    const rows = [
      row({ datapack: 'r', engineMargin: 2, correct: false, engineWinner: 'svc', truth: ['svc'] }),
      row({ datapack: 'b', engineMargin: 2, correct: true, engineWinner: 'wrong', truth: ['svc'] }),
    ];
    const reading = skipAt(rows, 1);
    expect(reading.gains).toBe(1);
    expect(reading.losses).toBe(1);
    expect(reading.delta).toBe(0);
    // And the accuracy is unchanged although two of two answers moved, which is exactly the reading the pair adds.
    expect(reading.accuracy).toBeCloseTo(0.5, 9);
  });

  it('is exclusive at the floor, because the shipped rule it prices is', () => {
    // `engineCertainty` fires on `margin > bar`. An inclusive price would sell a case the arm investigates, and the
    // only corpus on which that is invisible is one whose margins never equal a round number.
    const rows = [row({ datapack: 'edge', engineMargin: 0.9 })];
    expect(skipAt(rows, 0.9).skipped).toBe(0);
    expect(skipAt(rows, 0.9 - 1e-9).skipped).toBe(1);
  });

  it('treats a missing margin as below every floor, so an old artifact cannot silently skip everything', () => {
    const reading = skipAt([row({ engineMargin: null })], 0.9);
    expect(reading.skipped).toBe(0);
  });

  it('refuses an artifact with no margin column at all, because a skip curve read from it is fiction', () => {
    const noMargin = [{ ...row(), engineMargin: undefined }] as unknown as CostRow[];
    expect(() => skipAt(noMargin, 0.9)).toThrow(/engineMargin/);
  });

  it('refuses a floor outside the range the margin is measured on', () => {
    expect(() => skipAt([row()], Number.NaN)).toThrow(/floor/);
  });
});

describe('lossFreeFloor', () => {
  it('finds the floor that skips the most cases without losing a single one', () => {
    const rows = [
      // Three cases the engine already settles, at margins 3, 2 and 1.5.
      row({ datapack: 'a', engineMargin: 3, correct: true }),
      row({ datapack: 'b', engineMargin: 2, correct: true }),
      row({ datapack: 'c', engineMargin: 1.5, correct: true }),
      // One the model repairs, and which a floor above 0.2 would hand back to the engine, wrongly.
      row({
        datapack: 'd',
        engineMargin: 0.2,
        correct: true,
        engineWinner: 'wrong',
        truth: ['svc'],
      }),
    ];
    const floor = lossFreeFloor(rows);
    expect(floor).not.toBeNull();
    // The threshold is the highest margin that still DESTROYS a case — `d`, at 0.2 — and not the lowest margin in
    // the skipped set. That is the number a reader can act on: one step below it and the saving starts costing
    // cases. `skipAt` reproduces the same three skips from it, because the comparison is exclusive and `d` sits
    // exactly on the threshold rather than above it.
    expect(floor!.floor).toBeCloseTo(0.2, 9);
    expect(floor!.skipped).toBe(3);
    expect(floor!.gains).toBe(0);
    expect(floor!.losses).toBe(0);
    expect(floor!.delta).toBe(0);
  });

  it('returns null when no floor is loss-free, rather than reporting a saving that costs accuracy', () => {
    // Every case is a repair the engine gets wrong, so any skip loses one.
    const rows = [row({ engineMargin: 5, correct: true, engineWinner: 'wrong', truth: ['svc'] })];
    expect(lossFreeFloor(rows)).toBeNull();
  });

  it('silences every measured case when the engine answer never destroys one', () => {
    // No cliff means no threshold to sit under: the rule is loss-free everywhere, so the maximal saving is every
    // case that carries a margin. A floor returned as `null` here would hide a saving, not protect one.
    const rows = [
      row({ datapack: 'a', engineMargin: 3 }),
      row({ datapack: 'b', engineMargin: 0.1 }),
      row({ datapack: 'c', engineMargin: null }),
    ];
    const floor = lossFreeFloor(rows);
    expect(floor).not.toBeNull();
    expect(floor!.skipped).toBe(2);
    expect(floor!.losses).toBe(0);
    // The unmeasured row keeps its call: the floor is a threshold on a number, and this case has none.
    expect(floor!.accuracy).toBeCloseTo(1, 9);
  });
});

describe('ruleEdges', () => {
  it('names the highest margin at which the engine answer destroys a correct case, and the highest it repairs', () => {
    // These two numbers are the whole difference between a rule and a fit: above the first, the floor changes no
    // case at all, and the saving is proved rather than observed.
    const rows = [
      row({ datapack: 'destroy-high', engineMargin: 0.86, correct: true, engineWinner: 'wrong' }),
      row({ datapack: 'destroy-low', engineMargin: 0.3, correct: true, engineWinner: 'wrong' }),
      row({ datapack: 'repair', engineMargin: 0.55, correct: false, engineWinner: 'svc' }),
      row({ datapack: 'same', engineMargin: 4, correct: true }),
    ];
    const edges = ruleEdges(rows);
    expect(edges.destroys).toBeCloseTo(0.86, 9);
    expect(edges.repairs).toBeCloseTo(0.55, 9);
    // Above the cliff the priced rule is a no-op, which is the claim a dispatch can then falsify in one run.
    const reading = skipAt(rows, edges.destroys!);
    expect(reading.skipped).toBe(1);
    expect(reading.gains).toBe(0);
    expect(reading.losses).toBe(0);
  });

  it('reports no cliff when nothing is ever destroyed, which is a different claim from a zero margin', () => {
    const edges = ruleEdges([row({ engineMargin: 2, correct: true })]);
    expect(edges.destroys).toBeNull();
    expect(edges.repairs).toBeNull();
  });

  it('ignores a case whose margin was never measured, because an absent number has no edge', () => {
    const edges = ruleEdges([
      row({ engineMargin: null, correct: true, engineWinner: 'wrong' }),
      row({ engineMargin: 0.4, correct: true, engineWinner: 'wrong' }),
    ]);
    expect(edges.destroys).toBeCloseTo(0.4, 9);
  });

  it('refuses an artifact with no margin column, for the same reason the curve does', () => {
    const noMargin = [{ ...row(), engineMargin: undefined }] as unknown as CostRow[];
    expect(() => ruleEdges(noMargin)).toThrow(/engineMargin/);
  });
});

describe('the reading this iteration publishes', () => {
  it('is reproducible from the artifact it quotes', () => {
    // The corpus's own shape, coarsened to four strata: the audit must place the cost where the artifact puts it.
    const rows = [
      row({ datapack: 'a', answeredBy: 'model', promptTokens: 7_262 * 2, engineMargin: 0.3 }),
      row({ datapack: 'b', answeredBy: 'prior', promptTokens: 7_147, engineMargin: 1.4 }),
      row({ datapack: 'c', answeredBy: 'interface', promptTokens: 7_123, engineMargin: 1.1 }),
    ];
    const audit = auditCost(rows);
    expect(audit.cases).toBe(3);
    // 786 of 1 422 cases in the real artifact are settled without the model; here two of three are.
    expect(audit.strata.filter((s) => s.by !== 'model').reduce((sum, s) => sum + s.cases, 0)).toBe(
      2,
    );
  });
});

describe('the branches an artifact of one shape never reaches', () => {
  it('orders two strata of equal cost by name, so a report does not reshuffle between runs', () => {
    // A tie is not hypothetical: `door` and `certainty` differ by a fraction of a case's cost in a small sample,
    // and a sort that fell back to insertion order would print the table in artifact order.
    const audit = auditCost([
      row({ datapack: 'a', answeredBy: 'zeta' }),
      row({ datapack: 'b', answeredBy: 'alpha' }),
    ]);
    expect(audit.strata.map((s) => s.by)).toEqual(['alpha', 'zeta']);
  });

  it('reports a zero input share rather than NaN for an artifact that spent nothing', () => {
    // A dry run writes rows with zero tokens. Dividing by its total would put NaN in the column a reader trusts.
    const audit = auditCost([row({ promptTokens: 0, completionTokens: 0 })]);
    expect(audit.inputShare).toBe(0);
    expect(audit.perCase).toBe(0);
  });

  it('keeps the model call for a row whose margin is missing even though the column exists', () => {
    // The first row proves the column is there; the second is a case written before the value was carried. It must
    // not be skipped — a decision taken on a number that is not in the file is a decision nobody can re-read.
    const rows = [
      row({ datapack: 'a', engineMargin: 3 }),
      { ...row({ datapack: 'b' }), engineMargin: undefined } as unknown as CostRow,
    ];
    const reading = skipAt(rows, 0.5);
    expect(reading.skipped).toBe(1);
    expect(reading.accuracy).toBe(1);
  });

  it('returns no floor when no case carries a margin, rather than an empty skip that reads as a saving', () => {
    const rows = [row({ engineMargin: null }), row({ datapack: 'b', engineMargin: null })];
    expect(lossFreeFloor(rows)).toBeNull();
  });
});

describe('the two failure shapes a skip can hide', () => {
  it('counts a kept case that is wrong as wrong, and does not credit its engine answer', () => {
    // Below the floor the model runs; if the engine was also wrong, nothing about this case improves and the
    // accuracy column must not borrow the engine's answer for it.
    const rows = [
      row({ engineMargin: 0.1, correct: false, engineWinner: 'wrong', truth: ['svc'] }),
    ];
    const reading = skipAt(rows, 0.9);
    expect(reading.skipped).toBe(0);
    expect(reading.accuracy).toBe(0);
    expect(reading.saved).toBe(0);
  });

  it('lets the free-floor walk cross a case the engine repairs, which is a gain and not a loss', () => {
    // Engine right, model wrong, high margin: skipping it is +1, and a walk that stopped on any change would
    // stop here and report a floor of null.
    const rows = [
      row({ datapack: 'a', engineMargin: 2, correct: false, engineWinner: 'svc', truth: ['svc'] }),
      row({ datapack: 'b', engineMargin: 1.5, correct: true }),
    ];
    const floor = lossFreeFloor(rows);
    expect(floor!.skipped).toBe(2);
    expect(floor!.delta).toBe(1);
    expect(floor!.accuracy).toBe(1);
  });
});

describe('the risk the floor carries, stated in the same units', () => {
  it('reports a negative delta when a high-margin case was one only the model got right', () => {
    // The floor is a bet, and this is what losing it looks like: the engine was confident and wrong, the model was
    // right, and the case costs one point to skip. A reading that could not express this would be a sales sheet.
    const rows = [row({ engineMargin: 4, correct: true, engineWinner: 'wrong', truth: ['svc'] })];
    const reading = skipAt(rows, 0.9);
    expect(reading.delta).toBe(-1);
    expect(reading.accuracy).toBe(0);
    expect(reading.saved).toBeGreaterThan(0);
  });
});

describe('byCostThenName', () => {
  it('orders by cost first, so the largest line is the decision a reader sees', () => {
    expect(byCostThenName({ cost: 1, by: 'z' }, { cost: 2, by: 'a' })).toBeGreaterThan(0);
  });

  it('breaks a tie by code unit, ascending', () => {
    expect(byCostThenName({ cost: 1, by: 'alpha' }, { cost: 1, by: 'zeta' })).toBe(-1);
    expect(byCostThenName({ cost: 1, by: 'zeta' }, { cost: 1, by: 'alpha' })).toBe(1);
  });

  it('is a total order, so equal entries do not permute between runs', () => {
    // Two strata cannot share a name inside one audit, but a comparator that returned a non-zero for equal input
    // would make `sort` unstable across engines — the defect that costs a reader the ability to diff two reports.
    expect(byCostThenName({ cost: 1, by: 'x' }, { cost: 1, by: 'x' })).toBe(0);
  });
});
