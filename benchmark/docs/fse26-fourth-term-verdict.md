# The fourth term: the shipped score moved, and two diagnostics did not

**Status:** measured, shipped as a bug fix (no engine change). **Instrument:** the
dump reconstruction and the miss attribution in `benchmarks/src/`.

**The defect, in one line.** The shipped score has had four terms since
`e2d3b24` (`latWeight`, `latMinRise`, `poolMetricPenaltyWeight` plus the base); the
reconstruction summed three, and the miss vocabulary could spell three. Both are
diagnostics of "why did the engine rank this way", and a diagnostic that does not model
the configuration it diagnoses is not conservative — it is wrong.

The register already carries the case that produced this rule: a two-term classifier over
a three-term dump reported the shipped latency term's own decisions as **12 phantom
`unexplained` defects**, and `unexplained` is documented as "a bug, or a wrong weight —
never a result". This is the same defect one term later, caught before it published
anything.

---

## 1. What the omission actually produced

**The reconstruction.** Run against the pre-pool dump at the SHIPPED weight:

```
--dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0.0679 --term-oracle
```

| line | before this change | after |
| --- | --- | --- |
| `rank-1 reproduced` | **1319/1422** | 1319/1422, **labelled** `same as the dump's own recorded` |
| `moved by the pool penalty` | *did not exist* | **103** |
| `rank-1 an acceptable root` | 750 (the three-term prediction) | **756** |

The first row is the trap. 1319/1422 printed under the heading "reproduced" reads as an
instrument that drifted in 103 cases — and it cost nothing to fix, because the number is
not drift: the dump was scored by a run with the penalty **off**, so any case the penalty
reorders disagrees with it **by construction**. The line now says what it measures, and
the caveat that decides how to read it prints with it, because the tool cannot know
whether its flags name the dump's own configuration.

**The miss attribution.** On the pool-on dump (445 cases, five fault types), 11 of the
204 misses have a POSITIVE pool contribution — the penalty subtracted from the root, so it
is one of the reasons the root lost. The vocabulary could not spell that, so those eleven
were attributed to whichever other terms were positive, and the report read as complete.

## 2. The fix, and the two guards that keep it honest

**One implementation of the score.** `blendScores` is now the single place the four terms
are summed, and `rankCase` ranks by it. The next candidate is solved from score GAPS, so
a solver that re-derived the blend would be a second implementation of the quantity under
measurement — the defect this module exists to find.

**The rule is validated, not restated.** The pool family's prefix is imported from the
engine; the RULE (`startsWith`) is restated, because a dump carries a bare label while the
engine's classifier takes its own metric objects. The test feeds one label list to both
and requires agreement label for label. A screen that penalises a different family than
the engine does is a screen that validates nothing, and it fails silently — both sides
keep producing numbers.

**The vocabulary is one list the type derives from.** `MISS_DECIDED_BY` is a `const`
tuple; `MissDecidedBy` is derived from it, and `MISS_ORDER` is built from it. The guard is
a census, not a sample: it regenerates all **15** non-empty subsets of the four terms and
requires the list to equal them exactly, then requires the tally order to contain every
one of them in order and nothing twice. A spelling reachable by `classifyMiss` and absent
from the vocabulary would be a label the per-type line prints and the tally silently
drops.

**The term has a measured footprint.** A penalty has no ORDER of its own — ranking by it
alone puts every non-pool service in a tie broken by id — so it is deliberately absent
from the oracle's `TermName`, where the question is "which term's own order names the
root". That exclusion is stated in the type's own doc rather than left implicit, and the
term's footprint is reported instead: `OracleFidelity.poolFlips`, the number of cases
whose rank-1 the penalty moves. Without it, a reconstruction that carried the weight but
never applied it would read exactly like one that did.

## 3. Validation — against measurements the instrument had never seen

Every row is reproducible from a checked-in command; no row comes from a session probe.

**3.1 The three-term instrument still reproduces its own run.**

