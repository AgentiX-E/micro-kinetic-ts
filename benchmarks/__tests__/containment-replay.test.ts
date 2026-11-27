/**
 * The replay: three arms walked from one dump row, and the check that says whether the row is complete.
 *
 * The fixtures are built through `buildContainmentRow` rather than hand-written, because the property under test
 * is that the row carries ITS OWN input: a hand-written chain would test the parser against a shape the builder
 * might never produce, and the whole point of the field is that the builder's arguments survive the write.
 *
 * @module benchmarks/__tests__/containment-replay
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FAILURE_CONTAINMENT_SCOPE,
  failureEdgeKey,
} from '../../packages/tree/src/index.js';
import { headOf, replayAgrees, replayCase } from '../src/containment-replay.js';
import {
  buildContainmentRow,
  type BuildContainmentRowInput,
} from '../src/containment-row-build.js';
import type { ContainmentCaseRow } from '../src/containment-rows.js';

/** A case whose callee sits two band widths further out than its caller, on an interface that failed. */
function input(overrides: Partial<BuildContainmentRowInput> = {}): BuildContainmentRowInput {
  return {
    datapack: 'dp',
    faultType: 'NetworkDelay',
    sigma: 3,
    margin: 0,
    edges: [{ from: 'a', to: 'b' }],
    excursions: new Map([
      ['a', 0],
      ['b', 2],
    ]),
    surprises: undefined,
    failedInterfaces: new Map([[failureEdgeKey('a', 'b'), 4]]),
    failureFlows: undefined,
    failingEdges: undefined,
    attribution: 'shape',
    // Stated rather than defaulted: the builder requires it, which is the whole point of the field.
    scope: 'adjacent',
    fusionOrder: ['a', 'b'],
    publishedOrder: ['b', 'a'],
    ...overrides,
  };
}

/** A row whose recorded top-1 is the one its own chain produces, i.e. a healthy artifact. */
function row(overrides: Partial<BuildContainmentRowInput> = {}): ContainmentCaseRow {
  const built = buildContainmentRow(input(overrides));
  const replayed = replayCase(built, { kind: 'shipped' });
  return replayed === null ? built : { ...built, shippedTop1: headOf(replayed.published) };
}

const ADMITS = {
  residuals: new Map([[failureEdgeKey('a', 'b'), 0.2]]),
  threshold: 0,
};

/** A prior that has fitted nothing, which is the state a small corpus produces and the one that exposes a conjunction. */
const EMPTY = { residuals: new Map<string, number>(), threshold: 0 };

describe('headOf', () => {
  it('is null for an empty order rather than an empty string', () => {
    expect(headOf([])).toBeNull();
  });

  it('is the first candidate otherwise', () => {
    expect(headOf(['a', 'b'])).toBe('a');
  });
});

