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

import {
  MAX_FIELD_DECIMALS,
  SERVICE_FIELD_DECIMALS,
} from '../../packages/kinetic/src/benchmarks/index.js';
import { parseFieldDecimals, parseWeight } from '../src/cli-args.js';

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

/**
 * The dump's render precision, which is the one flag whose misuse makes the RUN crash rather than
 * answer wrongly.
 *
 * `toFixed` accepts `0` to `100` digits and raises `RangeError` outside that, so an unguarded parse
 * turns `--diagnose-decimals 200` into a run that dies on the first rendered case — after the loader
 * has read a suite. The bound is not a policy about how fine a dump should be: it is the renderer's
 * own domain, imported from the module that calls `toFixed` so the two cannot drift.
 */
describe('parseFieldDecimals', () => {
  it('accepts an integer the renderer can express', () => {
    expect(parseFieldDecimals('4', 3)).toBe(4);
    expect(parseFieldDecimals('6', 3)).toBe(6);
    expect(parseFieldDecimals('10', 3)).toBe(10);
    // Surrounding whitespace is not part of the value, as in `parseWeight`.
    expect(parseFieldDecimals(' 4 ', 3)).toBe(4);
  });

  it('keeps an explicit ZERO, which is a request rather than an absence', () => {
    // Integer rendering is a legal artifact and the coarsest box the reader can be handed; a helper
    // that treated `0` as "unset" would make it unreachable and silently hand back three decimals.
    expect(parseFieldDecimals('0', 3)).toBe(0);
    expect(parseFieldDecimals('00', 3)).toBe(0);
    // `-0` is zero too, and the artifact does not distinguish them: `String(-0)` is `'0'`, so the
    // header says `decimals=0`, and `toFixed(-0)` is `toFixed(0)`. Normalised with `+ 0` only because
    // `Object.is` separates the two zeroes while the RENDER does not — rejecting `-0` would need a
    // special case that names nothing a reader could observe.
    expect(parseFieldDecimals('-0', 3) + 0).toBe(0);
  });

  it('takes the bound from the RENDERER, measured rather than restated', () => {
    // The constant is only worth importing if it really is `toFixed`'s domain, so the claim is tested
    // against `toFixed` itself instead of asserted. If the language ever widened the range this
    // fails, which is the only way the imported bound could go stale.
    expect(Number.prototype.toFixed.call(1, MAX_FIELD_DECIMALS)).toBeTruthy();
    expect(() => Number.prototype.toFixed.call(1, MAX_FIELD_DECIMALS + 1)).toThrow(RangeError);
    expect(parseFieldDecimals(String(MAX_FIELD_DECIMALS), 3)).toBe(MAX_FIELD_DECIMALS);
  });

  it('falls back to the shipped value for a precision the renderer would REJECT', () => {
    // The severe half: these are the values that would raise inside `formatFSE26Diagnostic` mid-run.
    expect(parseFieldDecimals(String(MAX_FIELD_DECIMALS + 1), 3)).toBe(3);
    expect(parseFieldDecimals('200', 3)).toBe(3);
    expect(parseFieldDecimals('999', 3)).toBe(3);
  });

  it('falls back to the shipped value for everything that is not a precision', () => {
    for (const raw of [
      '',
      '   ',
      'four',
      '4x',
      'x4',
      '4.5',
      '-1',
      'NaN',
      'Infinity',
      '-Infinity',
      '1e3',
    ]) {
      expect(parseFieldDecimals(raw, 3), `raw=${JSON.stringify(raw)}`).toBe(3);
    }
  });

  it('returns the shipped value verbatim, so a caller can pass the producer’s constant', () => {
    expect(parseFieldDecimals('nonsense', SERVICE_FIELD_DECIMALS)).toBe(SERVICE_FIELD_DECIMALS);
    expect(parseFieldDecimals('200', SERVICE_FIELD_DECIMALS)).toBe(SERVICE_FIELD_DECIMALS);
  });

  it('is the only copy of the rule in the benchmark CLIs', () => {
    // Narrowed to the definition, because the callers mention the NAME in their imports: only a second
    // implementation is a second rule, and the drift it causes is invisible to either copy's tests.
    for (const file of ['fse26-cli.ts', 'run-rcaeval.ts']) {
      const source = readFileSync(resolve(BENCH_SRC, file), 'utf8');
      expect(source, `${file} defines its own parseFieldDecimals`).not.toMatch(
        /function parseFieldDecimals\s*\(/,
      );
    }
  });
});
