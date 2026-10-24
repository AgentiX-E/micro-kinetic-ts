# An argument the runner cannot honour must fail loudly

**Status:** shipped and gated. Two defects in the same three lines of both benchmark parsers, one of
which was **blessed by a test whose name claimed exactly the property the code violated**.

## The defect

Both argument chains ended with the last `else if` and no `else`:

```ts
for (let i = 0; i < argv.length; i++) {
  if (arg === '--data-dir' && i + 1 < argv.length) opts.dataDir = argv[++i]!;
  else if (arg === '--log-weight' && i + 1 < argv.length) { … }
  else if (arg === '--onset-shape' && i + 1 < argv.length) { … }
  // no else
}
```

A token the runner does not test therefore **left the loop untouched**: it was discarded, and the run
proceeded at the shipped configuration and printed a confident number for a configuration nobody had
asked for. `fse26-cli.ts` records the sibling failure in its own module doc — a dispatch asking for
`--log-mode count` matched nothing, fell back to `logicHttp`, and reported **47.3%** — and closes it for
the **value** by making the accepted modes an exhaustive `Record<LogSignalMode, true>`. The **flag** was
left open, and a flag is the wider hole: a value that falls back still names its switch, while a switch
that falls away leaves nothing in the artifact to say it was ever asked for.

### Why the two runners make it sharp

They do not share a vocabulary, and the log mode is where the divergence bites:

| runner | flag | values |
| --- | --- | --- |
| `run-fse26.ts` | `--log-mode` | `count`, `novelty`, `logicHttp`, `logicHttpJoint`, `logicHttpDominant`, `all` |
| `run-rcaeval.ts` | `--log-signal-mode` | `count`, `novelty` |

`run-rcaeval.ts --log-mode novelty` is a request that runner cannot honour, and the run it produced was
indistinguishable from one asked for `--log-signal-mode count` — including the config line, which prints
the resolved values and therefore looks correct.

## The second defect, and how it was found

While writing the fix, four existing assertions failed. Three of them pinned the discard, and one of
those was named

```ts
it('does not consume the next flag when the value is missing', () => {
  expect(parseFSE26Args(['--failed-edge-weight']).failedEdgeWeight).toBe(0);
  expect(parseFSE26Args(['--log-weight', '--log-mode']).logMode).toBe('logicHttp');
});
```

The name and the comment were right; **the assertion could not tell the two readings apart**.
`--log-weight` *did* consume `--log-mode` as its value (`hasValue` did not exist; the chain tested only
`i + 1 < argv.length`), `parseWeight('--log-mode', 1.0)` fell back to the shipped `1.0`, and the
following `count` was discarded as a stray token. The assertion passed because the swallowed flag's own
default happens to equal the value it checked for. So a dispatcher who forgot one value had their whole
request replaced by two defaults — the log mode silently shipped, the weight silently defaulted — and
the test that existed to prevent it could not see it.

## The fix

1. **The RCAEval parser is its own module** (`benchmarks/src/rcaeval-cli.ts`), extracted for the reason
   `fse26-cli.ts` already records about itself: `run-rcaeval.ts` calls `main()` at import time, so the
   parser could not be imported by a test and was unreachable to every guard in `benchmarks/__tests__/`.
2. **Both chains reject an unrecognised token**, naming it, in a message that also covers the case where
   the token is a *value* the flag before it was never given.
3. **`hasValue(argv, index)`** replaces the length check at all 36 value sites: a value never begins with
   `--` in these CLIs, so a flag can no longer swallow the next flag, and the flag left without a value
   is reported at the flag.
4. **Four assertions are rewritten** rather than deleted, each keeping the intent it was reaching for:
   `ignores unknown flags` becomes `refuses a flag it does not test instead of discarding it` **and** now
   asserts the intent directly (`parseFSE26Args(['--log-mode', 'count']).logMode === 'count'`, i.e. a
   stray token does not corrupt the accepted flags around it); the trap assertion is renamed `refuses a
   trailing --log-mode with no value` while its value-fallback line stays, because an unusable VALUE and
   an absent one are different decisions; and the swallow test now names the flag whose value is missing.

The distinction the record now carries: **an unusable value falls back to a published configuration; an
absent one is refused.** There is nothing to fall back *from* when the flag was never given a value, and
`0` is also the "off" value for several of them, so a silent default would make an unhonoured request
indistinguishable from a deliberate ablation.

## What this bounds

- Every dispatch that reaches a benchmark runner now either runs the configuration it asked for or fails
  before it loads a case (`main()` calls the parser first).
- The guard that would have caught this class at review time is `cli-argument-rejection.test.ts`: it
  reads each parser's **accepted set out of its own chain**, drives every value-flag at its own arity,
  and asserts that a flag with no value, a flag before another flag, a flag only the other runner owns,
  and a bare positional all fail naming the offending token. Driven from the chain, it cannot drift from
  the parser it describes — and it is what noticed that the RCAEval parser had moved.

## Gates

`benchmarks` **745** tests (was 737) at 99.84 / 97.37 / 100 / 99.84 · `rcaeval-cli.ts` **100/100/100/100**,
`fse26-cli.ts` **100/100/100/100**, `cli-args.ts` **100/100/100/100** · `kinetic` 940 · both typechecks ·
lint 0/0 (336 files) · format clean.

**Six mutations, all killed on the first pass**: the rejection removed from either chain, the value guard
reverted to a length check on either chain, `hasValue` accepting a flag as a value, and **the test going
back to blessing the discard** — which is the one that proves the rewritten assertion catches what the
old one could not.

Four guards had to be repointed because the parser moved, and each one is a case of the same lesson this
repository keeps re-learning: **a reader whose target moves does not fail, it goes on passing while
checking nothing.** `rcaeval-reported-config.test.ts` now reads both owners (a default is *declared* in
the parser and *forwarded* in the runner, so a swap to either alone would stop checking half of it);
`benchmark-rcaeval-trigger.test.ts` reads the parser for the flag and its default; the coverage-scope
guard demanded the new module be measured, and it is (`src/rcaeval-cli.ts` in `coverage.include`); and
the dispatch-surface census found **zero** accepted flags where the chain used to be, which is its
vacuity floor doing its job rather than a coincidence.

**A golden is owed** — `benchmarks/src/**` changed — and it is the end-to-end proof that the extraction
preserved the defaults: a push passes no flags, so the nine cells must be byte-identical.