describe('replayCase', () => {
  it('refuses the surprise arm on a row whose chain carries no surprise map', () => {
    // Not an empty map: an empty map makes the pass a no-op, so the arm would report itself as identical to `off`
    // and a dump written before the field existed would look like a finding about the measurement.
    expect(replayCase(row(), { kind: 'surprise' })).toBeNull();
  });

  it('walks the surprise arm over the surprise map, and the shipped arm over the excursions', () => {
    // Latency says nothing (both sides inside their bands) while the whole-channel measurement says the callee is
    // far out. The rule and the interface record are identical, so the two heads differ only by the measurement.
    const both = row({
      excursions: new Map([
        ['a', 0],
        ['b', 0],
      ]),
      surprises: new Map([
        ['a', 0],
        ['b', Math.log(7)],
      ]),
    });
    expect(headOf(replayCase(both, { kind: 'shipped' })!.published)).toBe('a');
    expect(headOf(replayCase(both, { kind: 'surprise' })!.published)).toBe('b');
  });

  it('keeps the interface record in the surprise arm, because the arm varies the measurement and not the rule', () => {
    // The interface did not fail, so neither arm may invert: an arm that dropped the record would be pricing a
    // different rule and crediting the improvement to the measurement.
    const recordless = row({
      failedInterfaces: new Map(),
      surprises: new Map([
        ['a', 0],
        ['b', Math.log(7)],
      ]),
    });
    expect(replayCase(recordless, { kind: 'surprise' })!.verdicts[0]!.decision).toBe(
      'no-failed-interface',
    );
    expect(headOf(replayCase(recordless, { kind: 'surprise' })!.published)).toBe('a');
  });

  it('refuses to walk a row that carries no input', () => {
    const built = buildContainmentRow(input());
    const { chain: _dropped, ...withoutChain } = built;
    expect(replayCase(withoutChain, { kind: 'shipped' })).toBeNull();
  });

  it('reproduces the refused arm when asked for no requirement at all', () => {
    // The `ungated` arm is the excursion rule and nothing else. It is the arm iteration 293 refused, and the
    // control the interface record is priced against — a replay that could not produce it could not price either.
    const built = row();
    const replayed = replayCase(built, { kind: 'ungated' });
    expect(replayed!.containment).toEqual(['b', 'a']);
    expect(headOf(replayed!.containment)).toBe(built.ungatedTop1);
  });

  it('leaves the order alone on the off arm, and claims nothing about it', () => {
    // `off` is the 1 141-case baseline: no sweep at all. A baseline walked through the excursion rule would be
    // the `ungated` arm, and crediting the gate against it would credit decisions the fusion never made.
    const built = row();
    const off = replayCase(built, { kind: 'off' });
    expect(off!.containment).toEqual(['a', 'b']);
    expect(off!.verdicts).toEqual([]);
    expect(off!.containment).not.toEqual(replayCase(built, { kind: 'ungated' })!.containment);
  });

  it('reproduces the shipped arm when asked for the interface requirement', () => {
    const built = row();
    const replayed = replayCase(built, { kind: 'shipped' });
    expect(replayed!.containment).toEqual(['b', 'a']);
    expect(headOf(replayed!.containment)).toBe(built.gatedTop1);
    expect(replayed!.verdicts.map((one) => one.decision)).toEqual(['inverted']);
  });

  it('refuses the inversion on the shipped arm when no interface failed', () => {
    const built = row({ failedInterfaces: new Map() });
    const replayed = replayCase(built, { kind: 'shipped' });
    expect(replayed!.verdicts.map((one) => one.decision)).toEqual(['no-failed-interface']);
    expect(replayed!.containment).toEqual(['a', 'b']);
  });

  it('walks the prior arm as a replacement for the interface record, not as an addition to it', () => {
    // The pre-registered arm is the residual INSTEAD of the record. A replay that carried both would price the
    // residual on the cases the record had already refused, and every one of those is a case the residual arm
    // was never allowed to answer.
    const built = row({ failedInterfaces: new Map() });
    const replayed = replayCase(built, { kind: 'prior', prior: ADMITS });
    expect(replayed!.containment).toEqual(['b', 'a']);
    expect(replayed!.verdicts.map((one) => one.decision)).toEqual(['inverted']);
  });

  it('refuses the prior arm when the edge was never fitted, and says so', () => {
    const built = row();
    const replayed = replayCase(built, {
      kind: 'prior',
      prior: { residuals: new Map(), threshold: 0 },
    });
    expect(replayed!.containment).toEqual(['a', 'b']);
    expect(replayed!.verdicts.map((one) => one.decision)).toEqual(['prior-absent']);
  });

  it('carries the row s margin into the walk', () => {
    // b - a is two band widths; a margin of 2.5 makes the pair fail the inequality, which the replay has to
    // read from the ROW rather than from a default, or a dump of a margin screen would replay at margin 0.
    const built = row({ margin: 2.5, publishedOrder: ['a', 'b'] });
    const replayed = replayCase(built, { kind: 'ungated' });
    expect(replayed!.verdicts.map((one) => one.decision)).toEqual(['not-larger']);
  });

  it('carries an unmeasured side into the walk as unmeasured', () => {
    const built = row({ excursions: new Map([['a', 0]]), publishedOrder: ['a', 'b'] });
    const replayed = replayCase(built, { kind: 'ungated' });
    expect(replayed!.verdicts.map((one) => one.decision)).toEqual(['unmeasured']);
  });

  it('applies the failure-flow pass, so the published order is the engine s and not the sweep s', () => {
    // `b` nets an unexplained inbound rise; the flow pass promotes it over an order the sweep left alone.
    const built = row({
      excursions: new Map([
        ['a', 2],
        ['b', 2],
      ]),
      publishedOrder: ['b', 'a'],
      failureFlows: new Map([
        ['a', { knownIn: 0, knownOut: 9, novelIn: 0, novelOut: 0 }],
        ['b', { knownIn: 9, knownOut: 0, novelIn: 0, novelOut: 0 }],
      ]),
      failingEdges: new Map([[failureEdgeKey('a', 'b'), { rise: 9, novel: 0 }]]),
    });
    const replayed = replayCase(built, { kind: 'shipped' });
    expect(replayed!.containment).toEqual(['a', 'b']);
    expect(replayed!.published).toEqual(['b', 'a']);
  });

  it('sees no flow at all when the chain recorded none', () => {
    // An absent flow map and an empty one are the same measurement, which is why the builder writes `{}` for
    // both: the replay then cannot distinguish them and does not need to.
    const built = row({ excursions: new Map([['a', 2]]), publishedOrder: ['a', 'b'] });
    const replayed = replayCase(built, { kind: 'ungated' });
    expect(replayed!.published).toEqual(['a', 'b']);
  });

  it('shows two arms walking to different adjacencies, which is why neither can be zipped by index', () => {
    // The same fusion order, the same edges, and one requirement between them: the refused arm inverts `a`/`b`
    // and then examines `a`/`c`, while the arm that refuses `a`/`b` goes on to examine `b`/`c` — which carries no
    // edge, so it examines nothing. Two rows against one, describing different pairs.
    const built = row({
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
      excursions: new Map([
        ['a', 0],
        ['b', 2],
        ['c', 3],
      ]),
      failedInterfaces: new Map(),
      fusionOrder: ['a', 'b', 'c'],
      publishedOrder: ['a', 'b', 'c'],
    });
    const refused = replayCase(built, { kind: 'ungated' });
    const shipped = replayCase(built, { kind: 'shipped' });
    expect(refused!.verdicts.map((one) => [one.upper, one.lower, one.decision])).toEqual([
      ['a', 'b', 'inverted'],
      ['a', 'c', 'inverted'],
    ]);
    expect(shipped!.verdicts.map((one) => [one.upper, one.lower, one.decision])).toEqual([
      ['a', 'b', 'no-failed-interface'],
    ]);
    expect(refused!.containment).toEqual(['b', 'c', 'a']);
    expect(shipped!.containment).toEqual(['a', 'b', 'c']);
  });
});

