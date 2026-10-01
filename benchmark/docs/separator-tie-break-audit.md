# The arm the register cited as unreachable — and what a comparator owes when its keys are equal

Iteration 39. Two claims leave this iteration: **the register's standing example of an arm "no input can
reach" is reachable**, and **the tie-break that example belongs to cannot say "equal"**. The first is a
correction of a citation that has stood for four iterations; the second is a contract fix whose absence the
instrument, the suite and the corpus all fail to punish — which is stated here rather than dressed up.

---

## 1. What the register claimed, and what had actually been measured

`docs/closed-axes-register.md` cites the separator's tie-break — `a.p - b.p || (a.faultType < b.faultType ? -1 : 1)`
— as the archetype of an unexercised arm, and iteration 37 asked it to be **probed** rather than re-read:
"eight ties came back, every one of them the `1` arm". That is a measurement of **the suite's draws**. It is
not a measurement of reachability, and the two were written down as if they were the same thing.

The difference matters because the two states need different treatments and the register's row asserts the
stronger one. `dead` owes a proof; `gap` owes a fixture. The row has been read for four iterations as a proof.

---

## 2. The construction, and the probe that confirms it

Three facts make the `-1` arm reachable, and each is in the code:

1. **The row order is decided before the compared list exists.** `built` is sorted by pair count DESCENDING
   and then by fault type ASCENDING (line 1124), and the survivor/dominated lists are filled by walking
   `built`. So among two rows of EQUAL size the smaller name comes first — which is why every tie in the
   suite has been asked as `(T_{k+1}, T_k)` and taken the `1` arm. Give the LARGER-named row MORE pairs and
   the order flips.
2. **`p` is a function of two counts and nothing else** — `separationPValue(tally.source, tally.winner)`. It
   does not read the subset's size, so two cells in rows of DIFFERENT size tie whenever those two counts
   agree. That is what makes "more pairs" and "the same `p`" compatible at all.
3. **A pair can grow a row without touching a cell.** A graph-less case leaves `inDegree` unmeasurable — it
   counts in `row.pairs` and not in the cell's measurable total. So the extra pair costs the cell nothing.

The fixture is those three facts: twelve graph-bearing pairs for `T1`, twelve for `T2`, and **one graph-less
pair for `T2`**. The probe on the real comparator, with the spec in place:

```
PROBE-BYP asked ('T1' as a, 'T2' as b) -> -1
```

The `-1` arm runs. What kept it out of the suite for four iterations was the caller's row order — the same
fact iteration 37 measured for `marginOf`, one module over.

---

## 3. Why the closure changes no answer

The tie-break's own order is **ascending by name**, and the fixture reaches it through the `-1` arm while
every other tie in the file reaches it through the `1` arm: two different arms, one answer. That is why the
arm could sit undrawn indefinitely without anyone seeing a defect — an unexercised arm and its complement
produce the same list — and it is why the register's row could be read as a proof without costing anything.

The spec therefore asserts the ORDER (which is the claim a reader cares about) and its preconditions assert
the SHAPE that reaches the other arm: two cells, tied on `p`, in rows of different size, with the larger name
in the larger row. Sheet one's S3 — the `-1` arm answered `0` instead — kills **exactly one test in the
suite**, which is that spec: the arm is load-bearing rather than incidental.

---

## 4. What a comparator owes when its keys are equal

The arm above is one of TWO that the comparator's shape hides. The other is the one the register never
mentioned, and the census is the reason it is worth an iteration:

