# A guard's reachability belongs to its caller

Iteration 35. `docs/analyze-caller-reach-audit.md` §7 left `fse26-diagnose-analyze.ts` at **30 arms and 3
statements** and named its largest remaining cluster — the thirteen guards on a missing input — with the
question that decides each one: *not* "can the input be absent", but **"does every caller already exclude it"**.
This iteration answers that question for eight of them, and the answers are **three** answers rather than two:

```
before  30 arms over 30 entries, 3 statements
after   24 arms, 3 statements
```

| the guard | the answer | the instrument |
| --- | --- | --- |
| `capBinderOf`'s `!Number.isFinite(cap)` | the single caller's own assignment makes it finite | **a PROOF** (§2) |
| `renderedTiePairs`'s `measured === undefined` | both call sites exclude the absent case | **a PROOF** (§2) |
| `renderedTiePairs`'s `n < 2` | **redundant** — the guard BESIDE it excludes every pair below two | **a MEASUREMENT** (§3) |
| `capBinderOf`'s `t === undefined` | reachable: `targets` is the ground truth as written | **a FIXTURE** (§4) |
| `renderedTiePairs`'s absent row, two clauses | reachable, and one clause MASKS the other | **a FIXTURE** (§4) |
| `renderedTiePairs`'s `other.base >= target.base` | reachable, and its boundary is `>=` rather than `>` | **a FIXTURE** (§4) |
| `dumpPrecisionOf`'s `seen.size === 0` | reachable: an empty population | **a FIXTURE** (§4) |

**Six arms are closed** — two by proofs and four by fixtures — and the seventh row above is closed in the other
sense: the guard was REMOVED, so its arm is gone, but the removal is not a coverage gain and §3 says why.

## 1. Why the question has to be asked of the CALLER

A guard's arm is uncovered, and the reading cannot say whether the state is impossible or merely undrawn —
**the same number is printed either way**. Three instruments can decide it, and this iteration needed all three:

- **the caller's arithmetic**, when the guard's subject is a LOCAL the caller computed (§2);
- **the guard beside it**, when two predicates exclude the same population and one of them returns first (§3);
- **a fixture through the seam**, when the caller is an exported function that accepts a type a hand-written
  caller can populate (§4).

The third case is the one that moved this iteration's reading, and it is worth stating plainly: **a guard whose
input comes from an exported seam is a CONTRACT, and "the two in-tree builders cannot produce it" is a claim
about the builders rather than about the API.** Four of the eight guards exist exactly there.

## 2. Two guards the callers exclude — proofs

**`capBinderOf`'s cap.** The only call site is `capCase === undefined ? undefined : capBinderOf(capCase, cap)`,
and `capCase` is assigned in one place, under `if (baseline < cap)`:

```ts
    let cap = Number.POSITIVE_INFINITY;
    …
    if (baseline === Number.NEGATIVE_INFINITY) { …; continue; }   // an unsatisfiable case leaves cap alone
    …
    if (baseline < cap) { cap = baseline; capCase = one; }
```

So `capCase !== undefined` ⟹ the last assignment had `baseline < cap`: a `-Infinity` baseline never arrives (the
branch above `continue`s), an `+Infinity` baseline fails that comparison, a `NaN` baseline fails it too, and
`cap` only ever DECREASES from `+Infinity` — so `cap` is FINITE whenever this function is called. The guard
re-checked what the caller had already established, and its arm was unreachable for that reason.

**`renderedTiePairs`'s provenance.** The callers are `computeZeroRegressionWindow`, which calls it inside
`if (one.measured !== undefined)`, and `leadsRenderTiedRival`, whose only caller reads it through
`capCase !== undefined && capCase.measured !== undefined && leadsRenderTiedRival(capCase)` — so the short-circuit
excludes the absent case before either call, and `const measured = one.measured!` is the house's `!` rather than
a fallback: the same form iteration 34 used for the binder, for the same reason.

## 3. A guard that is neither dead nor a gap: REDUNDANT — and a refuted declaration is how it was found

`renderedTiePairs` began with

```ts
  const n = measured.weighed.size;
  if (n < 2) return [];
```

and a spec was written for it: a case whose weighed set holds ONE service, asserted to contribute no pair. The
mutation that loosens the threshold to `n < 1` — exactly what that spec should catch — **left the suite green and
the class count unchanged**. The reason is in the body: every pair needs BOTH sides in the weighed set
(`!measured.weighed.has(name)` skips the target, `!measured.weighed.has(rival)` skips the competitor), so below
two weighed services **no pair can be formed whatever the early return does**. The spec had been passing for the
OTHER guard's reason.

