/**
 * The runner's own flags: what each one means, and what a refusal has to say.
 */
import { describe, expect, it } from 'vitest';

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

  it('refuses a flag it does not own instead of ignoring it', () => {
    // A silently ignored flag is how a run gets reported under a configuration it did not use.
    expect(() =>
      parseCloudOpsArgs(['--data-dir', '/tmp/cob', '--self-anomaly-weight', '2']),
    ).toThrow(/unknown argument "--self-anomaly-weight"/);
  });
});
