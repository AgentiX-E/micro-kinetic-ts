import { describe, expect, it } from 'vitest';

import type { SamplingRecord } from '../src/agentic-sampling.js';
import { stratifiedSample } from '../src/agentic-sampling.js';

/** Builds `count` records in one stratum, ids prefixed so their lexicographic order is known. */
function family(
  faultType: string,
  count: number,
  options: { depth?: number; engineCorrect?: boolean } = {},
): SamplingRecord[] {
  const records: SamplingRecord[] = [];
  // The id carries the stratum, because in a real corpus a case belongs to exactly one — a fixture that reused
  // ids across strata would make the duplicate check fire on a corpus that cannot exist.
  const depthTag = options.depth === undefined ? 'nd' : `d${options.depth}`;
  const correctnessTag = (options.engineCorrect ?? true) ? 'ok' : 'miss';
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(3, '0');
    records.push({
      caseId: `${faultType}-${depthTag}-${correctnessTag}-${suffix}`,
      faultType,
      ...(options.depth === undefined ? {} : { depth: options.depth }),
      engineCorrect: options.engineCorrect ?? true,
    });
  }
  return records;
}

/** The share of a stratum in the corpus, for comparing the plan against the population. */
function share(
  plan: { strata: readonly { population: number; selected: number }[] },
  index: number,
): {
  ofCorpus: number;
  ofSample: number;
} {
  const population = plan.strata.reduce((sum, stratum) => sum + stratum.population, 0);
  const sampled = plan.strata.reduce((sum, stratum) => sum + stratum.selected, 0);
  const stratum = plan.strata[index];
  if (stratum === undefined) throw new Error('no such stratum');
  return { ofCorpus: stratum.population / population, ofSample: stratum.selected / sampled };
}

