/**
 * Guards on HOW a benchmark runner hands its case to the engine.
 *
 * ## Why this is a fence and not a style rule
 *
 * `toFaultGraphOptions` exists because two call sites drifted: `run-fse26.ts` built its fault graph inline and
 * passed only `injectTimeMs` and `logs`, so `traceActivity` and then `failedTraceEdges` were each **silently
 * dead** on the benchmark with the largest case count. Nothing threw and no coverage fell; the battery simply
 * reported "no change", which reads as a measured result.
 *
 * Two more sites had drifted the same way (`run-optimize.ts` forwarded `logs` and nothing else;
 * `optimize-all.ts` passed no options at all). They are repaired, and this fence is what keeps the third, the
 * fourth and the fifth from appearing: an input that does not REACH the engine is indistinguishable, in every
 * artifact, from an input that does not matter.
 *
 * @module benchmarks/__tests__/fault-graph-assembly
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(resolve(HERE, relative), 'utf8');

/** Every benchmark runner that evaluates a suite of cases and is therefore subject to the drift. */
const CASE_EVALUATING_RUNNERS = [
  '../src/run-optimize.ts',
  '../src/run-rcaeval.ts',
  '../src/run-fse26.ts',
  '../src/optimize-all.ts',
] as const;

describe('a runner that scores cases assembles the engine inputs in one place', () => {
  it('routes every case through the shared assembly rather than an inline literal', () => {
    // The shared function forwards `logs`, `traceActivity`, `failedTraceEdges` and `edgeLatency`. An inline
    // literal lists whichever of those the author remembered, and the omission is invisible in every artifact.
    for (const runner of CASE_EVALUATING_RUNNERS) {
      const source = read(runner);
      expect(source, `${runner} imports the shared assembly`).toContain('toFaultGraphOptions');
      // The drift's shape: a call whose third argument is an object literal. `pruner.buildFaultGraph` takes two
      // arguments and is a different class, so it is not what this looks for.
      expect(
        source.match(/buildFaultGraph\([^)]*\{/g) ?? [],
        `${runner} must not build the options inline`,
      ).toEqual([]);
    }
  });

  it('leaves the shared assembly itself forwarding every optional field', () => {
    // If the assembly dropped a field, every runner would drop it together — which is exactly the silent
    // failure this module was written to end, moved one level up.
    const assembly = read('../../packages/kinetic/src/benchmarks/runners/fault-graph-options.ts');
    for (const field of ['logs', 'traceActivity', 'failedTraceEdges', 'edgeLatency']) {
      expect(assembly, `the assembly forwards ${field}`).toContain(`${field}: benchCase.${field}`);
    }
  });

  it('attaches the directional inputs where the traces still exist', () => {
    // The loader drops the spans after augmentation (a documented memory trade), so the ONLY place the
    // aggregate can be derived is the augmentation itself. A runner that forgot would look exactly like a
    // runner whose corpus has no traces — which is what RCAEval looked like for six iterations.
    for (const runner of ['../src/run-optimize.ts', '../src/run-rcaeval.ts'] as const) {
      const source = read(runner);
      expect(source, `${runner} derives the aggregate`).toContain('toEngineDirectionalInputs(');
      expect(source, `${runner} attaches it to the case`).toContain(
        'edgeLatency: directional.edgeLatency',
      );
      expect(source, `${runner} attaches the failed edges too`).toContain(
        'failedTraceEdges: directional.failedTraceEdges',
      );
    }
  });

  it('keeps the injection anchor a CALLER policy, since the shared function takes it as one', () => {
    // `injectTimeMs` is a parameter rather than a field because the runners own that policy: the ablation
    // runner disables the anchor. A fence that required a field here would be asserting a policy the
    // repository does not hold.
    const assembly = read('../../packages/kinetic/src/benchmarks/runners/fault-graph-options.ts');
    expect(assembly).toContain('injectTimeMs: number');
    expect(assembly).toContain('injectTimeMs,');
  });
});
