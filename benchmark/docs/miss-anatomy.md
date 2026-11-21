# The 236, decomposed — which of the formula's terms decided each miss

**Status:** measured on all 1 422 RCABench cases, published configuration (`failureContainmentScope =
'global-measured'`, fault-free profile `d13793d1…`), `Top@1` **1 186 (83.40 %)**. No model was called (`$0.00`).
The instrument is `benchmarks/src/miss-anatomy.ts` (**100 / 100 / 100 / 100**, 15 tests) and the probe is
`scripts/dump-miss-anatomy.ts`; the raw rows are `anatomy.ndjson`, one row per miss, 236 of them.

## 0. Headline

The engine already emits, on **every** result, the named contributions that sum to its `finalScore`
(`RootCauseResult.terms`). The difference between the winner's row set and the truth's row set is therefore a
**decomposition of the miss into the formula's own terms**, with no re-derivation anywhere. It says which term to
go and fix, and it says it in the unit the score is made of.

| what decided the miss                                             |   cases | share of 236 |
| ----------------------------------------------------------------- | ------: | -----------: |
| `selfAnomalyLog1p` — the winner is louder in the metric channel   | **126** |   **53.4 %** |
| `dualFamily` — the winner holds a moving channel in both families |      42 |       17.8 % |
| `lat` — the winner's callers waited longer for it                 |      41 |       17.4 % |
| `log` — the winner emitted more logic-exception evidence          |      25 |       10.6 % |
| `failedEdge`                                                      |       1 |        0.4 % |
| `pool` — the DB-pool dominance penalty                            |       1 |        0.4 % |
| truth absent from the results                                     |   **0** |    **0.0 %** |

Two readings are immediate and neither was in any artifact before this one:

1. **No miss is a set decision.** The truth reached a result on all 236, so `poolAdmission` and every other
   membership rule are not implicated. The money is in the ordering, not the pool.
2. **Not one miss is a tie.** The decisive term's contribution is a **median 40.4 % of the winner's score**, and
   only 14 of 236 (5.9 %) are under 5 %. A tie-break rule — the natural reading of "near miss" — has almost
   nothing to act on here, which is the same verdict `near-miss-census.md` §1 reached from the margin side.

Three of the readings below are defects rather than descriptions, and all three are measured rather than argued:

- **§4.0** — the `log` term's ceiling (1.000) sits above the base term's (0.693, because the base is `log1p`), and
  on the 25 misses it decided it fired at 1.000 with the base term already pointing at the truth.
- **§4.1** — `failedEdge` carries the formula's second-largest weight (3.0) and reached **2 of 236**, while **157
  of the 236 carry the failed-call rows it reads**. `trace` carries 1.0 and reached nobody, because the loader
  fills no input for it.
- **§5.1** — the fault-free prior's shipped aggregation pays essentially the whole fleet the same score (2
  distinct values per case, 60 of 60 sampled), so the term is a constant and cannot re-order anything.

## 1. The signature changes with DEPTH, and the two halves want different work

| band      | cases |     base |    `log` | `dualFamily` | `lat` |
| --------- | ----: | -------: | -------: | -----------: | ----: |
| rank 2–3  |    50 |     36 % | **32 %** |         22 % |  10 % |
| rank 4–5  |    19 |     42 % |     11 % |         16 % |  32 % |
| rank 6–10 |    29 |     34 % |     14 % |     **28 %** |  17 % |
| rank > 10 |   138 | **65 %** |      2 % |         14 % |  18 % |

The near misses are not a small version of the deep ones:

- **At rank 2–3, `log` decides one case in three.** The log channel is a full-weight term (`logWeight = 1`) and on
  this band it is the single most frequent decider after the base term. A log change is the cheapest available
  intervention on 16 cases and it is the ONLY band where that is true.
- **At rank > 10, the base term decides two cases in three and `log` decides almost none (2 %).** The truth is
  not quiet because a prior outvoted it; it is quiet because the metric channel does not rank it first. No prior
  can repair that — every other term is a correction applied to this one — and the work is to the anomaly
  definition itself.

## 2. The base term loses by a LOT, not by a hair

For the 126 cases the base term decided, `truthSelf / winnerSelf` — read back out of the two contributions with
`expm1`, because the term is `weight × log1p(self)` at `selfAnomalyWeight = 1`:

| truth's self-anomaly as a share of the winner's |  cases |
| ----------------------------------------------- | -----: |
| ≥ 0.90 (a hair behind)                          |     14 |
| 0.70–0.90                                       |     23 |
| 0.50–0.70                                       |     12 |
| 0.30–0.50                                       |     32 |
| > 0–0.30                                        | **45** |
| 0 (truth not anomalous at all)                  |      0 |