describe('replayAgrees', () => {
  it('agrees when the walk reproduces the recorded top-1', () => {
    const built = row();
    expect(replayAgrees(built, replayCase(built, { kind: 'shipped' }))).toBe(true);
  });

  it('disagrees when the record says something the walk does not', () => {
    const built: ContainmentCaseRow = { ...row(), shippedTop1: 'a' };
    expect(replayAgrees(built, replayCase(built, { kind: 'shipped' }))).toBe(false);
  });

  it('is unanswerable without a chain, which is not the same as a disagreement', () => {
    const built = buildContainmentRow(input());
    const { chain: _dropped, ...withoutChain } = built;
    expect(replayAgrees(withoutChain, replayCase(withoutChain, { kind: 'shipped' }))).toBeNull();
  });
});

describe('the graded arm’s refusal', () => {
  it('returns null rather than an order when a candidate has no score', () => {
    // The refusal is the arm's honest answer: a candidate the engine could not score has no place in a sort by
    // score, and an order invented from the ones that can be scored would be a population the run never declared.
    const row = {
      datapack: 'case',
      margin: 0,
      chain: {
        order: ['a', 'b'],
        edges: [['a', 'b']],
        excursions: { a: 0, b: 1 },
        failedInterfaces: {},
        flows: {},
        failingEdges: {},
        attribution: 'count',
      },
    } as unknown as ContainmentCaseRow;
    expect(
      replayCase(row, { kind: 'graded', transfers: [], scores: new Map([['a', 1]]) }),
    ).toBeNull();
  });

  it('publishes the graded order through the same flow pass every arm gets', () => {
    const row = {
      datapack: 'case',
      margin: 0,
      chain: {
        order: ['a', 'b'],
        edges: [['a', 'b']],
        excursions: { a: 0, b: 1 },
        failedInterfaces: {},
        flows: {},
        failingEdges: {},
        attribution: 'count',
      },
    } as unknown as ContainmentCaseRow;
    const replayed = replayCase(row, {
      kind: 'graded',
      transfers: [{ caller: 'a', callee: 'b', phi: 0.9, asymmetry: 1, delta: 1 }],
      scores: new Map([
        ['a', 1],
        ['b', 0.5],
      ]),
    });
    expect(replayed?.containment).toEqual(['b', 'a']);
    // No sweep ran, so no pair was examined: the graded arm's reasons are the transfers, which live in the study.
    expect(replayed?.verdicts).toEqual([]);
    expect(replayed?.published).toEqual(['b', 'a']);
  });
});