**The guard was then removed as redundant**, with the proof in its place, because a guard that cannot change an
answer is a claim about a population it does not own. The word for this is not `dead` (the arm's line was on the
guarded side, and a hand-built case CAN declare one weighed service) and not `gap` (no fixture can make it
matter): **the two predicates exclude the same population, and that is a property of the pair rather than of
either one.** The builders still state the threshold where it means something — they attach `measured` only under
`weighed.size >= 2`, because `shapeStep` would divide by `n − 1 = 0`.

**And the removal is not a coverage gain, which the sheet measured**: re-introducing the guard adds no uncovered
arm, because the spec written for it DRAWS it. A record that claimed an arm for that removal would be false. The
spec stays, because it now holds the `has` clause it was really exercising.

## 4. Four fixtures through the exported seam

`computeZeroRegressionWindow` takes `WeightSeparationCase[]`, and that type is exported. Every spec below hands
it a case neither in-tree builder produces, and each asserts its own precondition before the answer:

- **a root with no row.** `targets` is the ground truth as written — `buildWeightSeparationCases` does not
  intersect it with the services — so a block that names a root it prints no row for reaches the cap's binder
  with a target absent from `scores`. The ghost is placed **first** on purpose, because the search returns on the
  first matching pair and a ghost listed after the binding root would never be read.
- **an absent row that is also WEIGHED**, which is the only shape that makes that clause load-bearing: with the
  ghost outside the weighed set, the clause beside it returns first and the mutation that deletes it SURVIVES.
  That is measured rather than assumed — the fixture's first form was MASKED, and the mutation sheet is what
  found it (§5).
- **a root the case does not LEAD.** Two roots the render cannot tell apart, one behind the other at `w = 0`: the
  trailing root's pair is skipped, so its NEGATIVE `lead` never enters the class's floor. The fixture asserts the
  floor is the leading root's `lead / span`, and that assertion holds the guard because without it the floor
  would be `−1`. The mirror (bases swapped) moves the skip to the other root and the floor does not move, so the
  spec is about the guard and not about one root. And the **boundary** is asserted too: two roots at the SAME
  base are tied for the engine as well, so the class is EMPTY — which is what makes the guard a `>=` rather than
  a `>`.
- **an empty population.** `dumpPrecisionOf([])` is the one input no report path produces, and the input this
  function's own history makes interesting: it used to take the box from `cases[0]`, which an empty list does not
  have. The assertion is both the fallback (`stated: false`, so an assumed box cannot read as a declaration the
  artifact made) and the fact that no element is dereferenced.

## 5. The mutation passes — 5 suite rows and 5 coverage rows, 0 mismatches, and THREE refuted declarations

**Runner one: `vitest`, on the analyzer's own suite.** Every row declares its verdict before it runs, a run that
collected nothing is neither a kill nor a survivor, and every mutated file is restored and hash-verified.

```
C1  OK  SURVIVED  exp=SURVIVED  tests= 430   97s  restore=ok  [no-op control: the file rewritten verbatim]
S1  OK  KILLED    exp=KILLED    tests=   1   80s  restore=ok  [the tie-pair guard loosened to `>`, so a pair LEVEL with its rival enters the class with a floor of 0]
S3  OK  KILLED    exp=KILLED    tests=   1   79s  restore=ok  [the cap binder's absent-row skip removed, so a listed root with no row is dereferenced]
S4  OK  KILLED    exp=KILLED    tests=   1   78s  restore=ok  [the tie view's absent-row skip removed, so a listed root with no row is dereferenced]
S5  OK  KILLED    exp=KILLED    tests=   2   79s  restore=ok  [the empty population made to fall through to `cases[0]`, which it does not have]
rows=5  mismatches=0
```

What is NOT on this sheet: the threshold row that was declared here and its mutation SURVIVED — it became the
coverage sheet's `M3`, because a claim about a guard that cannot change an answer is a reach claim. A row whose
mutation survives a spec written to kill it is a statement about the SPEC, and it is kept rather than deleted.

**Runner two: the coverage reading**, for the reach claims, which no suite can hold. Its rows are stated as a
difference against its own no-op control **in both directions** — an `extra` count for a guard re-introduced and
a `removed` count for one the change took away.

```
COV1 OK  arms=25 baseline=25 extra=0 exp=0 removed=0 exp=0 stmts=13 exp_delta=0     106s  suite_green=True
M1   OK  arms=26 baseline=25 extra=1 exp=1 removed=0 exp=0 stmts=13 exp_delta=0  | if (!Number.isFinite(cap)) return un…
M2   OK  arms=26 baseline=25 extra=1 exp=1 removed=0 exp=0 stmts=13 exp_delta=0  | if (measured === undefined) return […
M3   OK  arms=25 baseline=25 extra=0 exp=0 removed=0 exp=0 stmts=13 exp_delta=0  -
M4   OK  arms=25 baseline=25 extra=0 exp=0 removed=0 exp=0 stmts=13 exp_delta=0  -
rows=5  mismatches=0
```

