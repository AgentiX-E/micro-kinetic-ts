# Closed axes — read this before proposing an experiment

Every row is an axis that has been **measured and closed**. The purpose is not
bookkeeping: four times now an axis has been re-derived and proposed again — three
from totals, most recently a monotone transform of the metric term, which
`fse26-metric-competition-verdict.md` had already excluded by name after building
and measuring both surviving shapes.

The fourth is the one to learn from, because it was re-derived from a *statistic the
register itself supplied*: the metric-family gate was proposed again off a
"flippable vs would-be-hurt" count, which appears in
`fse26-metric-competition-verdict.md` as a **necessary** condition — and that is
exactly what it is, not an estimate. Recounted on the shipped configuration it reads
**79 flippable against 7 hurt** for the connection-pool family, its best ratio ever,
and the measurement it was proposing had already been run: **+0.14pp with five
regressed fault types**, and the block it targeted did not move at all. A count of
cases a change *could* affect carries no information about the cases it *does*.

## The number that frames every row below

Of the **672 misses** on the shipped configuration, **74 (11.0%)** have the winner
strictly ahead on the metric, the log AND the latency — no non-negative reweighting can
put the source first, so those need new EVIDENCE. The other **598 (89.0%)** have the
source at least level with the winner on some term, so each is individually reachable by
reweighting. The two computations agree exactly: the 74 are precisely the cases labelled
`metric+log+lat`, and nothing else is blocked.

Read together with the `logWeight` row — where NO single weight satisfies every case, and
the per-type oracle ceiling is 50.00% — this locates the obstacle precisely. It is **not**
absent evidence for 89% of the misses, and it is not a single bad weight: it is **conflict
between cases**, i.e. demands for opposite weightings from cases that a global (or
per-fault-type) weight cannot serve at once.

So the lever that is left is a **per-case discriminator** that decides *which term to
trust* — a context feature, finer than the fault type. What the existing evidence surfaces
can supply for that has been measured down: the error text cannot supply direction (19,522
`ERR:` lines name zero peer services or URLs), per-edge failure counts do not separate
source from victim at any weight, breadth does not (`latEdges`), the call graph's ancestry
does not (the source carries a latency rise at all in only 9.3% of the latency-involved
misses), and every metric-family/label/spacing gate has been measured. **A candidate here
must name the context feature and show it separates, on a free read, before any run.**

**A proposal must say which rows it does not touch, and why it is not one of
them.** If it cannot, the first thing to do is read that row's document. If it is
resting on a necessary-condition count, the second thing is to look for the row that
measured the change — the count cannot tell you whether it was ever run.

The **shipped FSE'26 headline is Top@1 53.16% (756/1422)**, Top@3 66.46%, Top@5
70.25% — the per-edge latency term at `latWeight=0.561495` with `latMinRise=10.3`
measured together (`34921980498`), plus the pool-dominance penalty at
`poolMetricPenaltyWeight=0.0679` measured against its own ablation on one commit
(`34949812666` / `34949854236`). The previous headline, 52.74% (750/1422) with Top@3
65.75% and Top@5 70.11%, is the same configuration with the penalty off — reachable as
`--pool-penalty 0`. Verdicts written earlier quote a **47.33%** or
**48.80%** control: those rows are historical records of what their ablation was
measured against, not the current number. Both are still reachable as ablations — the
`latWeight=0` control, and the `latMinRise=1` credited-everything shape at 48.80%.

