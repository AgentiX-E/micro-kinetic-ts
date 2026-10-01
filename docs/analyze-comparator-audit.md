# What a comparator is asked, and the arm the reading cannot see

Iteration 37. `docs/analyze-seam-guards-audit.md` §5 left **19 arms** and named the comparator-and-marker family
as the one the register already had a standing example for. This iteration decides all four of its members — and
the first thing it found is that **the instrument that has decided every arm for six iterations cannot see inside
a function handed to `Array.prototype.sort`**.

```
before  19 arms over 19 entries, 3 statements
after   17 arms, 3 statements   — and one of the two that remain is a FALSE zero, measured
```

| the arm | what decided it | the instrument |
| --- | --- | --- |
| `marginOf`'s `(a.id < b.id ? -1 : 1)` | a fixture whose two ROOTS tie, listed in the order that reaches `-1` | **a FIXTURE** (§4) |
| `solveZeroRegressionWindow`'s `(a.datapack < b.datapack ? -1 : 1)` | **the caller had already sorted by datapack, and the sort is stable** | **a PROOF — removed** (§3) |
| `familyScreen`'s `a.family < b.family ? -1 : 1` | a fixture whose two families agree on BOTH keys | **a FIXTURE** — and the arm is taken 26 times while the reading reports 0 (§2) |
| `formatFamilyScreenReport`'s `? ' *' : '  '` | a fixture whose family carries the engine's own prefix | **a FIXTURE** (§4) |

## 1. What the runtime does with a pair, measured

A tie-break's `-1` arm is reached only when the sort asks the comparator for two elements **in that order**, and
that order belongs to the runtime. Measured directly (`.git/sort_probe.mjs`, on the same Node the suite runs
under):

```
input [a,b]: asked (a=b, b=a) -> 1     input [b,a]: asked (a=a, b=b) -> -1
input [b,c,a]: asked (a=c, b=b) -> 1   asked (a=a, b=c) -> -1   asked (a=a, b=b) -> -1
```

**For a pair the comparator is asked `(later, earlier)`** — so a `-1` arm needs the CALLER's array to be in
descending order, and a fixture that lists its subjects ascending exercises the OTHER arm while looking exactly
the same. My first version of §4's root fixture did precisely that: it asserted the right name, passed, and drew
nothing. The corrected fixture's comment says so, and `.git/sort_probe.mjs` is the reading behind it.

## 2. The arm the reading cannot see — measured in ONE run, by two instruments

`familyScreen` ends with a three-key sort whose third key is the family name:

```ts
  return rows.sort((a, b) => {
    if (b.gain !== a.gain) return b.gain - a.gain;
    const widthA = …; const widthB = …;
    if (widthB !== widthA) return widthB - widthA;
    return a.family < b.family ? -1 : 1;          // ← the arm, inside a comparator
  });
```

An in-source probe (a `console.log` on the path, run in the SAME pass as the coverage report) counted:

```
PROBE family (cpu, jvm)                 -> -1     24 times
PROBE family (cpu, memory)              -> -1      1 time    (this iteration's fixture)
PROBE family (cpu, db.client.connections) -> -1   1 time
```

and `coverage-final.json` from the same run reports that branch's `-1` location with **count 0**. **Twenty-six
executions, zero counted.** The most likely mechanism is that the comparator is INLINED into the sort builtin,
where V8's block counters are not updated — that is named as a hypothesis, not asserted — but what is measured
is enough: **a zero inside a function passed to `sort` is not evidence that its arm is untaken.**

That is the mirror of this register's existing law about `??` inside a comparator ("silence is not evidence a
fallback is taken"): here **silence is not evidence an arm is NOT taken**, and the two together say that the arm
reading has nothing to say about either operator once it is inside a comparator.

## 3. The register's standing example, PROBED — and it survives

The register has cited the separator's `byP` as its example of an arm no input reaches:

```ts
  const byP = (a, b) => a.p - b.p || (a.faultType < b.faultType ? -1 : 1);
```

Given §2, that citation had to be re-read rather than trusted. The probe:

```
PROBE byP (T2, T1) -> 1     PROBE byP (T1, T0) -> 1     PROBE byP (T3, T2) -> 1
PROBE byP (T7, T6) -> 1     PROBE byP (T6, T5) -> 1     PROBE byP (T5, T4) -> 1
PROBE byP (T4, T3) -> 1
```

**Eight ties, every one of them the `1` arm** — so `byP`'s `-1` is genuinely never taken, the register's example
stands, and it now stands on a probe rather than on a reading this iteration has shown to be unreliable for
comparators. It is also the reason the artefact in §2 is not simply "comparators are always mis-reported": `byP`
returns `1` and IS counted, `familyScreen` returns `-1` and is not.

## 4. The four arms, and how each was closed

- **`marginOf`'s root tie-break — a fixture, with the ORDER made explicit.** Two acceptable roots that score the
  same are the only way the `||` is reached. The fixture's case is a genuine gain (wrong at zero, reachable at
  four and above), its two roots tie at the weight the margin is measured at, and the `scores` map lists them in
  DESCENDING id order — which is what makes the sort ask `(ts-a, ts-b)` and reach `-1`. The assertion is the NAME
  the report prints, `ts-a`, because that is what has to be the same on every run of the same dump.
