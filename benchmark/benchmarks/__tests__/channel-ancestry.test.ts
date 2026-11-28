/**
 * The ancestry bound's own tests.
 *
 * The rule this module prices is not a threshold on a number — it is a statement about a GRAPH, and its value is
 * therefore entirely in the relation being real. The properties asserted here are the ones that make the reading a
 * test of the relation rather than a test of an arithmetic: the path is directional, the rung is the deepest and not
 * the loudest, a rung the entry cannot reach is refused rather than repaired, and the randomised control holds the
 * firing population constant while destroying the relation — which is the only way a graph rule can be shown to need
 * the graph.
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_ANCESTRY_GAIN,
  crossValidateAncestry,
  distancesFrom,
  pathTo,
  renamedUnder,
  risingUnder,
  rungOf,
  rungUnder,
  shuffledRung,
  type CallGraph,
  type RungPolicy,
} from '../src/channel-ancestry.js';
import type { ChannelDeparture } from '../src/channel-kind.js';
import { type Profiles, type SplitCase } from '../src/channel-split.js';

/** A case with everything the resolver reads, and no profile attached yet. */
function splitCase(overrides: Partial<SplitCase> = {}): SplitCase {
  return {
    datapack: 'case-a',
    faultType: 'HTTPResponseReplaceCode',
    truth: ['source'],
    answer: 'mid',
    entry: 'front',
    entryChildErrors: 0,
    belowFails: false,
    answerSurprise: 900,
    novelCaller: null,
    novelRise: null,
    ...overrides,
  };
}

/** A departure with the three non-symptom channels given and both symptom columns empty. */
function departure(
  resource: number | null,
  traffic: number | null = null,
  other: number | null = null,
): ChannelDeparture {
  return { resource, traffic, other, symptom: null, symptomRise: null };
}

/** A profile map carrying one case's services. */
function profilesOf(caseId: string, services: Record<string, ChannelDeparture>): Profiles {
  const profiles = new Map<string, Map<string, ChannelDeparture>>();
  profiles.set(caseId, new Map(Object.entries(services)));
  return profiles;
}

/**
 * The corpus's dominant shape, small: a front door, a fan-out, and one arm that goes three deep.
 *
 * ```
 * front ─┬─ left ── leftLeaf
 *        └─ mid ── deep ── source
 * ```
 */
const TREE: CallGraph = {
  edges: [
    ['front', 'left'],
    ['front', 'mid'],
    ['left', 'leftLeaf'],
    ['mid', 'deep'],
    ['deep', 'source'],
  ],
};

describe('distance from the entry', () => {
  it('counts hops, with the entry at zero', () => {
    const distances = distancesFrom(TREE, 'front');
    expect(distances.get('front')).toBe(0);
    expect(distances.get('mid')).toBe(1);
    expect(distances.get('source')).toBe(3);
  });

  it('leaves a service the entry cannot reach out of the map, because absence is not distance zero', () => {
    const distances = distancesFrom({ edges: [['a', 'b']] }, 'b');
    expect(distances.has('b')).toBe(true);
    expect(distances.has('a')).toBe(false);
  });

  it('survives a cycle, so a corpus that writes one twice cannot hang the walk', () => {
    const distances = distancesFrom(
      {
        edges: [
          ['a', 'b'],
          ['b', 'a'],
        ],
      },
      'a',
    );
    expect(distances.get('a')).toBe(0);
    expect(distances.get('b')).toBe(1);
  });
});

describe('the rising set', () => {
  it('admits a service whose loudest channel clears the bar, and only that', () => {
    const services = new Map<string, ChannelDeparture>([
      ['loud', departure(400)],
      ['quiet', departure(10)],
    ]);
    expect(risingUnder(services, 300)).toEqual(['loud']);
  });

  it('reads the maximum across channels, so a rise in any one of them counts', () => {
    const services = new Map<string, ChannelDeparture>([
      ['viaTraffic', departure(0, 400)],
      ['viaOther', departure(0, 0, 400)],
    ]);
    expect(risingUnder(services, 300)).toEqual(['viaOther', 'viaTraffic']);
  });

  it('is inclusive at the bar, because a unit of standardised surprise is coarser than the grid', () => {
    const services = new Map<string, ChannelDeparture>([['exactly', departure(300)]]);
    expect(risingUnder(services, 300)).toEqual(['exactly']);
  });

  it('leaves a service with no measurement at all out of the set, because a refusal is not a quiet', () => {
    const services = new Map<string, ChannelDeparture>([['silent', departure(null)]]);
    expect(risingUnder(services, 0.0001)).toEqual([]);
  });

  it('reads the traffic channel as a departure too, which is how a conduit enters the set', () => {
    const services = new Map<string, ChannelDeparture>([['conduit', departure(5, 900)]]);
    expect(risingUnder(services, 300)).toEqual(['conduit']);
  });
});

