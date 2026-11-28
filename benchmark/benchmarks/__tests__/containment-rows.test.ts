/**
 * The containment rows: one artifact, two arms, and an unmeasured side that must survive the serialisation.
 *
 * @module benchmarks/__tests__/containment-rows.test
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ContainmentRowDump,
  formatContainmentRow,
  parseContainmentRows,
  readContainmentRows,
  type ContainmentCaseRow,
  type ContainmentChain,
} from '../src/containment-rows.js';

/** The sweep's input, as the builder writes it. */
function chain(overrides: Partial<ContainmentChain> = {}): ContainmentChain {
  return {
    order: ['frontend', 'cart'],
    edges: [['frontend', 'cart']],
    excursions: { frontend: 0, cart: 2.5 },
    failedInterfaces: { 'frontend\u0000cart': 4 },
    flows: { cart: { knownIn: 9, knownOut: 0, novelIn: 0, novelOut: 0 } },
    failingEdges: { 'frontend\u0000cart': { rise: 9, novel: 0 } },
    attribution: 'shape',
    ...overrides,
  };
}

/** A case row with one measured pair and one unmeasured side, which is the shape the register cares about. */
function row(overrides: Partial<ContainmentCaseRow> = {}): ContainmentCaseRow {
  return {
    datapack: 'datapack-1',
    faultType: 'NetworkDelay',
    sigma: 3,
    margin: 0,
    depth: 5,
    fusionTop1: 'frontend',
    gatedTop1: 'cart',
    ungatedTop1: 'cart',
    shippedTop1: 'cart',
    replay: 'identical',
    pairs: [
      {
        upper: 'frontend',
        lower: 'cart',
        decision: 'inverted',
        upperExcursion: 0,
        lowerExcursion: 2.5,
      },
      { upper: 'cart', lower: 'db', decision: 'unmeasured', lowerExcursion: 1.25 },
    ],
    ungatedPairs: [{ upper: 'frontend', lower: 'cart', decision: 'inverted', lowerExcursion: 2.5 }],
    chain: chain(),
    ...overrides,
  };
}

const dirs: string[] = [];

