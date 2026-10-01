/**
 * An unrecognised argument must FAIL LOUDLY, in both benchmark runners.
 *
 * ## The defect
 *
 * Both argument chains end with the last `else if` and no `else`. A token the runner does not
 * test therefore leaves the loop untouched: it is **silently discarded**, its value (if any) is
 * left to be read as the next token, and the run proceeds at the shipped configuration and
 * prints a confident number.
 *
 * That is the shape of a failure this repository has already paid for once, in the FSE'26
 * runner's own words (`fse26-cli.ts`): `--log-mode count` matched nothing and fell back to
 * `logicHttp`, so "a dispatch asking for `count` ran `logicHttp` and printed a confident
 * 47.3%". The hole was closed for the *value* (the modes became an exhaustive `Record`) and
 * left open for the **flag**, which is the wider one.
 *
 * ## Why it is worse across the two runners
 *
 * The runners do not share a vocabulary, and the sharpest case is the log mode: FSE'26 calls it
 * `--log-mode` and accepts six values; RCAEval calls it `--log-signal-mode` and accepts two. So
 * `run-rcaeval.ts --log-mode novelty` is a request that cannot be honoured, and today it is
 * answered with `count` and no complaint — the run is indistinguishable from one that was asked
 * for `count`.
 *
 * ## What this file pins
 *
 * 1. An unknown flag, a flag only the OTHER runner owns, and a bare positional all throw, and
 *    the error names the offending token.
 * 2. Every flag each runner's own chain tests still parses, driven at that flag's own arity
 *    (extracted mechanically, so this cannot become a hand list that drifts from the chain).
 * 3. The RCAEval parser is importable at all — the reason its hole survived is that
 *    `run-rcaeval.ts` calls `main()` at import time and cannot be imported by a test, which is
 *    the sentence `fse26-cli.ts` already records about its own extraction.
 *
 * @module __tests__/cli-argument-rejection
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFSE26Args } from '../src/fse26-cli.js';
import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

/** One accepted flag and whether its branch consumes the following token as a value. */
interface AcceptedFlag {
  readonly flag: string;
  readonly takesValue: boolean;
}

/**
 * The accepted set, read out of a parser's argument chain.
 *
 * The chain IS the accepted set — a flag the parser does not test is a flag it rejects — so
 * reading it from the chain means this cannot drift from the parser it claims to describe. The
 * arity is read the same way: a branch that advances the index consumes a value, and one that
 * does not is a switch.
 *
 * @param source - The parser module's text.
 * @param argvName - The local name of the argument vector (`argv`, `args`).
 * @returns Every accepted flag, in chain order.
 */
function acceptedFlags(source: string, argvName: string): AcceptedFlag[] {
  const branch = new RegExp(
    `${argvName}\\[i\\]\\s*===\\s*'(--[a-z-]+)'|arg\\s*===\\s*'(--[a-z-]+)'`,
    'g',
  );
  const starts: { flag: string; at: number }[] = [];
  for (const m of source.matchAll(branch)) starts.push({ flag: (m[1] ?? m[2])!, at: m.index });
  return starts.map((start, i) => {
    const span = source.slice(start.at, starts[i + 1]?.at ?? source.length);
    return { flag: start.flag, takesValue: span.includes('++i') };
  });
}

const fse26Source = readFileSync(resolve(repoRoot, 'benchmarks/src/fse26-cli.ts'), 'utf8');
const rcaevalSource = readFileSync(resolve(repoRoot, 'benchmarks/src/rcaeval-cli.ts'), 'utf8');
const fse26Accepted = acceptedFlags(fse26Source, 'argv');
const rcaevalAccepted = acceptedFlags(rcaevalSource, 'args');

/** A minimal argv that exercises one accepted flag at its own arity. */
function argvFor(one: AcceptedFlag): string[] {
  return one.takesValue ? [one.flag, '1'] : [one.flag];
}

