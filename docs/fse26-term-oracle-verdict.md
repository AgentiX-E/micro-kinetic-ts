# The term oracle — the dump as an instrument, and what it closes

> Builds the free read the register demanded before any further run: a reconstruction
> of the engine's three scored terms from a diagnostic dump alone, validated by
> reproducing the shipped run's own rank-1 on **1422/1422 cases**. Three results follow.
>
> 1. **The log-mode axis is answered, and the answer is NO.** `count` collapses to
>    **496/1422 (34.9%)** with **9 regressed fault types**; the built-but-never-measured
>    `logicHttpDominant` reaches **775** at its default threshold with **5 regressed
>    types**, and at the only threshold where it regresses nothing (0.2) its entire
>    effect is **1 case** — inside the instrument's own ±5 error bar. The register's
>    reopening condition ("a new mode is both measured and better on the same cache") is
>    therefore **not met**, by measurement rather than by argument.
> 2. **The per-case discriminator the ceiling analysis named now has a measured bound.**
>    A perfect per-case choice among the four blend configurations reaches
>    **871/1422 = 61.25%**, i.e. **+8.51pp** over the shipped 750; a perfect choice of one
>    TERM alone reaches 880 (61.88%). **551 cases (38.8%)** are named by no configuration
>    at all. The lever is real and it is bounded, and the bound is much smaller than the
>    ceiling analysis's "89% individually reachable" reads on its own.
> 3. **A candidate with no service name is in every case.** One printed row per case
>    carries an EMPTY id and the ten unlabelled `k8s.*` series. It is a real candidate —
>    `n = 51`, which is what puts the metric term's step at exactly `1/50` — and the
>    shipped parser silently dropped it. Dropping it from the ENGINE costs a case
>    (750 → 749), so it is recorded, not shipped.
> 4. **A sampled claim in a shipped verdict is refuted by census**, and the family it
>    named is not the one that separates: the source's dominant metric is `hubble_http_*`
>    in 15.3% of misses against the winner's 15.6% (Δ **+2**), while the source's anomaly
>    is RESOURCE-driven (`k8s.*`/`container.*`/`jvm.*`) 85 cases more often than the
>    winner's and the winner's is CLIENT-duration/pool-driven 131 cases more often.

## 1. The instrument, and why it is exact

The shipped score is `log1p(A) + logWeight·logScore + latWeight·lat` with `A` from
`rankNormalizeScores`. The dump carries enough to rebuild all three:

| term | source in the dump | exactness |
| --- | --- | --- |
| metric `A` | the printed service ORDER (the formatter sorts by self-anomaly) and `n` | **exact**: `A` is the mean rank of a value's tie group over `n − 1` |
| log | the per-service `logScore` field, or rebuilt from the printed `logic`/`http` counts | printed to 3 dp; a rebuild is within **±5 cases** (below) |
| latency | `latRise` + the rise floor, `log1p(max(0, rise − 1))` max-normalised | same shape as the engine's `computeEdgeLatencyScores` |

Two details are load-bearing, and both are easy to get wrong:

- **`A` is the TIE-GROUP MEAN, not the position.** `rankNormalizeScores` assigns
  `(i + j) / 2 / (n − 1)` to a group of services sharing a value, so reading a rank off a
  row's position reports two distinct values for two services the engine scored equally.
  The groups are recoverable because the printed value IS the group mean, and the
  reconstruction reproduces the printed value to `4.90e-4` on **all 72,527 printed
  services** (`0` above `5e-4`). The report prints that number instead of asserting it.
- **The order is re-derived through the printer's comparator, never taken from the array
  order.** The two agree on `1422/1422` cases, which is itself reported: a dump where they
  disagree is a defect, not a nuance.

The instrument is then validated the only way that matters — against the run it is
derived from:

```
cases 1422; services 72527; logWeight=1 latWeight=0.561495 latFloor=10.3
metric term: max |recomputed - printed| = 4.90e-4; services above 5e-4: 0
printed order reproduced from the printed values: 1422/1422 cases
rank-1 reproduced: 1422/1422 cases; rank-1 an acceptable root: 750
log term: counts-derived vs printed, services above 6e-4: 109; cases whose rank-1 moves: 5
```

**Reproducing rank-1 on all 1422 cases with `750` correct is the shipped headline,
recomputed from the log text.** That is the whole claim: the reconstructed terms ARE the
terms the run scored with.

**The error bar is 5 cases, and it is stated rather than hidden.** The dump prints
`logScore` at three decimals while the counts behind it reach thousands, so RE-DERIVING
the log term — which is what comparing modes requires — can move a case whose margin is
under `5e-4`. All five are `HTTPResponseReplaceBody`. Every mode row below therefore
reads as `recorded ± 5`, and a predicted gain inside that band is not evidence.

