# What a `branch` entry IS — and the two fallbacks the correction uncovers

Iteration 38. The subject is the instrument, not the analyzer: for six iterations every arm this campaign
closed was read from one number, and that number's meaning had never been established. It is established here,
by two controlled experiments and by the provider's own source. The correction **retracts this project's most
recent law** — iteration 37's "the reading cannot see inside a comparator" — and it is what makes thirteen of
the seventeen entries left at the end of iteration 37 closable at all. Two of the thirteen are closed by
removing code, and the rest by fixtures whose mechanisms are each shown to be load-bearing by a mutation.

---

## 1. The reading, from the producer

`benchmarks/vitest.config.ts` sets `coverage.provider` to the v8 provider; `@vitest/coverage-v8@3.2.7` converts
V8's own counters with the **classic `v8-to-istanbul`**, bundled into `dist/provider.js` (the separate
`ast-v8-to-istanbul` dependency in the same file is not the converter this project invokes):

```js
const converter = v8ToIstanbul(filename, wrapperLength, sources, undefined, this.options.ignoreEmptyLines);
```

Three lines of that library decide everything this project has been reading:

| where | what it says |
|---|---|
| `applyCoverage` | for EVERY range of EVERY block, `new CovBranch(startLine, startCol, endLine, endCol, range.count)` — **one branch per V8 range, carrying that range's own count** |
| `CovBranch.toIstanbul` | `{ type: 'branch', line, loc, locations: [loc] }` — **ONE location**, which is the range's own span |
| `_branchesToIstanbul` | `b[index] = [ignore ? 1 : branch.count]` — a single-element array, and **`1` is FABRICATED for a range on an ignored line** |

So a `branch` entry in `coverage-final.json` is not a pair of arms. It is **one V8 block range, recorded with
the number of times that block ran**. Nothing in the artifact pairs it with a complementary arm, and
`cov_lines.py`'s word for it — "arm" — is the misnomer that made the misreadings possible. (Two of its own
outputs also differ: the earlier audits read `locations[0]` as "the side of a ternary", which it never was.)

---

## 2. The two experiments

Both live in `.git/probe38/`, outside `benchmarks/`, so they cannot enter the coverage allow-list: they are
questions about the instrument, not modules of the product. Each shape sits in its **own function**, so each
range lands in its own entry, and each is called a **known** number of times.

### A — what the shape of the record is

| function | call | entries produced |
|---|---|---|
| `leftPresent = x => x ?? 0` | left DEFINED (fallback never taken) | whole arrow `count 1`; `x ?? 0;` **count 0** |
| `leftAbsent = x => x ?? 0` | left NULLISH (fallback always taken) | whole arrow `count 1`; **no inner entry at all** |
| `condTrue = x => (x ? 'yes' : 'no')` | consequent taken | whole arrow `count 1`; `'yes' : 'no');` **count 0** |
| `condFalse` (same shape) | alternate taken | whole arrow `count 1`; `x ? 'yes' : ` **count 0** |
| `neverCalled` (same shape) | never called | **no entries at all** |

The asymmetry between the first two rows is the whole finding: the same source shape yields an entry when its
fallback is *skipped* and **none** when its fallback is *taken*.

### B — and the count is a count

Four more functions, each with an arithmetic prediction made before the run:

| function | calls | fallback taken | predicted | measured |
|---|---|---|---|---|
| `mixed` | 3 | 1 | right side `1` | **`x ?? 0;` count 1** |
| `alwaysLeft` | 3 | 0 | `0` | **`x ?? 0;` count 0** |
| `alwaysRight` | 3 | 3 | NO inner entry | **only the whole arrow, count 3** |
| `ifElse` | 3 | else never | `0` | **`'yes';` count 0** |

`mixed` is the row that matters: the count is **1 out of 3 calls**, so it is the number of times *that block*
ran — not a flag, not a "was this expression reached", and not the count of the surrounding function.

---

## 3. The law