/** A fresh directory per test, removed afterwards. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'containment-rows-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('formatContainmentRow', () => {
  it('omits an unmeasured side rather than writing zero', () => {
    const parsed = JSON.parse(formatContainmentRow(row())) as {
      pairs: Array<Record<string, unknown>>;
    };
    // The first pair measured both sides, and a measured ZERO is a value: the refusal in the register is about
    // absence, not about the number zero, and dropping it here would make "inside the band" indistinguishable
    // from "the profile could not speak".
    expect(parsed.pairs[0]).toHaveProperty('upperExcursion', 0);
    expect(parsed.pairs[0]).toHaveProperty('lowerExcursion', 2.5);
    // The second pair's upper side was never measured, and the KEY is absent — not null, which every consumer
    // doing arithmetic would read as a measurement of zero.
    expect(parsed.pairs[1]).not.toHaveProperty('upperExcursion');
    expect(parsed.pairs[1]).toHaveProperty('lowerExcursion', 1.25);
  });

  it('writes the two arms as two traces rather than as two columns on one row', () => {
    const parsed = JSON.parse(formatContainmentRow(row())) as Record<string, unknown>;
    expect(Array.isArray(parsed.pairs)).toBe(true);
    expect(Array.isArray(parsed.ungatedPairs)).toBe(true);
    expect(parsed.pairs).not.toEqual(parsed.ungatedPairs);
  });

  it('round-trips through the parser', () => {
    const original = row();
    const parsed = parseContainmentRows(formatContainmentRow(original));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(original);
  });

  it('writes the noise floor beside the margin, so a reader replays the rule that produced the row', () => {
    // Iteration 382: the floor decides whether a boundary excursion is an excursion at all. A dump that did not
    // carry it would replay a pre-fix row under the fixed default and invent a disagreement.
    const original = row({ minCalleeExcursion: 0.1 });
    const parsed = parseContainmentRows(formatContainmentRow(original));
    expect(parsed[0]!.minCalleeExcursion).toBe(0.1);
    expect(JSON.parse(formatContainmentRow(original)) as Record<string, unknown>).toHaveProperty(
      'minCalleeExcursion',
      0.1,
    );
  });

  it('omits the floor when the row predates it, so an old dump reads as old rather than as floor zero', () => {
    const text = formatContainmentRow(row());
    expect(JSON.parse(text) as Record<string, unknown>).not.toHaveProperty('minCalleeExcursion');
    expect(parseContainmentRows(text)[0]!.minCalleeExcursion).toBeUndefined();
  });

  it('refuses a negative floor rather than replaying a rule nobody wrote', () => {
    const parsed = JSON.parse(formatContainmentRow(row())) as Record<string, unknown>;
    expect(() =>
      parseContainmentRows(JSON.stringify({ ...parsed, minCalleeExcursion: -0.1 })),
    ).toThrow(/minCalleeExcursion.*negative/);
  });

  it('writes the sweep s input beside its decisions, so the walk can be repeated', () => {
    const parsed = JSON.parse(formatContainmentRow(row())) as { chain: Record<string, unknown> };
    expect(parsed.chain.order).toEqual(['frontend', 'cart']);
    expect(parsed.chain.edges).toEqual([['frontend', 'cart']]);
    expect(parsed.chain.excursions).toEqual({ frontend: 0, cart: 2.5 });
    expect(parsed.chain.attribution).toBe('shape');
  });

  it('round-trips the surprise map, and keeps an absent one absent', () => {
    // The second measurement the pass can be walked with. A reader that turned absence into `{}` would make a dump
    // from before the field indistinguishable from a case where every candidate was measured and none moved.
    const withSurprises = row({ chain: chain({ surprises: { frontend: 0, cart: 2 } }) });
    expect(parseContainmentRows(formatContainmentRow(withSurprises))[0]!.chain!.surprises).toEqual({
      frontend: 0,
      cart: 2,
    });
    const without = JSON.parse(formatContainmentRow(row())) as { chain: Record<string, unknown> };
    expect(without.chain).not.toHaveProperty('surprises');
    expect(parseContainmentRows(formatContainmentRow(row()))[0]!.chain).not.toHaveProperty(
      'surprises',
    );
  });

  it('OMITS the chain rather than nulling it, so an old artifact is distinguishable from an empty case', () => {
    const { chain: _dropped, ...withoutChain } = row();
    const parsed = JSON.parse(formatContainmentRow(withoutChain)) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('chain');
    expect(parseContainmentRows(JSON.stringify(parsed))[0]).not.toHaveProperty('chain');
  });
});

describe('ContainmentRowDump', () => {
  it('truncates on construction so two runs cannot read as one population', () => {
    const path = join(scratch(), 'containment.ndjson');
    const first = new ContainmentRowDump(path);
    first.record(row());
    first.record(row({ datapack: 'datapack-2' }));
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2);
    const second = new ContainmentRowDump(path);
    second.record(row());
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('counts decisions per arm and checks the gated census adds up to its own pair count', () => {
    const path = join(scratch(), 'containment.ndjson');
    const dump = new ContainmentRowDump(path);
    dump.record(row());
    dump.record(
      row({
        datapack: 'datapack-2',
        replay: 'differs',
        pairs: [
          { upper: 'a', lower: 'b', decision: 'no-failed-interface', upperExcursion: 1 },
          { upper: 'b', lower: 'c', decision: 'not-larger' },
        ],
        ungatedPairs: [{ upper: 'a', lower: 'b', decision: 'inverted' }],
      }),
    );
    dump.record(
      row({ datapack: 'datapack-3', replay: 'unavailable', pairs: [], ungatedPairs: [] }),
    );
    const summary = dump.summary;
    expect(summary.cases).toBe(3);
    expect(summary.pairs).toBe(4);
    expect(summary.ungatedPairs).toBe(2);
    expect(summary.measuredPairs).toBe(1);
    expect(summary.inverted).toBe(1);
    expect(summary.noFailedInterface).toBe(1);
    expect(summary.unmeasured).toBe(1);
    expect(summary.notLarger).toBe(1);
    expect(summary.invertedUngated).toBe(2);
    expect(summary.replayIdentical).toBe(1);
    expect(summary.replayDiffers).toBe(1);
    expect(summary.replayUnavailable).toBe(1);
    // The identity the dump's docblock claims: every gated pair carries exactly one decision.
    expect(
      summary.inverted + summary.noFailedInterface + summary.unmeasured + summary.notLarger,
    ).toBe(summary.pairs);
  });

  it('counts an ungated pair that was refused, not only the ones the ungated arm inverted', () => {
    // The counter's job is to separate "the ungated walk examined this pair" from "the ungated walk inverted it",
    // because the difference is the whole price of the interface record (§4 of `docs/containment-order.md`). A
    // fixture whose every pair is inverted cannot tell the two counts apart, and would report the counter as
    // correct while it was only ever copying the total.
    const dump = new ContainmentRowDump(join(scratch(), 'containment.ndjson'));
    dump.record(
      row({
        ungatedPairs: [
          { upper: 'a', lower: 'b', decision: 'not-larger' },
          { upper: 'b', lower: 'c', decision: 'inverted' },
          { upper: 'c', lower: 'd', decision: 'no-failed-interface' },
        ],
      }),
    );
    expect(dump.summary.ungatedPairs).toBe(3);
    expect(dump.summary.invertedUngated).toBe(1);
  });

  it('counts the two prior refusals apart, should a gated arm ever be recorded through it', () => {
    // Neither arm a run sweeps can produce them — the run fits no prior — but the format's vocabulary is the
    // sweep's, not the two arms'. Folding them into `notLarger` would make a gate's refusals indistinguishable
    // from a measurement that pointed the other way.
    const path = join(scratch(), 'containment.ndjson');
    const dump = new ContainmentRowDump(path);
    dump.record(
      row({
        pairs: [
          { upper: 'a', lower: 'b', decision: 'prior-absent' },
          { upper: 'b', lower: 'c', decision: 'prior-below' },
        ],
      }),
    );
    const summary = dump.summary;
    expect(summary.priorAbsent).toBe(1);
    expect(summary.priorBelow).toBe(1);
    expect(summary.notLarger).toBe(0);
    expect(summary.inverted).toBe(0);
    expect(
      summary.inverted +
        summary.noFailedInterface +
        summary.unmeasured +
        summary.notLarger +
        summary.priorAbsent +
        summary.priorBelow,
    ).toBe(summary.pairs);
  });
});

describe('parseContainmentRows', () => {
  /** The message the parser refuses a text with, or `NO THROW` when it accepted it. */
  function rejectionOf(text: string): string {
    try {
      parseContainmentRows(text);
    } catch (error) {
      return (error as Error).message;
    }
    return 'NO THROW';
  }

  /** The message the parser refuses a patched record with, or `NO THROW` when it accepted it. */
  function rejection(patch: Record<string, unknown>): string {
    const base = JSON.parse(formatContainmentRow(row())) as Record<string, unknown>;
    return rejectionOf(JSON.stringify({ ...base, ...patch }));
  }

  it('skips blank lines and accepts a trailing newline', () => {
    const text = `\n${formatContainmentRow(row())}\n\n`;
    expect(parseContainmentRows(text)).toHaveLength(1);
  });

  it('refuses a line that is not JSON, naming the line', () => {
    expect(() => parseContainmentRows('not json')).toThrow(/line 1 is not JSON/);
  });

  it('refuses a line that is not an object', () => {
    expect(() => parseContainmentRows('[]')).toThrow(/line 1 is not an object/);
  });

  it('refuses an empty datapack', () => {
    expect(rejection({ datapack: '' })).toMatch(/datapack on line 1/);
  });

  it('refuses a non-string faultType', () => {
    expect(rejection({ faultType: 3 })).toMatch(/faultType on line 1/);
  });

  it('refuses a sigma that is not positive', () => {
    expect(rejection({ sigma: 0 })).toMatch(/sigma on line 1 is not positive/);
  });

  it('refuses a non-finite margin', () => {
    expect(rejection({ margin: 'x' })).toMatch(/margin on line 1/);
  });

  it('refuses an unknown replay verdict', () => {
    expect(rejection({ replay: 'maybe' })).toMatch(/replay on line 1/);
  });

  it('refuses a missing ungatedPairs trace instead of reading it as "the arm examined nothing"', () => {
    const base = JSON.parse(formatContainmentRow(row())) as Record<string, unknown>;
    delete base.ungatedPairs;
    expect(rejectionOf(JSON.stringify(base))).toMatch(/ungatedPairs on line 1/);
  });

  it('refuses a pairs field that is not an array', () => {
    expect(rejection({ pairs: 'none' })).toMatch(/pairs on line 1/);
  });

  it('refuses a pair whose decision is not one of the six', () => {
    expect(rejection({ pairs: [{ upper: 'a', lower: 'b', decision: 'refused' }] })).toMatch(
      /decision on line 1 is not a containment decision/,
    );
  });

  it('refuses a pair that is not an object', () => {
    expect(rejection({ pairs: ['a'] })).toMatch(/pair on line 1 is not an object/);
  });

  it('refuses a pair with an empty upper side', () => {
    expect(rejection({ pairs: [{ upper: '', lower: 'b', decision: 'inverted' }] })).toMatch(
      /pair upper on line 1/,
    );
  });

  it('refuses a pair whose upper side is missing or not a string', () => {
    // Both sides of the guard are reachable — a missing key short-circuits on the type test, an empty string does
    // not — and each is asserted so the refusal cannot be reduced to one of them.
    expect(rejection({ pairs: [{ lower: 'b', decision: 'inverted' }] })).toMatch(
      /pair upper on line 1/,
    );
    expect(rejection({ pairs: [{ upper: 4, lower: 'b', decision: 'inverted' }] })).toMatch(
      /pair upper on line 1/,
    );
  });

  it('refuses a pair with an empty lower side', () => {
    expect(rejection({ pairs: [{ upper: 'a', lower: '', decision: 'inverted' }] })).toMatch(
      /pair lower on line 1/,
    );
  });

  it('refuses a negative excursion, which no band distance can produce', () => {
    expect(
      rejection({ pairs: [{ upper: 'a', lower: 'b', decision: 'inverted', upperExcursion: -1 }] }),
    ).toMatch(/upperExcursion on line 1 is negative/);
  });

  it('round-trips a pair whose UPPER side is the one that was measured', () => {
    // The two directions of the omission are separate branches on the way out; a writer that only knew how to drop
    // the upper side would silently zero every pair whose lower side the profile could not speak about.
    const base = JSON.parse(formatContainmentRow(row())) as Record<string, unknown>;
    const parsed = parseContainmentRows(
      JSON.stringify({
        ...base,
        pairs: [{ upper: 'a', lower: 'b', decision: 'unmeasured', upperExcursion: 4 }],
      }),
    );
    expect(parsed[0]!.pairs[0]).toEqual({
      upper: 'a',
      lower: 'b',
      decision: 'unmeasured',
      upperExcursion: 4,
    });
    expect(parsed[0]!.pairs[0]).not.toHaveProperty('lowerExcursion');
  });

  it('refuses a negative lower excursion', () => {
    expect(
      rejection({
        pairs: [{ upper: 'a', lower: 'b', decision: 'inverted', lowerExcursion: -0.5 }],
      }),
    ).toMatch(/lowerExcursion on line 1 is negative/);
  });

  it('refuses an excursion that is not a number at all', () => {
    expect(
      rejection({
        pairs: [{ upper: 'a', lower: 'b', decision: 'inverted', upperExcursion: 'far' }],
      }),
    ).toMatch(/upperExcursion on line 1/);
  });

  it('refuses an excursion that is null rather than absent', () => {
    // `null` is what a writer that zeroed a side WOULD have produced; the parser refuses it so that the two
    // encodings cannot both be legal under one name.
    expect(
      rejection({
        pairs: [{ upper: 'a', lower: 'b', decision: 'inverted', upperExcursion: null }],
      }),
    ).toMatch(/upperExcursion on line 1/);
  });

  it('refuses a top1 that is neither null nor a name', () => {
    expect(rejection({ fusionTop1: '' })).toMatch(/fusionTop1 on line 1/);
    expect(rejection({ gatedTop1: 7 })).toMatch(/gatedTop1 on line 1/);
  });

  it('refuses a chain that is not an object', () => {
    expect(rejection({ chain: 'everything' })).toMatch(/chain on line 1 is not an object/);
  });

  it('refuses a chain whose order is not an array', () => {
    expect(rejection({ chain: { ...chain(), order: 'frontend' } })).toMatch(
      /chain.order on line 1 is not an array/,
    );
  });

  it('refuses an order that carries something which is not a service name', () => {
    expect(rejection({ chain: { ...chain(), order: ['frontend', null] } })).toMatch(
      /chain.order on line 1 is not a service name/,
    );
  });

  it('refuses edges that are not pairs', () => {
    expect(rejection({ chain: { ...chain(), edges: 'frontend' } })).toMatch(
      /chain.edges on line 1 is not an array/,
    );
    expect(rejection({ chain: { ...chain(), edges: [['a', 'b', 'c']] } })).toMatch(
      /chain.edges on line 1 is not a pair/,
    );
    expect(rejection({ chain: { ...chain(), edges: [['a', '']] } })).toMatch(
      /chain.edges.to on line 1 is not a service name/,
    );
  });

  it('refuses an excursion map that is not an object', () => {
    expect(rejection({ chain: { ...chain(), excursions: [] } })).toMatch(
      /chain.excursions on line 1 is not an object/,
    );
  });

  it('refuses a stored excursion that is negative or not a number', () => {
    // The excursion is a distance divided by a band width: a negative one is a sign error, and a reader that
    // accepted it would feed it to the inequality as evidence.
    expect(rejection({ chain: { ...chain(), excursions: { cart: -1 } } })).toMatch(
      /chain.excursions.cart on line 1 is negative/,
    );
    expect(rejection({ chain: { ...chain(), excursions: { cart: '2' } } })).toMatch(
      /chain.excursions.cart on line 1 is not a finite number/,
    );
  });

  it('refuses a stored surprise that is negative or not a number', () => {
    // A surprisal is `log(1/q)` over a probability in `(0, 1)`: negative is not a small measurement, it is a sign
    // error that would enter the pass's inequality as the opposite comparison.
    expect(rejection({ chain: { ...chain(), surprises: { cart: -0.5 } } })).toMatch(
      /chain.surprises.cart on line 1 is negative/,
    );
    expect(rejection({ chain: { ...chain(), surprises: { cart: 'many' } } })).toMatch(
      /chain.surprises.cart on line 1 is not a finite number/,
    );
    expect(rejection({ chain: { ...chain(), surprises: [] } })).toMatch(
      /chain.surprises on line 1 is not an object/,
    );
  });

  it('refuses a flow map that is not an object, and a flow that is not four numbers', () => {
    expect(rejection({ chain: { ...chain(), flows: 4 } })).toMatch(
      /chain.flows on line 1 is not an object/,
    );
    expect(rejection({ chain: { ...chain(), flows: { cart: 4 } } })).toMatch(
      /chain.flows.cart on line 1 is not an object/,
    );
    expect(
      rejection({
        chain: { ...chain(), flows: { cart: { knownIn: 0, knownOut: 0, novelIn: 0 } } },
      }),
    ).toMatch(/chain.flows.cart.novelOut on line 1 is not a finite number/);
  });

  it('refuses a failed-interface map that is not an object, or a count that is not a number', () => {
    expect(rejection({ chain: { ...chain(), failedInterfaces: [] } })).toMatch(
      /chain.failedInterfaces on line 1 is not an object/,
    );
    // The key carries the separator the pass uses, so the assertion matches the field name and the reason rather
    // than spelling a control character into a pattern.
    expect(rejection({ chain: { ...chain(), failedInterfaces: { 'a\u0000b': 'many' } } })).toMatch(
      /chain\.failedInterfaces\.[^ ]+ on line 1 is not a finite number/,
    );
  });

  it('refuses a failing-edge map that is not an object, or an entry that is not a rise', () => {
    expect(rejection({ chain: { ...chain(), failingEdges: [] } })).toMatch(
      /chain.failingEdges on line 1 is not an object/,
    );
    expect(rejection({ chain: { ...chain(), failingEdges: { 'a\u0000b': 9 } } })).toMatch(
      /chain.failingEdges on line 1 is not an object/,
    );
    expect(rejection({ chain: { ...chain(), failingEdges: { 'a\u0000b': { rise: 1 } } } })).toMatch(
      /chain.failingEdges.novel on line 1 is not a finite number/,
    );
  });

  it('refuses an attribution that is not a flow reading', () => {
    expect(rejection({ chain: { ...chain(), attribution: 'either' } })).toMatch(
      /chain.attribution on line 1 is not a flow reading/,
    );
  });

  it('accepts null top1, which is the honest value for a case with no candidates', () => {
    const base = JSON.parse(formatContainmentRow(row())) as Record<string, unknown>;
    const parsed = parseContainmentRows(
      JSON.stringify({
        ...base,
        fusionTop1: null,
        gatedTop1: null,
        ungatedTop1: null,
        shippedTop1: null,
      }),
    );
    expect(parsed[0]!.fusionTop1).toBeNull();
  });

  it('reads a file from disk', () => {
    const path = join(scratch(), 'containment.ndjson');
    new ContainmentRowDump(path).record(row());
    expect(readContainmentRows(path)).toHaveLength(1);
  });
});

