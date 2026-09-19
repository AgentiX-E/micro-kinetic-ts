# The dispatch surface: every ranking knob, its three names, and its owner

**Status:** instrument shipped and gated (`packages/kinetic/__tests__/unit/dispatch-surface-census.test.ts`,
10 tests, 13 mutations all killed), and the structural gap it found is **closed**: the four knobs both runners
accept were dispatchable on the FSE'26 half alone, so the kill criterion was decidable for exactly ONE knob;
`benchmark-rcaeval.yml` now exposes all five, and every input is threaded into all seven invocations
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
| `suppressIdleTransients` | `--suppress-idle-transients` | — | — | `near-zero-rise-suppression-falsified.md` |
| `suppressNearZeroBaselineRise` | `--suppress-near-zero-baseline-rise` | — | — | `near-zero-rise-suppression-falsified.md` |
| `collapseDiscount` | `--collapse-discount` | — | — | **a code comment only** |
| `fusionCeiling` | `--fusion-ceiling` | — | — | **not a ranking knob** |

23 knobs, 26 flags (three switches have two poles, and the RCAEval runner exposes both while the FSE'26 parser
exposes one). 14 ranking flags are accepted by the FSE'26 CLI (`benchmarks/src/fse26-cli.ts`) and 17 by the RCAEval
parser (`benchmarks/src/rcaeval-cli.ts`, extracted from `run-rcaeval.ts` so a test can drive it — see
`docs/cli-argument-rejection-audit.md`). **Five knobs are dispatchable on BOTH benchmarks**, which is the set on
which the kill criterion is decidable at all: `logWeight`, `rankNormalization`, `onsetShape`, `stabilityWeight`,
`temporalWeight`.

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
four inputs, so the intersection is `{logWeight, rankNormalization, onsetShape, stabilityWeight,
temporalWeight}` — five knobs, 12 ranking flags still unreachable. The four added are exactly the knobs BOTH
runners accept: adding an RCAEval-only knob (`--collision-weight`, `--trace-weight`, …) would grow the surface
without growing the set of answerable questions, because the FSE'26 half would still be unreachable.

| benchmark | accepted | dispatchable | undispatchable |
| --- | --- | --- | --- |
| FSE'26 | 14 | **14** | 0 |
| RCAEval | 17 | **5** | 12 |

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
**optional**, on its own recorded argument ("omitted means the producer's default, which is what every caller
that predates this field means") — and an optional field is not a fence over the callers that need it. The
RCAEval runner threads the value through a sink that REQUIRES it; the FSE'26 runner reaches the builder
directly and omitted it, so **two dumps of the same engine rendered the same fields at different precisions
and both declared a precision**. An omission here is not a cosmetic default: a reader derives its error bar
from the declaration, so a four-decimal request answered by a three-decimal file has a box three orders of
magnitude too wide while every parse succeeds.

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
4. The four non-derivable option names, the one-element dispatchable intersection, and the sixteen
   RCAEval-undispatchable flags are recorded as **exact sets** — so a new non-derivable name, a newly
   dispatchable knob, or a newly unreachable one is a failing test rather than a discovery.
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

Register guard 14/14 · census **13 tests** · `kinetic` (full, 946 tests) at 100 / 99.44 / 100 / 100 ·
benchmarks **762 tests** at 99.84 / 97.37 / 100 / 99.84 · tree 650 at 100/100/100/100 · both typechecks
(0 `error TS`) · lint 0/0 (337 files) · format clean · root `pnpm coverage` green (127 files, 3198 tests).
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
