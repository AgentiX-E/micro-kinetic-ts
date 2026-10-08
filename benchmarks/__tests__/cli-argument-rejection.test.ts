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
 * The runners did not share a vocabulary, and the sharpest case is the log mode: FSE'26 calls it
 * `--log-mode` and RCAEval calls it `--log-signal-mode`. When this file was written RCAEval accepted
 * TWO values against FSE'26's six, so `run-rcaeval.ts --log-mode novelty` was a request that could
 * not be honoured and was answered with `count` and no complaint — the run indistinguishable from
 * one that had asked for `count`.
 *
 * BOTH halves of that are now closed, and the sentence above is kept because the number it carries
 * is the kind that outlives its own correction: the flag is refused BY NAME (that is what this file
 * asserts), and iteration 42 moved the vocabulary to ONE owner, so both runners accept the same six
 * modes from `LOG_SIGNAL_MODES` in the tree package. Two runners spelling one vocabulary twice is
 * how the `two` in the sentence above came to be wrong in the first place.
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
    // Not "anything else is not a mode at all" — that is what this assertion said, and it was
    // false. `LogSignalMode` has six members and the engine implements all six; this parser
    // accepted two and mapped the other four onto `count`, which is the `--log-mode count`
    // defect `fse26-cli.ts` records having closed on ITS side, left open here. The four are
    // now honoured by their own spelling:
    expect(parseRCAEvalArgs(['--log-signal-mode', 'logicHttp']).logSignalMode).toBe('logicHttp');
    expect(parseRCAEvalArgs(['--log-signal-mode', 'logicHttpJoint']).logSignalMode).toBe(
      'logicHttpJoint',
    );
    expect(parseRCAEvalArgs(['--log-signal-mode', 'logicHttpDominant']).logSignalMode).toBe(
      'logicHttpDominant',
    );
    // `all` is the member this iteration exists for: admitting every ERROR/FATAL line is what the
    // `NetworkPartition`/`errLines` cell needs, and until it was expressible here the candidate's
    // golden half was UNEVALUABLE rather than merely undispatched.
    expect(parseRCAEvalArgs(['--log-signal-mode', 'all']).logSignalMode).toBe('all');
    // And a token that is genuinely not a mode still falls back to the published default. The
    // guard is case-sensitive, so a miscased member is not a member:
    expect(parseRCAEvalArgs(['--log-signal-mode', 'LOGICHTTP']).logSignalMode).toBe('count');
    // A discount outside the domain is clamped, and a non-number is the shipped 0.
    expect(parseRCAEvalArgs(['--collapse-discount', '0.5']).collapseDiscount).toBe(0.5);
    expect(parseRCAEvalArgs(['--collapse-discount', '5']).collapseDiscount).toBe(1);
    expect(parseRCAEvalArgs(['--collapse-discount', 'abc']).collapseDiscount).toBe(0);
    expect(parseRCAEvalArgs(['--onset-shape', 'not-a-shape']).onsetShape).toBe('earliness');
    // And a shape that IS one is taken, which is the arm a typo test does not reach.
    expect(parseRCAEvalArgs(['--onset-shape', 'earliness']).onsetShape).toBe('earliness');
    // The PRISM pooling is a two-member vocabulary, and BOTH directions are asserted: the whole union
    // is taken by the union's own guard, and a token that is genuinely not a member falls back to the
    // SHIPPED pooling. The guard is case-sensitive, so a miscased member is not a member.
    expect(parseRCAEvalArgs(['--prism-pooling', 'conjunctive']).prismPooling).toBe('conjunctive');
    expect(parseRCAEvalArgs(['--prism-pooling', 'additive']).prismPooling).toBe('additive');
    expect(parseRCAEvalArgs(['--prism-pooling', 'Additive']).prismPooling).toBe('additive');
    expect(parseRCAEvalArgs(['--prism-pooling', 'nope']).prismPooling).toBe('additive');
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

describe('a knob stated twice, with two different values, is refused', () => {
  // WHY THIS IS NOT A HYPOTHETICAL, and why it is the same failure this file already exists for.
  //
  // `benchmark-rcaeval.yml`'s RE3 job runs the novelty REFERENCE as
  //
  //     run-rcaeval.ts --suite re3 --no-inject-time --log-signal-mode novelty \
  //       "${STABILITY_ARG[@]}" "${RANKING_ARG[@]}" "${DIAGNOSE_ARG[@]}"
  //
  // and `RANKING_ARG` carries `--log-signal-mode "${{ inputs.log_signal_mode }}"` when that input
  // is non-empty — added in iteration 42, when the mode became dispatchable on this half at all.
  // So ONE command line can carry two spellings of one knob, and this parser takes the LAST.
  // Measured before the fix: `[… '--log-signal-mode', 'novelty', '--log-signal-mode', 'all']`
  // returned `'all'`, while the step's artifact is still uploaded as
  // `rcaeval-re3-novelty-results.txt`.
  //
  // That is the MIRROR of the defect this file was written for. There, a dispatch asked for a mode
  // and was silently given the DEFAULT (`count` → `logicHttp` on the FSE'26 side; four of six modes
  // → `count` here). Here, a job's own IDENTITY is silently replaced by the dispatch — the reference
  // comparison runs a candidate's mode and is filed under the reference's name. Both are
  // "a dispatch asking for one thing ran another and printed a confident number", and the remedy the
  // repository already chose for the first is the same: refuse loudly and name the tokens.
  it('refuses two DIFFERENT values, and names both of them', () => {
    const message = ((): string => {
      try {
        parseRCAEvalArgs(['--log-signal-mode', 'novelty', '--log-signal-mode', 'all']);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).not.toBe('');
    expect(message).toContain('novelty');
    expect(message).toContain('all');
    expect(message).toContain('--log-signal-mode');
  });

  it('accepts the same value twice, which is ONE request stated twice', () => {
    // The reference step's own case when a dispatch asks for the mode it already pins. Refusing it
    // would make an honest dispatch fail, and the two occurrences are not in conflict about anything.
    expect(
      parseRCAEvalArgs(['--log-signal-mode', 'novelty', '--log-signal-mode', 'novelty'])
        .logSignalMode,
    ).toBe('novelty');
  });

  it('leaves a single occurrence, and an absent one, exactly as they were', () => {
    // Non-vacuity for the two rules above: the refusal must be about the CONTRADICTION, not about
    // repetition — and the shipped default must still be what a bare command line gets.
    expect(parseRCAEvalArgs(['--log-signal-mode', 'all']).logSignalMode).toBe('all');
    expect(parseRCAEvalArgs([]).logSignalMode).toBe('count');
  });
});