describe('an unrecognised argument fails loudly', () => {
  it('reads a non-empty accepted set out of each parser', () => {
    // A vacuity floor: the extraction below is what the acceptance assertions drive, and an
    // extraction that returned nothing would make all of them pass for free.
    expect(fse26Accepted.length).toBeGreaterThanOrEqual(20);
    expect(rcaevalAccepted.length).toBeGreaterThanOrEqual(25);
    expect(fse26Accepted.every((one) => one.flag.startsWith('--'))).toBe(true);
  });

  it('rejects a flag it does not test, and names it', () => {
    expect(() => parseFSE26Args(['--no-such-flag'])).toThrow(/--no-such-flag/);
    expect(() => parseRCAEvalArgs(['--no-such-flag'])).toThrow(/--no-such-flag/);
  });

  it('rejects a flag the OTHER runner owns, which is the trap that looks harmless', () => {
    // The two runners do not share a vocabulary, and the log mode is the sharpest divergence:
    // FSE'26's `--log-mode` (six values) against RCAEval's `--log-signal-mode` (two). A
    // dispatcher who carries the flag across gets a different mode, silently, today.
    expect(() => parseRCAEvalArgs(['--log-mode', 'novelty'])).toThrow(/--log-mode/);
    expect(() => parseFSE26Args(['--log-signal-mode', 'count'])).toThrow(/--log-signal-mode/);
  });

  it('rejects a bare positional, which is where a typo lands next', () => {
    // An unpaired value is the other half of the same hazard: `--log-weight 0.5extra` puts the
    // garbage in the value position, but a stray token after a switch puts it in the argv.
    expect(() => parseFSE26Args(['stray'])).toThrow(/stray/);
    expect(() => parseRCAEvalArgs(['stray'])).toThrow(/stray/);
  });

  it('accepts every flag its own chain tests, at that flag’s own arity', () => {
    // The other direction, and the one a fix can break: a rejection that is too eager turns a
    // working dispatch into a failed run. Driven from the chain rather than a hand list.
    for (const one of fse26Accepted) {
      expect(() => parseFSE26Args(argvFor(one)), one.flag).not.toThrow();
    }
    for (const one of rcaevalAccepted) {
      expect(() => parseRCAEvalArgs(argvFor(one)), one.flag).not.toThrow();
    }
  });

  it('refuses EVERY value-taking flag when its value is absent, driven from the chain', () => {
    // The property the old assertion claimed for one flag, generalised over the whole accepted set
    // and driven from the chain rather than a hand list. A flag whose value is missing has nothing
    // to fall back FROM: the requested configuration is unknowable, so defaulting silently means the
    // artifact answers a question the dispatcher did not ask — which is what happened when
    // `--log-weight --log-mode` consumed the next flag as its value.
    const valueFlags = (accepted: readonly AcceptedFlag[], run: (argv: string[]) => unknown) => {
      const taking = accepted.filter((one) => one.takesValue);
      expect(taking.length).toBeGreaterThan(10);
      for (const one of taking) {
        expect(() => run([one.flag]), `${one.flag} with no value`).toThrow(
          new RegExp(one.flag.replace(/-/g, '\\-')),
        );
        // And a following FLAG is not a value either, so the flag that lost its value is named.
        expect(() => run([one.flag, '--max-cases', '1']), `${one.flag} before a flag`).toThrow(
          new RegExp(one.flag.replace(/-/g, '\\-')),
        );
      }
    };
    valueFlags(fse26Accepted, (argv) => parseFSE26Args(argv));
    valueFlags(rcaevalAccepted, (argv) => parseRCAEvalArgs(argv));
  });

  it('keeps the VALUE-level fallbacks, which are a different decision from a missing one', () => {
    // An unusable value reproduces a published configuration rather than inventing one; a missing
    // one is refused. These are the arms of that first rule, and they are what makes the refusal
    // above a decision rather than a blanket strictness.
    expect(parseRCAEvalArgs(['--log-signal-mode', 'novelty']).logSignalMode).toBe('novelty');
    expect(parseRCAEvalArgs(['--log-signal-mode', 'count']).logSignalMode).toBe('count');
    // Anything else is not a mode at all, and `count` is the shipped one.
    expect(parseRCAEvalArgs(['--log-signal-mode', 'LOGICHTTP']).logSignalMode).toBe('count');
    // A discount outside the domain is clamped, and a non-number is the shipped 0.
    expect(parseRCAEvalArgs(['--collapse-discount', '0.5']).collapseDiscount).toBe(0.5);
    expect(parseRCAEvalArgs(['--collapse-discount', '5']).collapseDiscount).toBe(1);
    expect(parseRCAEvalArgs(['--collapse-discount', 'abc']).collapseDiscount).toBe(0);
    expect(parseRCAEvalArgs(['--onset-shape', 'not-a-shape']).onsetShape).toBe('earliness');
    // And a shape that IS one is taken, which is the arm a typo test does not reach.
    expect(parseRCAEvalArgs(['--onset-shape', 'earliness']).onsetShape).toBe('earliness');
    // A count that is not a number falls back to "no cap", not to a truncated one.
    expect(parseRCAEvalArgs(['--max-cases', 'abc']).maxCases).toBe(0);
    expect(parseRCAEvalArgs(['--max-cases', '50']).maxCases).toBe(50);
    expect(parseRCAEvalArgs(['--temporal-weight', 'nonsense']).temporalWeight).toBe(0);
    // The switches, whose absence of a value is the point.
    expect(parseRCAEvalArgs(['--no-inject-time']).noInjectTime).toBe(true);
    expect(parseRCAEvalArgs(['--rank-normalization']).rankNormalization).toBe(true);
    expect(parseRCAEvalArgs(['--no-rank-normalization']).rankNormalization).toBe(false);
    expect(parseRCAEvalArgs(['--suppress-idle-transients']).suppressIdleTransients).toBe(true);
    expect(parseRCAEvalArgs(['--no-suppress-idle-transients']).suppressIdleTransients).toBe(false);
  });

  it('names the offending token rather than a position, so a dispatcher can fix it', () => {
    // A message that says "unexpected argument" costs a round trip; the token is what the
    // dispatcher typed, and it is the only part of the input the parser is certain about.
    const message = (() => {
      try {
        parseRCAEvalArgs(['--temporal-wieght', '0.5']);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toContain('--temporal-wieght');
    // And a typo is a typo: the message must not silently accept the near-miss.
    expect(message.length).toBeGreaterThan(20);
  });
});