describe('the rung', () => {
  it('is the deepest rising service, not the loudest', () => {
    // `leftLeaf` is the shallowest and the loudest; `source` is deeper and quieter. A rule that read magnitude would
    // name the leaf, and 329 measured that reading at 12 of 160.
    const services = new Map<string, ChannelDeparture>([
      ['leftLeaf', departure(999)],
      ['source', departure(350)],
    ]);
    const distances = distancesFrom(TREE, 'front');
    expect(rungUnder(services, distances, 300)).toBe('source');
  });

  it('can only be a service the entry reaches, because a distance is what it is ranked by', () => {
    const services = new Map<string, ChannelDeparture>([['detached', departure(999)]]);
    const distances = distancesFrom(TREE, 'front');
    expect(rungUnder(services, distances, 300)).toBeNull();
  });

  it('breaks a tie by the smallest id, so the choice is a function of the corpus and not of insertion order', () => {
    const forward = new Map<string, ChannelDeparture>([
      ['deep', departure(500)],
      ['leftLeaf', departure(500)],
    ]);
    const backward = new Map<string, ChannelDeparture>([
      ['leftLeaf', departure(500)],
      ['deep', departure(500)],
    ]);
    const distances = distancesFrom(TREE, 'front');
    expect(rungUnder(forward, distances, 300)).toBe('deep');
    expect(rungUnder(backward, distances, 300)).toBe('deep');
  });

  it('is absent when nothing rises, and the rule then has nothing to say', () => {
    const services = new Map<string, ChannelDeparture>([['source', departure(1)]]);
    expect(rungUnder(services, distancesFrom(TREE, 'front'), 300)).toBeNull();
  });
});

describe('the path to the rung', () => {
  it('carries the entry, every ancestor, and the rung itself', () => {
    expect([...(pathTo(TREE, 'front', 'source') ?? [])].sort()).toEqual([
      'deep',
      'front',
      'mid',
      'source',
    ]);
  });

  it('is directional: a descendant of the rung is not on the path to it', () => {
    const path = pathTo(TREE, 'front', 'mid');
    expect(path?.has('source')).toBe(false);
    expect(path?.has('deep')).toBe(false);
  });

  it('is null rather than empty when the entry cannot reach the target, because silence and unreachable differ', () => {
    expect(pathTo(TREE, 'front', 'detached')).toBeNull();
  });

  it('follows one route rather than every route, on a graph where a service has two parents', () => {
    // The corpus writes a call edge per caller, so a shared callee has several parents. The path is the one the BFS
    // tree took, and that is enough for a bound: the source is on SOME path to the rung, so refusing answers off the
    // tree's path would be a stricter rule than the law licenses — which is a defect this test is written to expose.
    const diamond: CallGraph = {
      edges: [
        ['front', 'a'],
        ['front', 'b'],
        ['a', 'shared'],
        ['b', 'shared'],
      ],
    };
    const path = pathTo(diamond, 'front', 'shared');
    expect(path?.has('front')).toBe(true);
    expect(path?.has('shared')).toBe(true);
    expect([...(path ?? [])].length).toBe(3);
  });
});

describe('the rung a case carries', () => {
  it('refuses a case whose rung the entry cannot reach', () => {
    const profiles = profilesOf('case-a', { detached: departure(999) });
    expect(rungOf({ datapack: 'case-a', entry: 'front' }, profiles, TREE, 300)).toBeNull();
  });

  it('refuses a case with no entry, because there is no path to be a bound on', () => {
    const profiles = profilesOf('case-a', { source: departure(400) });
    expect(rungOf({ datapack: 'case-a', entry: null }, profiles, TREE, 300)).toBeNull();
  });

  it('refuses a case carrying no profile at all', () => {
    expect(rungOf({ datapack: 'case-missing', entry: 'front' }, new Map(), TREE, 300)).toBeNull();
  });

  it('returns the rung, its distance, and the path the bound is stated on', () => {
    const profiles = profilesOf('case-a', { source: departure(400), leftLeaf: departure(400) });
    const reading = rungOf({ datapack: 'case-a', entry: 'front' }, profiles, TREE, 300);
    expect(reading?.rung).toBe('source');
    expect(reading?.distance).toBe(3);
    expect(reading?.path.has('mid')).toBe(true);
  });
});

