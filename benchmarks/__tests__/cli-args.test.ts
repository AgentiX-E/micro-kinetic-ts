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
import { DEFAULT_TRACE_WEIGHT } from '../../packages/tree/src/index.js';

import {
  parseFieldDecimals,
  parseNodeCount,
  parseUnitInterval,
  parseWeight,
} from '../src/cli-args.js';
import { parseFSE26Args } from '../src/fse26-cli.js';
import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_SRC = resolve(HERE, '../src');

describe('parseUnitInterval', () => {
  it('passes a fraction through and refuses anything outside [0, 1]', () => {
    // The bound IS the function: a discount of 2 is not a stronger discount, it inverts the sign of the
    // node's anomaly, and a discount of −1 doubles it. Every case here is a value a dispatcher could type.
    expect(parseUnitInterval('0')).toBe(0);
    expect(parseUnitInterval('0.25')).toBe(0.25);
    expect(parseUnitInterval('1')).toBe(1);
    expect(parseUnitInterval('0.999')).toBe(0.999);
    expect(parseUnitInterval('1.0001')).toBe(0);
    expect(parseUnitInterval('2')).toBe(0);
    expect(parseUnitInterval('-1')).toBe(0);
    expect(parseUnitInterval('abc')).toBe(0);
    // The fallback is the CALLER's shipped value, not a constant, for the reason `parseWeight` takes one.
    expect(parseUnitInterval('2', 0.4)).toBe(0.4);
  });

  it('treats an EMPTY value as absent rather than as zero, because Number("") is 0', () => {
    // The defect iteration 125 found inside `parseWeight` and this function then reintroduced one
    // iteration after that fix: `Number('')` is `0`, which is a legitimate fraction, so an empty flag
    // value would be read as the setting `0` rather than as "no value". With a non-zero fallback the two
    // readings differ observably, which is the only way this can be a test rather than a comment.
    expect(parseUnitInterval('', 0.4)).toBe(0.4);
    expect(parseUnitInterval('   ', 0.4)).toBe(0.4);
    // …and a real zero is still a zero.
    expect(parseUnitInterval('0', 0.4)).toBe(0);
  });

  it('is what the RCAEval runner binds --topo-discount to, including its refusals', () => {
    // The parse rule is only worth its bound if the flag uses it. `--topo-discount 2` must build the
    // SHIPPED configuration rather than a negated anomaly, and a flag left without a value must not
    // swallow the next flag — the failure `hasValue` exists for.
    expect(parseRCAEvalArgs(['--topo-discount', '0.25']).topoDiscount).toBe(0.25);
    expect(parseRCAEvalArgs(['--topo-discount', '2']).topoDiscount).toBe(0);
    // A flag with NO value is REPORTED at the flag rather than silently defaulted — the rule `hasValue`
    // exists for, and the reason this is a throw rather than a fallback: a dispatcher who forgot a value
    // would otherwise get two defaults and an artifact that says the flags were never asked for.
    expect(() => parseRCAEvalArgs(['--topo-discount'])).toThrow(/--topo-discount/);
    expect(() => parseRCAEvalArgs(['--topo-discount', '--trace-weight', '0.5'])).toThrow(
      /--topo-discount/,
    );
  });
});

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

