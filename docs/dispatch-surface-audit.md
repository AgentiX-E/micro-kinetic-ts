# The dispatch surface: every ranking knob, its three names, and its owner

**Status:** instrument shipped and gated (`packages/kinetic/__tests__/unit/dispatch-surface-census.test.ts`,
10 tests, 13 mutations all killed), and the structural gap it found is **closed**: the four knobs both runners
accept were dispatchable on the FSE'26 half alone, so the kill criterion was decidable for exactly ONE knob;
`benchmark-rcaeval.yml` now exposes all six, and every input is threaded into all seven invocations
(`benchmarks/__tests__/benchmark-rcaeval-trigger.test.ts`).

It found four things, one of which was produced **while writing it**: a careful hand search of the register and
every document concluded that two knobs were never measured, and a candidate was drafted around one of them.
Both had been measured and rejected. The error was in the join between three names, and nothing owned that
join.

## The three names

A ranking knob has three names, and only two of them are related by a rule:

```
workflow input      fleet_baseline                    <- what a dispatcher types
CLI flag            --fleet-baseline                 <- input.replaceAll('_', '-')
engine option       metricFleetBaseline              <- NOT derivable
```

The documents and the run's own config line use the **third**. `fse26-metric-competition-verdict.md` measures
`metricFleetBaseline=true` at **+0.49pp with six regressed fault types** and rejects it; a search for
`fleet_baseline` finds zero mentions in `docs/`, and so does a search for `--fleet-baseline`. Four knobs are
non-derivable, by three different mechanisms — and only the first two of them were found by hand:

| mechanism | flag | option |
| --- | --- | --- |
| a `metric` prefix | `--fleet-baseline` | `metricFleetBaseline` |
| a `metric` prefix | `--rise-ceiling` | `metricRiseCeiling` |
| an abbreviation | `--pool-penalty` | `poolMetricPenaltyWeight` |
| a NEGATED pole | `--no-rank-normalization` | `rankNormalization` |

The census found the last two. The hand reading had stopped after the prefix pair.

## The population, by the option name the documents use

`fse26` / `rcaeval` name the workflow input that exposes the knob; `—` means that benchmark **cannot dispatch
it at all**, which is a fact about the kill criterion rather than bookkeeping.

| knob (engine option) | flag | fse26 | rcaeval | owner |
| --- | --- | --- | --- | --- |
| `logWeight` | `--log-weight` | `log_weight` | `log_weight` | `fse26-shipped-config-verdict.md` |
| `logMode` | `--log-mode` | `log_mode` | — | `fse26-metric-gap-verdict.md` |
| `logSignalMode` | `--log-signal-mode` | — | — | `fse26-result-attribution.md` |
| `rankNormalization` | `--no-rank-normalization` | `no_rank_normalization` | `no_rank_normalization` | `fse26-shipped-config-verdict.md` |
| `metricRiseCeiling` | `--rise-ceiling` | `rise_ceiling` | — | `fse26-metric-competition-verdict.md` |
| `metricFleetBaseline` | `--fleet-baseline` | `fleet_baseline` | — | `fse26-metric-competition-verdict.md` |
| `failedEdgeWeight` | `--failed-edge-weight` | `failed_edge_weight` | — | `fse26-failed-edge-verdict.md` |
| `failedEdgeMode` | `--failed-edge-mode` | `failed_edge_mode` | — | `fse26-failed-edge-verdict.md` |
| `failedEdgeMinRecords` | `--failed-edge-min-records` | `failed_edge_min_records` | — | `fse26-failed-edge-verdict.md` |
| `latWeight` | `--lat-weight` | `lat_weight` | — | `fse26-latency-term-verdict.md` |
| `latMinRise` | `--lat-min-rise` | `lat_min_rise` | — | `fse26-latency-term-verdict.md` |
| `poolMetricPenaltyWeight` | `--pool-penalty` | `pool_penalty` | — | `fse26-pool-penalty-verdict.md` |
| `stabilityWeight` | `--stability-weight` | `stability_weight` | `stability_weight` | `fse26-cv-screen.md` |
| `temporalWeight` | `--temporal-weight` | `temporal_weight` | `temporal_weight` | `fse26-onset-verdict.md` |
| `onsetShape` | `--onset-shape` | `onset_shape` | `onset_shape` | `fse26-onset-verdict.md` |
| `collisionWeight` | `--collision-weight` | — | — | `re3-fault-ceiling.md` |
| `topoWeight` | `--topo-weight` | — | — | `fse26-metric-competition-verdict.md` |
| `traceWeight` | `--trace-weight` | — | — | `rank-collapse-falsified.md` |
| `prismWeight` | `--prism-weight` | — | — | `fusion-routing-verdict.md` |
| `prismPooling` | `--prism-pooling` | — | — | `prism-pooling-axis.md` |
| `suppressIdleTransients` | `--suppress-idle-transients` | — | — | `near-zero-rise-suppression-falsified.md` |
| `suppressNearZeroBaselineRise` | `--suppress-near-zero-baseline-rise` | — | — | `near-zero-rise-suppression-falsified.md` |
| `collapseDiscount` | `--collapse-discount` | — | — | **a code comment only** |
| `fusionCeiling` | `--fusion-ceiling` | — | — | **not a ranking knob** |

