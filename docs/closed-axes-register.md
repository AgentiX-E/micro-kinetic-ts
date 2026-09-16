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

Of the **666 misses** at the shipped configuration (**672** is the same dump's pool-off
count — the two differ by the six cases the pool penalty fixes, see
`fse26-shipped-config-verdict.md` §4), **74 (11.1%)** have the winner strictly ahead on
the metric, the log AND the latency — no non-negative reweighting can put the source
first, so those need new EVIDENCE. The other **592 (88.9%)** have the source at least
level with the winner on some term, so each is individually reachable by reweighting.
The two computations agree exactly: the 74 are precisely the cases labelled
`metric+log+lat` (73) plus `metric+log+lat+pool` (1), and nothing else is blocked.

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

That requirement now has an instrument, and its answer is sharper than the sentence above:
the PAIRED census (`fse26-separator-verdict.md`) confirms the marginal claims (`failedEdge`
0.457, `inLatEdges` 0.487, the source's own deviation 0.270 — all pointing at the winner) and
refines the ancestry one — **the graph's direction separates per population and reverses
between them**: source → winner in 49 of 65 decisive replace-code pairs (AUC 0.732, stable in
all 5 folds) against winner → source in 8-32 for network partition and 0-19 for network loss.
A global graph bonus cannot exist, which is why `failedEdgeWeight = 0` was already closed with
2 regressed types.

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
| the diagnostics' LOG-TERM reconstruction — which lines the engine's level-1 gate admits, and therefore the denominator of every counting mode | `fse26-log-flood-verdict.md` | **a real defect, found and fixed.** The reader summed the two signature counts (`logic + http`); the engine admits a line ONCE, so its flood is the UNION of the two sets, not their sum. The dump proves the overlap without a new run: one case's source prints `logic=3495 http=3499 err=3499`, and two disjoint subsets of 3499 lines cannot have those sizes. Footprint over 72527 service rows: **81 with a non-empty overlap**, which was enough to make **109** scores disagree by > 6e-4 and to move **5** cases' rank-1 — printed all along as "the error bar". The second defect sat in the same function: the denominator was mode-INDEPENDENT, while `count` admits logic lines alone. Fixed with the union (and the overlap printed as a primitive `both=`); validated on the shipped dump over 1391 cases — **0 services differ, rank-1 +0/−0**, and the corrected `dominant@0.2` gain is **+1**, not the +6 the row below quote with a 5-case caveat | a signal whose flood is a set the dump cannot express — i.e. a third signature class, or a gate that stops being a boolean per line. The union is not an approximation to be traded off: dividing by the sum is dividing by a different quantity whose error depends on how much of the flood the two sets share |
| the injection-anchored ONSET prior (`temporalWeight`) — **the ENGINE'S OWN SHAPE** (min-max normalised delay) and the RANK shape (`order`) | `fse26-onset-verdict.md` §2, §3 | **measured on FSE'26** (`35006947938`, the shipped configuration, 1422 cases, 87.5% of services carrying an onset): **NO ADMISSIBLE WEIGHT ON EITHER SHAPE** — `earliness` gain 0 in `[0, 0.005361]`, `order` gain 0 in `[0, 0.005976]`, both capped by the same case (`ts4-ts-security-service-bandwidth-cs99dm`, `ts-preserve-service` overtaken by `ts-food-service`) whose **lead is `0.010050`, the metric term's top step for a 51-candidate case** — the SECOND axis to close on that constant, so it is a property of the metric rank spacing, not of this signal. The old −2.5pp RCAEval number is superseded by this: there is nothing to ship, on this benchmark, at any weight | a shape that is neither min-max in the delay nor linear in the onset RANK. Do not re-propose either: the free read is one command (`--onset-screen`) and it is already run |
| the **`earliest-only`** shape of the onset prior (credit ONLY the service(s) that moved first — a MASK on the onset, where the competitor and the credited source are not the same quantity) | `fse26-onset-verdict.md` §4, §7, §8 | **SHIPPED, then REVERTED by the golden — both halves measured, and they disagree.** The FSE'26 half passed completely and at case granularity: control **756** (`35021503281`) against candidate **760** (`35021510164`), Top@1 53.45% vs 53.16%, three types up (`HTTPRequestDelay +2 / JVMMemoryStress +1 / JVMReturn +1`), **zero regressed fault types**, and the run that shipped it flipped **exactly the four datapacks the solver named in advance**, `broken 0`. The RCAEval half failed: **six of nine golden cells moved**, `RE1 TrainTicket 68.0 → 27.2` and `RE2 68.1 → 25.7`, reproduced identically on a second run (`35029285379`, `35030365430`). The weight is back to **0** and the shape to `earliness`; both points are kept in `MEASURED_TEMPORAL_PAIRS`, the rejected one with `golden: 'moved'`. **The revert is verified on both benchmarks, through the default path and with no pin** (`fse26-onset-verdict.md` §8): RCAEval `35035309768` reproduces **9 of 9 cells**, FSE'26 `35035314921` reproduces the control **fault type for fault type, 25 of 25, 756/1422 = 53.16%**, and exactly the pair's own three types differ against it (`HTTPRequestDelay 56→54`, `JVMMemoryStress 13→12`, `JVMReturn 13→12`) | **the two benchmarks disagreeing, and the criterion having no tie-break.** This shape cannot demote the late-mover source, but it still PROMOTES the early symptom, and on RCAEval the injection-anchored onset anchors to the source's slow-responding dominant metric — so the first mover is systematically a symptom there. Do not re-propose this shape at any weight: the mechanism is now measured, not argued, and the failure is ~41pp on a cell, not a ratio. Reopening needs a source/symptom discriminator on the onset itself, screened on BOTH benchmarks before a run |
| the local source-likelihood prior (`sourceWeight` — the fraction of causal neighbours whose onset index is LATER) | `fse26-shipped-config-verdict.md` §5 | default 0 (`#193` "regressed the benchmark"); superseded inside the engine by `postInjectOnsetDelays`, whose own comment says the index-based onset was computed from a **fault-contaminated baseline** — the two were never both right | the same measurement as the row above, on the injection-anchored signal. Do not re-propose the index-based one: its input is the defect the other was written to fix |
| the ATTRIBUTION of each miss at the SHIPPED configuration (which term decided it) | `fse26-shipped-config-verdict.md` §4 | measured free from the 1422-case pre-pool dump: **756** at `--pool-penalty 0.0679` (the shipped headline, from another run's data); **750** both-correct / **6** fixed / **0** broken / **666** both-wrong; rank-1 moved 103. The instrument defect this exposed — one page printing 750, 756 and 672 for one run, and 14 cases filed as `unexplained` that were the flag difference — is fixed and pinned by tests. **The pool-ON dump has now LANDED** (`35035314921`, 1422 cases, the shipped configuration with `diagnose` on): the reconstruction reproduces the run's own rank-1 **1422/1422**, `acceptable root 756`, `moved by the pool penalty 103`, and the routing map with all terms live reads `metric 261 / metric+log 106 / metric+log+lat 73 / log 109 / metric+lat 50 / log+lat 21 / metric+pool 7 / log+pool 11 / lat 10 / pool 2 / metric+log+lat+pool 1`, with **221 cases silent on both sides**. The 74 the framing calls non-reweightable are exactly `metric+log+lat` (73) + `metric+log+lat+pool` (1) — the pre-pool derivation reproduced on a dump the instrument had never read, which is the cross-check the reopening condition asked for | a FIFTH term ships. The pool-ON dump landed and agreed; `unexplained` is 0 at the dump's own flags. Read `unexplained` only with `rank-1 moved`: it is a defect claim at the dump's own configuration and a footprint otherwise |
| reweighting the log term (`logWeight`) | `fse26-logweight-sweep-verdict.md` | control 47.33%; `0.5` → 46.84% (−0.49pp); per-fault-type **oracle ceiling +2.67pp → 50.00%** | a per-type oracle that exceeds 50% exists, i.e. the metric term itself changes |
| log-signal mode (`count` / `logicHttp` / `all` / `novelty` / `logicHttpDominant`) | `fse26-framework-http-direction-verdict.md`, `fse26-term-oracle-verdict.md` | `count` 16.5%, `logicHttp` 46.5% — the shipped mode is the best measured; **the two modes that were built and never measured are now pre-screened offline, on the shipped dump**: `count` re-derived is **531/1422 with 8 regressed fault types** (`ReplaceCode` −146) at the shipped configuration, and `logicHttpDominant` — "falsified before ablation" in `78eb99e` — reaches **749–753** at the engine's default and interior thresholds with **5 regressed types** (`ReplaceCode` −15 to −16). Swept from 0.2 to 0.95 the only point that regresses nothing is **0.2, at +1 case** (exact, after the log-flood fix in `fse26-log-flood-verdict.md`; it was quoted as +6 with a 5-case instrument caveat). The mechanism is the register's conflict a third time: the framework-HTTP flood is a source signature in the replace-code population (one emitter owns 90–100% of it, 597 cases) and a victim cascade in the network population (spread, 224 cases), and no threshold serves both | a new mode is both measured and better on the same cache. **The reopening condition is now answered for `logicHttpDominant`: it is measured exactly, and it is not better — its best zero-regression point is one case — and for `all` as well: measured at the shipped configuration it reaches **569 with 17 regressed fault types**, the worst row on the table (its costs concentrate on the HTTP types it was written for: `HTTPRequestDelay` −48, `HTTPResponseDelay` −44, `ReplaceCode` −27), and the gate-side precondition the separator census supplied (the source owns the flood 30-3 in NetworkPartition while owning the SIGNATURE flood in none of 29) does NOT survive the case-level normalisation. `logicHttpJoint` is re-attempted on current data as its own doc demands: **562 / +75/−243 / 8 regressed types**, costing **`ReplaceCode` −104** against the historical 98 — the same shape, and the mode stays closed. Its open question is answered by the same rebuild: the victim predicate is existential over callees, so the gate **withdraws 43.74% of all services** and takes the framework-HTTP flood **OWNER itself in 571/972 cases (58.74%)** — it deletes the evidence it was built to keep. `novelty` remains unmeasured — it cannot be rebuilt from a dump (it needs per-class line counts) and is not reachable from the FSE'26 CLI |
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
| **the diagnostics' model of the shipped score** (how many of the engine's terms a reader of a dump reconstructs) | `fse26-fourth-term-verdict.md` | the score has had **four** terms since `e2d3b24`; the reconstruction summed three and the miss vocabulary could spell three, which is the same defect that produced **12 phantom `unexplained`** one term earlier. Fixed and validated against two runs the instrument had NEVER read: the pre-pool dump at `--pool-penalty 0.0679` predicts the shipped run's own headline **756**, and the pool-ON dump's `--term-oracle` reproduces **445/445** of that run's rank-1 with **241** acceptable roots, which is exactly its five types summed in the shipped table (160+49+20+6+6). At the OLD configuration the miss map reproduces the published one line for line (275/120/12/116/50/25/74, silent 230, wrong 672) — an extension, not a rewrite. **The term is not rare**: it moves the winner in **103 of 1422 cases** (7.2%) for a net **+6**, because 97 of the moves were on already-wrong cases and **zero** went correct → wrong | a FIFTH term ships, or a re-derivation is proposed from a number this model prints — including the net, which is not the footprint. The routing map at the shipped configuration is still unmeasured (it needs a pool-ON dump of all 1422 cases, and the shipped run was dispatched without `diagnose`); re-measuring it is the fix, not a reason to re-read the old one |
| the **per-case discriminator** (which configuration to trust, chosen from inference-time features) | `fse26-discriminator-verdict.md` | measured, out of sample, with a 5-fold cross-validation split by datapack hash and a feature set that is TYPE-LEVEL unable to read the label. The instrument reproduces the census exactly at the pre-pool baseline (**750** shipped, **871** any configuration) and reports **756 / 878** at the shipped one — the pool term makes seven more cases reachable, so the headroom is **122**, not 115. A single declared feature (`predictedIsTop`: the model's own rank-1 is also the anomaly maximum) captures **+13** of it held out (**+14** pre-pool) — about 11% — and it does so by **TRADING**: 25 fixed against **11 broken** out of sample, on every fold. Applied to every case the same configuration fixes 119 and breaks 462. All eight declared features were searched per fold, so this is "no declared feature separates them", not "the obvious one failed" | a rule that beats **+14** held out with **ZERO** held-out losses and whose mechanism does not REMOVE a term (the winning rule sets `logWeight = 0`, which changes the golden's inputs rather than its outcome). A proposal that cannot state its held-out SPLIT against those numbers has not engaged the measurement |
| the WINNER-side dominant-family penalty, scanned over every family (`--family-screen`) | `fse26-family-screen-verdict.md` | the hand-registered twelve sets are now a SOLVED scan of **every** family the dump carries, validated by reproducing the pool family's recorded window exactly (`[0.048823, 0.087011]`, +6, the same split, the same binder) from a signed-in command. Result at the shipped configuration (**756** protected): the two largest gains are **unshippable** — `http.server.duration` +4 and `jvm` +2 both have a **width-ZERO** window, i.e. their maximal gain arrives at the exact weight that loses a currently-correct case — and every family with an interior window gains **one** case (`trace` width 0.247, `container` 0.040, `http.client.duration` 0.0056). The mechanism is named: `0.010050 = log1p(1) − log1p(0.98)` is the metric term's TOP STEP for a 51-candidate case, so the weight that wins a case and the weight that loses one are the same constant whenever the two sides' margins coincide — the wall and the reward are one number. The five families the census's +85/+131 margins pointed at convert into 6 shipped cases and nothing further | a family penalty whose window is wider than **0.038** with a gain above +6, or any candidate that is not a function of a service's own dominant family. A width-zero window is not a window: it is rejected by construction, not by preference |
| the DB-connection-pool dominance penalty (`poolMetricPenaltyWeight`) — keyed on WHICH metric won, not on the score | `fse26-pool-penalty-verdict.md` | **MEASURED as a pair on one commit** (`34949812666` off / `34949854236` on): 750 → **756 (+6, 53.16%)**, **zero regressed fault types**, Top@3 65.75% → 66.46%, Top@5 70.11% → 70.25%. The weight is the **midpoint of a bisected window**, not a round number: the gain plateau starts at **0.048823** and the first casualty is at **0.087011** (`HTTPResponseReplaceCode`, `ts-security-service` → `ts-preserve-service`), so 0.0679 sits 0.019 from either edge. The pre-screen solved that window for free, and the run reproduced the predicted **split** case for case (`ContainerKill` +2; `HTTPResponseReplaceCode`, `JVMLatency`, `NetworkDelay`, `NetworkPartition` +1 each). All **twelve** pre-registered family sets are reported in the doc, and the decisive negative is there: **every set that CREDITS the census's resource families gains nothing before its first casualty** (frontier 0.01, gain 0 — the +85 source-side margin does not convert into a rule), while the winner-side pool penalty alone keeps a frontier **9× wider** than any set that adds `http.client.request.duration` to it | a set or shape that gains more than +6 with no case-level regression, or one whose window is wider than 0.038. A candidate that re-derives this from the SCORE's magnitude is not this row but the closed metric-shape row; and the family prefix has one owner, so a new family means a new row |
| the entire **input-ablation** family (`dropMetrics`) — five families by necessary-condition bound, the DB connection pool by family, and the pool by LABEL | `fse26-logweight-sweep-verdict.md`, `fse26-httpnet-miss-verdict.md` | all measured on the full 1422 cases. Family drop (7 labels) 47.33% → **47.47% (+0.14pp)** with **5 regressed fault types**; label drop (`db.client.connections.use_time.max` ALONE) → **47.61% (+0.28pp)** with **2** — better on both counts, which is the measured RULE *ablate the label that wins, not the family it belongs to* (the family drop cost `NetworkDelay` five cases because it also removed `wait_time.max`, the SOURCE's own signature). Both rejected by the criterion; and the label drop recovered **2 of the 56** cases the necessary-condition bound predicted, so the deficit is **distributed across the inventory, not attributable to one bad series**. The silent block the family drop targeted **did not move at all** (JVMMemoryStress 4/171, ContainerKill 1/89, PodFailure 0/24 — identical in both arms) | evidence that cases MOVED, not a bound that they could: the bound read 68/25 on the config measured and **79/7** re-counted on the shipped one, and it converted to +0.14pp. Otherwise the input-ablation family is **closed completely** |
| metric term SPACING (`no_rank_normalization`) | `fse26-logweight-sweep-verdict.md` | measured **+0.00pp** (47.33% → 47.33%) with six fault types moving in opposite directions and cancelling (ReplaceCode +1, ReplaceMethod +1, ResponseAbort +1 against NetworkPartition −1, ResponseDelay −1, ReplacePath −1) | never — both branches bound the metric term to `[0, 1]`, so neither can exceed a full log term, and the two services at the top are close in raw score as well as in rank, so no spacing widens the decisive gap |
| network-loss deterministic crack | `loss-weak-source-verdict.md` | union ceiling 66.7% vs engine 55.9% / PRISM 52.0% | a signal that closes part of the 66.7% ceiling |
| delay deterministic crack | `delay-exhausted-verdict.md` | engine 80.4% vs union ceiling 90.2%; the 10.0pp gap is all bothWrong | the bothWrong population changes shape |
| fusion / deterministic routing | `fusion-routing-verdict.md` | engine 76.1%, PRISM 76.7%; routing cannot reach the union ceiling | a router whose input is not the two scores being routed |
| bothWrong evidence probe (RCAEval RE2/RE3) | `bothwrong-evidence-verdict.md` | 12.5% of 615 is the deterministic ceiling | a new evidence class for both-wrong cases |
| the weak-fault-type BLOCK's two headroom hypotheses — the `transient-return` guard hiding the source, and the source's signature being too weak — controlled by the SAME type's own correct cases | `fse26-guard-census-verdict.md` | **both closed by one free read, and each by a single number.** The guard discards **44%** of the source side's metrics across the 666 misses against the winner's 24%, and on the block it is FLAT: the source's transient-drop rate is `66.4% wrong` against **`66.8% correct`** on `JVMMemoryStress` (−0.5pp) and `65.9% / 66.5%` on `ContainerKill` — it fires on essentially every case of the type, so it carries no information about which is which. The largest Δ is on the type the engine is BEST at (`ReplaceCode` 69.3%, +11.8pp), the opposite of the hypothesis's prediction. The source's strongest RENDERED deviation separates the HTTP/Network types (`0.45` wrong against `1.33` correct) and does NOT separate the block (**`0.96` against `1.00`** on `JVMMemoryStress`): the source is exactly as anomalous in the cases that fail. Ships as a section — `--guard-census` | a candidate that acts on the RIVAL, because the wrong winner's margin (`1.23` against `0.96`) is not reachable from the source's side and the rival-side family axis is exhausted. Any re-proposal from a footprint must show its Δ: a rate that is the same in both groups is a property of the population, not a mechanism |
| the **PAIRED** separator question — which dump-visible signal prefers the true source to the engine's rank-1, per fault type — for all 14 declared signals | `fse26-separator-verdict.md` | 666 pairs, 250 non-term cells, bar `Sidak(0.05, 250) = p < 2.05e-4`: **no signal separates globally** (the best non-term signal is `onset` at AUC 0.537, under the 0.60 criterion); **4/250 separate FOR the source** and **35/250 AGAINST it**, six of those deterministic (`JVMMemoryStress/transientDrops` 0-159, `kept` 0-158, `sigLines` 0-105; `ContainerKill/kept` 0-83, `transientDrops` 1-82; `JVMMemoryStress/reaches` 11-110). Only two of the four hold in **every fold**: `NetworkPartition/errLines` 30-3 (AUC 0.781, p=1.4e-6) and `HTTPResponseReplaceCode/reaches` 49-16 (AUC 0.732, p=5.1e-5); `JVMMemoryStress/inDegree` (98-48) and `NetworkLoss/inDegree` (21-2) each have a fold at exactly 0.500. 43/666 pairs carry NO non-term preference for the source at all — **over ten signals**; the field audit (`SERVICE_FIELD_AUDIT`, typed `Record<keyof DiagnosedService, string>` so a new reader field cannot reach main unclassified) then named the fields that were read but not screened, five more signals were added, and the re-run over **375 non-term cells** reports **13/375 for the source and 37/375 against** it. Two findings, one of which survives: the raw `failedEdge` COUNT separates at **0.908** on replace-code (60-2, stable in all five folds) where the gated SCORE does not (0.457) — the register's "per-edge counts do not separate" is true of the score and false of the count — while the four `decisive*` composition signals (leader `decisiveCv` AUC 0.734, p=2.0e-40) are **NOT established**: the conditioning that would separate them from the renderer's brevity has 0-5 pairs to stand on in every block type, i.e. the confound is saturated instead of excluded. **The reader feeding them was itself wrong, and is now fixed and re-measured.** `inventoryOf` selected the decomposition by largest `riseRatio`, on the claim that "the metric that drove the score is the one with the largest rise" — which the engine's own `dominant` name contradicts in **751 of the 7,733 decomposed rows (9.7%)**: the decisive metric IS the score argmax, the rendered list is sorted by score, so the name was already in the dump to be read. Reading the named metric (fallback: the highest-scoring entry; never the rise) moves every aggregate one way — `decisiveCv` 0.734 → **0.738** (p 2.0e-40 → 7.9e-42, losses 132 → 129) — all of it on the **shipped** dump `r35006947938`, whose header carries `latWeight=0.561495 latMinRise=10.3 poolMetricPenaltyWeight=0.0679` and NO temporal override, and which yields the **666** pairs this row was written from. **Provenance note, because the first attempt got it wrong**: the same measurement on `r35029055764` gave 662 pairs and was labelled "shipped" in two documents; that dump's header pins `temporalWeight=0.036552 onsetShape=earliest-only`, i.e. the REJECTED onset pair, and the register's own 0.734/2.0e-40 turning up as that dump's pre-fix value is what confirmed it. Read the header, never the filename, `decisiveBaseline` 0.628 → **0.644**, `decisiveBurst` 0.571 → 0.577, `JVMMemoryStress/decisiveCv` 0.682 → 0.689, `HTTPResponseReplaceCode/decisiveCv` 59-3 → 58-3, and `PodFailure/decisiveCv` **0.958 → 1.000 (24-0, stable in all five folds)** — and the UNCONDITIONAL rate does not reopen it, for a reason that is now a number: `kept` and `decisiveCv` correlate at **r = 0.4325 (ρ = 0.4086)** across the pairs' 1,332 services, and the source keeps FEWER metrics than the winner in **514 of 666** pairs (more in 126, equal in 26). **The matched comparison does reopen it, and it is now an instrument rather than a paragraph**: `INVENTORY_MATCH_BAND = 2` with `inventoryComparable`, a `kept<=` column on every row and a `near` sub-cell on every cell, whose legend states that the matched stratum is NOT the whole population. On the same dump the confound stops being a separator under matching (`kept` 0.209 → **0.271**) while `decisiveCv` retains **0.718 on 487 pairs** — the ONLY non-term rate that clears the 0.6 criterion on that stratum (`decisiveBaseline` 0.598 is next and falls short). Per type, matched: `ReplaceCode/decisiveCv` **0.885** (48), `PodFailure/decisiveCv` **1.000** (23), `JVMMemoryStress/decisiveCv` 0.661 (87), `ContainerKill/decisiveCv` 0.637 (40), `ReplaceCode/edgeRecords` 0.865 (48), `NetworkPartition/errLines` 0.793 (46). Quote **0.718**, not 0.738: the unconditional rate is an upper bound under a confound that is measured rather than assumed | a candidate built on `edgeRecords`, screened on a **different** held-out fifth and fitted per POPULATION (the network types reverse it) — and, for the `decisive*` family, **instrumentation** — specifically an **inventory-MATCHED** comparison: exact-`kept` matches are 26 of 662, so the confound check needs a coarsened match at a stated band before it has any power. a **candidate run** for `decisiveCv` — the window solver on both benchmarks, fitted per population, with the standing rule that a paired preference is not a term (`fse26-term-oracle-verdict.md` §9). **The solver this names now exists**, behind `--cv-screen` (`fse26-cv-screen.md`): on the first 267 of 1422 cases it found a zero-regression window for the `flip` shape at `[0.047350, 0.050507]` (gain 4, `lostAtShip` 0), so what is owed is the WHOLE population — a window is a function of it — and the golden half, which cannot be measured offline at all because the term is not in the engine yet. The inventory match is no longer the blocker: what a run has to respect is the matched stratum (487 of 666, and the 179 dropped are the pairs whose inventories differ most) and the family split (`decisiveTrend` 0.372 the other way). Rendering the decisive metric for every service was never the missing instrument — the asymmetry is in how many metrics each side KEEPS |
| the weak-fault-type gap, as a block | `fse26-data-gap-verdict.md`, corrected by `fse26-stock-attribution.md` | 579 cases / 40.7% of the dataset; HTTPResponseReplaceCode 231 @ 4.8% is the signal gap and the top lever | a candidate that names which of the two mechanisms it addresses — **and note the correction: that type is two populations (173 backend-sourced at 91.9%, 58 `ts-ui-dashboard`-sourced at 0.0%), so a type-level claim about it is not a claim about 231 cases. Both mechanisms the row's own framing named are now closed on measurement: see the row above** |

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
- a workflow input's **description** is a second owner of any value it quotes. Two had
  drifted to the pre-ship configuration (`lat_weight` "0.03" for a shipped `0.561495`,
  `lat_min_rise` "1" for a shipped `10.3`; a dispatcher following either would have
  reproduced the ablation, 5.56pp under the headline, on a run that looks successful).
  The same class catches the ENGINE's own doc comments — the pool weight's claimed to
  default to 0 (INERT) after 0.0679 shipped. `fse26-reported-config.test.ts` now reads
  each description as text and requires it to name the constant the runner has; a
  DESCRIPTION IS A COPY, and a copy needs a guard
  (`docs/fse26-shipped-config-verdict.md` §6).
- a runner that **PINS** a value is a second owner of it, and a pin can make a gate
  unfalsifiable: `run-rcaeval` carried `temporalWeight: 0` — the term's ABLATION — so the
  moment the engine's default became non-zero, the golden 9-cell would have stayed
  byte-identical for a reason that has nothing to do with the signal, and the gate would
  have been described as passing. Both runners now read the engine's constants for the
  temporal pair, one shared `parseWeight` decides what a malformed flag means (the RCAEval
  CLI's `parseFloat(x) || 0` read `--log-weight ''` as "log signal OFF" against its own
  default of 1.0), and the defaults are guarded as TEXT because a default is invisible to
  every runtime assertion of the engine's behaviour
  (`benchmarks/__tests__/rcaeval-reported-config.test.ts`).
- **a recorded-runs table must be able to record BOTH halves of the kill criterion.** The
  onset pair's table carried `regressedTypes` — an FSE'26 claim about fault TYPES — and no
  field for the golden at all, so a candidate could be recorded as "measured" with the other
  half unmeasured. It was, and the golden had moved six cells with two of them down ~41pp
  (`fse26-onset-verdict.md` §8). The table now carries `golden: 'identical' | 'moved'` per
  point and the shipped value must be an `'identical'` one; the REJECTED candidate stays in
  the table as data, because a rejection recorded only in prose gets re-proposed as new.
- **a point measured down a PINNED path is not a measurement of what SHIPS.** Every row of
  that table was reached with the weight passed as a flag, and a flag is a second owner of
  the value — one that can be edited apart from the engine's default, which is exactly the
  failure the RCAEval runner's own `temporalWeight: 0` pin produced. So the shipped point
  carries a `defaultPath` sub-record: the same configuration, reached with no flag at all,
  on BOTH benchmarks (`35035314921` / `35035309768`), which is also what makes a revert
  checkable rather than merely asserted — the recorded 9-cell and the recorded fault-type
  table are measurements that already exist, so "this restores the engine" is a diff.
- **a guard that compares TEXT is comparing a substring.** The same table's description
  check used `toContain(String(shipped))`, which for a value of `0` is satisfied by a
  description naming `0.036552` — so the moment a value reverted to zero the check stopped
  checking, silently. Descriptions are now compared by NUMERIC TOKEN, which is also what
  makes `1.0` acceptable for a shipped `1`.
- **a reconstruction must model every term that is LIVE in the dump**, and the opposite
  failure is as expensive as the one above: a term missing from `blendScores` is invisible
  while its weight is 0 and turns the shipped configuration's own decisions into
  `rank-1 moved`/`unexplained` the moment it ships. Each shipped term therefore has an
  entry in `TermOracleOptions`, a count in the fidelity report (`poolFlips`,
  `temporalFlips`), and a contribution in the miss decomposition — and a term's SIGN there
  is the finding: positive means that term promoted the wrong winner, i.e. its case-level
  cost (`docs/fse26-onset-verdict.md` §7, where the shipped term's cost is `broken 0`).
  The CLI dispatch passes the SECTION OBJECT rather than re-listing its fields: the first
  version of this change passed a hand-picked subset, and `--temporal-weight 0` printed a
  banner claiming `0.036552`.
- **a nonzero fidelity counter is a DEFECT claim, not a tolerance.** The reconstruction
  of the log term printed `services above 6e-4: 109; cases whose rank-1 moves: 5` and
  called it "the error bar for any mode row below". A term rebuilt from the counts the
  engine itself used has no error bar — the only thing that can make it disagree is a
  mistake in the reconstruction, and there was one: the flood added two overlapping
  signature sets. The line now says `EXACT` or `NON-ZERO — a reconstruction defect, not a
  tolerance` and nothing in between (`docs/fse26-log-flood-verdict.md`).
- **the reconstruction must reproduce the dump's OWN mode, case for case.** This is free
  and it is the assertion that would have caught the defect above on the day it landed:
  the mode the run used IS the mode the reader rebuilds, so `logicHttp` re-derived must
  score `+0/−0` against the printed term. It is now printed as the mode screen's
  `self-check`, with both halves — how many SERVICES disagree (fires first) and how many
  cases' rank-1 moves (decides whether it matters).
- a diagnostic dump's miss attribution prints **`unexplained`** and **`tie`** — a
  healthy engine has zero `unexplained`, because that category means the order is
  inconsistent with the terms the dump carries (`docs/fse26-stock-attribution.md`).
- **two modules answering "which service is this case about" is a defect, and it shows up
  as a moved table rather than as an error.** The guard census took `groundTruth[0]` as the
  source while the separator screen takes the most anomalous ground-truth service; on FSE'26
  the five network types name TWO acceptable roots, so the two rules disagreed on 97-190
  cases each and five published rows moved when they were unified
  (`fse26-guard-census-verdict.md` §0: `NetworkPartition` Δ +4.1pp → **+6.2pp**,
  `NetworkLoss` −1.4pp → −0.5pp, `NetworkCorrupt` −3.6pp → −2.5pp, `NetworkBandwidth`
  +6.8pp → +9.0pp, `NetworkDelay` +1.1pp → +1.8pp). The block's own rows did not move, and a
  table that quotes a shared definition has to be RE-DIFFED when the definition changes.
  **Read it next to `rank-1 moved`**: the claim is about the modelled terms *at the
  dump's own configuration*. When the flags move the rank-1, every case they would flip
  lands in `unexplained` too — 14 of them, and 0 of them an engine finding, the first
  time it was read that way (`fse26-shipped-config-verdict.md` §2).

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

**The winner-side family-penalty axis is now measured-exhausted** by the systematic scan in
`fse26-family-screen-verdict.md`: every family was solved, and the only one whose window has
both an interior and a gain above one case is the term already shipped. The two families
with larger gains have **width-zero** windows, so what remains is not "find a better family"
but the per-case discriminator below.

**The per-case discriminator is measured too** (`fse26-discriminator-verdict.md`): about 11%
of its 122-case headroom is learnable from one inference-time feature, and the rule that
learns it trades 25 wins for 11 losses out of sample, so it fails the criterion's second half
outright and its mechanism (removing a term per case) would move the first half's golden. The
lever stays open as EVIDENCE with a stated bar — **+14 held out, zero held-out losses, and no
term removed** — and closed as a shippable change. What is genuinely left is therefore not a
weight, a family or a chooser among these four configurations: it is a signal that does not
exist in the dump yet.

**That signal has now been measured, and it resolved into three rows.** The engine computes
an injection-anchored onset delay per service (`postInjectOnsetDelays`), and the dump
carries it (`onset=<ms>`, `inject=<ms>`) with `--onset-screen` to solve it offline — one
command, no run. On the shipped configuration the engine's own shape and the rank shape have
**no admissible weight at all**, capped by the metric term's `0.010050` top step — the second
axis to close on that constant, which makes it a property of the metric rank spacing rather
than of any signal. The `earliest-only` shape **does** have an admissible window (**+4, 0
lost**) and is the axis's open candidate, with the pair as the next measurement. Read those
three rows before proposing anything on a TIME; the free read is one command and it is
already run, so a proposal that has not re-run it has not engaged the measurement.

**The onset candidate has since been measured and rejected, and the instrument that
judged it has been repaired.** `earliest-only` passed the FSE'26 half (+4 cases, zero
regressed fault types, the four datapacks the solver named in advance) and moved six of
the nine golden cells, so it was reverted (`docs/fse26-onset-verdict.md` §8). Two
iterations later the log-term reconstruction turned out to divide by the SUM of two
overlapping signature sets where the engine divides by their UNION — which deflated
every competing score in every case with a framework-HTTP flood, and which the
instrument had been printing as its own "error bar" (`docs/fse26-log-flood-verdict.md`).
That is worth reading as one story rather than two: **a mode pre-screen drawn from a
wrong denominator was used as evidence about a signal**, and the guard rail that would
have caught it — "the reconstruction must reproduce the dump's own mode, case for case"
— is now printed by the tool rather than assumed by its readers.

The instrument's reach at the shipped configuration is now measured rather than
inferred: the reconstruction reproduces the run's own rank-1 **1422/1422**, the routing
map is complete, and **221 of the 666 misses are silent on both sides**, which is larger
than any single term's attributable share. A candidate that has not said which of those
it addresses has not engaged the map.
