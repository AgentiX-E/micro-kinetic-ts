/**
 * The head-precedence rule's own tests.
 *
 * The rule is a statement about a RESOLVER, not about a score: a resolver may not take an answer away from a head
 * that is itself loud. What makes that a test of the mechanism rather than of an arithmetic is asserted here — the
 * guard is scoped to the two resolvers and cannot reach the model, a head with no profile is unmeasurable rather
 * than quiet, a bar of `null` is the shipped pipeline, the gain must clear the bar on BOTH folds, and a grid whose
 * optimum sits on its corner is refused whatever it reads.
 */

import { describe, expect, it } from 'vitest';

import type { ChannelDeparture } from '../src/channel-kind.js';
import { foldOf, stableHash, type Profiles } from '../src/channel-split.js';
import {
  MIN_PRECEDENCE_GAIN,
  crossValidatePrecedence,
  formatPrecedenceReport,
  headOf,
  headSpeaks,
  loudestChannel,
  loudnessUnder,
  modelAnswersTouched,
  precedenceUnder,
  type ChainOrder,
  type PrecedenceCase,
} from '../src/head-precedence.js';

/** A case with a head, an answer and the channel that produced it. */
function precedenceCase(overrides: Partial<PrecedenceCase> = {}): PrecedenceCase {
  return {
    datapack: 'case-a',
    faultType: 'F',
    truth: ['source'],
    answer: 'front',
    entry: 'front',
    by: 'entry',
    ...overrides,
  };
}

/** A departure with the three standardised channels given and both symptom columns empty. */
function departure(
  resource: number | null,
  traffic: number | null = null,
  other: number | null = null,
  symptomRise: number | null = null,
): ChannelDeparture {
  return { resource, traffic, other, symptom: null, symptomRise };
}

/** A profile map carrying one case's services. */
function profilesOf(caseId: string, services: Record<string, ChannelDeparture>): Profiles {
  const profiles = new Map<string, Map<string, ChannelDeparture>>();
  profiles.set(caseId, new Map(Object.entries(services)));
  return profiles;
}

/** A chain view carrying one case's fusion order. */
function headsOf(caseId: string, order: readonly string[]): ReadonlyMap<string, ChainOrder> {
  return new Map([[caseId, { order }]]);
}

describe('the head of a chain', () => {
  it('is the fusion order first choice', () => {
    expect(headOf({ order: ['mid', 'other'] })).toBe('mid');
  });

  it('is refused rather than guessed when the chain is empty', () => {
    // A chain with no slots is not a head at index zero: it is a case whose candidates were never written, and a
    // reader that returned `undefined` would let that case decide a verdict through a comparison with nothing.
    expect(headOf({ order: [] })).toBeNull();
  });

  it('is refused when the case carries no chain at all', () => {
    expect(headOf(undefined)).toBeNull();
  });
});

describe('how loud a service is', () => {
  it('is the largest of the three standardised channels', () => {
    expect(loudestChannel(departure(12, 900, 40))).toBe(900);
  });

  it('does not read the symptom columns, which are rates rather than standardised rises', () => {
    // A rise of 0.9 errors per request is enormous on its own scale and is not comparable with a standardised
    // departure; a rule that let it into the maximum would make every case with a failing callee look loud.
    expect(loudestChannel(departure(12, 900, 40, 0.9))).toBe(900);
  });

  it('ignores the channels that could not be standardised', () => {
    expect(loudestChannel(departure(400, null, null))).toBe(400);
  });

  it('is unmeasured, not quiet, when no channel could be standardised', () => {
    expect(loudestChannel(departure(null))).toBeNull();
  });

  it('is unmeasured when the case carries no profile for the service', () => {
    expect(loudestChannel(null)).toBeNull();
  });
});

