/**
 * The Cloud-OpsBench runner arms the label prior from the options the ENGINE receives, not from the flag's spelling.
 *
 * ## The defect this file was written for
 *
 * The runner decided whether to build a label history from the RAW command line: `(args.labelPriorWeight ?? 0) !== 0`.
 * That read `0` where the engine reads `DEFAULT_LABEL_PRIOR_WEIGHT`, and the two agreed only while the shipped
 * default WAS `0`. Iteration 369 enrolled the arm at `0.1`, at which point a bare `--data-dir <checkout>` reached the
 * engine with weight `0.1` and **no history attached to any case**: every `p(v)` was absent, the term was skipped, and
 * the run printed `shipped default (0, the ablation)` beside a ranking it had every right to call the ablation — but
 * no longer the shipped one. A silent divergence between "what the engine is configured with" and "what the runner
 * did" is the failure mode this project prices highest, because the run succeeds and the report is self-consistent.
 *
 * The fix is not a second constant: it is asking the RESOLVED options. One call builds the option object the engine
 * gets, and the same object answers whether a history is needed — so the two cannot drift again without the compiler
 * or this file saying so.
 *
 * @module benchmarks/__tests__/cloudopsbench-prior-arming
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABEL_PRIOR_JURISDICTION,
  DEFAULT_LABEL_PRIOR_MARGIN_GATE,
  DEFAULT_LABEL_PRIOR_WEIGHT,
} from '../../packages/tree/src/index.js';

import { pricesLabelPrior, resolveEngineOptions } from '../src/cloudopsbench-engine-options.js';

describe('whether a Cloud-OpsBench run prices the label prior', () => {
  it('prices it on a bare command line, because that is what the engine does', () => {
    // The enrolled arm is the DEFAULT now, so a run that attached no history would be a measurement of the
    // ablation published under the enrolled configuration's name.
    expect(DEFAULT_LABEL_PRIOR_WEIGHT).toBeGreaterThan(0);
    expect(pricesLabelPrior(resolveEngineOptions())).toBe(true);
  });

  it('resolves the weight to the shipped default rather than to a literal in this runner', () => {
    expect(resolveEngineOptions().signals.labelPriorWeight).toBe(DEFAULT_LABEL_PRIOR_WEIGHT);
    expect(resolveEngineOptions().signals.labelPriorMarginGate).toBe(
      DEFAULT_LABEL_PRIOR_MARGIN_GATE,
    );
    expect(resolveEngineOptions().signals.labelPriorJurisdiction).toBe(
      DEFAULT_LABEL_PRIOR_JURISDICTION,
    );
  });

  it('still prices nothing at explicit weight 0, which is the ablation', () => {
    expect(pricesLabelPrior(resolveEngineOptions({ labelPriorWeight: 0 }))).toBe(false);
  });

  it('lets an absent flag leave the shipped value untouched instead of overwriting it with undefined', () => {
    // The trap the override object already documented: `{...parsed, x: undefined}` would hand the engine an
    // invalid number, and the engine's own defaulting would then be the only thing standing between a dispatch
    // and a configuration nobody chose.
    expect(resolveEngineOptions({ labelPriorWeight: undefined }).signals.labelPriorWeight).toBe(
      DEFAULT_LABEL_PRIOR_WEIGHT,
    );
  });

  it('moves the weight, the gate and the position as one configuration', () => {
    const arm = resolveEngineOptions({ labelPriorWeight: 0.05, labelPriorMarginGate: 0.02 });
    expect(arm.signals.labelPriorWeight).toBe(0.05);
    expect(arm.signals.labelPriorMarginGate).toBe(0.02);
    expect(pricesLabelPrior(arm)).toBe(true);
  });
});
