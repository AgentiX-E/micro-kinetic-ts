# One command line, one knob named twice: how a reference comparison gets relabelled

**Status:** defect found, measured, fixed, and fenced. **Code:** `benchmarks/src/rcaeval-cli.ts`,
`.github/workflows/benchmark-rcaeval.yml`, `packages/kinetic/__tests__/unit/dispatch-surface-census.test.ts`.

The dispatch surface has been audited for whether a KNOB is reachable — `dispatch-surface-audit.md` reads
the accepted set out of each parser, `dispatch-surface-census.test.ts` checks it in both directions, and
iteration 42 closed the case where a knob was reachable-but-discarded. Every one of those checks asks a
question about a *knob*. None of them asks what a single **command line** means when it names the same knob
twice, and that question is not a property of the knob: it is a property of the parser's tie-break.

---

## 1. The defect, measured before it was fixed

`benchmark-rcaeval.yml`'s RE3 job runs the `novelty` **reference** as

```yaml
pnpm exec tsx benchmarks/src/run-rcaeval.ts --suite re3 --no-inject-time --log-signal-mode novelty \
  "${STABILITY_ARG[@]}" "${RANKING_ARG[@]}" "${DIAGNOSE_ARG[@]}"
```

and `RANKING_ARG` carries

```yaml
if [ -n "${{ inputs.log_signal_mode }}" ]; then
  RANKING_ARG+=(--log-signal-mode "${{ inputs.log_signal_mode }}")
fi
```

— added in iteration 42, when the log mode became dispatchable on this half at all. So one command line can
carry **two statements of one flag**, and `parseRCAEvalArgs` assigns inside its `else if` chain, so the
**last** one wins. Measured (`.git/probe_dup_44.mts`, calling the parser itself, not a re-derivation):

| command line | result |
| --- | --- |
| `--log-signal-mode novelty` | `novelty` |
| `--log-signal-mode novelty … --log-signal-mode all` | **`all`** |
| `--log-signal-mode novelty … --log-signal-mode novelty` | `novelty` |

The middle row is the defect: a dispatch that sets `log_signal_mode=all` runs `all` **inside the step whose
entire purpose is the `novelty` reference**, and the step still uploads its artifact as
`rcaeval-re3-novelty-results.txt` and tees it to `rcaeval-re3-novelty-results.txt`. The reference comparison
is relabelled by an input that has nothing to do with it.

## 2. Reachability, which is what makes it a defect rather than a curiosity

There is no `rcaeval-re3-novelty` JOB. The novelty step lives inside the `rcaeval-re3` job, and that job
carries **no `if:`** — so the step runs on every dispatch that reaches the job, and the only thing that
suppresses the user's mode is the input being empty. A **push** passes no flag (`inputs.*` are empty), which
is why every golden run so far was honest; a **dispatch** is exactly the case that is not, and a dispatch is
how every candidate is measured.

## 3. Why the existing fences could not see it

All three of the surfaces that read this workflow ask about knobs:

| surface | the question it asks | why this defect is invisible to it |
| --- | --- | --- |
| `reaches(flag, text)` | can this workflow mention the flag at all | it does, in **seven** places either way |
| `inputNames` ⇒ `flagOfInput` ⇒ `KNOBS` | is every declared input owned by a knob | `log_signal_mode` is owned, and stays owned |
| `UNDISPATCHABLE_ON_RCAEVAL` | which accepted flags no input reaches | the flag is reached, so it leaves this set |

A fence that counts occurrences cannot see a precedence problem, because the occurrence count is **right**
in both the broken and the fixed versions — the number that changed is the number of occurrences **per
command line**, and nothing was measuring per command line.

## 4. The fix, in two parts, because one part alone is wrong either way

**(a) The runner refuses the contradiction.** `parseRCAEvalArgs` now remembers the first
`--log-signal-mode` it saw — the RAW token *and* the mode it resolved to — and throws when a second one
resolves to a different mode, naming both values. It refuses rather than taking the last one, because a
command line that names a mode twice is a contradiction, not a precedence. Two statements of the SAME mode
are one request written twice and stay accepted, and an unusable value still falls back to the published
default: those two are different decisions from a second statement, and the test file asserts all three arms
apart.

**(b) The workflow stops creating the contradiction.** The novelty step, alone among the seven ranking
sites, no longer appends the dispatch's mode. Its mode is its identity; a reference that an unrelated input
can relabel is not a reference. Part (a) alone would turn a silent mislabel into a failed job for every
candidate dispatch, and part (b) alone would leave the next flag free to reintroduce the shape.

**(c) The fence is stated over the SHAPE, not over this flag.** A new assertion in
`dispatch-surface-census.test.ts` slices every `run:` block, reads the runner invocation, and computes the
flags the command line can name = the literals on it ∪ the flags its expanded arrays add. A flag in **both**
is a step that pins a flag an array also sets, and the assertion requires that set to be empty. It is red on
exactly the novelty step before the fix and green after, and it will stay red-reporting if some future flag
arrives the same way.

## 5. The instrument's own two corrections, recorded because the guard is what caught them

The new helper was wrong twice before it was right, and both failures were **silent** — the check reported
no offenders because it saw no steps:

1. `/^ *run: \|\n([\s\S]*?)(?=\n {6}- |$)/m` — under `/m`, `$` matches end-of-**line**, so the body was one
   line long. It saw 1 block of the 7 runner steps.
2. `/^ *run: \|\n([\s\S]*)$/` — `^` without `/m` anchors at the start of the **string**, so it matched no
   step at all. It saw 0.

Both were caught by the assertion's own **non-vacuity guard** (`expect(blocks.length).toBeGreaterThan(5)`,
and a second on the count of steps that expand an array which adds a flag). Without that guard both versions
would have PASSED while measuring nothing — which is the failure mode the guard exists for, reproduced
inside the instrument being written to catch a different one. The final anchor is a newline.

## 6. What else this pass found, and could not explain away

**`1421 of 1422` is wrong, and three documents say it about a dump that reads `1422 of 1422`.** The engine
ranks one service per case whose printed id is EMPTY, and its own header counts it: on
`dump-35035314921.txt` and `dump-35436069639.txt`, the parsed row count equals the header's `services=` in
**1422 of 1422** cases and the ground-truth marker count equals `|GT|` in **1422 of 1422** — which can only
be true if the unnamed row IS one of the declared services. Counting the unnamed rows directly gives
**1422** blank rows over **1422** cases: exactly one per case, in every case, on both dumps.

Three documents record 1421: `fse26-term-oracle-verdict.md` ("**1421 of 1422** cases carry it"),
`edge-grammar-audit.md` ("in 1421 of the shipped dump's 1422 cases"), and `artifact-capability-audit.md`
("disagreed with the header's `services=` in 1421 of 1422 cases"), the last two naming
`dump-35035314921.txt` explicitly. `fse26-term-oracle-verdict.md` is also **inconsistent with itself**:
§6's heading says "Every case but one carries a printed row whose service id is EMPTY" while the same
document's §8 says "One printed row per case carries an EMPTY id".

The offending row is left standing in each document as the CONTROL rather than edited away, and the
correction is recorded here because a count that three records agree on is exactly the kind a later reader
takes on authority. What the number changes: nothing in the argument. The unnamed candidate is the ten
unlabelled `k8s.*` series, `n = 51` is what puts the metric term's step at `1/50`, and its presence in
**every** case rather than all but one makes that step cleaner, not weaker.
