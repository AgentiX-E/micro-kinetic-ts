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

import {
  BASELINE_ANCHORS,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DROP_DEVIATION_MODES,
  DUAL_FAMILY_GATE_MODES,
  LOG_SIGNAL_MODES,
  ONSET_SHAPES,
  PRISM_POOLINGS,
} from '../../packages/tree/src/index.js';

import { parseFSE26Args } from '../src/fse26-cli.js';
import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';
import { buildRCAEvalEngineOptions } from '../src/rcaeval-engine-options.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

/** One accepted flag and whether its branch consumes the following token as a value. */
interface AcceptedFlag {
  readonly flag: string;
  readonly takesValue: boolean;
}

/**
 * One accepted flag, its arity, and the option its OWN branch assigns.
 *
 * `writes` is a second reading of the same span the arity comes from, and it is what lets a fence ask a
 * question the accepted set cannot: not "is this flag tested" but "is this OPTION settable". Until that
 * question was asked, a field could be declared, defaulted from the engine's own constant, printed on the
 * artifact's configuration line, and have **no branch at all** — which is the state `latWeight`,
 * `latMinRise` and `poolMetricPenaltyWeight` were in, the three that dominate the shipped ranking.
 */
interface AcceptedBranch extends AcceptedFlag {
  readonly writes: readonly string[];
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
 * @returns Every accepted flag, in chain order, with the fields its branch assigns.
 */
function acceptedBranches(source: string, argvName: string): AcceptedBranch[] {
  const branch = new RegExp(
    `${argvName}\\[i\\]\\s*===\\s*'(--[a-z-]+)'|arg\\s*===\\s*'(--[a-z-]+)'`,
    'g',
  );
  const starts: { flag: string; at: number }[] = [];
  for (const m of source.matchAll(branch)) starts.push({ flag: (m[1] ?? m[2])!, at: m.index });
  return starts.map((start, i) => {
    const span = source.slice(start.at, starts[i + 1]?.at ?? source.length);
    return {
      flag: start.flag,
      takesValue: span.includes('++i'),
      writes: [...span.matchAll(/opts\.(\w+)\s*=/g)].map((m) => m[1]!),
    };
  });
}

/** The same list without the field reading, for the assertions that are about the flag alone. */
function acceptedFlags(source: string, argvName: string): AcceptedFlag[] {
  return acceptedBranches(source, argvName).map((one) => ({
    flag: one.flag,
    takesValue: one.takesValue,
  }));
}

const fse26Source = readFileSync(resolve(repoRoot, 'benchmarks/src/fse26-cli.ts'), 'utf8');
const rcaevalSource = readFileSync(resolve(repoRoot, 'benchmarks/src/rcaeval-cli.ts'), 'utf8');
const fse26Accepted = acceptedFlags(fse26Source, 'argv');
const rcaevalAccepted = acceptedFlags(rcaevalSource, 'args');

/** A minimal argv that exercises one accepted flag at its own arity. */
/**
 * A representative value per MODE flag, because `1` is not a member of a mode's union.
 *
 * The defaults are the engine's own vocabularies rather than a list this file maintains: a new member extends
 * the probe set by existing. A mode flag's parser REFUSES a value it cannot name (`--drop-deviation-mode` throws
 * rather than silently becoming the shipped mode), so an arity probe that handed it `1` would be testing the
 * refusal instead of the arity.
 */
const MODE_VALUES: Readonly<Record<string, string>> = {
  '--drop-deviation-mode': 'log',
  // A mode flag whose vocabulary is a word: `1` is not a member of it, and the probe's job is to prove the
  // option MOVES, so the value has to be one the parser can accept.
  '--dual-family-gate-mode': 'channel',
  // Iteration 187: the deviation window's ANCHOR. A word, for the same reason, and the value here is the one
  // the parser would otherwise default to — the probe asserts the option MOVES, not that it changes the
  // score, and `whole-file` is the only value that keeps this fence a fence on every other flag.
  '--baseline-anchor': 'whole-file',
};

function argvFor(one: AcceptedFlag): string[] {
  if (!one.takesValue) return [one.flag];
  return [one.flag, MODE_VALUES[one.flag] ?? '1'];
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

/**
 * The other direction of the same question, and the one nothing asked.
 *
 * Every fence above starts from a flag and asks what it does. This starts from the OPTION and asks whether
 * any flag reaches it — the direction in which three fields were invisible. `latWeight = 0.561495`,
 * `latMinRise = 10.3` and `poolMetricPenaltyWeight = 0.0679` were declared in `CliOptions`, defaulted from
 * the engine's own constants, forwarded to the engine's constructor, and printed on every golden artifact's
 * configuration line — and **no branch of the chain wrote any of them**, so no invocation, dispatch or
 * otherwise, could move them. The artifact therefore asserted a configuration no command line can state,
 * which is the failure the configuration line itself exists to prevent, one level down.
 *
 * ## Why this is the GOLDEN half's fence and not a shared one
 *
 * The two runners reach the engine through different shapes, and the difference decides what "reachable"
 * even means. `buildFse26EngineOptions` **maps**: its parser holds `logMode` and the engine takes
 * `logSignalMode`, so "a branch writes it" is false there for a field that is perfectly reachable — measured,
 * not assumed: applying this reading to `fse26-cli.ts` reports `logSignalMode` while `--log-mode` sets it.
 * `buildRCAEvalEngineOptions` **copies**, one-for-one under the same names, so on this half "the engine
 * receives it" and "the parser must be able to write it" are the same statement. The premise is asserted
 * below rather than trusted, because the day the copy becomes a mapping this fence stops being the right
 * question — and a fence that keeps answering the wrong question is worse than none.
 */
describe('every option the golden runner forwards can be set from the command line', () => {
  const shipped = parseRCAEvalArgs([]);
  const engine = buildRCAEvalEngineOptions(shipped);
  /** Every option this runner hands the engine, across BOTH of its constructor arguments. */
  const forwarded = [...Object.keys(engine.signals), ...Object.keys(engine.topology)];
  const branches = acceptedBranches(rcaevalSource, 'args');

  it('declares them under the parser’s own names, which is what makes the reading valid', () => {
    // A key the parser has never heard of would be a mapping — and would make the structural assertion
    // below unprovable rather than false, which is the difference between a red test and a wrong one.
    const parsed = new Set(Object.keys(shipped));
    expect(forwarded.filter((key) => !parsed.has(key))).toEqual([]);
    expect(forwarded.length).toBeGreaterThanOrEqual(16);
  });

  it('writes every one of them from some branch of the chain', () => {
    const unreachable = forwarded.filter(
      (key) => !branches.some((one) => one.writes.includes(key)),
    );
    expect(unreachable).toEqual([]);
    // Non-vacuity in the other direction. The chain is WIDER than the engine's option list — it also carries
    // the data directory, the filters, the artifact paths and the switches — so a span reading that returned
    // everything would satisfy the line above while classifying nothing.
    expect(branches.length).toBeGreaterThan(forwarded.length);
    const written = new Set(branches.flatMap((one) => one.writes));
    expect(written.size).toBeGreaterThan(forwarded.length);
  });

  it('MOVES every one of them, at that flag’s own arity', () => {
    // The structural reading says an arm exists; this says the arm reaches the option. An arm that assigned
    // the shipped default, or one shadowed by a later condition, passes there and fails here. The probes are
    // the ENGINE's own vocabularies rather than a list this file maintains: a mode flag takes a member of its
    // union, so a new member extends the probe set by existing, and the numeric pair `0`/`1` covers every
    // weight — `1` because the floor refuses anything below it, `0` because a non-zero default is otherwise
    // only reachable downwards.
    const probes = [
      '0',
      '1',
      ...ONSET_SHAPES,
      ...Object.keys(LOG_SIGNAL_MODES),
      ...Object.keys(PRISM_POOLINGS),
      ...Object.keys(DROP_DEVIATION_MODES),
      // The gate's comparison is a third word-vocabulary, and the probe set is built from the unions rather
      // than maintained by hand — a member added to it extends this list by existing.
      ...Object.keys(DUAL_FAMILY_GATE_MODES),
      // Iteration 187: the deviation window's anchor, the fourth word-vocabulary on this chain. Both members
      // are probed, and both must MOVE the option — the arm and the shipped value are one word apart.
      ...Object.keys(BASELINE_ANCHORS),
    ];
    const moved = new Set<string>();
    for (const branch of branches) {
      for (const probe of branch.takesValue ? probes : ['']) {
        const argv = branch.takesValue ? [branch.flag, probe] : [branch.flag];
        let parsed: ReturnType<typeof parseRCAEvalArgs>;
        try {
          parsed = parseRCAEvalArgs(argv);
        } catch {
          // A flag that refuses this probe states it in the file's other assertions; what is being asked here
          // is only whether SOME accepted invocation moves each option.
          continue;
        }
        for (const key of forwarded) {
          const before = (shipped as unknown as Record<string, unknown>)[key];
          const after = (parsed as unknown as Record<string, unknown>)[key];
          if (after !== before) moved.add(key);
        }
      }
    }
    expect(forwarded.filter((key) => !moved.has(key))).toEqual([]);
  });

  it('keeps the three that were unreachable reachable, with their own domains', () => {
    // Asserted by name as well as by set difference, because these three are the defect rather than an
    // instance of it: the failure should say so in the message instead of leaving a reader to diff two sets.
    expect(parseRCAEvalArgs(['--lat-weight', '0']).latWeight).toBe(0);
    expect(parseRCAEvalArgs(['--lat-weight', '1']).latWeight).toBe(1);
    expect(parseRCAEvalArgs(['--lat-min-rise', '1']).latMinRise).toBe(1);
    expect(parseRCAEvalArgs(['--lat-min-rise', '5.5']).latMinRise).toBe(5.5);
    expect(parseRCAEvalArgs(['--pool-penalty', '0']).poolMetricPenaltyWeight).toBe(0);
    // A typo reproduces a PUBLISHED configuration rather than selecting an ablation — the rule every other
    // weight flag on this surface obeys, and here it is not a courtesy: each of the three ships non-zero, so
    // zero is a measured configuration (`--lat-weight 0` is the latency term switched off).
    expect(parseRCAEvalArgs(['--lat-weight', 'nonsense']).latWeight).toBe(DEFAULT_LAT_WEIGHT);
    expect(parseRCAEvalArgs(['--pool-penalty', '']).poolMetricPenaltyWeight).toBe(
      DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    );
    expect(parseRCAEvalArgs(['--lat-min-rise', 'nonsense']).latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    // …and the floor's domain, which is the one arm a shared `parseWeight` would get wrong: a floor below 1
    // suppresses nothing, so accepting it would report a configuration the operator believes changed
    // something. The rule is the FSE'26 runner's, so one value means one thing in both workflows.
    expect(parseRCAEvalArgs(['--lat-min-rise', '0']).latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    expect(parseRCAEvalArgs(['--lat-min-rise', '0.5']).latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    expect(parseRCAEvalArgs(['--lat-min-rise', '-3']).latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    // The shipped values themselves, so the fallbacks above are the engine's and not this file's.
    expect(shipped.latWeight).toBe(DEFAULT_LAT_WEIGHT);
    expect(shipped.latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    expect(shipped.poolMetricPenaltyWeight).toBe(DEFAULT_POOL_METRIC_PENALTY_WEIGHT);
  });
});