> A `branch` entry is ONE V8 block range, recorded when its count differs from the count of the range enclosing
> it; `b[i]` is a single-element array holding that count. The reading is therefore **one-sided**: a `0` states
> that the block **never ran** — and the block covered by a `??` fallback, a ternary arm, or an `if` arm is
> exactly that arm; **absence** states that the block ran **as often as its parent**, i.e. the fallback was
> taken whenever the expression was evaluated. What a `0` does not state is *where in the source the arm ends*:
> the span's START points at it and its `END` can overshoot to the end of the enclosing block.

The mechanism that fits every row above — V8 reporting no range for a block whose count equals its parent's — is
a **hypothesis**, stated as one. The disagreement in §2B is measured; the mechanism is inferred.

### What this retracts

Iteration 37 measured that `familyScreen`'s name tie-break took its `-1` arm **26 times** while
`coverage-final.json` reported **0** for that branch, and concluded that **the reading cannot see inside a
function passed to `sort`** — that a comparator's arms are "FALSE ZEROS". Both numbers were right and the
interpretation was wrong:

- the entry's `0` is the count of the **`1` arm's region**, and the probe logged **26 × `-1`, 0 × `1`** —
  so the reading agrees with the probe exactly;
- that iteration's own control was already the proof: it wrote that the separator's `byP` "returns `1`, and it
  IS counted". Under the corrected law, `byP`'s `-1` was never taken, so its entry is `0` for the same reason —
  and the register's standing example needed no re-reading at all.

Iteration 37's `docs/analyze-comparator-audit.md` §3 and the two laws it wrote into the workspace memory and the
`coverage-honesty` skill are therefore **corrected here**, not deleted: the measurements stand, the inference
does not. The two comparator entries it left are ordinary unexercised arms, and they are closed in §4.

---

## 4. The seventeen entries, re-read

The inventory at the end of iteration 37, each read under this law and given a disposition. Lines are
iteration 37's, since that is the reading this table explains.

| line | the region | what a `0` states | disposition |
|---|---|---|---|
| 1140 | `outcome.breakdown?.deviation ?? 0` | no kept outcome ever carried a composition | **fixture** — the census's own `caseOf` with a kept outcome and no `breakdown` |
| 1156 | `kase.prediction[0] ?? ''` | no artifact ever ranked NOTHING | **fixture** — an artifact with an empty prediction |
| 1157 | `winnerId === '' ? undefined : …` | the same population, the other half | **fixture** (the same spec) |
| 1732 ×2 | `onset.get(winner!) ?? 0`, `onset.get(source) ?? 0` | neither fallback ever fired | **REMOVED** — total by construction (§5) |
| 1922 | `weights.onsetShape ?? SHIPPED_ONSET_SHAPE` | every `formatMissReport` call passed a shape | **fixture** — a call with `temporalWeight` on and no shape |
| 2805, 2806 | `}` `}` in `capBinderOf` | no pair search ever ran dry | **not closed** — see §6 |
| 3469 | `a.id < b.id ? -1 : 1` in `marginOf` | the `1` arm was never taken | **fixture** — the same fixture with the roots the other way round |
| 5074 | `Number.isFinite(value) ? … : 'unbounded'` | no law ever carried a non-finite field | **contract** — recorded, not fixtured (§6) |
| 5076 | `law.range === 1 ? '' : …` | no RANK law was ever solved | **fixture** — the `order` shape, on a case with a rendered tie |
| 5694 | `verdict.gainsFrom ?? 0` | the fallback never fired | **REMOVED** — redundant by construction (§5) |
| 5790 | `a.family < b.family ? -1 : 1` | the `1` arm was never taken | **fixture** — the same two families from the other insertion order |
| 5899 | `row.gained.length > 4 ? ', …' : ''` | no gains list ever exceeded four | **fixture** — the boundary from BOTH sides, 4 and 5 |
| 6718 | `box.extraDigits === 0 ? body : …` | no REFINED box was ever printed | **fixture** — `gainResolution({ extraDigits: 2 })` through the same line |
| 7695 ×2 | the CLI's `isOnsetShape` test and its consequent | `--onset-shape` was passed by NOTHING | **fixture** — a valid name and a typo, in one spec |