describe('parseNodeCount', () => {
  it('accepts a non-negative integer, and KEEPS zero', () => {
    // `0` is not "the empty flag" for this one: it is the value that makes the rescale apply to every graph,
    // which is the ablation this flag exists to allow. A parse that treated 0 as a fallback would make the
    // axis's widest setting unreachable, the same defect `--pool-penalty 0` was fixed for.
    expect(parseNodeCount('0', 20)).toBe(0);
    expect(parseNodeCount('1', 20)).toBe(1);
    expect(parseNodeCount('20', 20)).toBe(20);
    expect(parseNodeCount('1000000', 20)).toBe(1000000);
  });

  it('falls back to the shipped value for a malformed one', () => {
    // A node count is a CARDINALITY, so `4.5` is not a coarser box — it is a value the guard cannot be read
    // against. Refused rather than rounded, for `parseFieldDecimals`' reason: rounding picks one of two legal
    // populations and reports it as the dispatched one.
    expect(parseNodeCount('', 20)).toBe(20);
    expect(parseNodeCount('   ', 20)).toBe(20);
    expect(parseNodeCount('4.5', 20)).toBe(20);
    expect(parseNodeCount('-1', 20)).toBe(20);
    expect(parseNodeCount('abc', 20)).toBe(20);
    expect(parseNodeCount('NaN', 20)).toBe(20);
    expect(parseNodeCount('Infinity', 20)).toBe(20);
  });

  it('is defined once, in the shared module', () => {
    for (const file of ['fse26-cli.ts', 'rcaeval-cli.ts', 'run-rcaeval.ts']) {
      const source = readFileSync(resolve(BENCH_SRC, file), 'utf8');
      expect(source, `${file} defines its own parseNodeCount`).not.toMatch(
        /function parseNodeCount\s*\(/,
      );
    }
  });
});

/**
 * The third instance of the class {@link DEFAULT_LOG_WEIGHT} was extracted for.
 *
 * `traceWeight` shipped as a bare numeric literal in BOTH parsers — `parseWeight(argv[++i]!, 0)` and
 * `parseWeight(args[++i]!, 0)` — with the RE3 job pinning a bare `1` in the workflow beside them, so the
 * shipped value had THREE owners and none of them was a name. `docs/dispatch-surface-audit.md`'s Finding 6
 * recorded it as the residue: the workflow-description guard requires every input claiming a runner default to
 * name a constant it can check, and this one could not, so its description had to state the default in words.
 *
 * The assertions below are the two directions that closing it needs. The first is behaviour — both runners fall
 * back to the owner. The second is SOURCE, and it is the one that catches a regression: a parser that reads the
 * constant while a second literal survives beside it would satisfy every behavioural check, because only one of
 * the two is ever exercised by an empty argv.
 */
describe('the trace weight has one owner, and both runners read it', () => {
  it('is the value an empty argv resolves to on BOTH halves', () => {
    expect(parseFSE26Args([]).traceWeight).toBe(DEFAULT_TRACE_WEIGHT);
    expect(parseRCAEvalArgs([]).traceWeight).toBe(DEFAULT_TRACE_WEIGHT);
  });

  it('is read from the owner in each parser, with no surviving literal fallback', () => {
    for (const file of ['rcaeval-cli.ts', 'fse26-cli.ts']) {
      const source = readFileSync(resolve(BENCH_SRC, file), 'utf8');
      expect(source, `${file} does not import DEFAULT_TRACE_WEIGHT`).toContain(
        'DEFAULT_TRACE_WEIGHT',
      );
      // The branch's own text, from its flag to the next branch, so a literal elsewhere in the file cannot
      // satisfy or fail this check by accident.
      const at = source.indexOf("'--trace-weight'");
      expect(at, `${file} has no --trace-weight branch`).toBeGreaterThanOrEqual(0);
      const rest = source.slice(at + 1);
      const next = rest.indexOf("=== '--");
      const branch = rest.slice(0, next < 0 ? 220 : next);
      expect(branch, `${file} does not read the owner: ${branch.trim()}`).toContain(
        'DEFAULT_TRACE_WEIGHT',
      );
      // A bare numeric fallback is the shape that was there. `parseWeight(x, 0)` is the literal.
      expect(branch, `${file} still holds a literal fallback: ${branch.trim()}`).not.toMatch(
        /parseWeight\([^;]*,\s*\d/,
      );
    }
  });

  it('is ZERO, because that is the value the shipped configuration states', () => {
    // Not a tautology: the constant exists so a reader can tell the shipped value from the RE3 JOB'S PIN,
    // which is a workflow-side `1` and cannot be read from here. Fixing the number in a test means a change to
    // it is a deliberate edit to this line rather than a silent move of the published configuration.
    expect(DEFAULT_TRACE_WEIGHT).toBe(0);
  });
});