24 knobs, 27 flags (three switches have two poles, and the RCAEval runner exposes both while the FSE'26 parser
exposes one). 14 ranking flags are accepted by the FSE'26 CLI (`benchmarks/src/fse26-cli.ts`) and 18 by the RCAEval
parser (`benchmarks/src/rcaeval-cli.ts`, extracted from `run-rcaeval.ts` so a test can drive it — see
`docs/cli-argument-rejection-audit.md`). **Six knobs are dispatchable on BOTH benchmarks**, which is the set on
which the kill criterion is decidable at all: `logWeight`, `logSignalMode`, `onsetShape`, `rankNormalization`,
`stabilityWeight`, `temporalWeight`. (The sixth is counted as an AXIS rather than as a row: the FSE'26 parser
spells it `--log-mode` and the RCAEval one `--log-signal-mode`, and both reach the engine's single
`logSignalMode` field — a row-wise intersection reported the axis as undispatchable for two iterations.)

`prismPooling` is the newest row and the reason the population is not merely inherited: the knob it names was
implemented in `combinePrismScore` and selectable by the standalone evaluator, while **no engine configuration
could select it at all** — the engine's single call site omitted the argument. An option the runner accepts and
the engine cannot act on is the same shape as an option the workflow cannot reach, and `--prism-pooling` is
recorded in the undispatchable set for the same reason. See `docs/prism-pooling-axis.md`.

## Finding 1 — no ranking knob is merely unmeasured, and that claim needed the right key

Keyed by the option name, **every ranking knob has a document**, and the guard asserts that the sentinel set is
exactly two: `collapseDiscount` (comment-only) and `fusionCeiling` (not a knob). The same population keyed by
the input name would report four knobs as unmeasured — `fleet_baseline`, `rise_ceiling`, `pool_penalty`,
`no_rank_normalization` — of which three are measured with verdicts and the fourth (`poolMetricPenaltyWeight`)
ships.

**The hand search that got this wrong is the evidence, not an aside.** It read the register, the workflow
descriptions and every document, concluded that `fleet_baseline` and `rise_ceiling` were unmeasured, and
drafted a candidate on the stronger of the two. The register could not have prevented it: its rows are written
in the resolution's vocabulary (`deviation`, `pool`, `earliness`), and a knob's option name is not in them.

## Finding 2 — the golden half was dispatchable for ONE ranking flag out of seventeen. It is now five, and that is the set the criterion is decidable on.

The kill criterion is an **AND**: a candidate must gain on FSE'26 and cost the golden 9-cell nothing. That makes
the dispatch surface a first-class constraint — an axis whose knob only one benchmark can dispatch has an
**undecidable** other half. Measured, before the fix:

| benchmark | ranking flags accepted by its parser | dispatchable through its workflow |
| --- | --- | --- |
| FSE'26 | 14 | **14** |
| RCAEval (the golden half) | 17 | **1** (`--stability-weight`) |

Sixteen ranking flags were unreachable through `benchmark-rcaeval.yml`, including **four of the five knobs both
runners accept** (`--log-weight`, `--no-rank-normalization`, `--onset-shape`, `--temporal-weight`; only
`--stability-weight` was wired). The set of knobs whose criterion is decidable by dispatch was therefore the
one-element intersection `{stabilityWeight}` — and that element existed only because the stability candidate
needed it.

**Closed, and the boundary is principled rather than convenient.** `benchmark-rcaeval.yml` now exposes those
four inputs, so the intersection is `{logWeight, logSignalMode, rankNormalization, onsetShape, stabilityWeight,
temporalWeight}` — six knobs, 12 ranking flags still unreachable. The four added are exactly the knobs BOTH
runners accept: adding an RCAEval-only knob (`--collision-weight`, `--trace-weight`, `--prism-weight`, …) would
grow the surface without growing the set of answerable questions, because the FSE'26 half would still be
unreachable.

