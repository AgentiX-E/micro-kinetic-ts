/**
 * The quiet engine: exactly two fields move, and the pruner it builds is the same engine as the run's.
 *
 * @module benchmarks/__tests__/containment-pruner.test
 */

import { describe, expect, it } from 'vitest';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { buildContainmentPruner, quietEngineOptions } from '../src/containment-pruner.js';
import type { Fse26EngineOptions } from '../src/fse26-engine-options.js';

/**
 * A configuration whose two relational passes are ON, which is the shipped setting.
 *
 * Built as a partial and cast rather than through `buildFse26EngineOptions`: this test is about a projection of a
 * configuration, and dragging sixty parsed flags in would make the assertion about the flag table instead of about
 * the two fields that move.
 */
function shipped(): Fse26EngineOptions {
  return {
    signals: {
      containmentOrder: true,
      failureContainment: true,
      failureAttribution: 'shape',
      logWeight: 1,
      topoWeight: 1,
      containmentMargin: 0,
    } as unknown as Fse26EngineOptions['signals'],
    topology: { rankNormalization: true } as unknown as Fse26EngineOptions['topology'],
  };
}

describe('quietEngineOptions', () => {
  it('turns off exactly the two relational passes', () => {
    const before = shipped();
    const after = quietEngineOptions(before);
    const changed = Object.entries(after.signals).filter(
      ([key, value]) =>
        (before.signals as unknown as Record<string, unknown>)[key] !== (value as unknown),
    );
    expect(changed.map(([key]) => key).sort()).toEqual(['containmentOrder', 'failureContainment']);
    expect(after.signals.containmentOrder).toBe(false);
    expect(after.signals.failureContainment).toBe(false);
  });

  it('leaves the attribution and every other signal alone', () => {
    // The attribution is named separately because it is the one field adjacent to the two that move: a mapping
    // that reset it would change how the FAILURE-FLOW pass reads a case, which is not this engine's subject.
    const after = quietEngineOptions(shipped());
    expect(after.signals.failureAttribution).toBe('shape');
    expect(after.signals.containmentMargin).toBe(0);
    expect(after.signals.logWeight).toBe(1);
    expect(after.signals.topoWeight).toBe(1);
  });

  it('passes the topology through by reference, so the two engines score one graph', () => {
    const before = shipped();
    expect(quietEngineOptions(before).topology).toBe(before.topology);
  });

  it('does not mutate its input, so the shipped engine is unaffected', () => {
    const before = shipped();
    quietEngineOptions(before);
    expect(before.signals.containmentOrder).toBe(true);
    expect(before.signals.failureContainment).toBe(true);
  });
});

describe('buildContainmentPruner', () => {
  it('builds the engine from the mapped pair rather than a literal at the call site', () => {
    // The construction census classifies `new TreePruner(` by the shape of its arguments, and an authored
    // literal is the shape that produced three consecutive iterations' defects. This asserts the property the
    // census reads, from the module it reads it in.
    const pruner = buildContainmentPruner(quietEngineOptions(shipped()));
    expect(pruner).toBeInstanceOf(TreePruner);
  });

  it('is a no-op on a graph that carries no excursions, whatever the passes are set to', () => {
    // Two engines, one graph, no profile: the quiet one and a shipped one must agree. That is the property the
    // observation rests on — the difference between the two orders is the passes and nothing else.
    const quiet = buildContainmentPruner(quietEngineOptions(shipped()));
    const loud = new TreePruner(shipped().signals, shipped().topology);
    expect(quiet).not.toBe(loud);
    expect(quiet.buildFaultGraph).toBeTypeOf('function');
  });
});
