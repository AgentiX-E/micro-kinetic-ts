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
} from '../src/containment-rows.js';

/** A case row with one measured pair and one unmeasured side, which is the shape the register cares about. */
function row(overrides: Partial<ContainmentCaseRow> = {}): ContainmentCaseRow {
  return {
    datapack: 'datapack-1',
    faultType: 'NetworkDelay',
    sigma: 3,
    margin: 0,
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

  it('refuses a pair whose decision is not one of the four', () => {
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