describe('when the guard speaks', () => {
  const heads = headsOf('case-a', ['mid', 'other']);
  const profiles = profilesOf('case-a', { mid: departure(900), front: departure(1) });

  it('speaks for a front-door rename whose head is loud', () => {
    expect(headSpeaks(precedenceCase(), profiles, heads, 300)).toBe(true);
  });

  it('stays silent when the head is under the bar', () => {
    expect(headSpeaks(precedenceCase(), profiles, heads, 900)).toBe(false);
  });

  it('stays silent when the head IS the entry, because the resolver has nothing to undo', () => {
    // `entry === answer` is the resolver's own refusal: it does not rename a case to the service it already named.
    expect(headSpeaks(precedenceCase({ entry: 'mid' }), profiles, heads, 300)).toBe(false);
  });

  it('stays silent when the answer was never renamed by a resolver', () => {
    // The model is the answer's SOURCE, not a resolver. A guard that rewrote its answers would be a different rule.
    expect(headSpeaks(precedenceCase({ by: 'model' }), profiles, heads, 300)).toBe(false);
    expect(headSpeaks(precedenceCase({ by: 'prior' }), profiles, heads, 300)).toBe(false);
    expect(headSpeaks(precedenceCase({ by: null }), profiles, heads, 300)).toBe(false);
  });

  it('speaks on the witness resolver exactly as on the front door', () => {
    expect(headSpeaks(precedenceCase({ by: 'interface' }), profiles, heads, 300)).toBe(true);
  });

  it('stays silent under the shipped pipeline, where the bar is disabled', () => {
    expect(headSpeaks(precedenceCase(), profiles, heads, null)).toBe(false);
  });

  it('stays silent when the head carries no profile, which is unmeasured rather than quiet', () => {
    const bare = profilesOf('case-a', { front: departure(1) });
    expect(headSpeaks(precedenceCase(), bare, heads, 300)).toBe(false);
  });

  it('stays silent when the case carries no chain to name a head from', () => {
    expect(headSpeaks(precedenceCase(), profiles, new Map(), 300)).toBe(false);
  });

  it('stays silent when the case has no answer to preserve', () => {
    expect(headSpeaks(precedenceCase({ answer: null }), profiles, heads, 300)).toBe(false);
  });
});

describe('the answer under the guard', () => {
  const heads = headsOf('case-a', ['mid', 'other']);
  const profiles = profilesOf('case-a', { mid: departure(900), front: departure(1) });

  it('returns the head when the head is loud', () => {
    expect(precedenceUnder(precedenceCase(), profiles, heads, 300)).toBe('mid');
  });

  it('returns the artifact answer when the head is quiet', () => {
    expect(precedenceUnder(precedenceCase(), profiles, heads, 900)).toBe('front');
  });

  it('returns the shipped answer when the bar is disabled', () => {
    expect(precedenceUnder(precedenceCase(), profiles, heads, null)).toBe('front');
  });

  it('leaves the model answer alone even when the head is loud', () => {
    expect(
      precedenceUnder(precedenceCase({ by: 'model', answer: 'other' }), profiles, heads, 300),
    ).toBe('other');
  });

  it('carries a null answer through rather than turning it into a name', () => {
    expect(precedenceUnder(precedenceCase({ answer: null }), profiles, heads, 300)).toBeNull();
  });
});

describe('the model scope', () => {
  it('counts nothing, because no bar can rewrite an answer the model settled', () => {
    const heads = headsOf('case-a', ['mid', 'other']);
    const profiles = profilesOf('case-a', { mid: departure(900), front: departure(1) });
    const cases = [
      precedenceCase({ datapack: 'case-a', by: 'model' }),
      precedenceCase({ datapack: 'case-a', by: 'prior' }),
      precedenceCase({ datapack: 'case-a', by: 'entry' }),
    ];
    expect(modelAnswersTouched(cases, profiles, heads, 300)).toBe(0);
  });
});