Thirteen entries and two source removals leave **three entries and three statements**: the `capBinderOf` tail
and the `at()` contract.

---

## 5. The two removals

Both were `??` fallbacks on values the code had already established, and both are the third answer beside *dead*
and *gap*: **redundant**. A proof cannot be given for `gap` and a fixture cannot be given for `dead`; redundant
is shown by neither, and each of these was settled by a **mutation that survives** — which is also why the
`coverage-honesty` skill keeps that case.

### 5.1 `onset.get(winner!) ?? 0` and `onset.get(source) ?? 0`, in `classifyMiss`

Two lines above them the function's own comment reads *"Both services are known from here on, so every term
below is read from a real row and **no fallback exists that coverage could never reach**"*, and it is right
about the intent and wrong about the code. The law that settles it is written elsewhere in the same file, at the
score map of `buildWeightSeparationCases`:

```ts
// Total by construction — `shippedScores` assigns an entry to every service, and `onsetSlopes`
// to every service — so the lookups assert rather than defaulting to a base or a slope nobody computed.
base: base.get(service.serviceId)!,
slope: slopes.get(service.serviceId)!,
```

`onsetSlopes` (`fse26-term-oracle.ts`) is total over the case's services by its own documentation and by its
loop, `classifyMiss` returns early unless both services are found in `byId` (built from `kase.services`), and so
both fallbacks were unreachable. The instrument agreed before the code did: **both regions counted 0**, while
`latOf`'s own `?? 0` three lines up counted **66** — because `latencySlopes` is *not* total. Two lookups of the
same shape, three lines apart, one live and one dead, and the reading separates them.

Both were replaced by the house's `!`, with the totality cited, exactly as that score map does it.

### 5.2 `at(verdict.gainsFrom ?? 0)`, in `formatCriterionReport`

`criterionVerdicts` has a single `return` building the verdict, and it defines `admissible` **from** the witness:

```ts
const admissible = gainsFrom !== undefined && Number.isFinite(ceiling) && gainsFrom < ceiling;
```

so `verdict.admissible` cannot be true with `gainsFrom` undefined, and the branch guarded by it can only be
entered when the witness exists. The fallback was also the wrong number to have printed: `0` reads as "gains
from zero" — the most permissive answer available for an artifact that gains nothing — and the line above it
already spells that state out (`no GAIN artifact gains …`). Replaced by `!`, with the construction cited.

---

## 6. The three that remain, and why

**`capBinderOf`'s tail (two entries, three statement lines).** The `throw` fires when no pair in a case
reproduces the cap it was called with. Its only caller guards on `capCase === undefined` and passes the case
whose own `componentEndingAtZero` **set** that cap, so the value searched for is one the case's own interval
produced — which is the reason to expect it cannot fire, and **not a proof this iteration produced**. It is
recorded as **unexercised, and deliberately kept**: the alternative is a function that returns a binder which is
not one, and a `throw` on a state the code cannot reach costs nothing and fails loudly if the arithmetic ever
moves. This is the state iteration 35 already established for a throw of the same shape, and the honest label
here is "cannot be drawn by this corpus and cannot be shown impossible by this iteration".

The three statement lines beside it are **not** the throw, and that is measured rather than assumed: sheet two's
M4 replaces the `throw` with a `return` and **nothing moves at all** — the entry count, the statement count and
the whole suite are unchanged. The lines belong to the loop exits on the unreached path, so the tail is invisible
to both runners in both directions: it cannot be drawn, and its removal cannot be seen. A row that had been
silently edited to match would have hidden exactly this, which is why the refuted declaration is kept beside it.