describe('the sweep width', () => {
  it('is written when stated and omitted when not, so a reader can tell the two apart', () => {
    // The same rule the scope follows: `"depth": 5` is a claim about the run, and a writer that filled the default
    // in would be inventing one -- while a dump from before the field must still be readable.
    expect(JSON.parse(formatContainmentRow(row()))).toHaveProperty('depth', 5);
    const { depth, ...withoutDepth } = row();
    expect(depth).toBe(5);
    expect(JSON.parse(formatContainmentRow(withoutDepth))).not.toHaveProperty('depth');
  });

  it('round-trips through the parser', () => {
    const parsed = parseContainmentRows(formatContainmentRow(row()));
    expect(parsed[0]!.depth).toBe(5);
    const { depth, ...withoutDepth } = row();
    expect(depth).toBe(5);
    expect(parseContainmentRows(formatContainmentRow(withoutDepth))[0]).not.toHaveProperty('depth');
  });

  it('round-trips the word `pool`, which is a rule rather than a width', () => {
    // Every candidate the case had. It is written as a word because the number it resolves to follows the graph,
    // and a pool-wide dump written as numbers states one "width" per graph shape -- which its own census then reads
    // as many populations and refuses (`docs/gate-replay.md` §11).
    const pooled: ContainmentCaseRow = { ...row(), depth: 'pool' };
    expect(JSON.parse(formatContainmentRow(pooled))).toHaveProperty('depth', 'pool');
    expect(parseContainmentRows(formatContainmentRow(pooled))[0]!.depth).toBe('pool');
  });

  it('refuses a word that is not `pool`, rather than folding it onto it', () => {
    // A reader that guessed `all` or `POOL` meant the same rule would be writing a configuration the producer did
    // not, which is how a five-wide half and a pool-wide half end up in one file that passes its own census.
    for (const value of ['POOL', 'all', 'wide', 'Pool']) {
      expect(() =>
        parseContainmentRows(formatContainmentRow({ ...row(), depth: value as never })),
      ).toThrow(/depth on line 1 is not a width or the word pool/);
    }
  });

  it('refuses a width that names no population', () => {
    // A population is an integer count of candidates, so zero, a negative and a fraction each name no population
    // at all -- and a parser that coerced them would fit ρ over a window the run never stated.
    for (const value of [0, -5, 2.5, '5']) {
      expect(() =>
        parseContainmentRows(formatContainmentRow({ ...row(), depth: value as never })),
      ).toThrow(/depth on line 1/);
    }
  });
});