describe('the populations the predictions are read from', () => {
  const heads = headsOf('case-a', ['mid', 'other']);
  const profiles = profilesOf('case-a', { mid: departure(900) });

  it('counts a resolver override that took a correct head away as wrong, and reads its loudness', () => {
    const rows = [precedenceCase({ truth: ['mid'], answer: 'front', by: 'entry' })];
    const reading = loudnessUnder(rows, profiles, heads, 300);
    expect([reading.overriddenWrong, reading.ofWhichLoud]).toEqual([1, 1]);
  });

  it('counts a resolver override that was right as right, and reads that head too', () => {
    const rows = [precedenceCase({ truth: ['front'], answer: 'front', by: 'entry' })];
    const reading = loudnessUnder(rows, profiles, heads, 300);
    expect([reading.overriddenRight, reading.ofWhichLoudRight]).toEqual([1, 1]);
  });

  it('does not count cases no resolver touched', () => {
    const rows = [precedenceCase({ truth: ['mid'], answer: 'other', by: 'model' })];
    const reading = loudnessUnder(rows, profiles, heads, 300);
    expect([reading.overriddenWrong, reading.overriddenRight]).toEqual([0, 0]);
  });

  it('counts a wrong override whose head is quiet as wrong without reading it as loud', () => {
    // The two halves of a prediction are separate counts: how often the override was wrong, and how often the guard
    // would have caught it. A single counter would make those the same number and hide the refutation.
    const quietHeads = headsOf('case-q', ['mid', 'other']);
    const quietProfiles = profilesOf('case-q', { mid: departure(10) });
    const rows = [
      precedenceCase({ datapack: 'case-q', truth: ['mid'], answer: 'front', by: 'entry' }),
    ];
    const reading = loudnessUnder(rows, quietProfiles, quietHeads, 300);
    expect([reading.overriddenWrong, reading.ofWhichLoud]).toEqual([1, 0]);
  });

  it('skips a case with no answer, no chain, or a head that IS the entry, and counts neither side', () => {
    // Four refusals, four different statements: a gate refusal is not a quiet service, a case with no chain has no
    // head to preserve, and a head that is the entry is a case the resolver never renamed.
    const rows = [
      precedenceCase({ datapack: 'case-a', truth: ['mid'], answer: null, by: 'entry' }),
      precedenceCase({ datapack: 'case-b', truth: ['mid'], answer: 'front', by: 'entry' }),
      precedenceCase({
        datapack: 'case-a',
        truth: ['mid'],
        answer: 'front',
        by: 'entry',
        entry: 'mid',
      }),
      precedenceCase({ datapack: 'case-a', truth: ['elsewhere'], answer: 'front', by: 'entry' }),
    ];
    const reading = loudnessUnder(rows, profiles, heads, 300);
    expect([reading.overriddenWrong, reading.overriddenRight]).toEqual([0, 0]);
  });
});