| benchmark | accepted | dispatchable | undispatchable |
| --- | --- | --- | --- |
| FSE'26 | 14 | **14** | 0 |
| RCAEval | 18 | **6** | 12 |

**Two instances in the record acquire a structural cause, and one of them is a closed loop:**

1. The temporal rejection (`2eb5827`) carries `golden: 'unmeasured'`, recorded as the honest reading of a
   candidate the other half had already rejected. True — and it was also the only reading *available*:
   `run-rcaeval.ts` accepted `--temporal-weight` and no dispatch could pass it, so the temporal golden half
   could not have been measured without moving the default.
2. `docs/closed-axes-register.md` records that the temporal axis was once *unfalsifiable* because `run-rcaeval`
   carried `temporalWeight: 0` — the term's own ablation — as a pin. The pin was removed and the runner took the
   flag; **no dispatch could reach it**, so **a repaired pin whose replacement is unreachable is still a pin.**
   The input now exists, and the flag is passed on all seven invocations.

**A declared input is not a threaded one**, and that is guarded separately: `benchmark-rcaeval-trigger.test.ts`
requires each of the four to have an empty default (so a push measures nothing new), to be appended to the
argument array in EVERY invocation, and to name a flag BOTH parsers accept — the count, not a sample, because
one missed invocation is one suite measured at the default while the run reports success.

## A limit found on the way, recorded rather than left to silence

The guard on the workflow DESCRIPTIONS (`packages/kinetic/__tests__/unit/fse26-reported-config.test.ts`)
compares numeric and string claims against the engine's constants, and its string half is **positive only**:
a registered input must name its constant, but a NEW string claim is not detected. The detection regex for
that direction requires a digit, because `runner default, which is the SHIPPED 0.007352` and
`runner default, which is all downloaded` are the same shape to a matcher — so a description reading
`runner default, which is earliest-only` (the REJECTED shape) would satisfy every assertion in the file
while `DEFAULT_ONSET_SHAPE` says `earliness`. Registered and checked today: `onset_shape` in both workflows.
The remaining work is a claim detector that distinguishes a constant's value from prose, which is a design
choice rather than a patch.

**And the guard found a real defect the moment it was pointed at four new inputs.** Both `DESCRIBES_SHIPPED`
tables had to name the shipped log weight, and the engine had **no constant to read it from**:
`logWeight`'s default was a bare `1.0` in four files — the pruner's option block, both parsers' parsed
defaults, and both `parseWeight` fallbacks — while every other shipped weight had an exported constant. It is
the LARGEST term in the ranking and the first to ship enabled. `DEFAULT_LOG_WEIGHT` now owns it, the two
oracle menus that typed `logWeight: 1` under a comment saying they must not read it from the options
(`menuConfigurations`) read it too, and both tables name the constant instead of a literal.

## Finding 3 — `collapseDiscount` is a ranking knob whose only record is a comment

`--collapse-discount` reaches `collapseDiscount`, which discounts the DROP half of a metric's direction-aware
deviation so a collapse is not read as a rise. Its measurement lives in the doc comment on
`computeMetricDirection` in `packages/tree/src/pruning/ranking-signals.ts`, citing **"benchmark #226/227"**. No
document states it. The register's fence reads `docs/*.md`, so it cannot see this knob, and the census records
it as the one owner that is not a document rather than inventing a document for it — promoting it needs the
measurement re-stated in a document, which is a different iteration from a census.

This is the third instance of one pattern in this repository: **a comment is a copy, and a copy drifts** (the
`levelOneFlood` reach was wrong in a comment while the document was right; the `decisiveOutcome` comment
contradicted itself). Here the comment is not wrong — it is the *only* place the number exists.

## Finding 4 — `fusionCeiling` is an output path that is named like a knob

`--fusion-ceiling <path>` joins the engine's per-case top-1 with PRISM's and writes a JSON report. It is named
after the concept it reports (the union ceiling of the two engines), so the expensive misreading is available:
treating it as an unmeasured ranking axis. The census classifies it explicitly rather than exempting it, because
"not a ranking knob" and "a ranking knob nobody has measured" are the same shape in a set — the confusion this
census exists to prevent.

## Finding 5 — an artifact-shaping flag can be accepted, documented as dispatchable, and reachable from no workflow at all

