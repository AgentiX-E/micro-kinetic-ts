# The verdict vocabulary of a screen

`docs/dump-population-audit.md` is about **which cases a reader kept**. This document is about a different
object: **the word a screen prints when it cannot act at all**, which is what tells a reader where to go next.
The two words are `INERT` and `UNEVALUABLE`, and this record already gives them separate meanings —
`INERT` = the term cannot reorder what the artifact RECORDS; `UNEVALUABLE` = the artifact lacks the input.
They are two pieces of work: a different AXIS, or a different ARTIFACT.

The subject is therefore not a number. It is a **claim's subject**, and it is checked the way every other claim
in this record is: against something that was not written by the same hand, on an instrument that can fail.

## 1. The defect: a rule declared in prose, and two arms that contradicted it

`onsetInertSentence`'s own doc comment states the rule:

> `INERT` when the term cannot reorder what the artifact RECORDS — a result about the axis — and `UNEVALUABLE`
> when the artifact does not carry the input at all, which invites a different ARTIFACT rather than a
> conclusion about the engine. Two pieces of work, so two words.

Its four arms were:

| cause | the arm's own text | word printed | what the absence is about |
| --- | --- | --- | --- |
| `no-cases` | "it names no case with an acceptable root" | `UNEVALUABLE` | the population |
| `no-anchor` | "no case carries an injection anchor" | **`INERT`** | **the input — the anchor** |
| `no-onset` | "all N anchored cases hold no service carrying an onset delay" | **`INERT`** | **the input — the onset** |
| `no-order` | "onsets ARE recorded (N of M services) and the engine's own earliness map is empty" | `INERT` | the order |

**Two of the four report a missing INPUT as `INERT`.** The sentences say so themselves — *"no case carries an
injection anchor"* is a statement about what the artifact does not hold — and the arm that IS about the
population gets it right, so the contradiction is inside one function.

### And the sibling screen proved the intent