describe('replayCase — the veto arm', () => {
  /** A case whose record is silent throughout: no interface failed anywhere. */
  const recordFree = (overrides: Partial<BuildContainmentRowInput> = {}): ContainmentCaseRow =>
    row({ failedInterfaces: new Map(), ...overrides });

  it('inverts where the record is silent and the residual admits the pair', () => {
    const built = recordFree();
    expect(headOf(replayCase(built, { kind: 'shipped' })!.published)).toBe('a');
    expect(headOf(replayCase(built, { kind: 'prior', prior: ADMITS })!.published)).toBe('b');
    expect(headOf(replayCase(built, { kind: 'veto', prior: ADMITS })!.published)).toBe('b');
  });

  it('keeps the record as a veto on a case that recorded a failed call somewhere else', () => {
    // This is the arm's whole risk, and the three losses §299 records: a call passed between these two and
    // completed, so the record vetoes the promotion even though the residual would admit it.
    const built = row({ failedInterfaces: new Map([[failureEdgeKey('b', 'a'), 4]]) });
    expect(headOf(replayCase(built, { kind: 'prior', prior: ADMITS })!.published)).toBe('b');
    expect(headOf(replayCase(built, { kind: 'veto', prior: ADMITS })!.published)).toBe('a');
  });

  it('reads the record per edge where the record exists, which is the shipped arm exactly', () => {
    // The arm is one word of interpretation, so on every case whose record is non-empty it must agree with the
    // shipped walk: no tuning, no drift, and a difference here would be a defect rather than a finding.
    //
    // The prior is deliberately EMPTY, which is the form that catches the defect this test did not catch the
    // first time. Written with a prior that admitted the edge, it passed while the arm was asking the residual on
    // top of the licence: a licensed pair with no fitted residual became `prior-absent` and the arm inverted 110
    // pairs where the shipped walk inverts 242. An empty prior makes every licensed pair a candidate for that
    // mistake, so agreeing with the shipped walk here is the assertion that the conjunction is gone.
    const built = row();
    const shipped = replayCase(built, { kind: 'shipped' })!;
    const veto = replayCase(built, { kind: 'veto', prior: EMPTY })!;
    expect(veto.published).toEqual(shipped.published);
    expect(veto.verdicts).toEqual(shipped.verdicts);
  });

  it('still refuses where the residual does not admit, however silent the record is', () => {
    const refused = EMPTY;
    expect(headOf(replayCase(recordFree(), { kind: 'veto', prior: refused })!.published)).toBe('a');
  });

  it('carries the record into the sweep even when the prior is empty, so the silence is what moves', () => {
    const refused = { residuals: new Map(), threshold: 0 };
    const replayed = replayCase(recordFree(), { kind: 'veto', prior: refused })!;
    expect(replayed.verdicts.map((verdict) => verdict.decision)).toEqual(['prior-absent']);
  });
});

