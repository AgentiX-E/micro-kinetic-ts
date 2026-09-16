# The term oracle — the dump as an instrument, and what it closes

> Builds the free read the register demanded before any further run: a reconstruction
> of the engine's three scored terms from a diagnostic dump alone, validated by
> reproducing the shipped run's own rank-1 on **1422/1422 cases**. Four results follow.
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

## 8. The routing map at the SHIPPED configuration

§6 and §7 measured the census at the pre-pool baseline, because no `diagnose` run had ever
been dispatched with the pool penalty ON over all 1422 cases — the fourth-term row's
reopening condition said exactly that, and said a pool-ON dump was what it needed. That
dump now exists (`35035314921`, the shipped configuration through the default path) and
the map below is read from it, with all four terms live.

Fidelity first, because everything else is a claim made through this reconstruction:

```
  cases 1422; services 72527; logWeight=1 latWeight=0.561495 latFloor=10.3 poolWeight=0.0679
  metric term: max |recomputed - printed| = 4.90e-4; services above 5e-4: 0
  printed order reproduced from the printed values: 1422/1422 cases
  rank-1 same as the dump's own recorded: 1422/1422 cases; an acceptable root: 756
  moved by the pool penalty: 103; moved by the temporal prior: 0
```

`1422/1422` and `756` are the two numbers that license the rest: the reconstruction
reproduces the run's own decisions, and the run's own headline.

**The routing map.** 666 misses, attributed to the terms that decided them:

| decided by | cases |
| --- | --- |
| metric alone | 261 |
| metric+log | 106 |
| metric+log+lat | 73 |
| log alone | 109 |
| metric+lat | 50 |
| log+lat | 21 |
| metric+log+pool | 10 |
| lat alone | 10 |
| log+pool | 11 |
| metric+pool | 7 |
| log+lat+pool | 4 |
| pool alone | 2 |
| lat+pool | 1 |
| metric+log+lat+pool | 1 |
| **silent on both sides** | **221** |

Three things it settles, none of which the pre-pool reading could:

- The **74 non-reweightable** cases the framing quotes are exactly `metric+log+lat` (73)
  plus `metric+log+lat+pool` (1) — the pre-pool derivation, reproduced on a dump the
  instrument had never read. That is a cross-check of §6, not a new claim.
- **221 cases are silent on BOTH sides** — no error evidence for the source and none for
  the winner. That is the weak-stock population, and it is larger than any single term's
  miss count.
- The pool term's footprint is **103 cases** for a net of +6, which is the §7 finding
  unchanged: 97 of the 103 moves were on already-wrong cases.

**The term-oracle ceilings at the shipped configuration** move with the added term:

```
  none 542; log 450; lat 140; metric+lat 101; log+lat 77; metric+log+lat 47; metric+log 44; metric 21
  single-term ceiling 880 (61.88%); unreachable by any single term 542
  menu ceiling (best of 3 blends + shipped) 878 (61.74%); shipped 756 (53.16%)
```

`878` against the pre-pool `871`, and `542` named by none against `551`: the pool term
adds seven cases to what a perfect per-case chooser could reach, which is the headroom the
discriminator verdict counts as 122.

**The family census moves with the configuration, so §5's figures are not this run's.**
Re-read on the shipped dump, over its 666 misses (`delta = winner − source`):

| family | source | winner | delta |
| --- | --- | --- | --- |
| `k8s` | 122 | 47 | **−75** |
| `container` | 47 | 23 | −24 |
| `db.client.connections` | 48 | 25 | −23 |
| `http.server.duration` | 139 | 127 | −12 |
| `trace` | 17 | 6 | −11 |
| `hubble_http` | 103 | 114 | +11 |
| `queueSize` | 36 | 54 | +18 |
| `jvm` | 130 | 183 | **+53** |
| `http.client.duration` | 24 | 84 | **+60** |

The source's side of the margin is still the resource families (`k8s` + `container`), but
it is **narrower** than §5's 85/132 split and `jvm` has moved to the WINNER's side, which
is why §5's grouping of `jvm.*` with the source's resource signature must not be reused:
the same prefix is a source's own stress signature in one population and a shared
node-level series in this one. The winner's side is dominated by client-duration and by
`jvm.system.cpu.load_1m` — the shared series the fleet-relative candidate was built for
and rejected.

## 9. The third mode: `all`, which the separator census asked for and the term refuses

`all` is the mode the engine's own documentation describes as targeting "fault classes where the
SOURCE — not the symptom — floods errors with a non-logic exception". It had never been measured,
and `fse26-separator-verdict.md` gave it a precondition: in the network partition cases the true
source carries MORE total error lines than the engine's pick (30-3) while carrying more
*signature* lines in **none** of 29 — the level-1 gate is what discards that population's own
fault evidence.