The census's dispatchability assertions are about **ranking knobs**, and they exempt `OPERATIONAL_OPTIONS`
by design. That exemption is where a false claim lived.

`docs/fse26-cv-screen.md` and `docs/closed-axes-register.md` both stated that the dump precision "is now an
input to all seven dump steps (`--diagnose-decimals`), so the same dispatch that renders FSE'26 at four
decimals also settles whether the window is admitted", and the register recorded the ONE window anywhere that
answers `needs 1` — FSE'26's stability `flip` on `35107871516` — as a prediction **one dispatch away**. The
seven dump steps are the RCAEval suites. On the FSE'26 side the flag was reachable nowhere, in three places at
once:

| seam | state before | consequence |
| --- | --- | --- |
| the parser (`fse26-cli.ts`) | no `--diagnose-decimals` arm | the flag was refused loudly (the chain throws on an unknown argument), so it could not be passed at all |
| the runner (`run-fse26.ts`) | called the shared builder WITHOUT `fieldDecimals` | every FSE'26 dump took the producer's three decimals |
| the workflow (`fse26-benchmark.yml`) | no `diagnose_decimals` input | a dispatcher had nothing to fill in |

The middle row is the one that would have survived a naive repair. The shared builder's `fieldDecimals` was
**optional**, and that was not an oversight — it was a **recorded design decision**, argued for on the ground
that the builder must not choose a value at all: it passes `undefined` through to the ONE default in the
formatter, and a default at that layer would be a second owner of a number a reader's error bar derives from.
Everything in that argument is correct about not inventing a second default. The step it skips is the one that
mattered: **optional at the builder layer is a fence over the BUILDER and over nobody else** — it does not stop
a CALLER from taking the default, and one did.

The RCAEval runner reaches the builder through a sink that REQUIRES the value, and a test held that sink to
the requirement **as text**; the FSE'26 runner reaches the builder directly and omitted it. So **two dumps of
one engine rendered the same fields at different precisions, both declaring a precision**, while every parse
succeeded. That test was correct and did exactly what it claimed — it was pointed at one of the two callers.
**A property asserted at ONE layer is a statement about that layer, and "required here" is read as "required
everywhere" by every sentence that then cites it**, which is how a design decision with a test attached became
an unexamined premise. The omission is not cosmetic either: a reader derives its error bar from the
declaration, so a four-decimal request answered by a three-decimal file has a box three orders of magnitude
too wide.

The prediction was therefore not one dispatch away. It was **unreachable**, which is the failure this
repository already names one register bullet down: *a repaired pin whose replacement is unreachable is still a
pin*. The dispatch the record invited would have re-rendered at three decimals and reported the answer as if
the question had been asked.

**The repair has three parts, and the fence is the one that matters.** The flag is threaded end to end; the
shared input's `fieldDecimals` is now **required**, so the omission is a COMPILE error (verified: dropping the
argument with the field required fails `tsc` with `TS2345`, and with the field relaxed back to optional the
source assertion in the new guard fails instead); and the census gains the direction that finds this class.

## What the guard checks

1. Each runner's accepted flag set is read from its **parser chain**, and every accepted flag must bind an
   `opts.<name>` — so a flag that reaches no option cannot be dropped from the population silently.
2. Every workflow input maps to `--<name with underscores as hyphens>` and that flag is **accepted by the
   parser it feeds**, unless it is an operational input named in a reason table. This is the check that would
   have caught the historical `--log-mode count` defect, where a dispatch asked for one mode and silently ran
   another.
3. Every ranking knob has an owner: a document that **exists on disk**, or one of two sentinels that are
   themselves exact sets. And the relationship between this table and the WORKFLOWS is asserted in **both**
   directions — every dispatch the table claims must exist, and every dispatch a workflow actually has must be
   in the table. The second direction was missing, in the expensive way: four inputs were added to the RCAEval
   workflow and the guard stayed green, because the intersection it checked was computed from the table rather
   than from the workflows.
4. The four non-derivable option names, the six-knob dispatchable intersection, and the twelve
   RCAEval-undispatchable flags are recorded as **exact sets** — so a new non-derivable name, a newly
   dispatchable knob, or a newly unreachable one is a failing test rather than a discovery. (This is what
   caught `--prism-pooling` on the way in: the flag had to be classified, and classifying it is what forced
   its owner document to exist.)