describe('stratifiedSample', () => {
  it('returns nothing for an empty corpus, without dividing by zero', () => {
    const plan = stratifiedSample([], 500);
    expect(plan.selected).toEqual([]);
    expect(plan.strata).toEqual([]);
    expect(plan.target).toBe(0);
    expect(plan.shortfall).toBe(0);
  });

  it('returns the whole corpus when the target exceeds it', () => {
    const corpus = family('cpu', 10);
    const plan = stratifiedSample(corpus, 500);
    expect(plan.selected).toHaveLength(10);
    expect(plan.target).toBe(10);
    expect(plan.shortfall).toBe(0);
  });

  it('keeps every fault family present in the corpus', () => {
    // The property the whole design exists for: a family that vanishes from the arm is a family the arm cannot
    // report on, and the published comparison is per-family.
    const corpus = [
      ...family('cpu', 60),
      ...family('mem', 40),
      ...family('PodKill', 25),
      ...family('NetworkDelay', 20),
      ...family('HTTPResponseReplaceBody', 15),
      ...family('disk', 12),
    ];
    const plan = stratifiedSample(corpus, 50);
    const families = new Set(plan.strata.map((stratum) => stratum.faultType));
    expect(families.size).toBe(6);
    for (const stratum of plan.strata) {
      expect(stratum.selected).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the proportions of the corpus, not the proportions of the floor', () => {
    // The floor alone would give every family three and stop, which is a sample of the floor rather than of the
    // corpus. Largest remainder is what restores the share.
    const corpus = [...family('cpu', 300), ...family('mem', 100), ...family('disk', 100)];
    const plan = stratifiedSample(corpus, 100);
    const cpu = share(plan, 0);
    expect(cpu.ofSample).toBeGreaterThan(cpu.ofCorpus - 0.06);
    expect(cpu.ofSample).toBeLessThan(cpu.ofCorpus + 0.06);
    expect(plan.selected).toHaveLength(100);
  });

  it('lands within one case of the corpus count for every stratum', () => {
    // The stronger statement: not just the biggest family, every cell.
    const corpus = [
      ...family('a', 137),
      ...family('b', 83, { engineCorrect: false }),
      ...family('c', 41, { depth: 2 }),
      ...family('d', 19, { depth: 4, engineCorrect: false }),
    ];
    const plan = stratifiedSample(corpus, 120);
    for (const stratum of plan.strata) {
      const proportional = (plan.target * stratum.population) / corpus.length;
      expect(Math.abs(stratum.selected - proportional)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps each depth apart rather than pooling it into its family', () => {
    // Depth is the axis on which the published accuracy collapses (89.5 to 57.1 between depth 2 and 5), so
    // pooling it would hide exactly the stratum a regression would show up in.
    const corpus = [
      ...family('cpu', 40, { depth: 1 }),
      ...family('cpu', 40, { depth: 3 }),
      ...family('cpu', 40, { depth: 5 }),
    ];
    const plan = stratifiedSample(corpus, 30);
    expect(plan.strata).toHaveLength(3);
    expect(plan.strata.map((stratum) => stratum.depth)).toEqual([1, 3, 5]);
    for (const stratum of plan.strata) expect(stratum.selected).toBe(10);
  });

  it('keeps correct and incorrect cases apart, so the arm can report both halves', () => {
    const corpus = [
      ...family('cpu', 50, { engineCorrect: true }),
      ...family('cpu', 50, { engineCorrect: false }),
    ];
    const plan = stratifiedSample(corpus, 20);
    expect(plan.strata).toHaveLength(2);
    expect(plan.strata.map((stratum) => stratum.selected)).toEqual([10, 10]);
  });

  it('reports a floor of zero when the target cannot cover one case per stratum', () => {
    // Six families and a target of four: the plan cannot keep every family, and it must say so rather than
    // pretending the coverage property held.
    const corpus = [
      ...family('a', 10),
      ...family('b', 10),
      ...family('c', 10),
      ...family('d', 10),
      ...family('e', 10),
      ...family('f', 10),
    ];
    const plan = stratifiedSample(corpus, 4);
    expect(plan.floor).toBe(0);
    expect(plan.selected).toHaveLength(4);
    const empty = plan.strata.filter((stratum) => stratum.selected === 0);
    expect(empty.length).toBeGreaterThan(0);
  });

  it('reports a floor of one when the target covers every stratum but not the floor', () => {
    const corpus = [...family('a', 10), ...family('b', 10), ...family('c', 10)];
    const plan = stratifiedSample(corpus, 3);
    expect(plan.floor).toBe(1);
    expect(plan.selected).toHaveLength(3);
  });

  it('reports a shortfall instead of silently shrinking the target', () => {
    // A target the strata cannot supply: four cases exist, five were asked for after clamping to the corpus, so
    // the only way this can be non-zero is the clamp itself. The assertion is that the field exists and is exact.
    const plan = stratifiedSample(family('cpu', 4), 9);
    expect(plan.target).toBe(4);
    expect(plan.shortfall).toBe(0);
    const impossible = stratifiedSample(family('cpu', 4), 4, { minPerStratum: 3 });
    expect(impossible.selected).toHaveLength(4);
    expect(impossible.shortfall).toBe(0);
  });

  it('is deterministic under a shuffled corpus', () => {
    // The plan has to be reproducible from the corpus alone: no seed, no file order. This is what makes two
    // dispatches of the same arm comparable byte for byte.
    const corpus = [
      ...family('cpu', 40),
      ...family('mem', 30, { depth: 2 }),
      ...family('disk', 30, { engineCorrect: false }),
    ];
    const forward = stratifiedSample(corpus, 30);
    const backward = stratifiedSample([...corpus].reverse(), 30);
    expect(backward.selected).toEqual(forward.selected);
    expect(backward.strata).toEqual(forward.strata);
  });

  it('does not select the first k cases of a stratum', () => {
    // A prefix is a biased sample whenever the archive's order correlates with anything, and it does: the
    // datapack names sort by system then by family. The hash has to move the selection off the prefix.
    const corpus = family('cpu', 20);
    const plan = stratifiedSample(corpus, 8);
    const prefix = new Set(corpus.slice(0, 8).map((record) => record.caseId));
    const selected = new Set(plan.selected);
    expect([...selected].sort()).not.toEqual([...prefix].sort());
  });

  it('orders the selection by stratum and then by hash, not by input order', () => {
    const corpus = [...family('b', 5), ...family('a', 5)];
    const plan = stratifiedSample(corpus, 10);
    expect(plan.selected.slice(0, 5).every((id) => id.startsWith('a-'))).toBe(true);
    expect(plan.selected.slice(5).every((id) => id.startsWith('b-'))).toBe(true);
  });

  it('treats an absent depth as its own stratum rather than as zero', () => {
    // A corpus that publishes no depth and one that publishes depth zero are different corpora. Coercing the
    // absent case to a sentinel would merge them and make the coverage table a lie.
    const corpus = [...family('cpu', 10), ...family('cpu', 10, { depth: 0 })];
    const plan = stratifiedSample(corpus, 20);
    expect(plan.strata).toHaveLength(2);
    expect(plan.strata[0]?.depth).toBeUndefined();
    expect(plan.strata[1]?.depth).toBe(0);
  });

  it('honours a custom floor', () => {
    const corpus = [...family('a', 100), ...family('b', 4)];
    const plan = stratifiedSample(corpus, 20, { minPerStratum: 5 });
    const small = plan.strata.find((stratum) => stratum.faultType === 'b');
    // The floor cannot exceed what the stratum holds, and it must not be padded beyond it.
    expect(small?.selected).toBe(4);
  });

  it('never selects a case id twice', () => {
    const corpus = [...family('a', 30), ...family('b', 30), ...family('c', 30)];
    const plan = stratifiedSample(corpus, 45);
    expect(new Set(plan.selected).size).toBe(plan.selected.length);
  });

  it('clamps a fractional or negative target into range', () => {
    const corpus = family('cpu', 10);
    expect(stratifiedSample(corpus, 2.7).selected).toHaveLength(2);
    expect(stratifiedSample(corpus, -5).selected).toHaveLength(0);
  });

  it('never takes more cases than it announced, even when the floor would overspend', () => {
    // The floor wants three from every stratum. A stratum holding two takes only two, while its neighbours each
    // still take three — and when the target is exactly the floor times the stratum count, the sum exceeds it.
    // An arm that runs more cases than it announced is an arm whose accuracy is over a different denominator.
    const corpus = [...family('a', 2), ...family('b', 1_000), ...family('c', 1_000)];
    const plan = stratifiedSample(corpus, 9);
    expect(plan.selected).toHaveLength(9);
    expect(plan.target).toBe(9);
    expect(plan.shortfall).toBe(0);
    expect(plan.strata.reduce((sum, stratum) => sum + stratum.selected, 0)).toBe(9);
  });

  it('claws the overspend back from the strata the floor over-served', () => {
    // The donor order has to be the slack, not the stratum order: taking a case away from a family that was
    // already under its share would make the deficit worse, not better.
    const corpus = [...family('a', 2), ...family('b', 200), ...family('c', 8)];
    const plan = stratifiedSample(corpus, 12);
    expect(plan.selected).toHaveLength(12);
    const tiny = plan.strata.find((stratum) => stratum.faultType === 'a');
    // The two-case family keeps both cases: it is under its share by construction, so it cannot be a donor.
    expect(tiny?.selected).toBe(2);
  });

  it('skips a stratum that has reached its capacity while filling the remainder', () => {
    // The loop that spends the remainder must not over-fill a stratum, and the only way it can be asked to is a
    // corpus where the largest-remainder order puts a full stratum first.
    const corpus = [...family('a', 3), ...family('b', 60), ...family('c', 60)];
    const plan = stratifiedSample(corpus, 20);
    for (const stratum of plan.strata) {
      expect(stratum.selected).toBeLessThanOrEqual(stratum.population);
    }
    expect(plan.selected).toHaveLength(20);
  });

  it('breaks a remainder tie by stratum key, so two symmetric families are ordered deterministically', () => {
    // Two families of equal size have equal slack, which is the arm where the key decides the order.
    const corpus = [...family('alpha', 50), ...family('beta', 50), ...family('gamma', 50)];
    const forward = stratifiedSample(corpus, 10);
    const shuffled = stratifiedSample([...corpus].reverse(), 10);
    expect(shuffled.selected).toEqual(forward.selected);
    // Reversed input makes the comparator see the pair in the other order, which is the only way the second arm
    // of the key comparison is reached: a sort over already-sorted input only ever asks "is this one smaller".
    expect(stratifiedSample([...corpus].reverse(), 10).strata).toEqual(forward.strata);
  });

  it('fills the remainder with whole rounds, so a large budget never gives one family everything', () => {
    // A budget larger than the stratum count has to come round again rather than pour itself into the first
    // family; the assertion is the spread, not the total.
    const corpus = [...family('a', 40), ...family('b', 40), ...family('c', 40), ...family('d', 40)];
    const plan = stratifiedSample(corpus, 30);
    const counts = plan.strata.map((stratum) => stratum.selected);
    expect(counts.every((count) => count >= 7)).toBe(true);
    expect(plan.selected).toHaveLength(30);
  });

  it('claws back across several donors when one is not enough', () => {
    // Two over-served families and a third that must stay untouched: the donor loop has to keep going after the
    // first family is spent, in surplus order.
    const corpus = [...family('a', 2), ...family('b', 2), ...family('c', 196)];
    const plan = stratifiedSample(corpus, 10);
    expect(plan.selected).toHaveLength(10);
    const smallest = plan.strata.filter((stratum) => stratum.population === 2);
    expect(smallest.every((stratum) => stratum.selected === 2)).toBe(true);
  });

  it('refuses a corpus holding the same case twice', () => {
    // A duplicate id would be sampled twice, counted twice in the arm's accuracy and invisible in the coverage
    // table: a corpus defect that reads as a method result.
    const doubled = [...family('cpu', 2), ...family('cpu', 2)];
    expect(() => stratifiedSample(doubled, 2)).toThrow(/duplicate case id/);
  });

  it('falls back to the case id when the hash ties, so the order is still total', () => {
    // Every id hashing equal is the arm where the tie-break decides everything, and the only way to reach it: a
    // well-distributed hash makes a tie a one-in-four-billion event, so a rule whose tie-break is never exercised
    // is a rule whose tie-break is never checked.
    const corpus = family('cpu', 6);
    const plan = stratifiedSample(corpus, 3, { hash: () => 0 });
    expect(plan.selected).toEqual(corpus.slice(0, 3).map((record) => record.caseId));
    // Reversed input makes the sort compare a pair in the other direction, which is the only way the second arm
    // of the id comparison is reached — and the selection must not depend on which direction it was asked.
    const reversed = stratifiedSample([...corpus].reverse(), 3, { hash: () => 0 });
    expect(reversed.selected).toEqual(plan.selected);
  });

  it('honours a custom hash, so the scatter is a parameter and not a constant', () => {
    const corpus = family('cpu', 6);
    const reversed = stratifiedSample(corpus, 3, { hash: (id) => -id.charCodeAt(id.length - 1) });
    expect(reversed.selected).toEqual(
      corpus
        .slice(3)
        .reverse()
        .map((record) => record.caseId),
    );
  });
});