**Median 0.413.** Only 14 of 126 (11 %) are within 10 % of the winner. A rescaling of the base term cannot move a
case whose truth reads at 40 % of the winner's loudness without also moving every case it was calibrated on.

The truth is never at exactly zero: every one of the 236 has _some_ anomaly at the truth, so the corpus is not
blind — it ranks the truth second-best or worse while seeing it. That distinction matters, because "the corpus
cannot see the fault" and "the corpus sees it and prefers something louder" imply different work, and this reading
says the second one.

## 3. Where the two loud families come from

| fault family               | misses | decisive term(s)                    |
| -------------------------- | -----: | ----------------------------------- |
| `HTTPResponseReplaceCode`  |     58 | base 44, `dualFamily` 8, `lat` 6    |
| `HTTPRequestReplaceMethod` |     44 | base 29, `lat` 6, `dualFamily` 5    |
| `NetworkPartition`         |     20 | base 7, `lat` 6, `dualFamily` 6     |
| `HTTPRequestDelay`         |     19 | base 6, `dualFamily` 5, `lat` 5     |
| `HTTPResponseDelay`        |     19 | base 8, `dualFamily` 4, `log` 4     |
| `NetworkLoss`              |     13 | base 5, `log` 4, `dualFamily` 3     |
| `NetworkBandwidth`         |     12 | base 5, `lat` 4, `log` 2            |
| `NetworkCorrupt`           |     10 | **`log` 4**, `dualFamily` 2, base 2 |

**Two code-level families account for 102 of 236 misses (43.2 %)**: replacing a response code and replacing a
request method. Both are faults whose footprint is a _semantic_ one — a status that changed, a verb that changed —
and RCABench's 87 metric names carry no response channel (`near-miss-census.md` §3), so the resource metrics those
services export barely move. This is the same mechanism RCAEval's own paper names for its code-level half:
infrastructure metrics cannot surface a wrong value, and the diagnostic evidence has to come from logs or traces.

## 4. What the score did NOT use, measured

### 4.0 The `log` term's ceiling is above the base term's, and it fires there

The base term is `log1p(rank-normalised self anomaly)`, so its ceiling on any case is `log1p(1) = 0.693` at
`selfAnomalyWeight = 1`. The log term is a max-normalised share in `[0, 1]` at `logWeight = 1`, so **its ceiling
is 1.000** — 44 % above the term every other term is a correction to. On the 25 misses the log term decided, that
gap is not theoretical:

| quantity                           |                                       reading |
| ---------------------------------- | --------------------------------------------: |
| winner's `log` contribution        |                         **1.000 on 25 of 25** |
| truth's `log` contribution         |        0.000 on 22 of 25, ≤ 0.003 on the rest |
| median base gap (`winner − truth`) | **−0.017 — the base term favoured the TRUTH** |

So on these cases the base term had already chosen correctly and the log term overrode it with a full-weight
constant, on the strength of a service being **louder in logs** — which on a propagated failure is the victim. The
band table in §1 is the same fact from the other side: `log` decides 32 % of the rank-2–3 band and 2 % of the
rank->10 band, because at rank 2–3 the base gap is small enough for a 1.0-ceiling term to cross it.

This is a **dimensional** defect rather than a weight to tune: no value of `logWeight` above 0.693 can prevent the
term from out-weighing a maximal base contribution, and every published reading of `logWeight` was taken with that
property already in it. It is recorded here as the next arm's target and not changed in this iteration, because
changing it moves every cell the golden half publishes and needs its own pre-registration.

### 4.1 Per-term reach on the 236

The same probe reports, per term, how many of the 236 candidates received a non-zero contribution at all:

| term                                                                                         |   weight | non-zero at the winner | non-zero at the truth |
| -------------------------------------------------------------------------------------------- | -------: | ---------------------: | --------------------: |
| `selfAnomalyLog1p`                                                                           |        1 |                    236 |                   236 |
| `stability`                                                                                  |   0.0074 |                    232 |                   235 |
| `dualFamily`                                                                                 |     0.25 |                    106 |                    23 |
| `lat`                                                                                        | 0.561495 |                     66 |                    30 |
| `log`                                                                                        |        1 |                     40 |                    22 |
| **`failedEdge`**                                                                             |    **3** |                  **2** |                 **1** |
| `trace`                                                                                      |        1 |                      0 |                     0 |
| `podState`                                                                                   |        8 |                      0 |                     0 |
| `faultFree`                                                                                  |        0 |                      0 |                     0 |
| `topo`, `collision`, `temporal`, `rise`, `prism`, `victim`, `source`, `selfTime`, `emission` |        0 |                      0 |                     0 |

