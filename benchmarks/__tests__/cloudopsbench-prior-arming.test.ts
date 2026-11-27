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
  DEFAULT_DUAL_FAMILY_GATE,
  DEFAULT_DUAL_FAMILY_GATE_MODE,
  DEFAULT_DUAL_FAMILY_WEIGHT,
  DEFAULT_LABEL_PRIOR_JURISDICTION,
  DEFAULT_LABEL_PRIOR_MARGIN_GATE,
  DEFAULT_LABEL_PRIOR_WEIGHT,
} from '../../packages/tree/src/index.js';

import { pricesLabelPrior, resolveEngineOptions } from '../src/cloudopsbench-engine-options.js';

describe('the log channel, resolved rather than restated', () => {
  it('leaves the shipped log mode and weight alone when no flag is given', () => {
    // The metric-only arm is the default at the ENGINE level too, and this file is where the two defaults are held
    // to each other: a run whose `--logs` was absent must reach the engine with the same log configuration the anchor
    // fingerprint hashes, whatever that configuration is.
    const shipped = resolveEngineOptions();
    expect(resolveEngineOptions({ logSignalMode: undefined }).signals.logSignalMode).toBe(
      shipped.signals.logSignalMode,
    );
    expect(resolveEngineOptions({ logWeight: undefined }).signals.logWeight).toBe(
      shipped.signals.logWeight,
    );
  });

  it('forwards a mode and a weight into the object the engine receives', () => {
    // Forwarded, not interpreted: the runner does not know what `logicHttp` means, and a second place that did would
    // be a second definition of the six modes.
    expect(resolveEngineOptions({ logSignalMode: 'logicHttp' }).signals.logSignalMode).toBe(
      'logicHttp',
    );
    expect(resolveEngineOptions({ logSignalMode: 'all' }).signals.logSignalMode).toBe('all');
    expect(resolveEngineOptions({ logWeight: 0 }).signals.logWeight).toBe(0);
    expect(resolveEngineOptions({ logWeight: 2.5 }).signals.logWeight).toBe(2.5);
  });

  it('keeps the log weight independent of the label prior, so one arm can price the other at nothing', () => {
    // The invariance arm this iteration runs is `--logs --log-weight 0` with the label prior still enrolled: if the
    // two shared a field, that run would silently be a different prior arm as well.
    const both = resolveEngineOptions({ logWeight: 0, labelPriorWeight: 0.1 });
    expect(both.signals.logWeight).toBe(0);
    expect(both.signals.labelPriorWeight).toBe(0.1);
  });
});

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

  it('resolves the dual-family triple to the shipped defaults too, because two scripts restate it', () => {
    // `run-dual-membership.ts` computes its flip BUDGET at the weight and prints all three, and both used to restate
    // the literals (`?? 0.25`, `?? 'channel'`). The projection is now the single source, so a default that moves fails
    // here instead of leaving two scripts asserting the old value in a report.
    const engine = resolveEngineOptions();
    expect(engine.signals.dualFamilyWeight).toBe(DEFAULT_DUAL_FAMILY_WEIGHT);
    expect(engine.signals.dualFamilyGate).toBe(DEFAULT_DUAL_FAMILY_GATE);
    expect(engine.signals.dualFamilyGateMode).toBe(DEFAULT_DUAL_FAMILY_GATE_MODE);
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