**`at()`'s `'unbounded'` arm (one entry).** `lawDerivationClause`'s local `at` prints `'unbounded'` for a
non-finite field, and the `CellLaw` values its producers make are all finite: `range` is 1 or 2, `quantum` is a
power of ten, `scale` is a span over two. So the in-tree producers **cannot** draw it. It is kept as a
**contract** rather than removed, for a reason the file itself supplies: the *same* helper body sits in
`formatFamilyScreenReport`, where the arm is drawn on every no-gain row (a row with no gain has an unbounded
cap), so the word is live one screen over and printing `Infinity` here instead would make two reports disagree
about what an unbounded cell looks like. No fixture is written for it, because the only way to reach it is to
hand the formatter a law no producer makes — a fixture that would be a statement about a fabricated artifact.

---

## 7. The sheets

**Sheet one — the fixtures' mechanisms (11 rows, 0 mismatches).** Each of the nine new specs has its mechanism
removed and the suite is required to fail; the driver counts the tests each run **executed** and **failed**, and
every restore is hash-verified. The no-op control survives with all **445** tests run.

| row | mechanism removed | verdict | ran | failed |
|---|---|---|---|---|
| C1 | — (control) | SURVIVED | 445 | 0 |
| S1 | the unranked artifact's sentinel replaced by a REAL service name | KILLED | 445 | 1 |
| S2 | the empty-name test inverted | KILLED | 445 | 2 |
| S3 | the kept-outcome deviation defaulted to 1 | KILLED | 445 | 1 |
| S4 | the onset shape the banner names defaulted to another shape | KILLED | 445 | 1 |
| S5 | the rank law's range clause printed on the other side of its test | KILLED | 445 | 3 |
| S6 | the gains list elided at four entries instead of five | KILLED | 445 | 1 |
| S7 | the refinement clause printed for the artifact's OWN box | KILLED | 445 | 1 |
| S8 | a NAMED onset shape discarded in favour of the shipped one | KILLED | 445 | 4 |
| S9 | the root tie-break inverted | KILLED | 445 | 2 |
| S10 | the family tie-break inverted | KILLED | 445 | 3 |

The kill counts are the point of the `failed` column: **one to four tests each**, so every fixture is targeted
rather than incidental — a mutation of something central would take the whole file with it and would tell us
nothing about the spec that claims to hold it.

**Sheet two — the removals and the contract (coverage runner, 5 rows, 0 mismatches).** None of §5 can be seen
from a test, so the runner that can is the coverage reading, and it reads them from four directions at once. Its
baseline is declared by the control and is **4 entries and 13 statement lines** — a different baseline from the
whole-corpus reading in §4, because this runner measures ONE test file, which is why the sheet holds its own
control rather than importing a number.

| row | what it does | extra | removed | statements | suite |
|---|---|---|---|---|---|
| COV1 | no-op control; declares the baseline | 0 | 0 | 13 | green, 445 |
| M1 | puts the two `?? 0` **back** | **+2** | 0 | 13 | green, 445 |
| M2 | **deletes** the `'unbounded'` clause | 0 | **1** | 13 | green, 445 |
| M3 | puts the redundant witness fallback **back** | **+1** | 0 | 13 | green, 445 |
| M4 | replaces the `throw` with a `return` | 0 | 0 | 13 | green, 445 |

M1 is the removal's own measurement: the two entries the source fix took away are exactly the two it hands back.
M3 is the redundancy's: the arm returns, and nothing else in the reading or the suite moves with it. M2 says the
`'unbounded'` clause is a contract in the only way an instrument can — deleting the code takes the entry with
it, so no producer was ever drawing it. M4 says the tail is invisible in both directions, as §6 records.

**M4's declaration was refuted by its own run and is kept that way.** It declared `-3` statements, on the
reasoning that the throw's lines would leave with it; the measurement said **0**, because a statement replaced
by a statement is still a statement and the lines that stay uncovered are the loop exits. The row's `why` now
carries the refuted declaration beside the measured one. A row silently edited to match would have hidden the
finding that those three lines are not the throw's — which is a claim this document makes two sections earlier.