```
--dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0 --term-oracle
  rank-1 same as the dump's own recorded: 1422/1422 cases; an acceptable root: 750; moved by the pool penalty: 0
```

750 is that run's published headline (`34928980425`), and `poolFlips = 0` at a weight of
zero is the ablation behaving as an ablation.

**3.2 The reconstruction PREDICTS a run it has never read.** The same dump, at the shipped
weight:

```
  rank-1 an acceptable root: 756
```

**756 is the shipped run's headline** (`34953378651`, `--pool-penalty 0.0679`, measured
against its own control last iteration). The reconstruction reaches it from a dump
produced by the pool-OFF run, which is the strongest offline statement available: the
fourth term's model, applied to another run's data, lands on the engine's own number.

**3.3 Per-type agreement on a pool-ON dump.** The flagged candidate run
(`34949854236`) carries a dump for five fault types, scored WITH the penalty:

```
--dump artifacts/r34949854236/fse26-results.txt --log-weight 1 --pool-penalty 0.0679 --term-oracle
  rank-1 same as the dump's own recorded: 445/445 cases; an acceptable root: 241; moved by the pool penalty: 41
```

Both numbers are external. 445/445 says the reconstruction reproduces the pool-on run's
own ranking for every dumped case — the fourth term modelled exactly, on data the model
was never fitted to. And **241 is the sum of those five types in the shipped run's own
table**: `HTTPResponseReplaceCode` 160 + `NetworkPartition` 49 + `NetworkDelay` 20 +
`ContainerKill` 6 + `JVMLatency` 6. Per-type agreement, not a total that could be right
for the wrong reasons.

**3.4 The extension is an extension.** At `--pool-penalty 0` the miss map reproduces the
recorded one line for line: `metric` 275, `log` 120, `lat` 12, `metric+log` 116,
`metric+lat` 50, `log+lat` 25, `metric+log+lat` 74, silent-both-sides 230, wrong 672 —
and the banner reads `pool penalty NOT modelled (--pool-penalty 0)`. A re-derivation that
reproduces the published map at the published configuration is a reader of that map, not a
replacement for it.

## 4. What this does NOT license

1. **"The penalty is rare" is false, and the +6 hides it.** The term moves the winner in
   **103 of 1422 cases** (7.2%); the net is +6 because 97 of those were already-wrong
   cases whose wrong winner changed, and **zero** went from correct to wrong. Any later
   argument that starts "it only touches six cases" is reading the net as if it were the
   footprint, and the tool now prints both so the two cannot be conflated.
2. **The routing map is still the PRE-POOL map.** `metric` 275 / `log` 120 / `lat` 12 /
   combos are the three-term numbers for the pool-OFF configuration, and they survive
   exactly because the vocabulary reproduces them there. Re-measuring them at the shipped
   configuration needs a pool-ON dump of all 1422 cases, which does not exist: the shipped
   run was dispatched without `diagnose`. The tool is now able to; the data is the gap.
3. **A `pool` row is not a candidate.** It says the penalty is one of the reasons a root
   lost. Whether some other family's penalty pays is a separate, separately-solved
   question.

## 5. Residual

The analyzer module's branch coverage is 99.1% (statements 99.74): lines 1413-1415 are the
binder search's `return undefined` tail, which is pre-existing and type-level unreachable
for a finite cap — the cap IS a case's interval cap, so a binder always matches. Left as
a defensive arm rather than removed in an iteration that does not own that code path.

## 6. Reproduce

```bash
# 3.1 the three-term instrument against its own run (750, 1422/1422, 0 flips)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0 --term-oracle

# 3.2 the four-term reconstruction predicting the shipped run (756)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0.0679 --term-oracle

# 3.3 a pool-ON dump, its own ranking and its five types (445/445, 241, 41 flips)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34949854236/fse26-results.txt --log-weight 1 --pool-penalty 0.0679 --term-oracle --misses

# 3.4 the map this is an extension of, at its own configuration
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0 --misses
```
