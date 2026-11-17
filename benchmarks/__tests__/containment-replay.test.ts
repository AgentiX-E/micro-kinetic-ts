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

import { failureEdgeKey } from '../../packages/tree/src/index.js';
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
    failedInterfaces: new Map([[failureEdgeKey('a', 'b'), 4]]),
    failureFlows: undefined,
    failingEdges: undefined,
    attribution: 'shape',
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

describe('headOf', () => {
  it('is null for an empty order rather than an empty string', () => {
    expect(headOf([])).toBeNull();
  });

  it('is the first candidate otherwise', () => {
    expect(headOf(['a', 'b'])).toBe('a');
  });
});

describe('replayCase', () => {
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