**A `? -1 : 1` tie-break appears 24 times in this repository.** Two of those are not comparators at all —
`sign = z < 0 ? -1 : 1` in `packages/causal` and `packages/noise`, where two values are the whole domain —
and the remaining **22 are comparators that cannot return `0`**. They are safe exactly where their tie-break
key is unique in the list being sorted (a `Map`'s keys, a service id, a signal name, a fault-type row), and
that is a property of each CALL SITE rather than of the shape. Nothing in the code says which is which.

**One site has a key that repeats: this one.** `survivors` and `dominated` hold one cell per (row, signal), so
two cells of ONE row share a fault type — and the corpus supplies them: the separator's own report over the
shipped dumps has **10 groups of cells that present equal keys** to this comparator, one of them a `disk` row
whose `decisiveTrend` and `decisiveCv` cells tie at `p = 5.19e-4`.

A stable sort preserves the order of the elements its comparator calls EQUAL, and of no others. So with a
two-valued tie-break the row's cell order is whatever the engine's sort happens to do — and the `0` arm is
what makes it a property of the data. The arm is added, and the honest part is what cannot be said about it:

- **the suite cannot hold it.** Sheet one row S2 removes the `0` again and **SURVIVES** with all 73 tests
  green — declared SURVIVED before it ran, because that is what the probe predicted;
- **the reading cannot hold it.** Sheet two row M2 reverts to the two-valued form and the separator's
  uncovered-arm count does not move;
- **the corpus cannot hold it.** The A/B over the shipped dumps, at both criteria, is `diff 0` — on a
  population that demonstrably presents equal-key pairs (§5).

So the arm is written for the CONTRACT, and this document is what says so. A `/* v8 ignore */` would have
hidden the arm instead; keeping the two-valued form and saying nothing would have left a report whose row
order is a fact about the runtime.

---

## 5. The A/B, and the check that it is not vacuous

Iteration 38's A/B reads the ANALYZER's reports, and this change is in the SEPARATOR — so the probe had to be
extended, not reused. `.git/probe_separator_39.ts` renders `formatSeparatorCensus` for every dump in the
corpus at the shipped criterion AND at a low floor, and prints the numbers behind every line.

```
lines=743   diff lines: 0   NUMBERS lines differing: 0   report lines differing: 0
HASH cbd48105…  (identical on both sides)
RESTORE VERIFIED
```

**And the population is not vacuous**, which is the check that makes `diff 0` mean something: over the two
criteria the probe prints 46 survivors and dominated cells, and **10 groups of them share a `(faultType, p)`
key** — i.e. the comparator was asked about equal keys on the corpus, and the two spellings answered the same
way there too.

---

## 6. The sheets

**Sheet one — the tie-break's arms, on the suite runner (5 rows, 0 mismatches).**

| row | mechanism removed | verdict | ran | failed |
|---|---|---|---|---|
| C1 | — (control) | SURVIVED | 73 | 0 |
| S1 | the name tie-break inverted | KILLED | 73 | 2 |
| S2 | the `0` arm removed (back to two-valued) | **SURVIVED** | 73 | 0 |
| S3 | the `-1` arm answered `0` instead | KILLED | 73 | **1** |
| S4 | the primary key neutralised | KILLED | 73 | 1 |

S3's single failure is the new spec, and S2's survival is the finding.

**Sheet two — can the reading see this comparator at all (3 rows, 0 mismatches).** The separator's arm count
went **1 → 0** and the arm that left was closed by a fixture, so the claim to hold is "the spec is what draws
that region" — and the danger is a zero that is really the instrument's blind spot, which is the error
iteration 37 made. M1 is the control for exactly that:

| row | what it does | arms | extra | removed | suite |
|---|---|---|---|---|---|
| COV1 | no-op control; declares the baseline | 0 | 0 | 0 | green, 73 |
| M1 | **deletes the new spec** from the suite | **1** | **+1** | 0 | green, 72 |
| M2 | reverts `byP` to the two-valued form | 0 | 0 | 0 | green, 73 |

M1 hands back exactly one arm — the `-1` arm's own region, named in the reading — with one test fewer and the
suite still green, so the instrument sees this comparator and the spec is what was drawing that region.

---

## 7. The gates

`prettier` and `oxlint` clean, both `tsc` legs clean, the register fence green. The whole-corpus reading is
now **3 arms and 3 statements**, all of them in `fse26-diagnose-analyze.ts` and each with a written reason;
`fse26-separator.ts` reads **zero of both**. The numbers from CI and the golden are read back in
`PROGRESS_2026-10-01.md` §34+.