---

## 8. The corpus A/B

The two removals change no value on the shipped corpus, and this is measured rather than argued: the same probe
is run against this tree and against the parent's source, and the two outputs are compared byte for byte.

```
lines=1717   entries=461   diff lines: 0   NUMBERS differing: 0   report lines differing: 0
HASH 2c19a640…  (identical on both sides of the A/B, and identical to iteration 37's own hash)
RESTORE VERIFIED
```

The hash being the same one iteration 37 recorded is the strongest available form of this claim: the analyzer's
entire corpus readout — every printed line and every number in it — is **byte-identical to the previous
iteration's**, on a tree whose source differs from that iteration's. A fallback that could not fire cannot have
fired on the corpus either.

---

## 9. What this changes beyond the thirteen

- **The register's `byP` example** now stands on a corrected law, and on a probe rather than on a reading:
  eight ties, every one the `1` arm, so the `-1` arm is genuinely untaken — which is what that row has claimed
  since it was written. It needed no edit; it needed the instrument to be understood before it could be cited.
- **Iteration 37's `analyze-comparator-audit.md` §3** is corrected in place rather than rewritten: its
  measurements are reproduced here and its inference is retracted.
- **`cov_lines.py`'s vocabulary** is the reason six iterations of readings were read as "arms". The entry is a
  block range with a span; this document calls it that from here on.
- **A mutation driver's own reading can lie too.** This iteration's suite sheet printed `tests=1` for every
  killed row until its parser was fixed: the `Tests` line is `Tests  1 failed | 444 passed (445)` when something
  fails and `Tests  445 passed (445)` when nothing does, so taking the **first** integer reports the FAILED
  count on exactly the rows a mutation sheet cares about. The corrected column reads `ran=445 failed=1..4` on
  every row, which is what makes a kill count evidence rather than arithmetic.

---

## 10. The gates

`prettier` and `oxlint` clean, both `tsc` legs clean, the register fence green, and the whole-corpus coverage
reading **17 entries → 3**, with the project's branches moving `99.80 → 99.84`.

CI on the tip commit: **19 jobs, 18 succeeded and 1 skipped** — `benchmark-diff` carries
`if: github.event_name == 'pull_request'`, so it is skipped by its own gate on every push, and describing this
as "19 of 19" would count a job that never ran. **56 dimensions, every one at or above 95**, worst 95.00
(`wave` branches); `benchmark-tests` at **99.95 / 99.84 / 100 / 99.95** with this file reading
**99.9 / 99.76 / 100 / 99.9 | 2816-2818**, identical to the local reading down to the three statement lines.

The golden run dispatched by the source commit is identical to iteration 37's **line for line** — not only the
nine cells (RE1 80.0 / 92.8 / 68.0 · RE2 82.4 / 88.9 / 68.1 · RE3 80.0 / 45.0 / 51.1) but every line of every
panel, which are the per-fault-type tables F1–F5 per system. The criterion's **second half is not measured by
this push**: `fse26-benchmark.yml` is `workflow_dispatch:`-only, so no commit dispatches it, and what holds
that half is the A/B's byte-identical analyzer output. It is recorded as dispatchable but not dispatched
rather than inherited from the previous iteration's number.

**One reading in this iteration's logs is a statement about the harness rather than about the code**, and it is
recorded because it would otherwise be read as a failure: the local coverage run exits **1** on this machine.
The tests pass (928 of 928) and the report is written in full; the non-zero code comes from vitest's own
`cleanAfterRun`, where the sandbox's safe-delete shim refuses to remove `benchmarks/coverage/.tmp` in bulk
(71 entries against a threshold of 50) and vitest surfaces the refusal as an unhandled error. It is an artifact
of this environment and not of CI, whose coverage jobs are green — and the same `EXIT=1` stands in every local
coverage log since iteration 35, which is exactly why it needed naming rather than repeating.