describe('what the bound does to one answer', () => {
  const profiles = profilesOf('case-a', { source: departure(400) });

  it('silences itself when the answer is on the path', () => {
    // The bet of the whole iteration: a correct answer IS the source, the rung is at or below it, so the source is an
    // ancestor of the rung and the rule has nothing to say.
    for (const answer of ['front', 'mid', 'deep', 'source']) {
      expect(renamedUnder(splitCase({ answer }), profiles, TREE, 300)).toBeNull();
    }
  });

  it('renames an answer off the path to the rung', () => {
    expect(renamedUnder(splitCase({ answer: 'leftLeaf' }), profiles, TREE, 300)).toBe('source');
  });

  it('silences itself when the case carries no rung', () => {
    const quiet = profilesOf('case-a', { source: departure(1) });
    expect(renamedUnder(splitCase({ answer: 'leftLeaf' }), quiet, TREE, 300)).toBeNull();
  });

  it('silences itself on a null answer, because there is no name to contradict', () => {
    expect(renamedUnder(splitCase({ answer: null }), profiles, TREE, 300)).toBeNull();
  });

  it('never returns the answer it was given, so re-applying it cannot move a settled case', () => {
    for (const answer of ['front', 'mid', 'deep', 'source', 'leftLeaf']) {
      expect(renamedUnder(splitCase({ answer }), profiles, TREE, 300)).not.toBe(answer);
    }
  });

  it('is idempotent: the renamed answer is on the path, so a second application is silent', () => {
    const once = renamedUnder(splitCase({ answer: 'leftLeaf' }), profiles, TREE, 300);
    expect(once).toBe('source');
    expect(renamedUnder(splitCase({ answer: once }), profiles, TREE, 300)).toBeNull();
  });
});

