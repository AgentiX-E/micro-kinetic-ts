# A guard one line above, and a reducer that needs a second element

Iteration 34. `docs/analyze-dead-branches-audit.md` §9 left **36 arms and 4 statements** in
`fse26-diagnose-analyze.ts` and named three of their clusters with a reading. This iteration closes **six of
the arms and one statement**, and the first thing it has to correct is that reading: the arm §9 put first —
the one it called a GAP — is **dead**, and the reason §9 gave for calling it a gap was a call site read from
the CALL rather than from the control flow around it.

```
before  36 arms over 36 entries, 4 statements
after   30 arms over 30 entries, 3 statements   (2790, 2791, 2792)
```

## 1. The reading, and the six arms

`.git/cov_lines.py` on `coverage-final.json`, on the parent (`f98c7e9`) and on this tree:

| the arm | what closed it | instrument |
| --- | --- | --- |
| `(binder === undefined ? '' : …)` | the binder is present whenever the clause is called — a property of the CONSTRUCTION, and all three call sites require `cases > 0` | **a PROOF** (§3) |
| `binder !== undefined && u.lossFloor < cap` | the same proof, on the comparison beside it | **a PROOF** |
| `reconciled.net >= 0 ? '+' : ''` | a fixture whose net is NEGATIVE — a screen that costs more than it fixes | **a FIXTURE** (§4) |
| `(best, one) => … one.losesFrom < best.losesFrom …` ×2 | a fixture with **three** protected artifacts, so the fold compares more than once | **a FIXTURE** (§4) |
| `(best, one) => … one.permittedFrom < best.permittedFrom …` ×2 | the same fixture, and the two reducers disagree about which artifact wins | **a FIXTURE** (§4) |

The file moves from **99.87 / 97.20 / 100 / 99.87** to **99.9 / 97.67 / 100 / 99.9**.

## 2. The arm the record called a GAP, and the guard on the line above

§9 of the previous audit said, of `(binder === undefined …)`:

> It is a GAP, not a dead arm, and the reason is a caller. … `capUpperBoundClause` has **three** callers, of
> which two guard with `if (u.cases > 0)` and the third (`formatCriterionReport`, 5280 in the parent's
> numbering) does not. So the `''` arm is reachable exactly at the unguarded site, with an EMPTY class, and
> the sentence it would render is `0 of 0 satisfied cases …`.

**All three call sites require `cases > 0`, and the third one's guard is on the line ABOVE the call:**

```ts
    if (s.gain === 0 && s.at === undefined && s.window.capUnrepresentable.cases > 0) {   // ← 5308
      lines.push(
        `    cap UPPER bound: ${capUpperBoundClause(s.window.capUnrepresentable, s.window.cap)}`,   // ← 5310
      );
    }
```

The other two are `if (u.cases > 0) lines.push(…)` (4548, 5217). So the arm is unreachable for the reason
§9 was looking for and did not find: **a guard written beside a call instead of inside its argument list is
still a guard**, and a claim about a call site has to be read from the enclosing block. That is the same
shape as this register's "a declaration is a claim only if something connects it to what it names" — the
connection here was one line up, and the record read only the line it was about.

**And §9's inventory has a second defect, of a different kind: it counts 36 and lists 35.** Its block omits
`1882 reconciled.net >= 0 ? '+' : ''` — the arm its own third bullet discusses. The arithmetic that exposes
it is the one this iteration's reading supplies: 36 (claimed) − 6 (closed) = 30 ✓, while 35 − 5 = 30 would
mean the sign's fixture closed nothing. **A count that disagrees with the list beneath it is a claim about
the list, and here it hid which arm the next iteration should start from.** Both defects are corrected in that
document, in place.

## 3. The construction, link by link

The `!` rests on an implication, so the implication is written out here rather than asserted:

```
cases > 0  ⟹  lossFloorBinder !== undefined
```

1. **The count and the binder are written in the same loop, under the same predicate.**
   `capUnrepresentable.cases` is `unrepresentable.length`, and the members are pushed under
   `pairs.length > 0` (line 3014). The binder is assigned inside `for (const pair of pairs)` (3018–3023) — the
   same iteration that produced the pairs. So a non-empty class means that loop body ran at least once.