Three rows are findings rather than configuration:

1. **`failedEdge` has the second-largest weight in the formula (3.0) and reached 2 of 236.** The corpus is not
   the reason: **157 of the 236 carry `failedTraceEdges`** — `HTTPResponseReplaceCode` 58/58,
   `HTTPRequestReplaceMethod` 44/44, `JVMReturn` 9/9, `JVMException` 8/8. The gate is the reason
   (`admitsFailedEdgeTerm`'s name half refuses any candidate whose dominant metric is not duration-shaped, which
   is 1 030 of 1 422 cases before any bar is consulted, and `evidence` mode needs a call denominator this corpus
   does not publish). `failed-edge-gate.md` recorded the golden half's version of this; §5 measures what the arm
   would be worth here.
2. **`trace` is 1.0 and reached nobody**, because the FSE'26 loader fills no `traceActivity` — the corpus ships
   `traceEdges` (pairs, no counts) and `traceEdgeLatency`, so the term's own input is ABSENT rather than zero.
   `lat` is the same data read as a node statistic, which is why 69 candidates do score on it.
3. **`faultFree` is 0 and the profile exists.** `/tmp/arms/profile.json` is byte-identical to a profile rebuilt
   from this corpus in this iteration (`md5 18344ca8…`, 2 080 channels over 51 services, 1 422 cases) — so the
   prior has been an INPUT of every run since iteration 314 and its weight has been the ablation at 0 throughout.
   §5 is the arm.

## 5. The `faultFree` arm: two aggregations, one degenerate, one refused

`docs/architecture-audit-265.md` §2 named the run and it had never been made: the fault-free weight had been read
only as the ablation. The term rewards a candidate whose anomalous channel is one the system RARELY produces when
nothing is wrong (`1 − rate`), which is the corpus-side form of the failure mode the 2026 agent literature codes
as **OMIT1 / baseline-missing** — "did not compare against the pre-failure healthy baseline" — the single most
common omission in the Qwen arm of `arXiv:2608.21310` (51.9 % of its failures).

The profile is real and it was already an input: `/tmp/arms/profile.json` is **byte-identical** to one rebuilt
from this corpus in this iteration (`md5 18344ca8…`, 2 080 channels over 51 services, counted from 1 422 cases).
So the prior has been fed to every run and its weight has been the ablation at `0` throughout.

### 5.1 `rarest` — the aggregation is DEGENERATE on this corpus

| arm                 |   `Top@1` | `Top@3` | `Top@5` | rows whose score moved |
| ------------------- | --------: | ------: | ------: | ---------------------: |
| control (`w = 0`)   | **1 186** |   1 236 |   1 255 |                      — |
| `rarest`, `w = 0.1` |     1 186 |   1 236 |   1 255 |            40 of 1 422 |
| `rarest`, `w = 0.3` |     1 186 |   1 236 |   1 255 |            51 of 1 422 |
| `rarest`, `w = 1.0` |     1 186 |   1 236 |   1 255 |            83 of 1 422 |

The scores moved and no rank did, and the reason is arithmetic rather than a weighting: **`rarest` reads the
minimum `rate` over EVERY channel the service carries**, and 150 of the profile's 2 080 channels have `rate = 0`.
A service with thirty-nine channels therefore almost always has one that never fires when nothing is wrong, so
`1 − r_e` is **1.0 for essentially the whole fleet**:

> A 60-case systematic sample (every 24th datapack, seed 7) measured **2 distinct `faultFree` scores per case, in
> 60 of 60 cases**. On `ts0-mysql-loss-67k278` the 50 scored services collapse onto two values, and 49 of them are
> `1.000`.