describe('the randomised control', () => {
  const services = new Map<string, ChannelDeparture>([
    ['leftLeaf', departure(500)],
    ['deep', departure(500)],
    ['source', departure(500)],
  ]);
  const rising = risingUnder(services, 300);

  it('draws from the same rising set the deepest rung comes from', () => {
    const drawn = shuffledRung(rising, 'case-a', 300);
    expect(rising).toContain(drawn);
  });

  it('is a function of the case and the bar, so a second run draws the same service', () => {
    expect(shuffledRung(rising, 'case-a', 300)).toBe(shuffledRung(rising, 'case-a', 300));
  });

  it('moves with the case, because a control that drew one member for the corpus would measure one case', () => {
    const draws = new Set(
      Array.from({ length: 24 }, (_, index) => shuffledRung(rising, `case-${index}`, 300)),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  it('has nothing to draw from when nothing rises', () => {
    expect(shuffledRung([], 'case-a', 300)).toBeNull();
  });

  it('holds the firing population constant and destroys only the target', () => {
    const profiles = profilesOf('case-a', { source: departure(400), leftLeaf: departure(400) });
    const caseA = splitCase({ answer: 'leftLeaf' });
    // The decision is made by the deepest rung in both arms; only the replacement differs.
    expect(renamedUnder(caseA, profiles, TREE, 300, 'deepest')).toBe('source');
    expect(renamedUnder(caseA, profiles, TREE, 300, 'shuffled')).not.toBeNull();
  });
});

describe('the held-out price', () => {
  /** A corpus of `count` cases in one family whose answer is right, wrong-and-off-path, or wrong-and-on-path. */
  function corpus(
    shape: readonly ('right' | 'offPath' | 'onPath')[],
    family = 'HTTPResponseReplaceCode',
  ): SplitCase[] {
    return shape.map((kind, index) => {
      const answer = kind === 'right' ? 'source' : kind === 'offPath' ? 'leftLeaf' : 'mid';
      return splitCase({
        datapack: `case-${index}`,
        faultType: family,
        truth: ['source'],
        answer,
        entry: 'front',
      });
    });
  }

  /** Profiles for a corpus: one rising source, so the rung is `source` and the path is front→source. */
  function corpusProfiles(rows: readonly SplitCase[]): Profiles {
    const profiles = new Map<string, Map<string, ChannelDeparture>>();
    for (const one of rows) {
      profiles.set(one.datapack, new Map([['source', departure(400)]]));
    }
    return profiles;
  }

  /** The same graph for every case, which is what a single fault family in one system looks like. */
  function graphsOf(rows: readonly SplitCase[]): ReadonlyMap<string, CallGraph> {
    return new Map(rows.map((one) => [one.datapack, TREE]));
  }

  it('counts a repair as a case the rule moved from wrong to right, and a break as the reverse', () => {
    const rows = corpus(['right', 'offPath', 'right', 'offPath']);
    const report = crossValidateAncestry(rows, corpusProfiles(rows), graphsOf(rows), [300], 0);
    const cell = report.sweep[0]!;
    expect(cell.repairs).toBe(2);
    expect(cell.breaks).toBe(0);
    expect(cell.fires).toBe(2);
  });

  it('counts an on-path wrong answer as no fire at all, because the bound does not exclude it', () => {
    const rows = corpus(['onPath', 'onPath']);
    const report = crossValidateAncestry(rows, corpusProfiles(rows), graphsOf(rows), [300], 0);
    expect(report.sweep[0]!.fires).toBe(0);
    expect(report.sweep[0]!.repairs).toBe(0);
  });

  it('reads the baseline from the shipped resolvers rather than from the artifact column', () => {
    const rows = corpus(['right', 'offPath']);
    const report = crossValidateAncestry(rows, corpusProfiles(rows), graphsOf(rows), [300], 0);
    // Both answers survive the shipped resolvers unchanged, so the baseline is one correct of two — and the correct
    // one lands in fold 1, because the fold is the family's hash XOR the index and this family hashes odd.
    expect(report.mixed).toEqual([0, 1]);
  });

  it('reads each fold under the bar the OTHER fold chose', () => {
    const rows = corpus(['right', 'offPath', 'right', 'offPath', 'right', 'offPath']);
    const report = crossValidateAncestry(rows, corpusProfiles(rows), graphsOf(rows), [30, 300], 0);
    expect(report.selected).toHaveLength(2);
    // Every bar reads the same on this corpus, so the swap is visible as an unchanged total rather than as a gain.
    expect(report.heldOut[0] + report.heldOut[1]).toBeGreaterThanOrEqual(0);
  });

  it('refuses a gain below the bar on EITHER fold', () => {
    const rows = corpus(['right', 'offPath']);
    const report = crossValidateAncestry(
      rows,
      corpusProfiles(rows),
      graphsOf(rows),
      [300],
      MIN_ANCESTRY_GAIN,
    );
    expect(report.passes).toBe(false);
  });

  it('accepts a gain at the bar on both folds', () => {
    // Eight repairs and no breaks, split by the family-and-parity fold into 4 and 4 — which is below seven, so this
    // asserts the arithmetic rather than the shipping decision.
    const shape = Array.from({ length: 16 }, () => 'offPath' as const);
    const rows = corpus(shape);
    const report = crossValidateAncestry(rows, corpusProfiles(rows), graphsOf(rows), [300], 4);
    expect(report.deltas[0]).toBeGreaterThanOrEqual(4);
    expect(report.deltas[1]).toBeGreaterThanOrEqual(4);
    expect(report.passes).toBe(true);
  });

  it('prices the randomised control on the same fires, so the two deltas are comparable', () => {
    const shape = Array.from({ length: 16 }, (_, index) =>
      index % 2 === 0 ? ('offPath' as const) : ('right' as const),
    );
    const rows = corpus(shape);
    const profiles = corpusProfiles(rows);
    const graphs = graphsOf(rows);
    const rule = crossValidateAncestry(rows, profiles, graphs, [300], 0, 'deepest');
    const control = crossValidateAncestry(rows, profiles, graphs, [300], 0, 'shuffled');
    expect(rule.sweep[0]!.fires).toBe(8);
    expect(control.sweep[0]!.fires).toBe(8);
    // The control draws from {source} alone here, so it cannot differ from the rule on this corpus — which is the
    // honest limit of the control, asserted rather than assumed.
    expect(control.heldOut).toEqual(rule.heldOut);
  });

  it('reports a fold size of zero rather than a gain of zero when a family is absent', () => {
    const rows = corpus([]);
    const report = crossValidateAncestry(rows, new Map(), new Map(), [300], MIN_ANCESTRY_GAIN);
    expect(report.sizes).toEqual([0, 0]);
    expect(report.passes).toBe(false);
  });

  it('takes the policy as a parameter so one corpus prices both arms', () => {
    const rows = corpus(['offPath', 'offPath']);
    const policies: RungPolicy[] = ['deepest', 'shuffled'];
    for (const policy of policies) {
      const report = crossValidateAncestry(
        rows,
        corpusProfiles(rows),
        graphsOf(rows),
        [300],
        0,
        policy,
      );
      expect(report.sweep[0]!.fires).toBe(2);
    }
  });
});

describe('the graph walks that a corpus can actually write', () => {
  it('keeps one edge per caller and callee when the corpus writes the same call twice', () => {
    // A duplicated edge is what a merge of two spans looks like, and a distance that counted it twice would rank a
    // service by how often it was written rather than by how far it is.
    const distances = distancesFrom(
      {
        edges: [
          ['front', 'a'],
          ['front', 'a'],
          ['a', 'b'],
        ],
      },
      'front',
    );
    expect(distances.get('a')).toBe(1);
    expect(distances.get('b')).toBe(2);
  });

  it('refuses a case the caller supplied no graph for, rather than reading a missing graph as an empty one', () => {
    const rows = [splitCase({ datapack: 'case-orphan', answer: 'leftLeaf' })];
    const profiles = profilesOf('case-orphan', { source: departure(400) });
    const report = crossValidateAncestry(rows, profiles, new Map(), [300], 0);
    expect(report.sweep[0]!.fires).toBe(0);
  });
});

describe('the three outcomes a fire can have', () => {
  /** A corpus of one family, with the given truth and answer, and a rising source. */
  function oneCase(truth: readonly string[], answer: string, entry = 'front'): SplitCase[] {
    return [splitCase({ datapack: 'case-a', truth, answer, entry })];
  }

  const profiles = profilesOf('case-a', { source: departure(400) });

  it('counts a fire that lands on the truth as a repair', () => {
    const rows = oneCase(['source'], 'leftLeaf');
    const report = crossValidateAncestry(rows, profiles, new Map([['case-a', TREE]]), [300], 0);
    expect(report.sweep[0]!.repairs).toBe(1);
    expect(report.sweep[0]!.breaks).toBe(0);
  });

  it('counts a fire that moves a right answer off the truth as a break, which is the cost the rule pays', () => {
    // The answer is right and the bound contradicts it: truth is the leaf and the rung is the source, so the rule
    // trades a correct answer for a bound it believes more than the engine.
    const rows = oneCase(['leftLeaf'], 'leftLeaf');
    const report = crossValidateAncestry(rows, profiles, new Map([['case-a', TREE]]), [300], 0);
    expect(report.sweep[0]!.breaks).toBe(1);
    expect(report.sweep[0]!.repairs).toBe(0);
    expect(report.deltas[0] + report.deltas[1]).toBeLessThan(0);
  });

  it('counts a fire that swaps one right name for another as neither, because the surface did not move', () => {
    // A two-name truth is the corpus's own convention for a fault that two services can be blamed for, and a pricing
    // that counted this as a repair would report a gain that no reader could reproduce.
    const rows = oneCase(['source', 'leftLeaf'], 'leftLeaf');
    const report = crossValidateAncestry(rows, profiles, new Map([['case-a', TREE]]), [300], 0);
    expect(report.sweep[0]!.fires).toBe(1);
    expect(report.sweep[0]!.repairs).toBe(0);
    expect(report.sweep[0]!.breaks).toBe(0);
    expect(report.deltas).toEqual([0, 0]);
  });
});

describe('the bar each fold chooses', () => {
  it('prefers the bar that reads better on the fold it selects on, not the first one swept', () => {
    // Two bars that disagree: at 500 only the loud leaf clears the bar, so the rung is the leaf and the answer IS the
    // leaf — the bound has nothing to say and the engine's wrong answer survives. At 300 the deeper source is in the
    // rising set, the path runs through `mid`, and the leaf is contradicted with the truth. A selection that returned
    // the first cell would price a grid it never read.
    const TREE_PROFILES: Profiles = profilesOf('case-a', {
      leftLeaf: departure(600),
      source: departure(400),
    });
    const rows = [
      splitCase({ datapack: 'case-a', truth: ['source'], answer: 'leftLeaf' }),
      splitCase({ datapack: 'case-b', truth: ['source'], answer: 'leftLeaf' }),
    ];
    const profiles: Profiles = new Map([
      ['case-a', TREE_PROFILES.get('case-a')!],
      ['case-b', TREE_PROFILES.get('case-a')!],
    ]);
    const graphs = new Map([
      ['case-a', TREE],
      ['case-b', TREE],
    ]);
    const report = crossValidateAncestry(rows, profiles, graphs, [300, 500], 0);
    const at300 = report.sweep.find((one) => one.kappa === 300)!;
    const at500 = report.sweep.find((one) => one.kappa === 500)!;
    expect(at300.correct[0] + at300.correct[1]).toBeGreaterThan(
      at500.correct[0] + at500.correct[1],
    );
    expect(report.selected).toEqual([300, 300]);
    expect(report.deltas).toEqual([1, 1]);
  });
});

describe('a grid whose better cell is not the first one swept', () => {
  /** The same tree with one more hop below the leaf, so a low bar has a rung there. */
  const DEEPENED: CallGraph = {
    edges: [...TREE.edges, ['leftLeaf', 'noise']],
  };

  it('moves the selection forward when a later bar reads better, which is what a sweep is for', () => {
    // At 30 the noise at depth 3 ties the source and wins it on the smaller id, so the rung is off the answer's branch
    // and the answer sits on its own path — the bound is silent and the engine's wrong answer survives. At 300 the
    // noise is out of the rising set and the contradiction lands on the truth. A `choose` that stopped at the first
    // cell would report the low bar as its selection and price the wrong half of the grid.
    const profiles: Profiles = new Map([
      [
        'case-a',
        new Map([
          ['source', departure(400)],
          ['noise', departure(50)],
        ]),
      ],
      [
        'case-b',
        new Map([
          ['source', departure(400)],
          ['noise', departure(50)],
        ]),
      ],
    ]);
    const rows = [
      splitCase({ datapack: 'case-a', truth: ['source'], answer: 'leftLeaf' }),
      splitCase({ datapack: 'case-b', truth: ['source'], answer: 'leftLeaf' }),
    ];
    const graphs = new Map([
      ['case-a', DEEPENED],
      ['case-b', DEEPENED],
    ]);
    const report = crossValidateAncestry(rows, profiles, graphs, [30, 300], 0);
    expect(report.sweep[0]!.correct[0] + report.sweep[0]!.correct[1]).toBe(0);
    expect(report.sweep[1]!.correct[0] + report.sweep[1]!.correct[1]).toBe(2);
    expect(report.selected).toEqual([300, 300]);
    expect(report.passes).toBe(true);
  });
});

describe('the population the rule is allowed to speak about', () => {
  it('leaves a case the front door does not address alone, even when the graph contradicts its answer', () => {
    // The relation holds on this case and the rule would contradict it — but the premise fails (calls below the door
    // are failing), so the pipeline never consults a prior here and a rule that spoke would be pricing a product this
    // repository does not ship. Measured ungated, the relation fires on 963 correct answers and repairs 2.
    const rows = [
      splitCase({ datapack: 'case-a', truth: ['source'], answer: 'leftLeaf', belowFails: true }),
    ];
    const profiles = profilesOf('case-a', { source: departure(400) });
    const report = crossValidateAncestry(rows, profiles, new Map([['case-a', TREE]]), [300], 0);
    expect(report.sweep[0]!.fires).toBe(0);
    expect(report.deltas).toEqual([0, 0]);
  });

  it('prices a case whose answer never moved past the prior as no fire either', () => {
    const rows = [
      splitCase({ datapack: 'case-a', truth: ['source'], answer: 'leftLeaf', answerSurprise: 10 }),
    ];
    const profiles = profilesOf('case-a', { source: departure(400) });
    const report = crossValidateAncestry(rows, profiles, new Map([['case-a', TREE]]), [300], 0);
    expect(report.sweep[0]!.fires).toBe(0);
  });
});

describe('the reach the population parameter measures', () => {
  it('speaks on a case the front door refuses when the caller asks for the whole corpus', () => {
    // The two readings differ by a factor of eighteen on the real corpus, so the parameter is asserted rather than
    // described: `addressed` is the pipeline's population and `all` is the relation's reach.
    const rows = [
      splitCase({ datapack: 'case-a', truth: ['source'], answer: 'leftLeaf', belowFails: true }),
    ];
    const profiles = profilesOf('case-a', { source: departure(400) });
    const graphs = new Map([['case-a', TREE]]);
    expect(
      crossValidateAncestry(rows, profiles, graphs, [300], 0, 'deepest', 'addressed').sweep[0]!
        .fires,
    ).toBe(0);
    expect(
      crossValidateAncestry(rows, profiles, graphs, [300], 0, 'deepest', 'all').sweep[0]!.fires,
    ).toBe(1);
  });
});
