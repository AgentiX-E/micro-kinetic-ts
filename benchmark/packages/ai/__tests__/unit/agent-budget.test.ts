import { describe, expect, it } from 'vitest';

import {
  AgentBudget,
  DEEPSEEK_PRICE,
  DEFAULT_ELIMINATOR_BUDGET,
  DEFAULT_INVESTIGATOR_BUDGET,
  formatMicroUsd,
  parseBudget,
  roundCost,
  tokenCost,
} from '../../src/agent/budget.js';

describe('tokenCost', () => {
  it('converts tokens at a per-million price into micro-dollars exactly', () => {
    // 9 000 tokens at $0.27/M is $0.00243, i.e. 2 430 µ$.
    expect(tokenCost(9_000, 0.27)).toBe(2_430);
  });

  it('charges nothing for no tokens', () => {
    expect(tokenCost(0, 0.27)).toBe(0);
  });

  it('rounds once, to the nearest micro-dollar', () => {
    // 1 token at $0.27/M is 0.27 µ$, which cannot be stored: the ledger is integral by construction.
    expect(tokenCost(1, 0.27)).toBe(0);
    expect(tokenCost(2, 0.27)).toBe(1);
  });
});

describe('roundCost', () => {
  it('sums input and output and prices them separately', () => {
    const cost = roundCost({ input: 2_600, output: 400 }, DEEPSEEK_PRICE);
    // 2 600 × 0.27 = 702 µ$, 400 × 1.1 = 440 µ$; tokens are the plain sum.
    expect(cost).toEqual({ tokens: 3_000, microUsd: 1_142 });
  });

  it('prices a three-round eliminator case at about four tenths of a cent', () => {
    // The number the plan quotes: three rounds of a 3k-token fingerprint is $0.0038, and 1 422 cases is $5.3.
    let microUsd = 0;
    let tokens = 0;
    for (const round of [
      { input: 2_600, output: 400 },
      { input: 3_000, output: 400 },
      { input: 3_400, output: 400 },
    ]) {
      const cost = roundCost(round, DEEPSEEK_PRICE);
      microUsd += cost.microUsd;
      tokens += cost.tokens;
    }
    expect(tokens).toBe(10_200);
    expect(microUsd).toBeGreaterThan(3_400);
    expect(microUsd).toBeLessThan(4_200);
  });
});

describe('formatMicroUsd', () => {
  it('prints six decimals so a gate at one cent is readable', () => {
    expect(formatMicroUsd(10_000)).toBe('0.010000');
    expect(formatMicroUsd(3_800)).toBe('0.003800');
    expect(formatMicroUsd(0)).toBe('0.000000');
  });
});

describe('parseBudget', () => {
  it('reads rounds,tokens,usd off one line', () => {
    expect(parseBudget('3,9000,0.01')).toEqual({ rounds: 3, tokens: 9_000, microUsd: 10_000 });
  });

  it('refuses a specification with the wrong number of fields', () => {
    // A missing field would parse to NaN, and NaN compares false against every gate, which allows unbounded
    // spend. The refusal is the only safe reading of a truncated line.
    expect(() => parseBudget('3,9000')).toThrow(RangeError);
    expect(() => parseBudget('3,9000,0.01,extra')).toThrow(RangeError);
  });

  it('refuses a round count that is not a whole number', () => {
    expect(() => parseBudget('2.5,9000,0.01')).toThrow(/rounds must be a non-negative integer/);
    expect(() => parseBudget('-1,9000,0.01')).toThrow(/rounds must be a non-negative integer/);
    expect(() => parseBudget('three,9000,0.01')).toThrow(RangeError);
  });

  it('refuses a token or dollar budget that is not a finite non-negative number', () => {
    expect(() => parseBudget('3,-1,0.01')).toThrow(/tokens/);
    expect(() => parseBudget('3,many,0.01')).toThrow(/tokens/);
    expect(() => parseBudget('3,9000,-0.01')).toThrow(/usd/);
    expect(() => parseBudget('3,9000,cheap')).toThrow(/usd/);
  });

  it('reads zero as zero rather than as absent', () => {
    // A zero round budget is a real configuration: it is how a dispatch proves the layer does not run.
    expect(parseBudget('0,0,0')).toEqual({ rounds: 0, tokens: 0, microUsd: 0 });
  });
});