5. **Every artifact-shaping flag a runner ACCEPTS is reachable from the workflow that drives it**, or is
   named in an exception table WITH its reason — the direction the ranking tables cannot cover. Reachability
   is read in CODE, not in prose: these workflows document their flags in `#` blocks directly above the code
   that passes them, and a plain text search reports a flag as reached on its own description. Measured, not
   assumed: with `--diagnose-decimals` renamed at the one place it is passed, the text search still matched —
   on a comment four lines above. The rule excludes `[a-z0-9-]` after the flag so `--diagnose` is not
   "reached" by `--diagnose-decimals`, and the stripping is one-way (removing text can only make a flag look
   UNREACHED, which fails loudly). Two exceptions are named today: `--routing-probe` and `--system`, both
   RCAEval-only, both recorded with why.
   The sharper companion assertion: among the artifact-shaping options **both** runners accept — derived, not
   listed: `dataDir`, `maxCases`, `diagnoseDecimals` — each must be reachable from **both** workflows. A
   dump both screens read, renderable at two precisions by one runner and one by the other, is the exact
   state `diagnoseDecimals` was in.
6. **The workflow side is guarded at its own seam, in the other file**: `fse26-dump-precision.test.ts`
   asserts the input is declared, FORWARDED at the flag's own spelling, gated on non-emptiness, and that
   **every argument array the run step builds is expanded into a command** — because
   `DIAGNOSE_DECIMALS_ARG=(--diagnose-decimals …)` is a complete, correct-looking declaration of the flag,
   and deleting the one line that expands it leaves the flag spelled exactly as before while the runner never
   sees it. The input's `default: ''` is deliberately NOT re-asserted there: `fse26-reported-config.test.ts`
   already requires every runner-owned input to have an empty default, and a second assertion would be a
   second owner of one rule.

## Gates

Register guard 14/14 · census **14 tests** (the count said 13 until the `prismPooling` row was added, i.e. it
had been stale by one) · `kinetic` (full, 1007 tests) at 99.97 / 99.28 / 100 / 99.97 ·
benchmarks **1037 tests** at 99.95 / 99.89 / 100 / 99.95 · tree at 100/100/100/100 · core 420 tests at
99.88 / 96.62 / 100 / 99.88 · both typechecks (0 `error TS`) · lint 0/0 (356 files) · format clean. (The
`pnpm coverage` reading this line carried before — 127 files, 3198 tests — is the last whole-repo run and is
kept as that; `pnpm` is absent locally, so the per-project numbers above are the current reading.)
**Eleven mutations killed on the first pass** — every one a change to
the DATA or a MECHANISM, not to an assertion: a knob marked unowned, an owner naming a document that does not
exist, a knob deleted (the population shrinking to fit the table), a row naming a flag that binds a different
option, a row naming the other runner's flag, a dispatch it does not have, the non-derivable set trimmed to
what a hand search finds, the undispatchable list shortened, an operational input reclassified as a knob, a
measured knob exempted into the operational table, and the flag reader narrowed so a runner looks smaller. One
candidate mutation was **discarded as equivalent** (it replaced an assertion with `void`, which tests nothing
about the system); the exact pairing check it appeared to threaten was shown able to fail by two data
mutations instead.

**Finding 5 added eleven more, and the first pass of them was WRONG in the instructive way.** The harness
reported "KILLED" for every mutation including ones that had to survive, because it ran `vitest` with a
repo-relative path from a package-relative cwd: the file was not found, so `vitest` exited non-zero and the
harness read that as a kill. **A COUNTER MUST BE ABLE TO FAIL AND MUST NOT FIRE ON LEGAL OUTPUT** — this one
fired on its own broken invocation. Re-run with the paths corrected, three of the eleven SURVIVED, and each
survivor was real: the census was satisfied by a **comment** naming the flag; the workflow guard did not
notice an argument array that is **built and never expanded**; and one mutation was a bad mutation (it
inserted a second `default:` instead of replacing the first, so the assertion was still correctly satisfied).
All three are now closed and re-killed. The complete set:

| mutation | killed by |
| --- | --- |
| forwarded flag misspelled in the workflow | census + dump-precision |
| arg array built but never appended | dump-precision |
| input's `default` made non-empty | `fse26-reported-config` (its owner) |
| input declared but never read (`if -n` re-pointed) | dump-precision |
| runner passes a COPY of the constant instead of the option | dump-precision |
| parser arm deleted | dump-precision + census |
| parser drops `hasValue`, swallowing the next flag | dump-precision |
| parser drops the bound (raw `Number`) | dump-precision |
| fence removed at both ends (field optional, argument dropped) | dump-precision |
| **fence in place, argument dropped** | **`tsc` — `TS2345`** |