Both numbers were cross-checked against an independent implementation written before the
TypeScript module (a Python probe over the same dump): the oracle distribution, the
conflict tally and the menu ceiling agree **exactly**, and the mode-sweep rows agree
exactly on all seven thresholds. The cross-check also found **two defects in the
module**, both of the same shape — a value that was displayed but not used:
the sweep's threshold lived on the row while the reconstruction read it from the options
(every grid point printed the same numbers and read as a plateau the mode does not have),
and the menu's `lat only` point carried weight `1` instead of the shipped latency weight,
which would have made the ceiling a statement about a configuration the engine cannot
take. Both are fixed and both now have a test that fails without the fix.

## 2. The oracle census — which term is right, and where they disagree

Per case, each term's OWN order is read and compared against the acceptable roots
(the benchmark's labels are a LIST, so any root counts):

| terms whose own order names a root | cases |
| --- | --- |
| none | 542 |
| `log` | 450 |
| `lat` | 140 |
| `metric`+`lat` | 101 |
| `log`+`lat` | 77 |
| `metric`+`log`+`lat` | 47 |
| `metric`+`log` | 44 |
| `metric` | 21 |

The conflict tally is the register's "conflict between cases" measured directly:

| right beats wrong | cases |
| --- | --- |
| `log` beats `metric`+`lat` | 450 |
| `lat` beats `metric`+`log` | 140 |
| `metric`+`lat` beats `log` | 101 |
| `log`+`lat` beats `metric` | 77 |
| `metric`+`log` beats `lat` | 44 |
| `metric` beats `log`+`lat` | 21 |

`log` is right where both others are wrong 450 times and wrong where both are right 101
times: a population of 551 cases demanding opposite treatments from ONE global weighting.
The metric term alone names a root in **21** cases; the log term alone in **450**.

The metric rank of the best-ranked root is spread over the whole list, not concentrated
at the top (`#1` 213, `#2` 102, `#3` 89, … `#46` 1): the misses are not near-ties in the
metric layer, they are deep ordering errors — which is consistent with the dimension
theorem and closes the "promote the runner-up" family for good.

## 3. The ceilings a per-case chooser would be spending

The shipped formula cannot switch its metric base off, so the configurations a per-case
chooser can actually pick are four points: `metric only`, `log only`, `lat only` (each at
the shipped weights) and the shipped blend itself.

| | cases | Top@1 |
| --- | --- | --- |
| shipped blend | 750 | 52.74% |
| **menu ceiling** — best of the four, per case (an ORACLE) | **871** | **61.25%** |
| single-term ceiling — best of the three terms alone (not implementable: the metric base is always on) | 880 | 61.88% |
| named by NO configuration | 551 | 38.75% |

So the entire per-case-discriminator programme is worth **at most +8.51pp**, and it must
convert that oracle into a decision rule that loses nothing — i.e. it must be right on
essentially every case it decides, while the population it is deciding is the conflict
tally above. That is a much narrower door than "89% of misses are individually
reachable" suggests on its own, and the two statements are not in conflict: reachability
counts a case as reachable if SOME weighting serves it, while the menu counts only the
configurations the engine can be run at.

Which configurations cover a case, and how often two do:

| configurations that name a root | cases |
| --- | --- |
| (`none`) | 551 |
| `log only` + shipped | 457 |
| `log only` + `metric only` + `lat only` + shipped | 141 |
| `lat only` + shipped | 73 |
| `log only` + `lat only` + shipped | 64 |
| `lat only` | 63 |
| `metric only` + `lat only` | 56 |
| `log only` + `metric only` + shipped | 11 |
| `metric only` + `lat only` + shipped | 3 |
| `metric only` | 2 |
| shipped | 1 |

`lat only` is the only configuration that reaches 63 cases nothing else reaches, and
`metric only` reaches 2: the two terms that are individually weakest are also the ones
carrying cases the blend cannot get.

## 4. The log-mode axis, closed by measurement

Every row is compared against the RECORDED log term per fault type, from one dump:

| configuration | correct | gained/regressed cases | regressed fault types |
| --- | --- | --- | --- |
| `recorded` (shipped `logicHttp`) | 750 | +0/−0 | 0 |
| `count` | **496** | +129/−383 | **9** (…`ReplaceCode` −149, `RequestReplaceMethod` −61, `RequestAbort` −42) |
| `logicHttp` re-derived from counts | 755 | +5/−0 | 0 (the ±5 rounding artefact) |
| `dominant` @ 0.2 | 756 | +6/−0 | 0 |
| `dominant` @ 0.3 | 765 | +33/−18 | 5 (`ReplaceCode` −9, `RequestAbort` −2, …) |
| `dominant` @ 0.4 | 777 | +64/−37 | 5 (`ReplaceCode` −14, …) |
| `dominant` @ 0.5 (the engine's default) | 775 | +69/−44 | 5 (`ReplaceCode` −15, `RequestAbort` −7, `ResponseAbort` −5, `ReplacePath` −3, `ReplaceMethod` −1) |
| `dominant` @ 0.6 | 769 | +84/−65 | 5 (`ReplaceCode` −21, …) |
| `dominant` @ 0.8 | 770 | +85/−65 | 5 (`ReplaceCode` −21, …) |
| `dominant` @ 0.95 | 598 | +94/−246 | 6 (`ReplaceCode` −98, …) |

**The verdict.** `count` mode is not a candidate at any point on the benchmark: the
framework-HTTP half is what detects the replace-code population, and withdrawing it
costs 383 cases. `logicHttpDominant` — added in `78eb99e` with the message "falsified
before ablation", and never measured until now — is the one mode whose DIRECTION is
right: at 0.2 it gains **6** cases and regresses none. But five of those six are the
instrument's own rounding artefact (the fifth column of the `logicHttp` row: `+5/−0`, all
`HTTPResponseReplaceBody`), so the mode's own contribution is **1 case**, inside the ±5
error bar. Every threshold at which the gate actually suppresses something (−0.3, −0.9,
−0.14, −0.15, −0.21, −98 on `HTTPResponseReplaceCode`) fails the criterion's second half.

The mechanism is worth recording because it is the register's conflict again, from a
third direction: the framework-HTTP flood is a **source signature** in the replace-code
population (one emitter owns 90–100% of it) and a **victim cascade** in the network
population (spread across callers). `dominance` separates the two **cases** well — the
0.9–1.0 bucket holds 597 cases and the 0.2–0.4 buckets hold 224 — but the shipped
configuration needs both populations served at once, and no threshold does that: the
gate is right about WHICH cases it suppresses and wrong about what to do with them.

## 5. The dominant-metric family: a sample claim refuted, and a feature that does separate

`fse26-data-gap-verdict.md` states, from ten sampled rows, that "the source's dominant
metric is almost always `hubble_http_request_duration_pXX`, never its fault-specific
signature". Censused over all **672 misses** by the `--term-oracle` section itself
(`dominantFamilyCensus`), classified by the family of the series that won each service's
anomaly maximum:

| dominant family | source | winner | Δ (winner − source) |
| --- | --- | --- | --- |
| `jvm.*` | 131 | 157 | +26 |
| `http.server.request.duration*` | 142 | 96 | −46 |
| `db.client.connections.*` | 48 | **128** | **+80** |
| `k8s.*` | **122** | 42 | **−80** |
| `hubble_http_*` | **103** | **105** | **+2** |
| `http.client.request.duration*` | 26 | 77 | +51 |
| `container.*` | 47 | 16 | −31 |
| `queueSize` | 36 | 45 | +9 |
| `otlp*` / `processed*` (trace) | 17 | 5 | −12 |
| `hubble_icmp_total` | 0 | 1 | +1 |
| **total** | **672** | **672** | |

**Two results, and the first one matters more than the second.**

**The sample claim is refuted.** The source's dominant metric is a `hubble_http_*` series
in **103 of 672** misses (15.3%), and the WINNER's is the same family in **105** (15.6%):
Δ = **+2 cases**, i.e. the family carries no information about which service is which. A
ten-row sample said "almost always"; the census says "about one time in seven, for both
sides equally". This is the third time this register's rule — *a type-level claim needs a
census, not a sample* — has paid, and the first time it has reversed a claim in a shipped
verdict document.

Two grouping choices are part of the measurement rather than incidental: the bare and
`.max` variants of `http.server.request.duration` are ONE family, and the whole
`db.client.connections.*` prefix is one — keyed on the full name they report as four
families and a 46-case and an 80-case separation each read as two that look like noise.
Anything the classifier does not claim is returned as its OWN name (`hubble_icmp_total`
above), never pooled into `other`.

**A feature that does separate**, and it is not the one the sampled claim pointed at. The
source's anomaly is driven by a **resource** series — `k8s.*`, `container.*` or `jvm.*` —
in **300 of 672** misses (44.6%) against the winner's **215** (32.0%): a margin of **85
cases.** The winner's anomaly is driven by a **client-side duration or the DB pool**
(`http.client.request.duration*` + `db.client.connections.*`) in **205** misses against
the source's **74**: a margin of **131 cases**, in the same direction as the register's
"the emitter is credited" finding but computed from the metric layer instead of the log
layer.

Two caveats keep this from being a candidate on its own, and both are the register's:

1. The two largest deltas sit on series already inside closed rows. The pool series is the
   one the `dropMetrics` label drop removed (+0.28pp, 2 regressed types, rejected), and
   `k8s.*`/`container.*` are the silent stock's own series. A rule built here must say
   which of those rows it does not touch and why.
2. It is a 14-way categorical over a service's OWN evidence, so it is adjacent to the row
   that excludes "any function of that service's own metric score". A rule that
   down-weights a pool-dominant winner *conditional on another service being
   resource-dominant* is a different object from a transform of a score — but it has to be
   argued as such, and pre-screened, before it is proposed.

The instrument can pre-screen it at zero cost, which is the next iteration's work; this
section publishes the feature screen it would start from, so the next proposal either uses
these margins or explains why not. The census is a section of `--term-oracle`
(`dominantFamilyCensus`), not a session's throwaway probe, so every number above is
reproduced by the command in §8.

## 6. The candidate with no name

Every case but one carries a printed row whose service id is EMPTY:

```
   selfAnomaly=0.100 logScore=0.000 failedEdge=0.000 failedEdgeRecords=0 latRise=- latEdges=0 dominant=k8s.container.restarts err=0 fatal=0 logic=0 http=0
    metrics(10): k8s.container.cpu_limit,k8s.container.cpu_request,k8s.container.memory_limit,…
```

It is the ten unlabelled `k8s.*` series (`k8s.container.*`, `k8s.pod.phase`,
`k8s.replicaset.*`, `k8s.namespace.phase`) — cluster-level metrics with no service label,
which the converter emits as a candidate service. Measured consequences:

- **1421 of 1422** cases carry it; its self-anomaly is `0.00–0.36`; it ranks **last** in
  943 cases and never once appears in the engine's top-5. It has never decided a ranking.
- It IS one of the `n` candidates, and `n` is the divisor of every service's metric term:
  with it, `n = 51` and the step is exactly `1/50`; without it, `n = 50`. The shipped
  geometry therefore depends on an unlabelled row.
- **Dropping it from the engine costs a case: 750 → 749** (the loss is
  `ts0-ts-travel2-service-response-abort-bvl7cs`, which is also the latency cap's binder).
  A change that loses a case and gains none is not a candidate, so the defect is RECORDED,
  not shipped.

Two parser defects came out of the same investigation, and both are fixed in this
iteration because the instrument cannot be exact without them:

1. `SERVICE_RE` required a non-empty id (`\S+`), so that row was **silently dropped** and
   the parsed service list disagreed with its own header in 1421/1422 cases — nothing
   checked. The pattern is now `\S*`.
2. `parseDiagnosticDump` never compared the parsed count against the header's
   `services=`. A block whose list is short is a different `n` — which changes the metric
   term of EVERY service in the case — so such a block is now dropped, on the same rule
   that already drops a truncated one: an absent case is visible in the totals, a wrong
   one is not.

## 7. What this closes, and what is left

**Closed by measurement (new register rows):** the log-signal mode axis, at its stated
reopening condition; the unlabelled-candidate axis (750 → 749); and the per-case
discriminator, whose bound is now a number rather than a direction.

**Still open, in the order the numbers suggest:**

1. **`HTTPResponseReplaceCode` is 231 cases at 68.8%** and is the single largest block on
   the table — 159 correct, 72 wrong, and the register records that its 58
   `ts-ui-dashboard`-sourced cases are at 0.0. Any candidate that names *which* of the two
   populations it addresses has 72 cases of headroom inside one fault type.
2. **The 551 cases no configuration of the shipped formula can reach** need new EVIDENCE,
   not a new weighting. The oracle census says what that evidence would have to beat: the
   source is behind the winner on the metric (median rank of a root among the misses is
   deep, not near the top) and the winner's metric is assembled from an `hubble_http_*`
   series in most of them.
3. **A discriminator, if one is proposed, must clear a quantified bar** (§3): +8.51pp is
   the entire headroom, it is an oracle, and it must be reached with zero regressions.
   A candidate that cannot state its expected accuracy against the conflict tally has not
   engaged the measurement.
4. **The dominant-metric family is the first computed feature with a large margin**
   (§5) — 85 cases on the source side, 132 on the winner side — and the one the sampled
   claim wrongly named (`hubble_http_*`, Δ+2) is not it. Pre-screening a rule built on it
   is free.

## 8. Reproduce

```bash
# the instrument, on the shipped dump (no run, no rebuild: read the CI artifact)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --term-oracle

# the same module's tests and their coverage
cd benchmarks && npx vitest run --coverage
```

Every number above is in the section that command prints, and every one of them is
recomputed from the dump on each run rather than pasted here.