describe('the held-out reading', () => {
  const GRID = [100, 300, 600, 1500];
  const bit = stableHash('F') & 1;
  /** A correct head at 1 000, taken away by the resolver: a bar under 1 000 would keep it. */
  const repair = { head: 1000, truth: ['mid'] as readonly string[] };
  /** A head at 400 that the resolver was right to leave: a bar under 600 would take it and be wrong. */
  const breaks = { head: 400, truth: ['front'] as readonly string[] };
  /** A head under every bar in the grid: the guard cannot reach the case at all. */
  const quiet = { head: 10, truth: ['front'] as readonly string[] };
  /** A single head at 150: it fires under the narrowest two bars, which is what makes a fold pick the third. */
  const narrow = { head: 150, truth: ['front'] as readonly string[] };

  /**
   * A corpus of 32 cases in one family, with a profile per case.
   *
   * The spec is handed the case's FOLD, so a test can say what each half contains instead of guessing which parity
   * lands where — the hash decides that, and a test that guessed would silently describe one half twice.
   */
  function corpusOf(
    spec: (fold: 0 | 1, nth: number) => { head: number; truth: readonly string[] },
  ): {
    rows: PrecedenceCase[];
    profiles: Profiles;
    heads: ReadonlyMap<string, ChainOrder>;
  } {
    const rows: PrecedenceCase[] = [];
    const profiles = new Map<string, Map<string, ChannelDeparture>>();
    const heads = new Map<string, ChainOrder>();
    const seen: [number, number] = [0, 0];
    for (let index = 0; index < 32; index += 1) {
      const fold = foldOf('F', index);
      const shape = spec(fold, seen[fold]);
      seen[fold] += 1;
      const id = `case-${index}`;
      heads.set(id, { order: ['mid', 'other'] });
      profiles.set(id, new Map([['mid', departure(shape.head)]]));
      rows.push(
        precedenceCase({
          datapack: id,
          faultType: 'F',
          truth: shape.truth,
          answer: 'front',
          by: 'entry',
        }),
      );
    }
    return { rows, profiles, heads };
  }

  it('reads the shipped surface as the comparison and the sizes as the population', () => {
    const { rows, profiles, heads } = corpusOf((_, nth) => (nth % 2 === 0 ? repair : breaks));
    const reading = crossValidatePrecedence(rows, profiles, heads, GRID, MIN_PRECEDENCE_GAIN);
    expect(reading.sizes[0] + reading.sizes[1]).toBe(rows.length);
    // Half the corpus is already right, and it is the half the resolver was right to leave alone.
    expect(reading.mixed[0] + reading.mixed[1]).toBe(16);
    expect(reading.sweep).toHaveLength(GRID.length);
  });

  it('passes when both folds clear the bar, and picks the bar the breaks make interior', () => {
    // The breaks fire under 600 and the repairs fire up to 1 500, so 600 is the only bar that keeps the repairs and
    // drops the breaks. A rule that passes here has had its bar CHOSEN by the corpus rather than by its caller.
    const { rows, profiles, heads } = corpusOf((_, nth) => (nth % 2 === 0 ? repair : breaks));
    const reading = crossValidatePrecedence(rows, profiles, heads, GRID, MIN_PRECEDENCE_GAIN);
    expect(reading.selected).toEqual([600, 600]);
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_PRECEDENCE_GAIN);
    expect(reading.deltas[1]).toBeGreaterThanOrEqual(MIN_PRECEDENCE_GAIN);
    expect(reading.passes).toBe(true);
  });

  it('fails when one fold gains less than the bar', () => {
    // The second half carries nothing the guard can reach, so the rule may not be shipped on the strength of the half
    // it was chosen on — which is the whole reason the partition exists.
    // One narrow break per fold keeps both halves off the grid corner; the second half is blind beyond that, so the
    // first half's gain cannot be published on the second half's evidence.
    const { rows, profiles, heads } = corpusOf((fold, nth) =>
      nth === 0 ? narrow : fold === 1 ? quiet : repair,
    );
    const reading = crossValidatePrecedence(rows, profiles, heads, GRID, MIN_PRECEDENCE_GAIN);
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_PRECEDENCE_GAIN);
    expect(reading.reasons).toEqual(['fold 1 gains 0']);
    expect(reading.passes).toBe(false);
  });

  it('fails when the two folds choose bars more than one step apart', () => {
    // One half wants 600 (its breaks sit at 400) and the other wants the narrowest bar. Two halves wanting different
    // rules is the signature of a bar fitted to the half it was chosen on, so this reading is refused on its
    // partition rather than on its gain, and the deltas are asserted to prove exactly that.
    const { rows, profiles, heads } = corpusOf((fold, nth) =>
      fold === 1 ? repair : nth % 5 === 4 ? breaks : repair,
    );
    const reading = crossValidatePrecedence(rows, profiles, heads, GRID, MIN_PRECEDENCE_GAIN);
    expect(reading.selected).toEqual([600, 100]);
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_PRECEDENCE_GAIN);
    expect(reading.deltas[1]).toBeGreaterThanOrEqual(MIN_PRECEDENCE_GAIN);
    expect(reading.reasons).toContain('the folds chose bars more than one step apart');
    expect(reading.passes).toBe(false);
  });

  it('fails when the chosen bar sits on the grid corner, whatever it reads', () => {
    // No breaks, so every bar tying is the whole reading and the tie-break takes the narrowest: the grid cannot
    // distinguish its cells, and a best cell at the edge is a reading with no bar in it.
    const { rows, profiles, heads } = corpusOf(() => repair);
    const reading = crossValidatePrecedence(rows, profiles, heads, GRID, MIN_PRECEDENCE_GAIN);
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_PRECEDENCE_GAIN);
    expect(reading.reasons).toEqual(['the chosen bar is on the grid corner, so it is unmeasured']);
    expect(reading.passes).toBe(false);
  });

  it('counts the loudness of each side at every bar it is asked about', () => {
    const { rows, profiles, heads } = corpusOf((_, nth) => (nth % 2 === 0 ? repair : breaks));
    const loud = loudnessUnder(rows, profiles, heads, 300);
    expect([
      loud.overriddenWrong,
      loud.ofWhichLoud,
      loud.overriddenRight,
      loud.ofWhichLoudRight,
    ]).toEqual([16, 16, 16, 16]);
    const narrow = loudnessUnder(rows, profiles, heads, 600);
    expect([narrow.ofWhichLoud, narrow.ofWhichLoudRight]).toEqual([16, 0]);
  });

  it('keeps the family hash out of the reading, so a fold is a property of the corpus', () => {
    expect(bit === 0 || bit === 1).toBe(true);
  });
});