2. **The first pair always assigns.** The guard is `if (floor < lossFloor)` with `lossFloor` initialised to
   `Number.POSITIVE_INFINITY`, so the FIRST pair assigns whatever it is — provided `floor = lead / span` is
   finite. It is: `renderedTiePairs` skips a pair the root does not LEAD (`if (other.base >= target.base)
   continue`, so `lead > 0`) and a pair whose cell is zero-width (`if (span === 0) continue`), and `span`
   comes from `cellSpanWidth` → `shapeStep`, which is a ratio of the law's own finite range — with
   `weighed.size ≥ 2` guaranteed by that function's own early return, so the ratio's denominator is at least
   one.
3. **Every caller requires a non-empty class** — two in the call expression, one in the enclosing `if` (§2).

**What is NOT claimed**: the optionality of `UnrepresentableFrontier.lossFloorBinder` is real — the builder
emits a frontier with no binder whenever the class IS empty, and the spread at line 3054 says so — so the
type does not encode the implication and this file does not pretend it does. The three links above are the
connection, and the spec below is what holds them.

**The spec that holds it** asserts the implication over a POPULATION of shapes, with a non-vacuity assertion
first, so it cannot pass on a population whose classes are all empty — which is exactly how a dead fallback
hides. It also asserts, per member, that the binder belongs to the class it qualifies (`one.datapacks`
contains `binder.datapack`) and that the printed floor IS the binder's own (`one.lossFloor === binder.floor`).
Mutation `S4` — the binder's assignment removed, leaving the class non-empty with no binder — is killed by
that spec and by sixteen neighbouring ones.

## 4. Two fixtures, and what each one is about

**A screen that costs more than it fixes.** `reconciled.net >= 0 ? '+' : ''` is the same sign shape iteration
32 removed as DEAD from the discriminator, and §9 was right to refuse to remove this one: `net = modelled −
recorded` can be negative. Every reading the suite built ran at a weight the dump's own ranking agrees with,
so the net was never negative and the sign was never drawn. The fixture is a case whose recorded rank-1 is its
OWN pool-dominant root: the penalty demotes that root, nothing is fixed, one case is broken, and the report
reads `net -1`. The spec asserts the split (`fixed 0`, `broken 1`, `net < 0`) BEFORE it asserts the sentence,
so it cannot pass on a fixture that merely happens to be negative.

**Three protected artifacts, because a fold does not run on one element.** The two reducers are
`reduce<…>(callback, undefined)` over the protected side. **With ONE artifact the callback runs once with
`best === undefined`, the `||` short-circuits, and the comparison's two arms are never evaluated** — which is
why the reading showed two arms per reducer rather than one. Three put both sides of each comparison on the
path, and the fixture makes the two reducers disagree about the winner, so each answer is a choice rather
than agreement with whichever artifact came first:

| artifact | `losesFrom` | `permittedFrom` |
| --- | --- | --- |
| `b` | 0.02 | 0.006 |
| `c` | 0.03 | **0.004** |
| `d` | **0.01** | 0.008 |

`losesFrom` ends on `d` (0.01, the EARLIEST predicted loss — the pessimistic end) while `permittedFrom` ends
on `c` (0.004, permitted EARLIER than `d` despite coming before it), and the ceiling is the pessimistic of the
two, so the permission governs and names `c`.

## 5. The mutation passes — 5 suite rows and 2 coverage rows, 3 controls, 0 mismatches

**Runner one: `vitest`, on the analyzer's own suite.** Every row declares its verdict before it runs, every
mutated file is restored and hash-verified, and a run that executed nothing would be neither a kill nor a
survivor.

| row | mutates | declared | verdict | tests executed |
| --- | --- | --- | --- | --- |
| `C1` | the file rewritten verbatim | SURVIVED | **SURVIVED** | 426 |
| `S1` | the reconciliation's sign made unconditional | KILLED | **KILLED** | 1 |
| `S2` | the loss reducer keeps the LARGEST bound | KILLED | **KILLED** | 1 |
| `S3` | the permission reducer inverted | KILLED | **KILLED** | 1 |
| `S4` | the binder's assignment removed | KILLED | **KILLED** | 17 |

**Runner two: the coverage reading**, for the claims about REACH, which no suite can hold — re-introducing a
removed fallback changes no output. Declared in advance, with its own control, and stated as a DIFFERENCE
against that control because the control's own baseline is a fact about the population this runner draws:

```
```
COV1 OK  arms=31 baseline=31 extra=0 exp=0 - tests= 426 suite_green=True  78s restore=ok
M5   OK  arms=32 baseline=31 extra=1 exp=1 | (binder === undefined tests= 426 suite_green=True  70s restore=ok
```

That control's expected count is **31**, and it is not the full suite's 30 for a reason worth keeping: this
runner is the analyzer's OWN suite, and the arms are counted as a **multiset of arm TEXTS** — two arms can sit
on one line (`1732` carries two), so a set of LINE NUMBERS reads 29 where the multiset reads 31. Iteration 33's
sheet learned that the hard way from the other side: it compared line numbers, so a mutation that **adds a
line** shifted every arm below it and the shift read as thirty new arms. **The baseline is held by text for the
same reason the row is asserted by text: a line number is a position, and a mutation moves positions.**

**And the first run of THIS sheet made the same mistake in its own way**, which is worth recording because the
defect was in the instrument rather than in the subject: the multiset was right, but the phrase asserted on the
extra arm was `binder.datapack` — a string on the fallback's SECOND line, not on the arm's own (`(binder ===
undefined`). The row reported `extra=1` and still failed, which is exactly what a location check is for: a count
alone would have passed.
```

## 6. Does anything a reader sees move? The corpus A/B

The change is inside three renderers and one fold, so "no published number moves" has to be a reading of the
text AND of the numbers behind it. `.git/probe_analyze_reports_34.ts` renders, for every dump the cache
holds: the miss report at two weights (the sign), the onset/cv/family screens at three named weights and both
shapes (the binder clause, printed by `formatCvScreenReport`), and the criterion report over FOUR artifacts of
which THREE are `protect` — built from the corpus's own menus, so the reducers compare real boundaries rather
than a hand-built array. `.git/probe_ab_34.sh` runs it under this tree and under the parent (`f98c7e9`) with a
`trap` and a hash-verified restore:

```
```
lines=461  (1717 physical)   diff lines: 0   NUMBERS lines differing: 0   report lines differing: 0   RESTORE VERIFIED
```

**What that reading does and does not cover, since a diff of zero is only as strong as what was rendered.** The
criterion section names `protectCount=6` — three `protect` artifacts over two shapes — so both reducers compare
more than once on the corpus's OWN boundaries (the table it prints runs from `re1` as `gain` through
`re1-noinject`, `re2` and `re3` as `protect`). The miss reports are rendered at two weights per dump. **The one
half the corpus does NOT draw is the negative net**: every line reads `net +0`, because no weight in this cache
breaks a case the recorded ranking got right — so the sign's `''` arm is the FIXTURE's claim, held by the spec
and by mutation `S1`, and the A/B's contribution to it is the `'+'` half only.
```

## 7. What is left

**30 arms over 30 entries and 3 statements** (`2790–2792`), all named in `.git/cov_lines.py`'s output and
grouped in the previous audit's §9. Three clusters now have a second reading attached, from this iteration's
own work:

- **`reconciled.net >= 0 ? '+' : ''` is CLOSED** and was never dead — the lesson is that "the suite never drew
  the sign" and "the sign cannot be drawn" are different claims, and the second one needs the construction.
- **The `? -1 : 1` tie-breaks (3443, 3542, 5758) and the reducers' `best === undefined` siblings are the same
  two families this iteration met**: a fold that needs a second element, and a comparator whose arms are
  decided by the ORDER a sort asks its questions in. `byP`'s `? -1` in the separator (100 / 99.65) is the
  register's standing example of the second.
- **The guards on a missing input are the largest remaining cluster**, and iteration 33's mistake applies to them
  twice over: for each one the question is not "can the input be absent" but "does every CALLER already exclude it" —
  and that question is answered by the enclosing block, not by the call. **Iteration 35 answered it for eight of the
  thirteen and found a THIRD answer beside "the caller excludes it" and "nobody does": the guard beside it may
  exclude the same population** (`docs/analyze-guard-reach-audit.md` §3). Six remain.

## 8. Gates

| | |
| --- | --- |
| the changed suite | **426 tests** green (`fse26-diagnose-analyze`, 423 → 426) |
| `fse26-diagnose-analyze.ts` | **99.9 / 97.67 / 100 / 99.9** — **30** arms (was 36) and **3** statements (was 4) |
| the benchmarks project | **909 tests / 23 files**, coverage **99.95 / 98.78 / 100 / 99.95** |
| `tsc` both legs · oxlint · prettier | clean · 0 warnings 0 errors · the changed files conform |
| the register's own fence | **14 / 14** green with the corrected row and the new one |
| golden | **OWED** — `benchmarks/src/**` is a `push` trigger, and §6 is why the 9 cells are expected byte-identical |