A term that pays every candidate the same is a constant added to every score, and a constant cannot re-order
anything. This is the mechanism `dual-family-gate.md` measured for its own bonus ("a constant 0/1 bonus cannot
re-order a cell"), reached from the other direction: here the constant is not 0/1 by construction but 1.0 by
degeneracy.

### 5.2 `dominant` — the signal is real, the direction is against the base term

`dominant` reads the `rate` of the channel the candidate's anomaly actually came from, which is the reading the
term's own docblock describes. It is not degenerate, and it is not a gain:

| arm                   |   `Top@1` |   `Top@3` |   `Top@5` | gained / lost at rank 1 |
| --------------------- | --------: | --------: | --------: | ----------------------: |
| control               | **1 186** |     1 236 |     1 255 |                       — |
| `dominant`, `w = 0.3` |     1 175 | **1 249** | **1 279** |                 15 / 26 |
| `dominant`, `w = 1.0` |     1 143 |     1 247 |     1 278 |                 28 / 71 |

**The shape is a flattening, and it is legible in one row of the migration table**: at `w = 0.3` the single
largest movement is `1 → 2` on **20 cases**, against `2 → 1` on 9. The term does not point at noise — `Top@3` gains
17 and loses 4, `Top@5` gains 24 — it points at a **different candidate than the base term does**, and on this
corpus the base term is right twice as often as it is wrong.

By family at `w = 0.3`, the loss is concentrated and the gain is not:

| family                     | gained |  lost |
| -------------------------- | -----: | ----: |
| `NetworkPartition`         |      0 | **7** |
| `NetworkDelay`             |      0 |     5 |
| `NetworkBandwidth`         |      0 |     5 |
| `JVMException`             |  **5** |     0 |
| `HTTPResponseDelay`        |      2 |     0 |
| `HTTPResponseReplaceCode`  |      2 |     1 |
| `HTTPRequestReplaceMethod` |      2 |     3 |

`NetworkPartition` losing seven and gaining none is the pre-registered **P3** in its second form: a partition
makes a _reachability_ channel fire, and that channel is noisy in the fault-free window too — so `1 − r` is small
exactly where the fault is loudest in its own units, and the term prefers a quieter neighbour.

### 5.3 Verdict against the gates written in advance

| gate                                              | stated              | measured                                                        | result          |
| ------------------------------------------------- | ------------------- | --------------------------------------------------------------- | --------------- |
| **B1** net ≥ +10                                  | `Top@1` ≥ 1 196     | 1 175 (`0.3`) / 1 143 (`1.0`)                                   | **fail**        |
| **B2** no family −2                               | ≥ 64 each           | `NetworkPartition −7`, `NetworkDelay −5`, `NetworkBandwidth −5` | **fail**        |
| **B3** half the gain in the rare-channel families | ≥ 50 %              | net gain negative at both weights                               | **not reached** |
| **B4** monotone in weight                         | 0.1 moves something | `rarest` moved nothing; `dominant` moves monotonically down     | **pass**        |
| **B5** `Top@3`/`Top@5` may not fall               | ≥ 1 236 / 1 255     | 1 249 / 1 279 at `0.3`                                          | **pass**        |

**The arm is refused on `Top@1`, and the published configuration does not move.** `faultFreeWeight` stays `0`,
`rarest` stays the default, and every published cell reproduces with no flag.

What the refusal buys is the two facts underneath it, neither of which existed before this iteration:

1. **`rarest` is the wrong aggregation for a corpus whose profile carries zero-rate channels**, and the statement
   is arithmetic rather than a preference: 2 distinct scores per case, 60 of 60. The alternative is implemented
   and measured; it is not a gain either, but it is no longer untested.
2. **A prior that agrees with the base term is worth nothing and a prior that disagrees with it loses.** `Top@5`
   rising while `Top@1` falls is the signature of a second opinion rather than a better one, and it is the third
   independent measurement of that shape on this corpus (after `dualFamily`'s gate and the containment reach).

## 6. What this document does not claim

- **It does not claim the decomposition is a cause.** A term with the largest difference is the term that
  decided the miss; whether the corpus was RIGHT to give the winner more of it is a different question, and §3 is
  where the two are separated.
- **It does not name a per-family rule.** §3's table is a description computed with the labels of other cases and
  cannot be a feature; it says which mechanism to look for, and the mechanism has to be re-expressed as something
  the engine observes within one case.
- **It does not re-open the closed axes.** `topo`, `collision`, `rise`, `prism` read zero because their weights
  are zero, and every one of those zeros was measured before it was shipped (`closed-axes-register.md`).
- **It does not read §5.2's `Top@5` gain as a win.** The published reading is `Top@1`, the arm loses 11 cases
  there, and a gate that moved to whichever column improved would be a gate in name only.

## 7. Reproduce

```sh
# the per-case artifact the misses are read from
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> \
  --fault-free-profile <profile.json> --failure-containment-scope global-measured \
  --output run.json --per-case-out run.ndjson

# the decomposition
pnpm exec tsx scripts/dump-miss-anatomy.ts --data-dir <corpus> \
  --per-case run.ndjson --fault-free-profile <profile.json> \
  --failure-containment-scope global-measured --out anatomy.ndjson
```