`cvInertSentence`, written three iterations earlier about a different term, applies the rule in all three of its
arms: `no-cases` → `UNEVALUABLE`, `no-composition` → `UNEVALUABLE` (*"a dump whose producer emitted
`metricDecisive` is needed"*), `no-spread` → `INERT`. Its doc comment describes the same measurement the
temporal screen's does. **So the correct reading is not a matter of opinion: the codebase's other half already
took it.**

## 2. The measurement: 13 of 19, and the two screens disagreeing about one artifact

Every local artifact, run through `--onset-screen` at the shipped weight, with the census's own reach for the
two channels the temporal term reads:

| | artifacts | emit a verdict | the verdict | census `inject-time` | census `onset` |
| --- | --- | --- | --- | --- | --- |
| with cases | **19** | **13** | **all 13 `INERT`** | | |
| …of which carry NO anchor | 12 | 12 | `INERT` | **`none`** | **`none`** |
| …of which carry a zero anchor | 1 | 1 | `INERT` | `every` | `every` |
| print a window instead | 6 | — | — | `every` | `every` |

The thirteen: `diag-34482091814`, `diag-34484932735`, `diag-34678188226`, `diag-34678189964`,
`diag-34679583391`, `diag-34684319273`, `diag-34693527122`, `diag-34694846718`, `diag-34742498321`,
`r34919714864`, `r34928980425`, `r34949854236`, and `re3-novelty.txt`.

**On twelve of the thirteen the artifact carries no `inject=` and no `onset=` at all**, so the reader is told
the temporal axis is inert — a result about the engine — when what the artifact supports is that the question
cannot be asked. And the census reported it on the same bytes, in the same repository, with **no caller**:

```
$ python -c "…dc.capability_of(open('artifacts/diag-34684319273/fse26-results.txt').read())"
  onset=none   inject-time=none   decisive-composition=none
```

**And on the same artifact the stability screen said the other word.** Before the fix:

```
$ … --dump artifacts/diag-34684319273/fse26-results.txt --onset-screen --log-weight 1
  the term is INERT on this dump: no case carries an injection anchor, so the engine was given
  no time to order — an artefact of the CONFIGURATION, not a finding about the engine.

$ … --dump artifacts/diag-34684319273/fse26-results.txt --cv-screen --log-weight 1
  the term is UNEVALUABLE on this dump: its blocks record a decisive composition for NONE of
  their 18820 services (0 of 18820) …
```

**One artifact, two screens, two words, one absence.** That is the measurement this document rests on, and it
is why the rule can no longer live in prose: a rule that lives in two places can disagree with itself, and it
did.

### The thirteenth is a different fact, and it is why the arms must name their counts

`re3-novelty.txt` renders **`inject=0` on every one of its rows** — the census reads `inject-time every` — and
the reader still finds no usable anchor, because `withAnchor` counts anchors that are **positive**. So the
artifact DOES carry the field and the assembled artifact does not carry the input.

The arm said *"an artefact of the CONFIGURATION"* about both this artifact and the twelve that render no field
at all. That is a **cause the artifact does not establish**: for `inject=0` the configuration is a plausible
explanation, for the twelve it is not even a candidate. The corrected clauses name the counts and the field and
attribute nothing.

## 3. The second defect: a name its own function did not establish

`onsetInertCause` returned `no-order` as its **default**, and the caller separately tested `withEarliness === 0`
before printing the sentence. Two files, one verdict:

| | lives in | establishes |
| --- | --- | --- |
| *is this a verdict at all?* | the **caller** | `a.withEarliness === 0` |
| *which verdict is it?* | the **function** | the four-way chain |

So the function answered `no-order` for any artifact whose earliness map is **non-empty** — the name's own
sentence ("the earliness map is empty for every case") was false of what the function had just been asked
about. Measured on six local artifacts, every one reporting `withEarliness` equal to its case count:

| artifact | cases | `withEarliness` | `no-order` claimed? | sentence printed? |
| --- | --- | --- | --- | --- |
| `re1.txt` | 375 | 375 | yes | no — the caller's gate |
| `re2.txt` | 150 | 150 | yes | no |
| `re3.txt` | 90 | 90 | yes | no |
| `r35006947938` | 1422 | 1422 | yes | no |
| `r35029055764` | 1422 | 1422 | yes | no |
| `r35107871516` | 1422 | 1422 | yes | no |

**A name its own function does not establish is not a name** — and the gate that hid it was the only thing
keeping the sentence off the screen, so the pair was correct by coordination rather than by construction.

## 4. The fix: the word is DERIVED from what the absence is about

```
ScreenAbsence   = 'population' | 'input' | 'order'
VERDICT_OF_ABSENCE[population] = UNEVALUABLE     ← one place, for every screen
VERDICT_OF_ABSENCE[input]      = UNEVALUABLE
VERDICT_OF_ABSENCE[order]      = INERT

ONSET_ABSENCE:   no-cases → population · no-anchor → input · no-onset → input · no-order → order
CV_ABSENCE:      no-cases → population · no-composition → input · no-spread → order

onsetVerdict(cause) = VERDICT_OF_ABSENCE[ONSET_ABSENCE[cause]]
cvVerdict(cause)    = VERDICT_OF_ABSENCE[CV_ABSENCE[cause]]
```

- **A new cause must declare its COLUMN** and cannot choose a word by eye — the same rule iteration 22 applied
  to a channel's value placement, one level up.
- **The word is written once per module**, in the table. The sentences are `` `  the term is ${onsetVerdict(cause)} on this dump: ` `` plus a clause, so **an arm cannot spell the word differently** — and the assertion that the table reaches the TEXT is what the defect would have failed in exactly the two arms that were wrong.
- **`onsetInertCause` and `cvInertCause` now return `undefined`** when the term CAN act, and the four call
  sites became `if (…InertCause(a) !== undefined)` — so the condition and the name have **one owner**. The
  `withEarliness > 0` arm is what makes `no-order` its own precondition.
- **The clauses name their counts and the producer field, and attribute no cause**: `no-anchor` says
  *"no case of its 369 carries a usable anchor … a dump whose run emitted a POSITIVE `inject=` is needed"*, and
  `no-onset` names `onset=`. `no-order` and `no-spread` keep `INERT`, so **this is not a blanket relabelling**:
  two of the seven words in the two tables are results about the axis, and they stay that way.

## 5. Why it survived three iterations: the defect was asserted in five tests

Correcting the two arms failed **exactly five tests, and every one of them asserted the wrong word**. Two had
the defect in their **name**:

| test | what it asserted |
| --- | --- |
| `screens a dump with no anchor as inert rather than as a zero gain` | `expect(report).toContain('INERT')` |
| `reports the menu as INERT, once, when the dump carries no order` | `toHaveLength(1)` on `INERT` |
| `reports the onset share as n/a rather than as a division by zero` | `toContain('INERT')`, twice |
| `survives a dump where the term is INERT, which is the menu's other early exit` | `toContain('the term is INERT')` |
| `does NOT blame the engine for a gap in the data` | `toContain('INERT')` on the no-anchor half |

**A suite that asserts a defect is a suite that certifies it.** Five green tests are five independent reasons
not to look, and the two whose names carried the claim made it read as intent.

## 6. The new edge: the ADVICE names a field, and the field is the census's

The corrected clauses tell a reader which field to find — `` `inject=` ``, `` `onset=` ``, `` `metricDecisive` ``.
That is a claim about the **producer's grammar**, so it is now held against the census's own key column, in the
TypeScript fence that already reads the projection:

| edge | subject | how it is held |
| --- | --- | --- |
| A | the census's key column ↔ the keys the **producer** emits | the producer builds a block; every declared key appears and every emitted key is declared, per scope (iteration 20) |
| B | the census's table ↔ the **reader's** typed field map | both directions against `Object.keys(SERVICE_FIELD_AUDIT)` (iteration 20) |
| C | the census's valuation ↔ the **reader's own parse** | the projection carries the census's `pattern`/`valueIn`/`absent`; the two sides apply the SAME regex (iteration 22) |
| **D** | **a screen's ADVICE ↔ the census's key for the channel it advises about** | **the projection's `key` is read, and the sentence must contain it in the producer's own spelling** |

**And the separator is derived from the channel's SCOPE**, because it is part of the spelling: a header or row
channel is `key=value` and a sub-line is `key(N): body`, whose marker carries no `=` at all. Asserting
`` `metricDecisive=` `` would be asserting a line the producer never writes — a first version of this fence did
exactly that, and the scope column is what caught it.

## 7. Defects in this iteration's own work

1. **A probe of mine called the sentence unconditionally** and reported `no-order` for six artifacts whose
   screen prints a window. It was not a defect in the module — the caller's gate suppressed the sentence — and
   the reading was mine. Re-measured over the artifacts where a verdict is **emitted**, it became §2's table.
2. **An assertion recomputed the function it checked**:
   `expect(onsetVerdict(cause)).toBe(VERDICT_OF_ABSENCE[ONSET_ABSENCE[cause]])` is a second spelling of
   `onsetVerdict`, so it passes for any table consistent with itself. Replaced by **literals in the test**, and
   the mutation pass is what made it visible: regressing `input → INERT` did **not** kill that assertion.
3. **The cross-screen assertion tested AGREEMENT and not the word** — `onsetVerdict('no-anchor') ===
   cvVerdict('no-composition')` is satisfied by two screens that are *both* wrong, which is what the regressed
   table produced. The word is now asserted first and the agreement second.
4. **The fence's own first version asserted `` `metricDecisive=` ``**, a line the producer does not write.

## 8. Gates

| | |
| --- | --- |
| python gate | **473 tests · 1628 statements · 584 branches · 100.00%**, every module 100% — **unmoved**, because this iteration touched no python |
| `benchmarks` project | **831 tests / 23 files** (823 before: the derivation block's 8 tests), coverage **99.84 / 97.49 / 100 / 99.84** locally — branches **up** from `97.48` |
| `packages/kinetic` | **959 tests / 36 files**, unchanged |
| both typechecks | 15 projects clean + `tsconfig.workspace.json` clean |
| lint / format | 0 warnings, 0 errors on 340 files; the touched files formatted |
| mutations | **17 rows, every one as declared**; both controls (`py`, `ts`) SURVIVED; tree hash-verified byte-identical |
| probes | three, each restored: the table regressed → **8** tests fail; the body spelling the word → **7**; the chain losing its `withEarliness` arm → **10** |
| golden | **OWED** — `benchmarks/src/**` is a trigger, and "the reader is offline" is a claim to measure |

The corpus is unchanged for every row where a verdict is **emitted** except the word itself: the same 13
artifacts emit one, the same 6 print windows, and no window, count or ordering moved.

## 9. The named follow-up this iteration did not do

`require_channel` — the census's own refusal, *"Refuse a read the artifact cannot serve, before any number is
attributed to it"* — **is invoked by nothing**. Every call in the repository is inside its own test module:

```
$ grep -rn 'require_channel\|CapabilityError' --include='*.py' --include='*.ts' . | grep -v node_modules
./scripts/dump_capability.py:530:class CapabilityError(RuntimeError):
./scripts/dump_capability.py:930:def require_channel(
./scripts/dump_capability.py:951:    @raises CapabilityError: If the channel reaches less far than required.
./scripts/dump_capability.py:962:    raise CapabilityError(
./scripts/test_dump_capability.py:803:        with self.assertRaises(dc.CapabilityError) as caught:
./scripts/test_dump_capability.py:804:            dc.require_channel(
…                    (9 more, every one in the same test module)
```

and the only other mention of the name anywhere is the sentence that presents it as the module's guarantee:

```
$ grep -n 'require_channel' docs/artifact-capability-audit.md
35:the reading the module exists to stop. `require_channel` refuses a read before any number is attributed to it
```

**So the instrument that exists for exactly this defect has never had a caller**, and the register's index row
for that audit advertises the refusal as a property of the census. Three iterations of this record said a reader
must *"name the channels it reads and the reach it needs"* — and the one function that would enforce it is dead
code with a test.

## 8b. The same gates, read from CI and from the benchmark run's own cells

| | |
| --- | --- |
| CI `12d92f4` | **19 of 19 jobs green**, `Release` green |
| 56 dimensions | 14 coverage jobs × 4 — **worst `95.00`** (`wave` branches) over **4,042 tests**, and **every percentage unchanged** from the reading before the iteration. `benchmark-tests` reads `99.84 / 97.49 / 100 / 99.84` with **831** tests |
| golden 9 cells | **byte-identical**, from each job's own table: RE1 `80.0 / 92.8 / 68.0`, RE2 `82.4 / 88.9 / 68.1`, RE3 `80.0 / 45.0 / 51.1` (OB / SS / TT) |
| FSE'26 half | **not dispatchable** — `fse26-benchmark.yml` declares no `push` trigger, and nothing this iteration changed is read by the FSE'26 measurement (its producer is `packages/kinetic/src/benchmarks/**` and the five knobs are untouched) |

**A verdict is not a cell, so the golden is the right half to demand here**: the change moves no score, and the
nine cells being byte-identical is what says so rather than the change's own reasoning. The coverage table is
the other reading worth taking: **a branch was added and no dimension moved**, and `benchmark-tests`' COUNT moved
by exactly the eight tests this iteration added.