describe('the scope the flow pass ran at', () => {
  /**
   * A row whose only failing edge spans a candidate the fusion put two places lower.
   *
   * `buildContainmentRow` is the writer, so the fixture goes through it: the question is whether the scope the
   * run applied reaches the walk from the FILE, and a hand-written chain would not test that.
   */
  function spanned(scope: 'adjacent' | 'global' | 'global-measured'): ContainmentCaseRow {
    const built = buildContainmentRow(
      input({
        edges: [{ from: 'a', to: 'c' }],
        excursions: new Map([
          ['a', 0],
          ['b', 0],
          ['c', 0],
        ]),
        failedInterfaces: new Map(),
        failureFlows: new Map([
          ['a', { knownIn: 0, knownOut: 0, novelIn: 0, novelOut: 0 }],
          ['c', { knownIn: 5, knownOut: 0, novelIn: 0, novelOut: 0 }],
        ]),
        failingEdges: new Map([[failureEdgeKey('a', 'c'), { rise: 5, novel: 0 }]]),
        fusionOrder: ['a', 'b', 'c'],
        publishedOrder: scope === 'adjacent' ? ['a', 'b', 'c'] : ['c', 'a', 'b'],
        scope,
      }),
    );
    return built;
  }

  it('lifts a spanned pair only when the chain states the wide scope', () => {
    const wide = spanned('global-measured');
    expect(replayCase(wide, { kind: 'off' })!.published).toEqual(['c', 'a', 'b']);
    const narrow = { ...wide, chain: { ...wide.chain!, scope: 'adjacent' as const } };
    expect(replayCase(narrow, { kind: 'off' })!.published).toEqual(['a', 'b', 'c']);
  });

  it('names the scope it walked at on every replayed case', () => {
    expect(replayCase(spanned('global'), { kind: 'off' })!.scope).toBe('global');
    expect(replayCase(spanned('adjacent'), { kind: 'off' })!.scope).toBe('adjacent');
  });

  it('replays a row that states no scope at the shipped default AND says that is what it did', () => {
    // Absence is not a claim. A dump written before the field existed cannot be read at a scope its author never
    // wrote, so the walk falls back to the one the engine ships and reports which one it used — a reader that
    // mistook the fallback for a measurement would be reading a configuration nobody stated.
    const built = spanned('adjacent');
    const { scope: _dropped, ...chainless } = built.chain!;
    const bare: ContainmentCaseRow = { ...built, chain: chainless as typeof built.chain };
    expect(replayCase(bare, { kind: 'off' })!.scope).toBe(DEFAULT_FAILURE_CONTAINMENT_SCOPE);
    expect(DEFAULT_FAILURE_CONTAINMENT_SCOPE).toBe('adjacent');
  });

  it('agrees with a wide run’s recorded top-1, which is the 33-case instrument break', () => {
    const wide = spanned('global-measured');
    expect(replayAgrees(wide, replayCase(wide, { kind: 'off' }))).toBe(true);
  });

  it('calls the same row a disagreement when the scope is not carried, which is honest and is why it is written', () => {
    const wide = spanned('global-measured');
    const { scope: _dropped, ...chainless } = wide.chain!;
    const bare: ContainmentCaseRow = { ...wide, chain: chainless as typeof wide.chain };
    expect(replayAgrees(bare, replayCase(bare, { kind: 'off' }))).toBe(false);
  });
});