That control's expected count is **25**, and it is not the project reading's 24: this runner is the analyzer's
OWN suite, so its population is smaller and its uncovered-statement count is **13** where the project reading
says 3. **A harness's baseline is a fact about the population it draws from**, which is why every row here is a
difference against it rather than a number.

**Three declarations were refuted by their own measurements, and each refutation is a finding** — which is what a
declared-before-run sheet is for:

1. the threshold row was declared a KILL and the mutation SURVIVED ⟹ the guard is redundant (§3);
2. the same row was then declared to add an uncovered arm and the measurement said it adds none, because the spec
   DRAWS it ⟹ the removal is not a coverage gain;
3. the `throw` row was declared to cost an arm and the measurement said it costs none ⟹ the `throw` was taken for
   its TYPE (`WindowCapBinder` rather than `WindowCapBinder | undefined`) and its loudness, never for coverage.

**And the sheet reproduced a defect it was written to warn about.** Its first version compared the uncovered
STATEMENTS by line number, so every row failed while printing every number correctly: a mutation that adds a line
shifts every statement below it, which is precisely why the ARM comparison is a multiset of texts. The fix is
`len(statements) == len(baseline) + expected` — a COUNT, because a line number is a position and not an identity.

## 6. Does anything a reader sees move?

The three changed functions are read by the corpus through `computeZeroRegressionWindow` and the reports that
print its frontier, so the reading is the probe iteration 34 built — the miss report at two weights per dump, the
onset/cv/family screens at three named weights and both shapes, and the criterion report over four artifacts of
which three are `protect` — run under this tree and under the parent (`7b78a81`) with a `trap` and a
hash-verified restore:

```
lines=461  (1717 physical)   diff lines: 0   NUMBERS lines differing: 0   report lines differing: 0   RESTORE VERIFIED
HASH 2c19a6404fad633d564a105b29eeb92d6d4c7e54a7b81c788efb6610e9946f61   (both trees)
```

The hash is the one iteration 34's A/B produced as well, which is what a change inside a guard should look
like: the renderings are a function of the corpus, and none of these three functions consults a state the
corpus does not have.

## 7. What is left

**24 arms**, all named by `.git/cov_lines.py`. The missing-input cluster had **five** guards left, and this
paragraph called it six — **the same count/list mismatch iteration 33's inventory made**, since the sixth entry in
the list below was not a guard at all but `capBinderOf`'s loop-exit brace, which this iteration's own restructure
had already taken as far as it could. **Iteration 36 closed all five of them and with them the whole cluster**
(`docs/analyze-seam-guards-audit.md`), so the list below is a record of what was left HERE rather than a plan; the
live inventory is that audit's §5. The corrected count is the arithmetic: 13 in the cluster, 2 excused by their
callers, 1 removed as redundant, 5 fixtures here, 5 fixtures there.

```
    1153  guardCensus              if (sourceService === undefined) continue;
    2987  unreachableCause         if (target === undefined) continue;
    3319  buildFamilyCases         if (targets.length === 0) continue;
    4427  formatOnsetMenuReport    if (first === undefined) return 'Temporal (onset) screen: no shape was screened'
    5263  formatCvMenuReport       if (first === undefined) return 'Decisive-stability screen: no shape was screened'
```

Each is a question about its caller, and two of them are already answered in outline: `first` comes from the
literal shape list the menu is solved over (so the guard asks whether that list can be empty — a question about
`CV_SHAPES`, which no fixture can draw and no proof has yet been written for), and `targets.length === 0` is the
same predicate the case builder filters on, re-checked in the family builder — the REDUNDANT shape of §3
awaiting its own measurement.

## 8. Gates

| | |
| --- | --- |
| the changed suite | **430 tests** green (`fse26-diagnose-analyze`, 426 → 430) |
| `fse26-diagnose-analyze.ts` | **99.9 / 98.14 / 100 / 99.9** — **24** arms (was 30) |
| the benchmarks project | **99.95 / 99.01 / 100 / 99.95** |
| `tsc` both legs · oxlint · prettier | clean · 0 warnings 0 errors · the changed files conform |
| the register's own fence | **14 / 14** green with the new index row |
| golden | **OWED** — `benchmarks/src/**` is a `push` trigger, and §6 is why the 9 cells are expected byte-identical |
