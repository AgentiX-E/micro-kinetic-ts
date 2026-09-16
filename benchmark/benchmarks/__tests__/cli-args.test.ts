/**
 * Unit tests for the benchmark CLIs' shared argument rules.
 *
 * The rule under test decides what a malformed dispatch DOES, which is the part no
 * end-to-end run can distinguish from a correct one: a flag whose value failed to
 * parse produces a plausible-looking benchmark at the ablation's configuration.
 *
 * @module benchmarks/__tests__/cli-args.test
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseWeight } from '../src/cli-args.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_SRC = resolve(HERE, '../src');

describe('parseWeight', () => {
  it('returns the parsed value for a finite, non-negative number', () => {
    expect(parseWeight('0', 1)).toBe(0);
    expect(parseWeight('0.036552', 0)).toBe(0.036552);
    expect(parseWeight('1', 0)).toBe(1);
    expect(parseWeight('2', 0.5)).toBe(2);
    expect(parseWeight('0.001', 0)).toBe(0.001);
    // Scientific notation is a number to `Number`, and a weight is a weight.
    expect(parseWeight('1e-3', 0)).toBe(0.001);
    // Surrounding whitespace is not part of the value.
    expect(parseWeight(' 2 ', 0)).toBe(2);
  });

  it('returns the SHIPPED value — not zero — for every unusable value', () => {
    // The whole point of the helper. `Number('')` is 0, so an inline parse reads an
    // empty flag as "zero", which for a field that ships non-zero is its ABLATION:
    // a dispatch that meant to leave the value alone would measure the term
    // switched OFF and report it under the shipped configuration's name.
    const shipped = 0.036552;
    for (const raw of [
      '',
      '   ',
      'abc',
      '1x',
      'x1',
      '-1',
      '-0.5',
      'NaN',
      'Infinity',
      '-Infinity',
    ]) {
      expect(parseWeight(raw, shipped), `raw=${JSON.stringify(raw)}`).toBe(shipped);
    }
  });

  it('keeps zero distinguishable from the shipped value', () => {
    // An explicit `0` is a REQUEST for the ablation and must survive; only the
    // values that are not numbers at all fall back. The two are different
    // statements, and a helper that conflated them would make the ablation
    // unreachable through the CLI.
    expect(parseWeight('0', 0.036552)).toBe(0);
    expect(parseWeight('0.0', 0.036552)).toBe(0);
  });

  it('returns the shipped value verbatim, so a caller can pass a constant', () => {
    // Not a copy, not a rounded value: the fallback is what the runner would have
    // used anyway, and anything else would make the flag's absence a configuration.
    const shipped = 0.561495;
    expect(parseWeight('nonsense', shipped)).toBe(shipped);
  });

  it('is the only copy of the rule in the benchmark CLIs', () => {
    // Narrowed to `function parseWeight(`: the two callers mention the NAME in a
    // comment and in their imports, and only a second definition would be a second
    // rule. Measured as text because the drift this guards against is a duplicated
    // implementation, which no runtime assertion of either copy can see.
    for (const file of ['fse26-cli.ts', 'run-rcaeval.ts']) {
      const source = readFileSync(resolve(BENCH_SRC, file), 'utf8');
      expect(source, `${file} defines its own parseWeight`).not.toMatch(
        /function parseWeight\s*\(/,
      );
    }
  });
});
