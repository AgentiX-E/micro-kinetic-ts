# The dispatch surface: every ranking knob, its three names, and its owner

**Status:** instrument shipped and gated (`packages/kinetic/__tests__/unit/dispatch-surface-census.test.ts`,
9 tests, 11 mutations all killed). It found four things, one of which was produced **while writing it**: a
careful hand search of the register and every document concluded that two knobs were never measured, and a
candidate was drafted around one of them. Both had been measured and rejected. The error was in the join
between three names, and nothing owned that join.

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
| `logWeight` | `--log-weight` | `log_weight` | — | `fse26-shipped-config-verdict.md` |
| `logMode` | `--log-mode` | `log_mode` | — | `fse26-metric-gap-verdict.md` |
| `logSignalMode` | `--log-signal-mode` | — | — | `fse26-result-attribution.md` |
| `rankNormalization` | `--no-rank-normalization` | `no_rank_normalization` | — | `fse26-shipped-config-verdict.md` |
| `metricRiseCeiling` | `--rise-ceiling` | `rise_ceiling` | — | `fse26-metric-competition-verdict.md` |
| `metricFleetBaseline` | `--fleet-baseline` | `fleet_baseline` | — | `fse26-metric-competition-verdict.md` |
| `failedEdgeWeight` | `--failed-edge-weight` | `failed_edge_weight` | — | `fse26-failed-edge-verdict.md` |
| `failedEdgeMode` | `--failed-edge-mode` | `failed_edge_mode` | — | `fse26-failed-edge-verdict.md` |
| `failedEdgeMinRecords` | `--failed-edge-min-records` | `failed_edge_min_records` | — | `fse26-failed-edge-verdict.md` |
| `latWeight` | `--lat-weight` | `lat_weight` | — | `fse26-latency-term-verdict.md` |
| `latMinRise` | `--lat-min-rise` | `lat_min_rise` | — | `fse26-latency-term-verdict.md` |
| `poolMetricPenaltyWeight` | `--pool-penalty` | `pool_penalty` | — | `fse26-pool-penalty-verdict.md` |
| `stabilityWeight` | `--stability-weight` | `stability_weight` | `stability_weight` | `fse26-cv-screen.md` |
| `temporalWeight` | `--temporal-weight` | `temporal_weight` | — | `fse26-onset-verdict.md` |
| `onsetShape` | `--onset-shape` | `onset_shape` | — | `fse26-onset-verdict.md` |
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
`docs/cli-argument-rejection-audit.md`).

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

## Finding 2 — the golden half is dispatchable for ONE ranking flag out of seventeen

The kill criterion is an **AND**: a candidate must gain on FSE'26 and cost the golden 9-cell nothing. That makes
the dispatch surface a first-class constraint — an axis whose knob only one benchmark can dispatch has an
**undecidable** other half. Measured:

| benchmark | ranking flags accepted by its runner | dispatchable through its workflow |
| --- | --- | --- |
| FSE'26 | 14 | **14** |
| RCAEval (the golden half) | 17 | **1** (`--stability-weight`) |

Sixteen ranking flags are unreachable through `benchmark-rcaeval.yml`, including four of the five knobs **both**
runners accept (`--log-weight`, `--no-rank-normalization`, `--onset-shape`, `--temporal-weight`; only
`--stability-weight` is wired). The set of knobs whose criterion is decidable by dispatch is therefore the
one-element intersection `{stabilityWeight}` — and that one element exists because the stability candidate
needed it.

**This gives an instance in the record a structural cause.** The temporal rejection (`2eb5827`) carries
`golden: 'unmeasured'`, recorded as the honest reading of a candidate the other half had already rejected. True
— and it is also the only reading *available*: `run-rcaeval.ts` accepts `--temporal-weight` and the workflow
cannot pass it, so the temporal golden half could not have been measured without moving the default.

**And it names a half-finished repair.** `docs/closed-axes-register.md` records that the temporal axis was once
*unfalsifiable* because `run-rcaeval` carried `temporalWeight: 0` — the term's own ablation — as a pin. The pin
was removed: the runner now takes the flag. No dispatch can reach it. A repaired pin whose replacement is
unreachable is still a pin, and the census is what makes that visible.

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

## What the guard checks

1. Each runner's accepted flag set is read from its **parser chain**, and every accepted flag must bind an
   `opts.<name>` — so a flag that reaches no option cannot be dropped from the population silently.
2. Every workflow input maps to `--<name with underscores as hyphens>` and that flag is **accepted by the
   parser it feeds**, unless it is an operational input named in a reason table. This is the check that would
   have caught the historical `--log-mode count` defect, where a dispatch asked for one mode and silently ran
   another.
3. Every ranking knob has an owner: a document that **exists on disk**, or one of two sentinels that are
   themselves exact sets.
4. The four non-derivable option names, the one-element dispatchable intersection, and the sixteen
   RCAEval-undispatchable flags are recorded as **exact sets** — so a new non-derivable name, a newly
   dispatchable knob, or a newly unreachable one is a failing test rather than a discovery.

## Gates

Register guard 14/14 · census 9 tests · `kinetic` (full) at 100 / 99.44 / 100 / 100 · benchmarks 737 ·
both typechecks · lint 0/0 · format clean. **Eleven mutations killed on the first pass** — every one a change to
the DATA or a MECHANISM, not to an assertion: a knob marked unowned, an owner naming a document that does not
exist, a knob deleted (the population shrinking to fit the table), a row naming a flag that binds a different
option, a row naming the other runner's flag, a dispatch it does not have, the non-derivable set trimmed to
what a hand search finds, the undispatchable list shortened, an operational input reclassified as a knob, a
measured knob exempted into the operational table, and the flag reader narrowed so a runner looks smaller. One
candidate mutation was **discarded as equivalent** (it replaced an assertion with `void`, which tests nothing
about the system); the exact pairing check it appeared to threaten was shown able to fail by two data
mutations instead.

**No golden is owed**: this iteration touches `docs/` and `__tests__/` only.