| axis | where | the number that closed it | reopens only if |
| --- | --- | --- | --- |
| reweighting the log term (`logWeight`) | `fse26-logweight-sweep-verdict.md` | control 47.33%; `0.5` → 46.84% (−0.49pp); per-fault-type **oracle ceiling +2.67pp → 50.00%** | a per-type oracle that exceeds 50% exists, i.e. the metric term itself changes |
| log-signal mode (`count` / `logicHttp` / `all` / `novelty` / `logicHttpDominant`) | `fse26-framework-http-direction-verdict.md`, `fse26-term-oracle-verdict.md` | `count` 16.5%, `logicHttp` 46.5% — the shipped mode is the best measured; **the two modes that were built and never measured are now pre-screened offline, on the shipped dump**: `count` re-derived is **496/1422 (34.9%) with 9 regressed fault types** (`ReplaceCode` −149), and `logicHttpDominant` — "falsified before ablation" in `78eb99e` — reaches **775** at the engine's default 0.5 with **5 regressed types** (`ReplaceCode` −15). Swept from 0.2 to 0.95 the only point that regresses nothing is **0.2, at +6 cases of which 5 are the instrument's own ±5 rounding artefact** (`HTTPResponseReplaceBody`), leaving **1 case** — inside the error bar. The mechanism is the register's conflict a third time: the framework-HTTP flood is a source signature in the replace-code population (one emitter owns 90–100% of it, 597 cases) and a victim cascade in the network population (spread, 224 cases), and no threshold serves both | a new mode is both measured and better on the same cache. **The reopening condition is now answered for `logicHttpDominant`: it is measured, and it is not better.** `novelty` remains unmeasured — it cannot be rebuilt from a dump (it needs per-class line counts) and is not reachable from the FSE'26 CLI |
| a per-case DISCRIMINATOR that picks the configuration per case (the lever `fse26-latency-shape-verdict.md`'s ceiling analysis named) | `fse26-term-oracle-verdict.md` | **the bound is measured**: a perfect per-case choice among the four configurations the shipped formula can take (`metric only`, `log only`, `lat only` at the shipped weights, and the blend) reaches **871/1422 = 61.25%**, i.e. **+8.51pp** over the shipped 750 — and **551 cases (38.8%)** are named by NONE of them. A perfect choice of one TERM alone reaches 880 (61.88%), which is not implementable (the metric base cannot be switched off) but bounds the blend: no discriminator can exceed it. The conflict tally the discriminator would have to resolve is 551 cases demanding opposite treatments (`log` right where both others are wrong 450 times, wrong where both are right 101 times), and the metric layer misranks the root deeply rather than narrowly (median rank of the best root among misses **14**, mean 16.8; only 126 of 672 inside the top 3) | a discriminator that states its expected accuracy against the conflict tally, is pre-screened on the dump for free, and converts the +8.51pp oracle with **zero** regressed fault types |
| the unlabelled candidate (a service row with an EMPTY id — the ten `k8s.*` series with no service label) | `fse26-term-oracle-verdict.md` | present in **1421/1422** cases, self-anomaly 0.00–0.36, last position in 943 cases, never in the engine's top-5; it IS one of the `n` candidates and `n` is the divisor of every metric term (`n = 51` is what makes the step exactly `1/50`). Dropping it from the engine measures **750 → 749** — one case lost, none gained — so it is recorded rather than shipped. The PARSER defects it exposed are fixed: `SERVICE_RE` required a non-empty id and silently dropped the row (the parsed count disagreed with the header's `services=` in 1421/1422 cases, unchecked), and a block whose parsed count is short is now dropped like a truncated one because it is a different `n` | a candidate filter that removes it and does not lose a case — or a converter change that gives those series a home |
| metric term: any monotone transform or bound of a service's OWN score | `fse26-metric-competition-verdict.md`, `fse26-logweight-sweep-verdict.md` | both surviving shapes built and rejected; a bound/rescale can only shrink a margin or tie, and the metric term is bounded in `[0,1]` while one log step is a full `1.0` | the candidate is **not** a function of that service's own metric score |
| metric term: fleet-relative baseline | `fse26-metric-competition-verdict.md` | `metricFleetBaseline` measured, rejected (+0.49pp / 6 type regressions) | a different cross-service statistic than the median |
| global min-max normalisation of ranks | `fse26-metric-competition-verdict.md` | measured **+0.00pp** | never — it is the same ordering rescaled |
| monotone compression of the TOTAL score | `fse26-metric-competition-verdict.md` | proved non-reordering; measured **−2.67pp** | never — non-reordering is a proof, not a measurement |
| anomaly dynamic range (rise ceiling) | `fse26-metric-competition-verdict.md` | dynamic-range ablations measured and rejected | a bound that is **not** monotone in the service's own score |
| `rankNormalization` (reverting it) | `bothwrong-evidence-verdict.md` | load-bearing: TT RE3 **3.6% → 51.1%** | never — this is the largest single measured effect in the repo |
| failed-edge direction signal — direction, volume (`minRecords`), aggregation (`mean`) AND scale | `fse26-failed-edge-verdict.md` | +5.8pp but 2 regressed types; the floor recovers them and spends all +82; and the weight is solved, not swept: the 62 fixed cases need `w ≥ 0.580` while the 5 broken ones tolerate `w ≤ 0.261`, so **no weight exists** | a discriminator that separates source from victim on a *different* signal — a topological-source gate was tried and **REJECTED by simulation**: it recovers both regressed types but costs 71 `ReplaceCode` cases and lands at 155 against a baseline of 166. It is not a source detector — it asks whether the source is the single most anomalous service, which is the metric layer's own failure (`ts-ui-dashboard` false in 57 of 58). See `fse26-stock-attribution.md` |
| per-edge latency-reward signal (`latWeight`) — **the opening cell below records the `0.03` step; the SHAPE row further down supersedes it as the shipped value** | `fse26-latency-term-verdict.md` | matched pair at `0.75`: 47.33% → **55.20%**, 673→785 (**+7.88pp**), Top@3 +11.88pp, Top@5 +13.01pp — but **7 regressed fault types** (ReplaceCode −2, ResponseAbort −2, five at −1), so the criterion's second half failed. The weight was then **SOLVED, not swept**: `--log-weight 1 --window --slope lat --lat-floor 1` on the full dump gives a zero-regression window of `w ∈ [0, 0.030459]`, bound by one `JVMException` case, and **`w = 0.03` shipped as the default** (`fb54fb8`) — 47.33% → **48.80%**, 673→694 (**+21**), **zero regressed fault types**, confirmed on the flip commit through the DEFAULT path (no flag) as 694 with cells byte-identical to the flagged run. The window's edge is confirmed from both sides: `0.031` measures 696 with exactly one regressed type, `JVMException`, which is the type the reconstruction named as the binder. RCAEval golden 9-cell byte-identical on the flip commit (`34877797128` / `34878213491`), so both halves of the shared criterion are met **by measurement** rather than by argument | a weight or variant that keeps **zero** regressed fault types and gains **more than +21**. The frontier is `w ≈ 0.6646` for +118 at 11 regressed cases, so a candidate must close that gap on the regression side, not the gain side — and the cap is set by a SINGLE case, so the question is which property separates the 3 cases lost at `w = 0.04` from the 21 gained at `0.03`. Re-counted on the SHIPPED dump, the reopening condition has a measured shape: of the 672 misses, **161 have the latency term voting for the winner**, and among those the source's median inbound rise is **0.97 — no rise at all** — while the winner's is **27.47 over 2.56 inbound edges against the source's 1.11**. So the cost is not "the source rose a little less" but that the source frequently did not rise while a broad slowdown elsewhere is credited; any discriminator must separate real evidence from absent evidence and keep the +56 / +77 gains. Two candidates were tested and **falsified** on that same free read, and the second one closes the DIRECTION question rather than answering it. **Breadth** (`latEdges`, unused by the term): "a spurious competitor is slow on ONE edge" is backwards — the winner is the breadthier service in **120 of the 161** (source breadthier in 21). **Descending the risen chain** (credit the deepest node on a risen path instead of the top one): the source carries a rise AT ALL in only **15 of 161 (9.3%)**, so the rule could fix at most **10 (6.2%)**. With a path statistic the null matters: the winner is an ANCESTOR of the source in **67.7%** against a direction-matched null of **36.9%** (1.83×), which says the population is victim-side, and the 9.3% says the source has no latency evidence to be found by any direction rule. The obstacle here is **evidence availability, not direction** — the same wall the log term hits in `silent both sides`. Three candidate mechanisms are already measured and negative: `failedEdgeWeight` at any weight (no weight exists), the topological-source gate (rejected by simulation, −71 `ReplaceCode` cases), and every direction/volume/aggregation variant of `failedEdgeMinRecords` |
| metric-gap repair (per-service baseline selection) | `fse26-metric-gap-verdict.md` | 18.85% → 23.07% Top@1 with one regressed case | the regression is repaired without spending the gain |
| the latency term's SHAPE (`φ` in `A(v) + w·φ(L(v))`) | `fse26-latency-shape-verdict.md` | **every pointwise reshaping is excluded by construction**: `--window` prints the cap's binder as `lead 0.030459 / slope gap 1.000000 (slopes 0.000000 -> 1.000000)` — a target already at 0 against a rival already at the case maximum 1 is the maximal gap, and no monotone `φ` with `φ(0) = 0` can change it. That kills compressions, exponents, logs, sqrt and rank normalisation together, at zero cost. A MASK is not pointwise, and a rise floor (`latMinRise`, 1 = the shipped shape) is one — but a floor is a PURE mask (the surviving maximum is always the case maximum, so nothing is renormalised and no slope is ever raised), so it can only delete votes and **cannot delete a spurious COMPETITOR without deleting that same service as a CREDITED source**. Its cap is a STEP function of the floor: at 10.3 — just above the 10.283 rise of the single competitor that bound the shipped window — the cap jumps 0.030459 → **0.561495** and the best zero-loss point goes +21 → **+77**. **MEASURED as a PAIR** (`34921980498`): 48.80% → **52.74%**, 694→750 (**+56**), **zero regressed fault types**, Top@3 65.75%, Top@5 70.11%, 10 types gain and none regress. The floor is NOT safe alone — at the previous weight it is a 6-case regression across 6 fault types (`34921984651`), which is why the two values ship together and a guard requires the PAIR to have been measured | a reshaping that is **neither pointwise nor a mask on the rise** — i.e. one keyed on something other than the magnitude of the rise, since a mask provably cannot separate a service's two roles. The next candidate must also keep the pair's zero-regression property, which the shipped 52.74% now defines. **Both halves of the criterion are measured on the flip commit** (`34923701046` default path: 750, zero regressions, per-type cells byte-identical to the flagged run; `34923687812` golden 9-cell byte-identical). The shipped pair sits **exactly on its own cap** — `cap 0.561495`, binder `ts0-ts-travel2-service-response-abort-bvl7cs`, gap again 0 → 1 — so the shape axis is exhausted AT this floor too, and the lever left is another mask |
| the DB-connection-pool dominance penalty (`poolMetricPenaltyWeight`) — keyed on WHICH metric won, not on the score | `fse26-pool-penalty-verdict.md` | **MEASURED as a pair on one commit** (`34949812666` off / `34949854236` on): 750 → **756 (+6, 53.16%)**, **zero regressed fault types**, Top@3 65.75% → 66.46%, Top@5 70.11% → 70.25%. The weight is the **midpoint of a bisected window**, not a round number: the gain plateau starts at **0.048823** and the first casualty is at **0.087011** (`HTTPResponseReplaceCode`, `ts-security-service` → `ts-preserve-service`), so 0.0679 sits 0.019 from either edge. The pre-screen solved that window for free, and the run reproduced the predicted **split** case for case (`ContainerKill` +2; `HTTPResponseReplaceCode`, `JVMLatency`, `NetworkDelay`, `NetworkPartition` +1 each). All **twelve** pre-registered family sets are reported in the doc, and the decisive negative is there: **every set that CREDITS the census's resource families gains nothing before its first casualty** (frontier 0.01, gain 0 — the +85 source-side margin does not convert into a rule), while the winner-side pool penalty alone keeps a frontier **9× wider** than any set that adds `http.client.request.duration` to it | a set or shape that gains more than +6 with no case-level regression, or one whose window is wider than 0.038. A candidate that re-derives this from the SCORE's magnitude is not this row but the closed metric-shape row; and the family prefix has one owner, so a new family means a new row |
| the entire **input-ablation** family (`dropMetrics`) — five families by necessary-condition bound, the DB connection pool by family, and the pool by LABEL | `fse26-logweight-sweep-verdict.md`, `fse26-httpnet-miss-verdict.md` | all measured on the full 1422 cases. Family drop (7 labels) 47.33% → **47.47% (+0.14pp)** with **5 regressed fault types**; label drop (`db.client.connections.use_time.max` ALONE) → **47.61% (+0.28pp)** with **2** — better on both counts, which is the measured RULE *ablate the label that wins, not the family it belongs to* (the family drop cost `NetworkDelay` five cases because it also removed `wait_time.max`, the SOURCE's own signature). Both rejected by the criterion; and the label drop recovered **2 of the 56** cases the necessary-condition bound predicted, so the deficit is **distributed across the inventory, not attributable to one bad series**. The silent block the family drop targeted **did not move at all** (JVMMemoryStress 4/171, ContainerKill 1/89, PodFailure 0/24 — identical in both arms) | evidence that cases MOVED, not a bound that they could: the bound read 68/25 on the config measured and **79/7** re-counted on the shipped one, and it converted to +0.14pp. Otherwise the input-ablation family is **closed completely** |
| metric term SPACING (`no_rank_normalization`) | `fse26-logweight-sweep-verdict.md` | measured **+0.00pp** (47.33% → 47.33%) with six fault types moving in opposite directions and cancelling (ReplaceCode +1, ReplaceMethod +1, ResponseAbort +1 against NetworkPartition −1, ResponseDelay −1, ReplacePath −1) | never — both branches bound the metric term to `[0, 1]`, so neither can exceed a full log term, and the two services at the top are close in raw score as well as in rank, so no spacing widens the decisive gap |
| network-loss deterministic crack | `loss-weak-source-verdict.md` | union ceiling 66.7% vs engine 55.9% / PRISM 52.0% | a signal that closes part of the 66.7% ceiling |
| delay deterministic crack | `delay-exhausted-verdict.md` | engine 80.4% vs union ceiling 90.2%; the 10.0pp gap is all bothWrong | the bothWrong population changes shape |
| fusion / deterministic routing | `fusion-routing-verdict.md` | engine 76.1%, PRISM 76.7%; routing cannot reach the union ceiling | a router whose input is not the two scores being routed |
| bothWrong evidence probe (RCAEval RE2/RE3) | `bothwrong-evidence-verdict.md` | 12.5% of 615 is the deterministic ceiling | a new evidence class for both-wrong cases |
| the weak-fault-type gap, as a block | `fse26-data-gap-verdict.md`, corrected by `fse26-stock-attribution.md` | 579 cases / 40.7% of the dataset; HTTPResponseReplaceCode 231 @ 4.8% is the signal gap and the top lever | a candidate that names which of the two mechanisms it addresses — **and note the correction: that type is two populations (173 backend-sourced at 91.9%, 58 `ts-ui-dashboard`-sourced at 0.0%), so a type-level claim about it is not a claim about 231 cases** |

## The shared kill criterion

Any candidate that changes the shipped ranking must move **both**:

1. **RCAEval golden 9-cell byte-identical** (RE1 80 / 92.8 / 68, RE2 82.4 / 88.9 /
   68.1, RE3 80 / 45 / 51.1), and
2. **FSE'26 with zero regressed fault types.**

A headline gain does not buy silence about regressions — that rule has rejected
+0.14pp, +0.28pp, +0.49pp and +5.8pp alike, and it is what the two above it are
for.

## The two invariants that make a measurement trustworthy

Before reading any number, check that the input was counted:

- the FSE'26 run prints **`Data: failed edges in …`** — a signal that received
  nothing reports the same headline as a signal with no effect;
- a diagnostic dump's miss attribution prints **`unexplained`** and **`tie`** — a
  healthy engine has zero `unexplained`, because that category means the order is
  inconsistent with the terms the dump carries (`docs/fse26-stock-attribution.md`).

## What is left

`docs/fse26-httpnet-miss-verdict.md` and `docs/fse26-stock-attribution.md` agree
that the metric layer is the larger of the remaining mechanisms, and
`fse26-metric-competition-verdict.md` says the next candidate must be **not a
function of a service's own metric score**. Those two statements together are the
door: the constraint is on the SHAPE of the problem, and it excludes a whole
family rather than pointing at one candidate.

**The door now has a number on it.** `docs/fse26-term-oracle-verdict.md` rebuilds the
engine's three terms from a dump and reproduces the shipped run's own rank-1 on
1422/1422 cases, so a candidate can be pre-screened at zero cost. It measures the
lever the ceiling analysis named — a per-case discriminator — at **871/1422 = 61.25%**
(best of the four configurations the shipped formula can take, as an ORACLE, +8.51pp
over the shipped 750), with **551 cases (38.8%) named by none of them** and the metric
layer misranking the root **deeply** rather than narrowly (median rank **14** among the
misses). It also censuses the dominant-metric family of every miss: the family a sampled
verdict named as the source's signature (`hubble_http_*`) separates the two sides by
**+2 cases out of 672** — no information — while the source's anomaly is RESOURCE-driven
(`k8s.*`/`container.*`/`jvm.*`) **85 cases** more often than the winner's and the
winner's is CLIENT-duration/pool-driven **131 cases** more often. That is the first computed
feature with a large margin, and it comes with the two rows it must not touch: the pool
label drop (+0.28pp, 2 regressed types) and the silent stock's own series.

Before proposing a candidate, read that document's §1: the pre-screen is exact for the
shipped configuration and carries a **±5 case** error bar for any RE-DERIVED term, so a
predicted gain inside that band is not evidence.