describe('AgentBudget', () => {
  it('admits rounds until the round gate is reached', () => {
    const budget = new AgentBudget({ rounds: 2, tokens: 1_000, microUsd: 1_000 });
    const cost = { tokens: 10, microUsd: 10 };
    expect(budget.admits(cost)).toBeNull();
    budget.record(cost);
    budget.record(cost);
    expect(budget.admits(cost)).toBe('rounds');
    expect(budget.exhausted).toBe(true);
  });

  it('admits rounds until the token gate is reached', () => {
    const budget = new AgentBudget({ rounds: 10, tokens: 25, microUsd: 1_000 });
    const cost = { tokens: 10, microUsd: 1 };
    budget.record(cost);
    budget.record(cost);
    expect(budget.admits(cost)).toBe('tokens');
    expect(budget.spend).toEqual({ rounds: 2, tokens: 20, microUsd: 2 });
  });

  it('admits rounds until the dollar gate is reached', () => {
    const budget = new AgentBudget({ rounds: 10, tokens: 1_000, microUsd: 25 });
    const cost = { tokens: 1, microUsd: 10 };
    budget.record(cost);
    budget.record(cost);
    expect(budget.admits(cost)).toBe('usd');
  });

  it('treats an exactly-full budget as spent, not as one more round', () => {
    // The boundary that matters for a one-cent gate: the round that lands exactly on the limit is admitted, and
    // the next one is not. Off-by-one here is a silent doubling of the budget.
    const budget = new AgentBudget({ rounds: 1, tokens: 10, microUsd: 10 });
    expect(budget.admits({ tokens: 10, microUsd: 10 })).toBeNull();
    budget.record({ tokens: 10, microUsd: 10 });
    expect(budget.exhausted).toBe(true);
    expect(budget.admits({ tokens: 0, microUsd: 0 })).toBe('rounds');
  });

  it('refuses to record a round it did not admit', () => {
    const budget = new AgentBudget({ rounds: 1, tokens: 10, microUsd: 10 });
    budget.record({ tokens: 10, microUsd: 10 });
    expect(() => budget.record({ tokens: 1, microUsd: 1 })).toThrow(/budget exceeded on rounds/);
    // And the ledger is unchanged by the refusal: a failed record must not half-apply.
    expect(budget.spend).toEqual({ rounds: 1, tokens: 10, microUsd: 10 });
  });

  it('names the gate that would be crossed rather than a generic refusal', () => {
    const budget = new AgentBudget({ rounds: 10, tokens: 5, microUsd: 5 });
    expect(budget.admits({ tokens: 6, microUsd: 0 })).toBe('tokens');
    expect(budget.admits({ tokens: 0, microUsd: 6 })).toBe('usd');
  });

  it('is exhausted when any single gate is reached, not only the round gate', () => {
    // The round gate usually binds first, so a test suite that only ever exhausts rounds never evaluates the
    // other two conditions. A token-only or dollar-only exhaustion is a real configuration — a long cheap round
    // against a short expensive one — and reading it as "not exhausted" would spend past the gate.
    const byTokens = new AgentBudget({ rounds: 10, tokens: 10, microUsd: 1_000 });
    byTokens.record({ tokens: 10, microUsd: 1 });
    expect(byTokens.exhausted).toBe(true);

    const byDollars = new AgentBudget({ rounds: 10, tokens: 1_000, microUsd: 10 });
    byDollars.record({ tokens: 1, microUsd: 10 });
    expect(byDollars.exhausted).toBe(true);
  });

  it('starts exhausted at a zero-round budget, which is how a dispatch proves the layer is off', () => {
    expect(new AgentBudget({ rounds: 0, tokens: 0, microUsd: 0 }).exhausted).toBe(true);
  });

  it('hands out a copy of the ledger, so a caller cannot rewrite what was spent', () => {
    const budget = new AgentBudget(DEFAULT_ELIMINATOR_BUDGET);
    budget.record({ tokens: 1, microUsd: 1 });
    const snapshot = budget.spend;
    expect(snapshot).toEqual({ rounds: 1, tokens: 1, microUsd: 1 });
    // Mutating the snapshot is a caller bug that must not reach the gate.
    (snapshot as { rounds: number }).rounds = 99;
    expect(budget.spend.rounds).toBe(1);
  });

  it('accumulates ten thousand tiny rounds without drift', () => {
    // The reason the ledger is integral. At $0.000004 per round a float accumulator has lost about 1e-11 by the
    // ten-thousandth entry, which is enough to make two reruns of the same corpus bill differently — and a billed
    // difference is an ablation that compared two budgets.
    const rounds = 10_000;
    const budget = new AgentBudget({ rounds, tokens: rounds, microUsd: rounds * 4 });
    for (let index = 0; index < rounds; index += 1) {
      budget.record({ tokens: 1, microUsd: 4 });
    }
    expect(budget.spend.microUsd).toBe(40_000);
    expect(budget.exhausted).toBe(true);
    // The same ledger read as dollars, which is what the report prints: exactly four hundredths, no residue.
    expect(formatMicroUsd(budget.spend.microUsd)).toBe('0.040000');
  });
});

describe('default budgets', () => {
  it('gives the eliminator three rounds and one cent', () => {
    expect(DEFAULT_ELIMINATOR_BUDGET).toEqual({ rounds: 3, tokens: 9_000, microUsd: 10_000 });
  });

  it('gives the investigator more of everything, because free-form search is what costs', () => {
    expect(DEFAULT_INVESTIGATOR_BUDGET.rounds).toBeGreaterThan(DEFAULT_ELIMINATOR_BUDGET.rounds);
    expect(DEFAULT_INVESTIGATOR_BUDGET.microUsd).toBeGreaterThan(
      DEFAULT_ELIMINATOR_BUDGET.microUsd,
    );
  });

  it('prices output above input, as every provider does', () => {
    expect(DEEPSEEK_PRICE.outputPerMillion).toBeGreaterThan(DEEPSEEK_PRICE.inputPerMillion);
  });
});