**A golden IS owed**: `packages/kinetic/src/**`, `benchmarks/src/**` and `.github/workflows/**` all changed.
The default path passes no flag, so the nine cells must stay byte-identical.

**And one of the numbered checks above had a hole that only a non-numeric owned value could find.** The
"reads the shipped weight from its OWNER" loop asserted `not.toMatch(<knob>: (?!DEFAULT_)\d)` — a pattern that
requires a **digit**. Every owned option in that loop was a NUMBER until `prismPooling` was added, so the
pattern was an adequate proxy for "named the constant"; the first member outside the population — a string —
walked straight through it. Measured, not argued: the mutation `prismPooling: 'additive'` instead of
`DEFAULT_PRISM_POOLING` **SURVIVED** the unmodified loop and is killed by the corrected one
(`<knob>:\s*DEFAULT_[A-Z0-9_]+`), which subsumes the numeric arm because a numeric literal cannot be
`DEFAULT_<NAME>`. *A proxy that was true of every member of a population is not a rule about the population.*

## Finding 6 — the golden half's own accepted flags, and the boundary argument this document already made (iteration 95)

**The third direction, and it is neither of the two above.** Findings 1–5 close three seams: a knob that reaches
no option, an option whose owner document is missing, and an artifact-shaping flag no workflow can reach. This one
is a **RANKING** knob the golden parser accepts, the runner carries into `RCAEvalSignalOptions` or
`RCAEvalTopologyOptions`, **the configuration line names on every artifact** — and no dispatch could state.
Measured: **eight of them.**

| knob | flag | before | after |
| --- | --- | --- | --- |
| `traceWeight` | `--trace-weight` | workflow could not state it | `trace_weight` |
| `topoWeight` | `--topo-weight` | " | `topo_weight` |
| `collisionWeight` | `--collision-weight` | " | `collision_weight` |
| `prismWeight` | `--prism-weight` | " | `prism_weight` |
| `prismPooling` | `--prism-pooling` | " | `prism_pooling` |
| `collapseDiscount` | `--collapse-discount` | " | `collapse_discount` |
| `suppressIdleTransients` | `--suppress-idle-transients` | " | `suppress_idle_transients` |
| `suppressNearZeroBaselineRise` | `--suppress-near-zero-baseline-rise` | " | `suppress_near_zero_baseline_rise` |