It is now rebuildable from a dump and measured. Its flood is every ERROR/FATAL line, so it is
`err + fatal` and there is **no union to recover** — which makes it the only counting mode whose
row survives a dump that predates `both=` (and the only row above measured on all 1422 cases
rather than the reconstructable 1391).

At the shipped configuration:

| configuration | correct | +/− cases | regressed types |
| --- | --- | --- | --- |
| `recorded` (shipped) | 756 | +0/−0 | 0 |
| `logicHttp` (the dump's own mode) | 730 | +0/−0 | 0 |
| `dominant@0.2` | 731 | +1/−0 | 0 |
| **`all`** | **569** | **+95/−282** | **17** |
| `count` | 531 | +130/−355 | 8 |

**`all` is the worst row on the table**, and its 17 regressed types include every HTTP type it
was supposed to help: `HTTPRequestDelay −48`, `HTTPResponseDelay −44`, `HTTPRequestReplaceMethod
−28`, `HTTPResponseReplaceCode −27`. The types it costs *least* are the resource/JVM/network ones
(−1 to −8) — the opposite of the engine's own stated target, exactly as `logicHttpDominant`'s
prediction was the opposite of its measurement (`fse26-emitter-dominance-falsified.md`).

So the register's reopening condition for this axis — "a new mode is both measured and better on
the same cache" — is answered **negatively for `all`**: measured, and 187 cases worse than the
shipped mode with 17 fault types against it.

**The lesson is the one this pair of instruments exists to produce.** The separator census
measures a PREFERENCE between two services; a mode is a TERM, normalised across the case. The
source owning the flood inside a pair is a real fact — 30-3 — and it does not survive the
case-level normalisation, because the cases where some other service floods *harder* outnumber
them. A paired separation is a necessary condition, not a sufficient one, and the two numbers
that have to be read together are the pair counts (`30-3`) and the frontier row (`569, 17 types`).

**And the self-check stopped being silent.** `ModeScreenSelfCheck` printed only when a check
existed, so a dump in a mode this reader cannot rebuild printed nothing — indistinguishable from
"checked, found nothing". It now names the mode and says there is no check; and the
`logicHttpJoint` entry was removed from the mapping, because that mode's gate withdraws the
framework-HTTP half for a service whose callee is more anomalous, which this reader does not
rebuild: the "check" would have compared the joint mode against its own unjointed half and
reported a disagreement on every case.

## 10. `logicHttpJoint` re-attempted, because its own doc demanded it

The engine's comment on the joint mode ends with an instruction: its −19.4pp loss is on the record,
the attribution recorded with it is **provably wrong** ("normalisation is ruled out", the invariance
suite is a proof rather than a claim), and it says —

> **Do not re-attempt this mode without a fresh ablation on current data.**

So it is re-attempted here, offline, on today's cache. The gate is `logicHttp` minus the
framework-HTTP half of every emitter whose callee is more anomalous — a predicate over the call
graph, which the dump carries, and over the anomaly ORDER, which is invariant under the rescales the
engine ships, so the rebuild is faithful rather than similar.

| configuration | correct | +/− cases | regressed types |
| --- | --- | --- | --- |
| `recorded` (shipped) | 756 | +0/−0 | 0 |
| `logicHttp` (the dump's own mode) | 730 | +0/−0 | 0 |
| **`logicHttpJoint`** | **562** | **+75/−243** | **8** |
| `all` | 569 | +95/−282 | 17 |
| `count` | 531 | +130/−355 | 8 |

It costs **`HTTPResponseReplaceCode −104`** — against **98** in the historical run. The shape of the
loss reproduces on current data, the magnitude is the same order, and the target type is the same
one the mode was built for. The mode stays closed, now with a number instead of an instruction.

**And the open question around it is answered by the same rebuild.** The engine's doc names its
leading hypothesis for the loss — the victim predicate is *existential over a service's callees*, so
on a dense cascade most emitters have at least one more-anomalous callee and the withdrawal
approaches the whole graph. That is now measured, and it is not marginal:

```
joint gate footprint: withdraws 43.74% of all services (median case 0.43);
  the framework-HTTP flood OWNER is itself withdrawn in 571/972 cases (58.74%)
```

The gate deletes the flood from **the very emitter that owns it** in 59% of the cases that have an
owner. A mode whose withdrawal reaches its own evidence is not a signal decision that lost; it is a
near-total withdrawal, and the row's net (243 cases) could never have said so — which is why the
footprint prints with the table.

## 11. Reproduce

```bash
# the instrument, on the shipped dump (no run, no rebuild: read the CI artifact)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --term-oracle

# the same module's tests and their coverage
cd benchmarks && npx vitest run --coverage
```

Every number above is in the section that command prints, and every one of them is
recomputed from the dump on each run rather than pasted here.