describe('the report', () => {
  const loud = {
    kappa: 300,
    overriddenWrong: 10,
    ofWhichLoud: 3,
    overriddenRight: 69,
    ofWhichLoudRight: 2,
  };
  const bar = (kappa: number, correct: [number, number]) => ({
    kappa,
    correct,
    repairs: 3,
    breaks: 1,
  });

  it('prints the four predictions, the model scope and a refusal naming its clause', () => {
    const reading = {
      sizes: [711, 711] as [number, number],
      mixed: [643, 644] as [number, number],
      sweep: [bar(100, [644, 645]), bar(300, [643, 644])],
      selected: [100, 100] as [number, number],
      heldOut: [643, 644] as [number, number],
      deltas: [-1, 0] as [number, number],
      reasons: ['fold 0 gains -1'],
      passes: false,
    };
    const text = formatPrecedenceReport(reading, [loud], 0);
    expect(text).toContain('P1/P2');
    expect(text).toContain('P3');
    expect(text).toContain('P4 -- model answers touched 0');
    expect(text).toContain('does not pass -- fold 0 gains -1');
  });

  it('prints a gain that passes as passing', () => {
    const reading = {
      sizes: [711, 711] as [number, number],
      mixed: [643, 644] as [number, number],
      sweep: [bar(300, [650, 651])],
      selected: [300, 300] as [number, number],
      heldOut: [650, 651] as [number, number],
      deltas: [7, 7] as [number, number],
      reasons: [],
      passes: true,
    };
    expect(formatPrecedenceReport(reading, [loud], 0)).toContain('passes every clause');
  });
});

describe('the fold the module reads', () => {
  it('is the same partition the channel split uses, so two axes cannot disagree about a case', () => {
    // Not a tautology: the module could have hashed the datapack, and then a held-out reading of this rule would be
    // a statement about the cases in a fold rather than about the families in it.
    const rows = Array.from({ length: 4 }, (_, index) =>
      precedenceCase({
        datapack: `case-${index}`,
        faultType: 'F',
        truth: ['mid'],
        answer: 'front',
        by: 'entry',
      }),
    );
    const heads = headsOf('case-a', ['mid']);
    const profiles = profilesOf('case-a', { mid: departure(900) });
    const reading = crossValidatePrecedence(
      rows,
      profiles,
      heads,
      [100, 300, 900],
      MIN_PRECEDENCE_GAIN,
    );
    const bit = stableHash('F') & 1;
    expect(reading.sizes[bit]).toBe(2);
    expect(reading.sizes[1 - bit]).toBe(2);
  });
});