`UNDISPATCHABLE_ON_RCAEVAL` therefore goes from **twelve to four**, and the four that remain are not of this shape:
`--fusion-ceiling` (an output path, Finding 4), `--rank-normalization` (the POSITIVE pole whose axis IS reachable
through its negation, the same single-pole convention the FSE'26 parser uses), and the two NEGATED poles of switches
whose shipped default is `false`, so each can only restate the default.

### The boundary argument, answered rather than ignored

**This document already argued against this change**, and the argument is worth restating in its own words: the
four inputs added by Finding 2 *"are exactly the knobs BOTH runners accept: adding an RCAEval-only knob
(`--collision-weight`, `--trace-weight`, `--prism-weight`, …) would grow the surface without growing the set of
answerable questions, because the FSE'26 half would still be unreachable."*

**That is still true, and it is not the ground this change rests on.** The kill criterion's AND is untouched: with
the FSE'26 half unable to state these eight, dispatching them answers nothing about the criterion. What the change
repairs is the **artifact integrity** defect Findings 3 and 5 already own — an option the runner accepts, the engine
carries, and the line NAMES makes every artifact assert a configuration nobody can ask for. The distinction is that
Findings 3 and 5 are about flags reaching no *option*; this one is about options reaching no *dispatch*, and the
line is the same lie in both directions.

The boundary argument's consequence is therefore recorded as a **task rather than a prohibition**: the mirror is to
give `fse26-cli.ts` the same eight flags and forward them, which is what turns eight goldens-only arms into eight
decidable axes. Until that happens the eight inputs here are **not** a claim about the criterion, and this paragraph
exists so the next reader cannot mistake them for one.

### One defect found while wiring it, and it is this document's own theme

`trace_weight`'s shipped value **has no owning constant**. It is a bare literal in `rcaeval-cli.ts` and a bare `1`
in the RE3 job's pin, so the workflow-description guard — which requires every input claiming a runner default to
name a constant that can be checked — **refused the claim**, and the description had to state the default in words
instead. That is the **second instance** of the class `DEFAULT_LOG_WEIGHT` was created for, found by the same guard
one iteration later, and it is registered here rather than worked around: the runner's default is `0` and the RE3
pin is a per-invocation configuration, so the two want one constant and one guard-side `else` — which is also how
the pin stopped being stated twice.

**Closed in iteration 97.** `DEFAULT_TRACE_WEIGHT` now lives in `packages/tree` beside
`DEFAULT_LOG_WEIGHT` and `DEFAULT_LOG_SIGNAL_MODE`, and the value had **four** owners rather than three: the
engine's own `DEFAULT_TREE_PRUNER_OPTIONS` held a bare `0.0` as well as each parser's field default and
`parseWeight` fallback. All four read the constant now, so the golden workflow's `trace_weight` description
states its default as a NUMBER and the description guard checks it — the two things the words-only
description could not do. `docs/rank-collapse-falsified.md` carries the measurement that explains why the
value matters beyond bookkeeping.

### Three fences that had encoded the old symmetry, each updated with its reason

1. **"the golden half reaches exactly the intersection"** was an equality. It is now a **subset in both
   directions** plus an ownership check, because the golden half reaches 18 axes against the FSE'26 half's 15 —
   **the direction of the asymmetry reversed** — and the property the equality was protecting is that no axis is
   reachable without a `KNOBS` row.
2. **"RCAEval still exposes fewer knobs than FSE'26 does"** was a non-vacuity floor on an inequality. Both sides
   are non-empty and the two counts differ; *which* is larger is now a recorded fact rather than a premise.
3. **`unreachable.length > 10`** was a floor pinned to the twelve members. A floor left at the old count would have
   made the emptying look like a **regression**, so it is replaced by the property that still has to hold: the set
   is non-empty and is a strict subset of the accepted flags. **A set that shrinks without a note is a set nobody
   can audit**, and its own docblock already said so.

### And the pin this change would have created

The RE3 job **pinned** `--trace-weight 1` on its command line while `RANKING_ARG` can now set the same flag. The
census's own rule — *"a step that states one knob twice has a meaning that depends on the parser's tie-break"* — is
why it fires, and it is the hazard this document records for `--log-signal-mode`. The pin moved **inside the
guard** (`else RANKING_ARG+=(--trace-weight 1)`), so one statement per state, the dispatch wins, and the RE3
default is unchanged.

## Finding 7 — the mirror landed, and the intersection went from ten to eighteen (iteration 96)

Finding 6 closed the eight knobs on the GOLDEN side and registered the mirror as a task, because its own
boundary argument was that *adding an RCAEval-only knob grows the surface without growing the set of answerable
questions, because the FSE'26 half would still be unreachable.* This is that task done, and the argument's
instrument is now the thing it grew.

| | before | after |
| --- | ---: | ---: |
| knobs the golden half can dispatch | 18 | 18 |
| knobs the FSE'26 half can dispatch | 15 | **15 + 8** |
| **knobs BOTH can dispatch** (the criterion's decidable set) | **10** | **18** |
| `UNDISPATCHABLE_ON_RCAEVAL` | 4 | 4 |

The intersection is computed over the `KNOBS` rows, and the eight rows carried `fse26: null` — so they were
absent from it **by construction**, and no number of golden-side inputs could have put them there. That is the
join this census exists to expose, arriving one level up: Finding 6 closed eight options-to-*dispatch* seams and
did not move the intersection at all, which is exactly what its boundary argument predicted.

### What changed, and what deliberately did not

- `fse26-cli.ts` accepts the eight flags and assigns the same option names the golden parser does, **except**
  where the engine's own field is the name — which is the whole point of the cross-runner fence.
- `fse26-engine-options.ts` forwards five into `signals` and three into `topology`, on the split's own rule: a
  value placed in the wrong argument is accounted for and still a no-op.
- `fse26-report.ts` names each on the line's `omit when it holds its default` rule, which is **sound for all
  eight because every default here is zero or false** — the property the latency weight does not have and which
  is why that one is printed unconditionally. `prismPooling` is the ninth case and is nested under
  `prismWeight`, on `failedEdgeMode`'s rule, because a pooling combined with a zero weight is not part of the
  configuration.
- The workflow gains ONE input for the eight, and the input-ownership table in `packages/kinetic` gains one row.
  **It had to be one, and the reason is a HARD GITHUB LIMIT rather than a preference** — see the next section,
  which is a defect this iteration introduced and then had to repair.
- **No engine source moved at all.** The options were already carried and already printed on the golden half;
  this iteration is the FSE'26 half catching up to a surface the golden half already had.

### The defect this iteration created, and the budget nothing was counting

**Eight named inputs took `fse26-benchmark.yml` from 22 inputs to 30, and a `workflow_dispatch` accepts at most
25.** Past 25 the file is not large, it is **INVALID**, and the two consequences were both immediate and both
loud:

- the **push-triggered validation run failed** (`38349525722` / `38349501764`) — the workflow could not be
  loaded at all, so this was not a red benchmark but a red *file*;
- and `POST .../dispatches` was refused with **`HTTP 422: you may only define up to 25 inputs for a
  workflow_dispatch event`**, which is how the iteration's own candidate dispatch discovered it.

**Every one of the eight was a real knob the surface was missing, and the count was still fatal.** That is the
class of defect this document exists for, arriving from a direction it had not covered: not a flag reaching no
option and not an option reaching no dispatch, but **a surface reaching a platform's budget** — and *nothing
counted it*. The census could see every knob, every flag and every dispatch, and had no number at all for how
many inputs a workflow is allowed.

**The repair is one input carrying all eight**, with two properties that keep the reach auditable rather than
merely legal:

1. **The step's `case` block spells every one of the eight flags in CODE**, so `reaches()` still reads the reach
   out of the workflow rather than trusting a table. An unrecognised `name=` **exits non-zero** instead of being
   dropped, because a silently ignored knob is a run whose configuration line reports something nobody asked for.
2. **The census gains `SHARED_INPUTS`, naming which flags each shared input can emit, and checks every claim
   against the workflow's own text before crediting it.** A shared input is the one shape that could hide a
   dispatch from the `KNOBS` table — `declared()` skips it by name — so the expansion is derived and verified
   rather than assumed.

**And the budget is now a fence.** `dispatch-surface-census.test.ts` gains a block that reads **every** workflow
in `.github/workflows` and asserts each `workflow_dispatch` declares **at most 25** inputs, plus the two
benchmark workflows' exact counts so a change to either is a deliberate edit. It is asserted over every file
because the limit is a property of the EVENT rather than of a file — and because the golden half is at **21**,
which is four under and therefore the next surface to be extended.

**`ranking_knobs` therefore records a platform constraint, not a design.** The eight knobs remain eight axes,
eight `KNOBS` rows and eight members of `DISPATCHABLE_ON_BOTH`; only the wiring through which a dispatch states
them is shared, and the grammar is documented on the input itself.

### The fences, and the one that is the whole point

Three fences pin it, and the middle one is stronger than a per-flag test could be:

1. `benchmarks/__tests__/fse26-cli.test.ts` gains a **cross-runner equivalence**: each of the eight is fed to
   BOTH parsers and the **ENGINE-level** values are compared, valid AND malformed. Comparing engine values
   rather than parse results is deliberate — the two surfaces do not use the same option names everywhere, so
   two parsers can agree field-by-field and still disagree about what the engine receives, and a disagreement
   is what makes the intersection meaningless even when both halves are individually reachable.
2. The same block asserts the parser still **REFUSES** a flag it does not handle, because a fence that only
   counted accepted flags would be satisfied by a parser that accepted everything.
3. `benchmarks/__tests__/fse26-report.test.ts` gains the POSITIVE half of the line's rule — each of the eight
   appears when it leaves its default, and not before. The shipped line's byte-identity is the negative half
   and a line that printed none of them would satisfy it, so the rule is only fenced with both directions.

### And the golden half is untouched, which is the acceptance

Every new input defaults to empty, so a push passes no flag at all, and the eight defaults ARE the shipped
values. **The acceptance is therefore the nine golden cells plus the `signals:` line** — both byte-identical,
verified on the run the source commit triggered — which is the same criterion Finding 6 used and for the same
reason: the surface grew, so the line's bytes may not.

### One more thing this iteration found, and it is not about the surface

`docs/near-zero-rise-suppression-falsified.md` closed its sibling's verdict with *"consistent with
`suppressIdleTransients`"* — an inference from a shared guard shape that had never been tested. The dispatch
that motivated this whole mirror then measured the sibling at **+3 net cases across two cells**, so the two
switches are not consistent after all. **A reachability gap is not only a missing knob; it is a missing
MEASUREMENT, and the golden half had been carrying a claim about a switch it could not vary.**