- **The margin tie-break — REMOVED, on a proof whose premise is now measured.** `gained` is sorted by datapack
  one statement before the margins are derived; `Array.prototype.sort` has been required to be stable since
  ES2019; and §1 measured that the comparator is asked `(later, earlier)` — so with an ascending input the
  `-1` arm can never be reached. The order the tie-break meant to guarantee is guaranteed by the sort above it
  plus stability, and the existing spec that asserts `['dp-a','dp-b']` from an input listed `['dp-b','dp-a']` now
  holds the UPSTREAM sort, which is where the guarantee actually lives.
- **The family name tie-break — a fixture, and a warning.** Two families with no gain and an unbounded window
  agree on both earlier keys, so the name decides. The arm it reaches is the one §2 showed the reading cannot
  count: **this arm will stay in every future inventory of the file**, and the record says why rather than leaving
  a reader to re-derive it.
- **The engine-pool marker — a fixture, and a CLOSED arm.** `const marker = row.enginePoolFamily ? ' *' : '  '` is
  not inside a comparator, so the reading sees it, and it does: the fixture renders one report with a
  pool-prefixed family and one without, and asserts the marker as a substring of the first line and not of the
  second. With it the file's branch figure moves 98.53 → 98.69.

## 5. The mutation passes — 4 rows, 0 mismatches

**Runner one: `vitest`, on the analyzer's own suite.** Every row declares its verdict before it runs, the tests
each run EXECUTED are counted, and every mutated file is restored and hash-verified.

```
C1  OK  SURVIVED  exp=SURVIVED  tests= 437   63s  restore=ok  [no-op control: the file rewritten verbatim]
S1  OK  KILLED    exp=KILLED    tests=   1   62s  restore=ok  [the root tie-break inverted]
S2  OK  KILLED    exp=KILLED    tests=   2   60s  restore=ok  [the family tie-break inverted]
S3  OK  KILLED    exp=KILLED    tests=   1   60s  restore=ok  [the marker's polarity swapped]
rows=4  mismatches=0
```

**All three fixtures are load-bearing, including the two whose arms the reading cannot count** — which is the
point of pairing them: a mutation that inverts the comparator kills the spec whether or not the count moves.

**Runner two: the coverage reading**, for the one reach claim (§4's removal), with its own no-op control:

```
COV1 OK  arms=18 baseline=18 extra=0 exp=0 removed=0 exp=0 stmts=13 exp_delta=0               82s  suite_green=True
M1   OK  arms=19 baseline=18 extra=1 exp=1 removed=0 exp=0 stmts=13 exp_delta=0  | .sort((a, b) => a.margin - b.margin
rows=2  mismatches=0
```

That control's count is **18** where the project reading says 17: this runner is the analyzer's own suite, and a
baseline is a fact about the population it draws from.

## 6. Does anything a reader sees move?

The removal is inside a sort's ORDER, so the reading is the probe the last two iterations used — the miss report
at two weights per dump, the three screens at three named weights and both shapes, and the criterion report over
four artifacts of which three are `protect` — run under this tree and under the parent (`a4be685`) with a `trap`
and a hash-verified restore:

```
lines=461 (1717 physical)   diff lines: 0   NUMBERS lines differing: 0   report lines differing: 0   RESTORE VERIFIED
HASH 2c19a640…  identical on both trees — and the same hash the last three iterations produced
```

A sort's tie-break can only reorder two items whose primary key collides, and the corpus's dumps do not collide
there; the removal is therefore expected to move nothing, and it moved nothing. The identical HASH across four
iterations is itself the reading: the corpus's renderings are a fixed point of this family of changes.

## 7. What is left: 17 arms, of which some cannot be read at all

| family | arms | note |
| --- | --- | --- |
| `??` lookups | 7 | `guardCensus` ×2, `classifyMiss` ×2, `formatMissReport`, `parseAnalyzeArgs` ×2 |
| `? -1 : 1` tie-breaks | 4 | `marginOf`, `familyScreen` (**a false zero, measured**), `tallyCounter`, and the separator's two |
| report-only qualifications | 4 | `lawDerivationClause` ×2, `formatCriterionReport`, `formatFamilyScreenReport` |
| `capBinderOf`'s loop exits | 2 | unreachable for the reason iteration 35 proved |
| uncovered STATEMENTS | 3 | `2806–2808`, the `throw` and its braces |

**The comparator rows cannot be decided by the arm reading any more**, and the honest treatment is the one this
iteration used: a spec that asserts the BEHAVIOUR, a mutation row that proves the spec holds it, and a record
that says the arm will keep printing. A `/* v8 ignore */` would hide the number rather than explain it, which is
what `coverage-honesty` exists to refuse.

## 8. Gates

| | |
| --- | --- |
| the changed suite | **437 tests** green (`fse26-diagnose-analyze`, 434 → 437) |
| `fse26-diagnose-analyze.ts` | **99.9 / 98.69 / 100 / 99.9** — **17** arms (was 19) |
| the benchmarks project | **99.95 / 99.29 / 100 / 99.95** — 920 tests / 23 files |
| `tsc` both legs · oxlint · prettier | clean · 0 warnings 0 errors · the changed files conform |
| the register's own fence | **14 / 14** green with the new index row |
| golden | **OWED** — `benchmarks/src/**` is a `push` trigger and this iteration changes it |
