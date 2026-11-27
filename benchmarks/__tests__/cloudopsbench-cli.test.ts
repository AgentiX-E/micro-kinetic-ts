/**
 * The runner's own flags: what each one means, and what a refusal has to say.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LABEL_PRIOR_JURISDICTION } from '../../packages/tree/src/index.js';

import { parseCloudOpsArgs } from '../src/cloudopsbench-cli.js';

describe('the Cloud-OpsBench runner’s command line', () => {
  it('requires a data directory, because there is no default checkout', () => {
    expect(() => parseCloudOpsArgs([])).toThrow(/--data-dir is required/);
  });

  it('reads a full command line', () => {
    expect(
      parseCloudOpsArgs([
        '--data-dir',
        '/tmp/cob',
        '--output',
        '/tmp/out.json',
        '--max-cases',
        '20',
      ]),
    ).toEqual({
      dataDir: '/tmp/cob',
      output: '/tmp/out.json',
      maxCases: 20,
      useInjectTime: true,
      topology: 'registry',
      dualFamilyWeight: undefined,
      dualFamilyGate: undefined,
      dualFamilyGateMode: undefined,
    });
  });

  it('builds the registry graph unless the ring ablation is asked for by name', () => {
    expect(parseCloudOpsArgs(['--data-dir', '/tmp/cob']).topology).toBe('registry');
    expect(parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--topology', 'ring']).topology).toBe(
      'ring',
    );
    expect(() => parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--topology', 'mesh'])).toThrow(
      /registry or ring/,
    );
    expect(() => parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--topology'])).toThrow(
      /needs a value/,
    );
  });

  it('reads the one engine weight it can move, and refuses a value that is not a weight', () => {
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-weight', '0']).dualFamilyWeight,
    ).toBe(0);
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-weight', '0.5']).dualFamilyWeight,
    ).toBe(0.5);
    expect(parseCloudOpsArgs(['--data-dir', '/tmp/cob']).dualFamilyWeight).toBeUndefined();
    expect(() =>
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-weight', 'x']),
    ).toThrow(/non-negative number/);
    expect(() =>
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-weight', '-1']),
    ).toThrow(/non-negative number/);
  });

  it('reads the membership gate as the SHARE it is, and refuses a number that is not one', () => {
    // The gate is a share of the fleet's strongest dual signal, so the interval is [0, 1] and not "non-negative": a
    // gate above 1 asks for a member stronger than the maximum, which no component can be and which would empty every
    // family silently instead of failing.
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-gate', '0']).dualFamilyGate,
    ).toBe(0);
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-gate', '0.08']).dualFamilyGate,
    ).toBe(0.08);
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-gate', '1']).dualFamilyGate,
    ).toBe(1);
    expect(parseCloudOpsArgs(['--data-dir', '/tmp/cob']).dualFamilyGate).toBeUndefined();
    for (const value of ['x', '-0.1', '1.5']) {
      expect(() =>
        parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-gate', value]),
      ).toThrow(/share in \[0, 1\]/);
    }
    expect(() => parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-gate'])).toThrow(
      /needs a value/,
    );
  });

  it('reads the gate mode off the engine’s own union, and refuses an inherited property', () => {
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-gate-mode', 'min'])
        .dualFamilyGateMode,
    ).toBe('min');
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-gate-mode', 'channel'])
        .dualFamilyGateMode,
    ).toBe('channel');
    expect(parseCloudOpsArgs(['--data-dir', '/tmp/cob']).dualFamilyGateMode).toBeUndefined();
    // `toString` is the string a dispatch really sends by accident, and `in` would accept it while `hasOwnProperty`
    // does not — the rule `isPrismPooling` records one module over.
    for (const value of ['average', 'toString', '__proto__']) {
      expect(() =>
        parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--dual-family-gate-mode', value]),
      ).toThrow(/channel or min/);
    }
  });

  it('turns the injection time off only when asked, and off is not the default', () => {
    const base = parseCloudOpsArgs(['--data-dir', '/tmp/cob']);
    expect(base.useInjectTime).toBe(true);
    expect(base.output).toBeUndefined();
    expect(base.maxCases).toBeUndefined();
    expect(parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--no-inject-time']).useInjectTime).toBe(
      false,
    );
  });

  it('names the flag that needs a value rather than reading the next one as a flag', () => {
    expect(() => parseCloudOpsArgs(['--data-dir'])).toThrow(/--data-dir needs a value/);
    expect(() => parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--output'])).toThrow(
      /--output needs a value/,
    );
    expect(() => parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--max-cases'])).toThrow(
      /--max-cases needs a value/,
    );
  });

  it('refuses a cap that is not a positive integer', () => {
    // `0` and `-1` are the two a shell history produces by accident, and either would silently select nothing or
    // slice from the end — a rate over a denominator of one case is worse than an error.
    for (const value of ['0', '-1', '1.5', 'ten']) {
      expect(() => parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--max-cases', value])).toThrow(
        /positive integer/,
      );
    }
  });

  it('leaves the label prior ABSENT unless a weight is given, so the shipped configuration stands', () => {
    // Absent rather than "armed at zero": `createContainer` then hands the engine the shipped configuration object,
    // and the shipped weight is `DEFAULT_LABEL_PRIOR_WEIGHT` — 0.1 since iteration 369, which is ARMED. The
    // distinction this test defends is therefore "the flag was not passed" versus "the flag was passed as 0", and
    // not "the term is off"; the runner reads its arming decision off the RESOLVED weight for exactly this reason.
    const base = parseCloudOpsArgs(['--data-dir', '/tmp/cob']);
    expect(base.labelPriorWeight).toBeUndefined();
    expect(base.labelPriorMarginGate).toBeUndefined();
    expect(base.labelPriorJurisdiction).toBeUndefined();
  });

  it('reads the POSITION the prior may act in, because the shipped one is not the one the registered arms used', () => {
    // Every Cloud-OpsBench arm in docs/label-prior.md §6 (`0.5577` at 0.05 / 0.02, `0.5769` at 0.1 / 0.02) was run
    // before the pin existed, i.e. at `everywhere`. The shipped jurisdiction moved to `tail` in iteration 369, so
    // those command lines no longer reproduce those numbers unless the word can be named — which is why this flag
    // exists rather than being implied by the default.
    expect(DEFAULT_LABEL_PRIOR_JURISDICTION).toBe('tail');
    for (const word of ['tail', 'everywhere'] as const) {
      expect(
        parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--label-prior-jurisdiction', word])
          .labelPriorJurisdiction,
      ).toBe(word);
    }
    // A flag alone is a legal arm: it changes nothing without a weight, the rule the gate above already follows.
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--label-prior-jurisdiction', 'everywhere'])
        .labelPriorWeight,
    ).toBeUndefined();
  });

  it('refuses a jurisdiction word the engine does not know, rather than reproducing the shipped one', () => {
    // The RCAEval parser falls back to the shipped word here, on the rule that a typo must reproduce a published
    // configuration rather than invent one. This parser refuses instead, because every other flag in it refuses and a
    // dispatch here is a shell line a reader typed: a failure names the word, while a fallback silently re-runs the
    // pinned arm under a name the operator did not ask for.
    expect(() =>
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--label-prior-jurisdiction', 'head']),
    ).toThrow(/--label-prior-jurisdiction is tail or everywhere/);
    expect(() =>
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--label-prior-jurisdiction']),
    ).toThrow(/needs a value/);
  });

  it('reads the label prior price and gate, together or apart', () => {
    const both = parseCloudOpsArgs([
      '--data-dir',
      '/tmp/cob',
      '--label-prior-weight',
      '0.1',
      '--label-prior-margin-gate',
      '0.02',
    ]);
    expect(both.labelPriorWeight).toBe(0.1);
    expect(both.labelPriorMarginGate).toBe(0.02);
    // The gate alone is a legal arm — it changes nothing without a weight, and refusing it would make a dispatch that
    // sets only the pair's second half fail with a message about the first.
    const gateOnly = parseCloudOpsArgs([
      '--data-dir',
      '/tmp/cob',
      '--label-prior-margin-gate',
      '0.05',
    ]);
    expect(gateOnly.labelPriorWeight).toBeUndefined();
    expect(gateOnly.labelPriorMarginGate).toBe(0.05);
    // 0 is a value, not an absence: it is the ungated arm, which the register refused after measuring it.
    expect(
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--label-prior-margin-gate', '0'])
        .labelPriorMarginGate,
    ).toBe(0);
  });

  it('refuses a negative label-prior weight, which would reward the services the history never saw', () => {
    // At `p < 1` the term is a penalty, so a negative weight inverts its meaning while still moving the ranking —
    // the shape of an arm that looks like it works.
    // `Number('')` is 0, so an empty value reads as the shipped weight rather than as a rejection — the rule two
    // numeric options above already follow, and the reason the list below names the two shapes that ARE invalid.
    for (const value of ['-0.1', 'x']) {
      expect(() =>
        parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--label-prior-weight', value]),
      ).toThrow(/--label-prior-weight must be a non-negative number/);
    }
  });

  it('refuses a negative label-prior gate, which would admit the prior where the head is undecided', () => {
    expect(() =>
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--label-prior-margin-gate', '-0.01']),
    ).toThrow(/--label-prior-margin-gate must be a non-negative margin/);
  });

  it('refuses a flag it does not own instead of ignoring it', () => {
    // A silently ignored flag is how a run gets reported under a configuration it did not use.
    expect(() =>
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--self-anomaly-weight', '2']),
    ).toThrow(/unknown argument "--self-anomaly-weight"/);
  });
});

describe('the arm baseline pair', () => {
  it('parses together', () => {
    const parsed = parseCloudOpsArgs([
      '--data-dir',
      '/tmp/cob',
      '--arm-baseline',
      'benchmarks/baselines/cloudopsbench-arms.json',
      '--arm-name',
      'enrolled',
    ]);
    expect(parsed.armBaseline).toBe('benchmarks/baselines/cloudopsbench-arms.json');
    expect(parsed.armName).toBe('enrolled');
  });

  it('leaves both absent by default, so a bare run is held to nothing', () => {
    const parsed = parseCloudOpsArgs(['--data-dir', '/tmp/cob']);
    expect(parsed.armBaseline).toBeUndefined();
    expect(parsed.armName).toBeUndefined();
  });

  it('refuses a baseline with no arm to look up', () => {
    expect(() => parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--arm-baseline', 'x.json'])).toThrow(
      /travel together/,
    );
  });

  it('refuses an arm name with nothing to compare it against', () => {
    expect(() => parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--arm-name', 'enrolled'])).toThrow(
      /travel together/,
    );
  });
});
