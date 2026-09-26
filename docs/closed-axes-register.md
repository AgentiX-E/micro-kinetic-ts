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

**And a row is found by the KNOB's name, so a search has to know all three of them.**
A ranking knob is reachable as a `workflow_dispatch` input (`fleet_baseline`), as a
CLI flag (`--fleet-baseline`) and as an engine option (`metricFleetBaseline`), and only the
first two are related by a rule. The documents and this register's rows are written in the
third — so a search for the input name reports four measured-and-rejected knobs as
unmeasured, which happened here and produced a drafted candidate before an instrument
caught it. `docs/dispatch-surface-audit.md` is the table that closes it: every ranking knob,
its three names and its owner, with `packages/kinetic/__tests__/unit/dispatch-surface-census.test.ts`
requiring that owner to exist, that the four non-derivable names stay an exact set, and that
the flag a workflow passes is one its runner accepts.

A fifth axis was missing from this table altogether, and it is the first whose record
lived outside this repo: the LLM-dependent ranking layer — the single-shot
evidence-grounded reranker and the GALA+ Phase-III multi-hop agent — was measured,
refuted and **REMOVED** (`0d6ae609`, 19 files, both ablation flags), and a fortnight
later it was proposed again as the next step, from a note that had never been updated.
Its row is below, and a test now keeps the retired slice's own symbols out of the tree
(`packages/kinetic/__tests__/unit/closed-axes-register.test.ts`), because a row is
prose while this closure was code — and that test failed on its own name list the
first time it ran, which is why it excludes itself.

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
| the diagnostics' LOG-TERM reconstruction — which lines the engine's level-1 gate admits, and therefore the denominator of every counting mode | `fse26-log-flood-verdict.md` | **a real defect, found and fixed.** The reader summed the two signature counts (`logic + http`); the engine admits a line ONCE, so its flood is the UNION of the two sets, not their sum. The dump proves the overlap without a new run: one case's source prints `logic=3495 http=3499 err=3499`, and two disjoint subsets of 3499 lines cannot have those sizes. Footprint over 72527 service rows: **81 with a non-empty overlap**, which was enough to make **109** scores disagree by > 6e-4 and to move **5** cases' rank-1 — printed all along as "the error bar". The second defect sat in the same function: the denominator was mode-INDEPENDENT, while `count` admits logic lines alone. Fixed with the union (and the overlap printed as a primitive `both=`); validated on the shipped dump over 1391 cases — **0 services differ, rank-1 +0/−0**, and the corrected `dominant@0.2` gain is **+1**, not the +6 the row below quote with a 5-case caveat. **The reach of the fix is now a PRINTED quantity** (`logFloodReach`, one field of each mode-screen row): on the shipped dump the union is proved for **72496 of its 72527 rows** and REFUSED for **31**, one per case in 31 cases, over intervals of **1 to 32 lines** against floods of 31 to 12809 — so the `logicHttp` rows read `[1391/1422 cases]` and now also carry the refusal and its widest interval beside them. The refusal is NOT free: the smallest refused row (`logic=22 http=11 err=33`) leaves the union unknown within a THIRD of the flood it divides. The reader's own comment used to assert that "all 71105 services pin it", which was wrong twice — 71105 is the count a parser that DROPS the unlabelled rows produces, and 31 rows do not pin | a signal whose flood is a set the dump cannot express — i.e. a third signature class, or a gate that stops being a boolean per line. The union is not an approximation to be traded off: dividing by the sum is dividing by a different quantity whose error depends on how much of the flood the two sets share |
| the injection-anchored ONSET prior (`temporalWeight`) — **the ENGINE'S OWN SHAPE** (min-max normalised delay) and the RANK shape (`order`) | `fse26-onset-verdict.md` §2, §3 | **measured on FSE'26** (`35006947938`, the shipped configuration, 1422 cases, 87.5% of services carrying an onset): **NO ADMISSIBLE WEIGHT ON EITHER SHAPE** — `earliness` gain 0 in `[0, 0.005361]`, `order` gain 0 in `[0, 0.005976]`, both capped by the same case (`ts4-ts-security-service-bandwidth-cs99dm`, `ts-preserve-service` overtaken by `ts-food-service`) whose **lead is `0.010050`, the metric term's top step for a 51-candidate case** — the SECOND axis to close on that constant, so it is a property of the metric rank spacing, not of this signal. The old −2.5pp RCAEval number is superseded by this: there is nothing to ship, on this benchmark, at any weight | a shape that is neither min-max in the delay nor linear in the onset RANK. Do not re-propose either: the free read is one command (`--onset-screen`) and it is already run. **And the intersection has since been computed** (`fse26-onset-verdict.md` §9): `earliness` DOES have a region the golden admits — `[0.007722, 0.010108)`, width `0.002386`, worth ONE case — but that weight sits AT OR ABOVE FSE'26's own cap (`0.005361`), so it costs a case on the benchmark it was to improve, and `order`/`latest-only` are closed by the golden at `0.003931`/`0.040848` against first gains of `0.006700`/`0.281658`. So the axis does not convert: **no temporal weight gains a case on FSE'26 without costing a case somewhere**. **And the one region that survived has now been DISPATCHED and REJECTED by a run** (`fse26-onset-verdict.md` §10): `earliness` at its midpoint `0.008915` (run `35420303504`) against the same-commit control `35420305720` (`temporalWeight=0`) gives **757 vs 757 — net ZERO** — with `HTTPResponseDelay 52 → 53` and **`NetworkBandwidth 13 → 12`**: one fault type REGRESSED, so the FSE'26 half fails and the criterion is an AND. No golden run was bought to confirm a rejection the other half had delivered; the row is recorded `golden: 'unmeasured'` and the guard never reads that as green. **Two `costsOnGainSide` caveats, two verdicts**: the stability axis's was loose (the run rejected it, zero regressed types) and this one was correct — which is why the instrument prints the caveat instead of applying it |
| the **`earliest-only`** shape of the onset prior (credit ONLY the service(s) that moved first — a MASK on the onset, where the competitor and the credited source are not the same quantity) | `fse26-onset-verdict.md` §4, §7, §8 | **SHIPPED, then REVERTED by the golden — both halves measured, and they disagree.** The FSE'26 half passed completely and at case granularity: control **756** (`35021503281`) against candidate **760** (`35021510164`), Top@1 53.45% vs 53.16%, three types up (`HTTPRequestDelay +2 / JVMMemoryStress +1 / JVMReturn +1`), **zero regressed fault types**, and the run that shipped it flipped **exactly the four datapacks the solver named in advance**, `broken 0`. The RCAEval half failed: **six of nine golden cells moved**, `RE1 TrainTicket 68.0 → 27.2` and `RE2 68.1 → 25.7`, reproduced identically on a second run (`35029285379`, `35030365430`). The weight is back to **0** and the shape to `earliness`; both points are kept in `MEASURED_TEMPORAL_PAIRS`, the rejected one with `golden: 'moved'`. **The revert is verified on both benchmarks, through the default path and with no pin** (`fse26-onset-verdict.md` §8): RCAEval `35035309768` reproduces **9 of 9 cells**, FSE'26 `35035314921` reproduces the control **fault type for fault type, 25 of 25, 756/1422 = 53.16%**, and exactly the pair's own three types differ against it (`HTTPRequestDelay 56→54`, `JVMMemoryStress 13→12`, `JVMReturn 13→12`) | **the two benchmarks disagreeing, and the criterion having no tie-break.** This shape cannot demote the late-mover source, but it still PROMOTES the early symptom, and on RCAEval the injection-anchored onset anchors to the source's slow-responding dominant metric — so the first mover is systematically a symptom there. Do not re-propose this shape at any weight: the mechanism is now measured, not argued, and the failure is ~41pp on a cell, not a ratio. **The intersection now names the ceiling**: this is the ONE temporal shape whose FSE'26 gain is free on FSE'26 (its own cap `0.038183` sits above its own window floor `0.034920`), and the golden's `re1` caps it at **`0.004717` — 2.2× below the first weight at which FSE'26 gains anything here (`0.010257`) and 7.7× below the `0.036552` the solver recommended** (`fse26-onset-verdict.md` §9). **And the four shapes' OWN laws are now stated, which turns the screen's `no step stated` into a measurement** (`fse26-onset-verdict.md` §11): `order` spaces its positions by `2/(n − 1)` — a rank law's RANGE became a field of the law, because the decisive screen normalises to `[0, 1]` and the temporal one to `[−1, 1]`, and the version that hardcoded 1 halved it — `earliness` is `(max − delay)/(span/2) − 1`, AFFINE in the printed delay, so its one position is ONE MILLISECOND of that column rather than `10^-decimals` of a service field (**`9.886e-6` against the old rank step `2.174e-2` on FSE'26, 2200×**), and `earliest-only`/`latest-only` are INDICATORS whose one position is their whole range. So the screen's margin line reads **`one crediting step 3.655e-2; 4 of 4 gains inside one step`** where it read `no step stated … 0 of 4 gains inside one step (4 without a law)`, and the cap's own class — computed and left UNPRINTED until now — reads **15 of 756 satisfied cases holding a boundary tie, the earliest of which can be lost at `0.026668`**, which is BELOW the window's cap `0.038183` and below the `0.036552` the solver recommended; the class is the same **15 at both boxes** (a threshold's membership is the printed boundary, and its tie groups did not move here) while `earliness`'s own permission moves `216.414837 → 216.531973`. **The temporal verdict did not move** — the golden still caps it at `0.004717`, below the `0.010257` at which FSE'26 gains anything — so what changed is that the FSE'26 side's own permission is a number where it read `never`. Reopening needs a source/symptom discriminator on the onset itself, screened on BOTH benchmarks before a run — and any reopening must first clear that `0.004717` |
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
| the **PAIRED** separator question — which dump-visible signal prefers the true source to the engine's rank-1, per fault type — for all 14 declared signals | `fse26-separator-verdict.md` | 666 pairs, 250 non-term cells, bar `Sidak(0.05, 250) = p < 2.05e-4`: **no signal separates globally** (the best non-term signal is `onset` at AUC 0.537, under the 0.60 criterion); **4/250 separate FOR the source** and **35/250 AGAINST it**, six of those deterministic (`JVMMemoryStress/transientDrops` 0-159, `kept` 0-158, `sigLines` 0-105; `ContainerKill/kept` 0-83, `transientDrops` 1-82; `JVMMemoryStress/reaches` 11-110). Only two of the four hold in **every fold**: `NetworkPartition/errLines` 30-3 (AUC 0.781, p=1.4e-6) and `HTTPResponseReplaceCode/reaches` 49-16 (AUC 0.732, p=5.1e-5); `JVMMemoryStress/inDegree` (98-48) and `NetworkLoss/inDegree` (21-2) each have a fold at exactly 0.500. 43/666 pairs carry NO non-term preference for the source at all — **over ten signals**; the field audit (`SERVICE_FIELD_AUDIT`, typed `Record<keyof DiagnosedService, string>` so a new reader field cannot reach main unclassified) then named the fields that were read but not screened, five more signals were added, and the re-run over **375 non-term cells** reports **13/375 for the source and 37/375 against** it. Two findings, one of which survives: the raw `failedEdge` COUNT separates at **0.908** on replace-code (60-2, stable in all five folds) where the gated SCORE does not (0.457) — the register's "per-edge counts do not separate" is true of the score and false of the count — while the four `decisive*` composition signals (leader `decisiveCv` AUC 0.734, p=2.0e-40) are **NOT established**: the conditioning that would separate them from the renderer's brevity has 0-5 pairs to stand on in every block type, i.e. the confound is saturated instead of excluded. **The reader feeding them was itself wrong, and is now fixed and re-measured.** `inventoryOf` selected the decomposition by largest `riseRatio`, on the claim that "the metric that drove the score is the one with the largest rise" — which the engine's own `dominant` name contradicts in **751 of the 7,733 decomposed rows (9.7%)**: the decisive metric IS the score argmax, the rendered list is sorted by score, so the name was already in the dump to be read. Reading the named metric (fallback: the highest-scoring entry; never the rise) moves every aggregate one way — `decisiveCv` 0.734 → **0.738** (p 2.0e-40 → 7.9e-42, losses 132 → 129) — all of it on the **shipped** dump `r35006947938`, whose header carries `latWeight=0.561495 latMinRise=10.3 poolMetricPenaltyWeight=0.0679` and NO temporal override, and which yields the **666** pairs this row was written from. **Provenance note, because the first attempt got it wrong**: the same measurement on `r35029055764` gave 662 pairs and was labelled "shipped" in two documents; that dump's header pins `temporalWeight=0.036552 onsetShape=earliest-only`, i.e. the REJECTED onset pair, and the register's own 0.734/2.0e-40 turning up as that dump's pre-fix value is what confirmed it. Read the header, never the filename, `decisiveBaseline` 0.628 → **0.644**, `decisiveBurst` 0.571 → 0.577, `JVMMemoryStress/decisiveCv` 0.682 → 0.689, `HTTPResponseReplaceCode/decisiveCv` 59-3 → 58-3, and `PodFailure/decisiveCv` **0.958 → 1.000 (24-0, stable in all five folds)** — and the UNCONDITIONAL rate does not reopen it, for a reason that is now a number: `kept` and `decisiveCv` correlate at **r = 0.4325 (ρ = 0.4086)** across the pairs' 1,332 services, and the source keeps FEWER metrics than the winner in **514 of 666** pairs (more in 126, equal in 26). **The matched comparison does reopen it, and it is now an instrument rather than a paragraph**: `INVENTORY_MATCH_BAND = 2` with `inventoryComparable`, a `kept<=` column on every row and a `near` sub-cell on every cell, whose legend states that the matched stratum is NOT the whole population. On the same dump the confound stops being a separator under matching (`kept` 0.209 → **0.271**) while `decisiveCv` retains **0.718 on 487 pairs** — the ONLY non-term rate that clears the 0.6 criterion on that stratum (`decisiveBaseline` 0.598 is next and falls short). Per type, matched: `ReplaceCode/decisiveCv` **0.885** (48), `PodFailure/decisiveCv` **1.000** (23), `JVMMemoryStress/decisiveCv` 0.661 (87), `ContainerKill/decisiveCv` 0.637 (40), `ReplaceCode/edgeRecords` 0.865 (48), `NetworkPartition/errLines` 0.793 (46). Quote **0.718**, not 0.738: the unconditional rate is an upper bound under a confound that is measured rather than assumed | a candidate built on `edgeRecords`, screened on a **different** held-out fifth and fitted per POPULATION (the network types reverse it) — and, for the `decisive*` family, **instrumentation** — specifically an **inventory-MATCHED** comparison: exact-`kept` matches are 26 of 662, so the confound check needs a coarsened match at a stated band before it has any power. a **candidate run** for `decisiveCv` — the window solver on both benchmarks, fitted per population, with the standing rule that a paired preference is not a term (`fse26-term-oracle-verdict.md` §9). **The solver this names now exists and the FSE'26 half is SOLVED**, behind `--cv-screen` (`fse26-cv-screen.md`): on all 1422 cases of run `35107871516` the `rank` shape has a zero-regression window at `[0.029860, 0.030480]` — gain 6, `lostAtShip` 0, `ship 0.030170`, Top@1 756→**762 (+0.42pp)**, the same 6-case magnitude the shipped pool penalty was accepted on — and `flip` gains 3. The instrument's self-check is exact (`correct at 0` 756 = the run's published 53.16%), and both the per-case closed forms and a direct re-ranking at five weights reproduce it. What is owed is therefore only the **golden half**, which cannot be measured offline because the term is not in the engine: an opt-in fusion weight defaults to 0, so enrolling it leaves the golden configuration bit-for-bit unchanged and the candidate is measured by PASSING THE FLAG, not by moving the default. The inventory match is no longer the blocker: what a run has to respect is the matched stratum (487 of 666, and the 179 dropped are the pairs whose inventories differ most) and the family split (`decisiveTrend` 0.372 the other way). Rendering the decisive metric for every service was never the missing instrument — the asymmetry is in how many metrics each side KEEPS. **The candidate run the condition asked for has now been taken**: `35125277962` at `stabilityWeight=0.03017` against the control `35125285784` on the same commit (`95f963c`), where the control reproduces the shipped headline exactly — **756 / 53.2%**, Top@3 66.5%, Top@5 70.3% — and the candidate delivers **+5 cases and 0 regressed fault types**: 761 / 53.5%, Top@3 66.7%, Top@5 70.5%, with `HTTPResponseReplaceCode` 160→161, `JVMMemoryStress` 12→13, `HTTPResponseDelay` 52→53, `HTTPResponseReplaceBody` 45→46, `JVMException` 30→31 and no type down. The solver claimed **6**; the case it did not collect is the one its own margin list names as thinnest — **1.054e-4** at the shipped weight, against `3.129e-4` for the next and a rank step of **6.034e-4** — a step the SHAPE's own law supplies, and the screen now names which: the same artifact's `flip` row reads **3.086e-5** (a printed-digit step, `quantum/scale`, 15× smaller at the same shipped weight, and it moves `10.2×` with one more digit where the rank step does not move at all — the same asymmetry the span carries, because a sub-quantum difference becomes a whole RANK STEP for one shape and only the quantum itself for the other) — and the dump renders every input at three decimals, so the sixth gain was never resolvable from it. That margin is a scale and not a calibrated threshold (`3.129e-4` is also under `1e-3` and that case WAS collected); what it buys is that `--cv-screen` now prints it, so a knife-edge claim is visible before a run rather than only after one. What is still owed is the **golden half**: at the enrolling commit `0ab737f` the run `35125060855` reproduces **all nine cells** (`RE1 80 / 92.8 / 68`, `RE2 82.4 / 88.9 / 68.1`, `RE3 80 / 45 / 51.1`) — which is the DEFAULT path, where the weight is 0, so it is the enrolment that is verified rather than the weight. The weight's own golden is unmeasured and cannot be argued away (the field exists on RCAEval too), so the term SHIPS at 0.007352: 0.030170 was the WINDOW's own midpoint and it is a REJECTED point, while 0.007352 is the midpoint of the INTERSECTION and both halves were measured green; `earliest-only` passed this same FSE'26 half completely and then moved six of nine cells by up to 41pp. **That half has now been measured, and it is a VETO.** `run-rcaeval.ts` gained `--stability-weight` (default read from the engine's `DEFAULT_STABILITY_WEIGHT`, so a push-triggered run is byte-identical) and `benchmark-rcaeval.yml` the matching `workflow_dispatch` input, and the dispatched run `35132525118` at `5233678` with `stability_weight=0.03017` **moves four of nine cells**: `RE1 OnlineBoutique 80.0 → 79.2`, `RE1 TrainTicket 68.0 → 67.2`, **`RE2 TrainTicket 68.1 → 52.3` (−15.8pp)**, `RE3 SockShop 45.0 → 47.5`. So 0.03017 buys +5 on FSE'26 and costs four golden cells, one of them by 15.8pp: under the shared kill criterion the WEIGHT is rejected and its default stays 0. Two things are now measurable that were not: the resolution of the count itself (`gainResolution`, in `fse26-cv-screen.md` §4 — at 0.030170 the `rank` shape's six gains hold in 22.5% of 400 seeded resamplings of the digits the producer discards, **five in 36.0%**, four in 30.5%, three in 8.8%, two in 2.3%, and **1 of 6** holds in every one, so the run's own five is the MODAL outcome while `flip`'s three hold 95.3% of the time), and the second benchmark at any weight via the flag. **The second benchmark can now be solved OFFLINE as well**: `run-rcaeval.ts` emits the same diagnostic dump the FSE'26 runner does (`--diagnose-dump`, driven by `benchmark-rcaeval.yml`'s `diagnose_dump` input, one file per invocation and shipped as an artifact), assembled by the ONE writer `buildFSE26Diagnostic` — which is what found the second defect: that runner derived the failed-edge record count and the inbound latency rise from the raw converter's tuples while the loaded case already carried the loader's normalised form of both, i.e. two sources for one number, and the reason no second runner could reuse the builder. So one dispatch now buys every subsequent weight: the window solver, the family screen and the decisive-stability screen run on the golden's own case set at no further cost, and the reopening condition is checkable before the money is spent rather than after. **The first dispatch has now been read, and it described less of its run than it appeared to, twice.** `--suite re1` evaluates 375 cases (125 in each of three systems) and the artifact held **125 blocks, every one of them tagged `re1tt`**: the runner built the text per group and called `writeFileSync` INSIDE the group loop, so each system truncated the last one's while the console printed the same `125 cases, 125 blocks` three times. And `Config:` appears **0 times in all seven dumps** against the FSE'26 dump, which opens with the run's own line — so the `re3` dump, the only one dispatched with `traceWeight=1`, reconstructs to `correct at 0 1` against its own `prediction= 15` with nothing in the file to explain it. Both are fixed by one owner for the file (`DiagnoseDump`): records accumulate across every group, `write()` runs once after the last group, a record after the write and a second write both RAISE, and the file opens with `formatSignalLine(opts)` — the banner's own string, so artifact and console cannot state different modes. Measured on a three-system fixture with the same input: **old 3 blocks, all `re1tt`, no header; new 9 blocks, `re1ob 3 / re1ss 3 / re1tt 3`, header = the banner line**. The fidelity question is now answered as a table rather than an assurance: against each dump's OWN `prediction=` rank the reconstruction is **exact on all four `traceWeight=0` dumps** (`re1` 85, `re1-noinject` 85, `re2` 33, and even `re3-noinject`'s 1 of 30) and diverges **only** on the trace-augmented one (15 → 1), which is the one term the reconstruction does not model — so a `traceWeight=0` dump is screenable, a `traceWeight>0` dump is not, and the instrument says which it is holding. **And then the base every screen reconstructs on was found to be gap-wrong.** A paired dispatch at `stability_weight=0.030170` WITH `diagnose_dump` (`35181249060`) makes the dump's own `prediction=` list the engine's ranking at that weight, so the engine's flips are readable case by case: **re1 gained 1 / lost 3, re2 gained 0 / lost 8, re3-noinject gained 1 / lost 0**. Against the screen's own version of that term — its `rank` shape, which IS the engine's `computeStabilityScores` — the screen reads **300 (1/2), 111 (0/8, every NAME identical), 37 (0/0)**: exact on `re2`, and two cases out on the other two suites. The `+7 / −13` quoted before that was the screen's DEFAULT (`flip`) shape measured against a rank-shaped engine term — two different quantities. The cause is a wrong QUANTITY in `blendScores` plus a CONDITION it did not carry: the engine takes `log1p` of the node's anomaly AS THE TOPOLOGY BUILDER LEFT IT (`pruner.ts` 1400/1575), and that builder rescales the vector only at or above `ANOMALY_NORMALIZE_NODE_THRESHOLD` nodes (`topology-fault-graph.ts` step 1b; 20, now an exported owner), while the reconstructor substituted a re-derived rank rescale unconditionally (`fse26-term-oracle.ts` 219, deleted). The rescale is monotone, so the ORDER was the engine's on every case and the GAPS were not on any case below the threshold: **407 of the golden's 615 cases** (`re1` 250/375, `re2` 100/150, `re3` 57/90 — the OB and SS systems at 12–19 services) and **0 of FSE'26's 1422**, where every case is 51 or 52 services (`{51: 1417, 52: 5}` measured on the dump) — which is exactly why only the second benchmark could expose it, and why the FSE'26 headline is untouched. The fidelity line could not have exposed it either, and for a worse reason: it printed a metric-term deviation of `2.51e+0` over `3500` of its `11557` services on `re1` — a deviation with no unit, no population and no pass condition, read as a rounding detail for as long as the defect lived. **Corrected and re-measured**: the metric term is read off the row (`log1p(service.selfAnomaly)`), `metricSlopes` is deleted rather than documented, the threshold is exported with a test that pins BOTH sides on a real graph (19 nodes raw vs 20 rescaled, and the flag provably inert below it), the producer's `selfAnomaly` contract no longer claims "[0, 1] rank-normalised" (false on two thirds of the golden), and the deviation counter is replaced by the population split plus the check that CAN fail — at or above the threshold no value may EXCEED 1, measured **0 cases** on every dump read, and reported separately from the 34 of 1422 FSE'26 cases whose maximum is BELOW 1.000 because a TIED top anomaly takes its tie group's mean rank (`47.5 / 50` for a six-way tie — the first counter written claimed a 1.000 maximum instead and the first real dump falsified it, which is why the falsifiable half and the population fact are now two lines). The regression proof is that every fidelity number is bit-identical (`correct at 0` 301/301/119/119/35/37/37, and `rank-1 same as the dump's own recorded` 375/375 · 375/375 · 150/150 · 150/150 · 70/90 · 90/90 · 90/90) and the whole FSE'26 half is byte-identical (`correct at 0` 756, `rank` gain 6 at `[0.029860, 0.030480]` ship `0.030170`, `flip` gain 3 at `[0.021536, 0.024882]` ship `0.023209`, both margins, both resolution lines). What moved is the golden's own window arithmetic: `re1` `flip` ship `0.007968 → 0.008032`, `rank` cap `0.015112 → 0.015233`, and at the weight `flip` `295 → 294` with gained `7 → 6` (`re2` and `re3-noinject` unchanged at `107`/`37`), plus the FSE'26 resolution histogram — with a stated cause: `gainResolution` resamples the render's discarded digits, and the old base RE-RANKED a resampled row, so its jitter moved the term by a rank step (≈`1/50`) instead of a digit. At `0.030170` the six gains now hold in 23.5% of the 400 seeded draws and **2 of 6 in every draw**, against the old 22.5% and 1 of 6. The two residuals are NAMED rather than inferred, and both decide on a pair whose `cv` renders equal (`0.050` vs `0.050`; `0.045` vs `0.045`) while the engine ranks on the unrounded field — so no weight can reorder them from this artifact, and "unreachable at every weight" now has a third cause besides "no decisive composition" and "the term cannot cross the gap". So: the VETO stands (it is a run's own measurement), the term stays admitted at 0.03017 and off by default, every window figure in `fse26-cv-screen.md` is quoted against the corrected base, and the correction's own golden is **9 of 9 cells byte-identical** (`35199445631` at `8bcf16c`: `RE1 80.0 / 92.8 / 68.0`, `RE2 82.4 / 88.9 / 68.1`, `RE3 80.0 / 45.0 / 51.1`, every job green) — the kill criterion's second half, measured by the push that carried the change rather than asserted. **And the unreachable count now travels with its causes**, because one count read the same whether the term had no input here, read a deciding pair as EQUAL, or genuinely could not reach: FSE'26 `rank` **526 = 0 root-without-a-row + 0 no spread + 0 unweighed + 226 tied at the render + 300 out of reach** (`flip` 569 = 0 + 0 + 0 + 236 + 333), `re1` `rank` 52 = 0 + 0 + 0 + 20 + 32, `re2` 24 = 0 + 0 + 0 + 11 + 13, `re3-noinject` 37 = 0 + 0 + 0 + 25 + 12 — five classes, because an equal slope the term weighed on NEITHER side is a pair the ENGINE cannot separate either, and it reads 0 on every dump here — with every total IDENTICAL before and after the split (measured on the same dumps) so the classes are a refinement of the count rather than a new one. That is how one of the two residual disagreements — `re3ss_front-end_f3_2`, whose deciding pair renders `cv=0.045` twice — became a CLASS rather than something a hand-diff against the engine had to find; the other, `re1ob_currencyservice_delay_4`, is on the CAP side, and the mirror class is now built and NAMES it: **the cap is an UPPER bound** — 31 of `re1`'s 301 satisfied cases, 14 of `re2`'s 119 and 510 of FSE'26's 756 hold a rival the artifact cannot order (on FSE'26 the cap's own case is one of them), each case's frontier being a gap the engine ranks on the unrounded `cv`. **The count is a count of a BOX and not of a benchmark**: the class is *pairs the RENDER cannot tell apart*, so a finer render splits them — FSE'26's own class is **356 of 756 at four decimals**, a 30% shrink on the same 1422 cases, and every count in this paragraph is quoted at the three decimals those dumps declare. The class is a NECESSARY condition and the paired dispatch confirms it in the only direction that can be checked: **exactly one satisfied-side disagreement exists (`re1ob_currencyservice_delay_4`) and it is inside the class**, while the engine's other losses at that weight (2 of 3 on `re1`, all 8 on `re2`) are ones the model predicts too. **And the class carries its own bound rather than a caveat**: an equal rendered `cv` means the two services sit in ONE rounding cell, so the engine's slope gap for the pair cannot exceed what THAT SHAPE's spacing can hide — `(g − 1)/(n − 1)` for a shape that re-ranks, `quantum/(scale − quantum)` for one that is LINEAR in the value — and the earliest weight it can cost the case is `lead / span`. Over the class that is `lossFloor`, **0.003873 on FSE'26 against a cap of 0.030480 (8× under it)** on the `rank` shape, 0.008032 against 0.015233 on `re1`'s `rank` shape, and above the cap on `re2` where the channel cannot bind at all. **The two laws are not interchangeable, and the gap between them is the shape's own exposure to the render's resolution**: on FSE'26 the same class and the same leads give `rank` `0.003873` and `flip` `1.457280` at four decimals — a sub-quantum difference becomes a whole RANK STEP for a shape that re-ranks and only the quantum itself for one that is linear, so a finer render leaves the rank-spaced exposure bounded away from zero (`0.1%` across one digit) while the value-linear one VANISHES (`10.1×`) — and the class's own count shrinks with the quantum for the same reason. What is NOT a property of the shape is the class's MEMBERSHIP: both shapes are strictly monotone in `cv`, so two services one cell cannot tell apart are one cell apart under either. The floor is a PERMISSION and not a prediction, and the one run that measured it says so: the FSE'26 candidate delivered +5 cases with **0 regressed fault types** at 0.030170, so the engine's own cap is above that weight and the bound is loose by more than 8× there. **And the separator's own instrument has since caught a THIRD defect in itself, whose reach is the census's Finding 7**: `bestDev` and `bestRise` were maxima initialised at `0`, so a service whose block rendered an inventory and NO decomposition read `0` — the value a decomposed zero-deviation metric also takes. `SeparatorScalar.of` already reserves `undefined` for "an inventory the block did not render" and the container `rendered` already honours it; the rule had been applied to the container and not to the two numbers inside it, and a test on exactly that fixture asserted it for the three `decisive*` signals while `bestDev`/`bestRise` on the same fixture returned `0`. Measured in production on `artifacts/diag-34684319273` (2095 inventories, **zero** decompositions, 2094 labelled rows): **319 pairs decided as ties at 0.500 with the `n/a` column at zero → 319 `unmeasurable`**, and a full-report diff over six artifacts shows `re3`, `artifacts/r34919714864` and **the shipped dump this row's table is read from** bit-identical (`bestRise / bestDev` 0.270, `180–486–0`, unchanged), `re1`/`re2` one pair each into `n/a` (`bestDev` 74→73, 31→30) (`docs/fse26-separator-verdict.md` §2.3) |
| the weak-fault-type gap, as a block | `fse26-data-gap-verdict.md`, corrected by `fse26-stock-attribution.md` | 579 cases / 40.7% of the dataset; HTTPResponseReplaceCode 231 @ 4.8% is the signal gap and the top lever | a candidate that names which of the two mechanisms it addresses — **and note the correction: that type is two populations (173 backend-sourced at 91.9%, 58 `ts-ui-dashboard`-sourced at 0.0%), so a type-level claim about it is not a claim about 231 cases. Both mechanisms the row's own framing named are now closed on measurement: see the row above** |
| the LLM-dependent ranking layer — the single-shot evidence-grounded reranker (`RerankingEngine`) and the GALA+ Phase-III multi-hop ReAct investigator (`InvestigatorEngine`), the two slices behind the `llmReranker` and `agenticInvestigation` ablation flags | the retirement record (`LLM_RERANKING_LAYER_RETIREMENT`, in the docs repo) with the evidence chain in `GALA_PHASE3_AGENTIC_RCA` §7 and `TT_RE3_ROOT_CAUSE_FINDINGS` §7 | **AVG A@1 Δ −1.1%** for each engine, and **wrong→correct = 0** on the class that motivated them: in 54 agent conclusions (`33460058463`) 16 TT RE3 cases changed and **9 still answer the SYMPTOM `ts-order-service` and 0 the source `ts-auth-service`**, with SS regressing 40.0% → 36.7% and OB unchanged; the Phase-III matrix (`33403700788`) reads OB Δ0.0 / SS +3.3 / TT **+1.1% from a single hit in 1 of 3 reps**, under the 3-hit rule. The layer was then REMOVED in `0d6ae609` (19 files, both flags), so the ranking is purely deterministic | a frozen-model prompt or evidence change converts the TT RE3 class and shows **wrong→correct > 0 reproducibly (3 of 3 reps)** with RE1/RE2 held. The information IS present — the exception class, the service name and the dependency edge jointly encode the chain — so what closed is a practical reasoning ceiling of the evidence presentation, not an information floor: a reopening needs the presentation to change, not the weight |
| the DIRECTIONAL source signals — the collision ratio `ratioContrib` (`collisionWeight`), the topological source (`topoSource`, `topoWeight`) and trace-activity | `re3-fault-ceiling.md`, `silent-source-ceiling.md` | measured on **two populations and the sign inverts between them**, which is the whole finding. SockShop RE3: **9 of 10 failures are REVERSED** — `carts_f1_1` GT `0.559` against top1 `0.228`, `carts_f1_4` `0.457` against `0.274`, `carts_f4_3` `0.581` against `0.059` — because `ratioContrib = collisionGain / (local + collisionGain)` reads "energy inherited from upstream = symptom" and a **fan-in callee** source inherits from its many callers, so `collisionWeight > 0` penalises the source and rewards the symptom. TrainTicket RE3 f3 is the mirror: it is the **only correct direction** (GT `0.000` against top1 `0.110`-`0.284`) but flipping each case needs `collisionWeight` **4.2 / 3.7 / 2.6**, and **`f3_3` and `f3_4` have no discrimination at all** (`ratioContrib` `0.000` on both sides, i.e. no finite weight), while `≥ 2.6` regresses the other suites. `topoSource` is unstable the same way across ONE fault class: TT RE2 `GT = 1.000` against top1 `1.000` (no discrimination, both are roots after trace augmentation), TT RE1 `0.02`-`0.22` against `0.09`-`0.68` (reversed), OB RE1 `pcat delay_1` `0.000` against `1.000` (reversed) while `adsvc loss_2` `0.989` against `0.295` (correct). Trace-activity is `< 1` on every SS RE3 failure (the span **drops**, the gate stays neutral). Keep all of them at `collisionWeight = 0` / `topoWeight = 0`; do not re-run their ablations | a source/symptom signal that is a function of a node's OWN metric shape and **not** of the direction of explanation — i.e. neither `ratioContrib` nor `topoSource`, and not a mask on either. A candidate that removes the fan-in asymmetry — an upstream-inheritance test that a callee source does not satisfy — reopens this row only by re-measuring BOTH populations, since the two readings above are both true and neither generalises |
| callee→caller REVERSE propagation (Direction 2 — the mirror `topoSource`, `1 − maxChildExplanation`) | `reverse-propagation-falsified.md` | falsified **before any code was written**, from the SockShop RE3 metric dump read against the bit-identical golden (`3044b29`), which is why no 55-minute cycle was spent. The victims that outrank the source occupy **all three** topological positions in the SAME case: `carts_f1_1` is outranked by `front-end::error` (**upstream caller**, `dev` 1.47-1.76) and by `rabbitmq-exporter::cpu` (**sibling/sidecar**, not on `carts`'s path at all, `0.55`-`1.52`), while `carts-db::diskio` (**downstream callee**, `0.30`-`0.35`) points the other way. So no single direction `d` makes "source = the node unexplained from `d`" simultaneously correct for `front-end`, `rabbitmq-exporter` and `carts`, and the mirror signal is dead by the same argument as the forward one: **a source's neighbours are ALWAYS anomalous** (they are the propagation symptoms), so any "explained by a neighbour" test discounts the source in every direction | a static-graph resolution of the chicken-and-egg problem — a neighbour test that is not "explained by a neighbour" — or a failing population whose victims are single-direction (which the measured one is not). The deterministic ceiling the row records is `~77.4%` Top-1, and the residual is off-path near-zero-baseline noise a propagation signal can never see |
| near-zero-baseline rise suppression (`suppressNearZeroBaselineRise`, commit `13e7cc3`) | `near-zero-rise-suppression-falsified.md` | **a measured NO-OP**: run `34227145755` is bit-identical to the golden baseline on all **9** cells (RE1/RE2/RE3 × OB/SS/TT), so it neither moves RE3 nor regresses RE1/RE2, and the default stays `false`. The reason is a precision error in the hypothesis, not an absence of leak: the production top-1's baseline across all **35** RE3 cases spans `0.008` to `8.3e7` and **none is `≤ 0.001`**, so the guard never fires. The near-zero culprit is real in the RAW view (`rabbitmq-exporter::cpu`, `head 0.0001`, `dev 1.52`) but rank normalization + trace/topo fusion already demote it to 4th at best and it is **never** top-1 — the top-1 is `front-end::error` (`base 0.156`-`0.184`, `dev 1.62`-`1.76`, an upstream caller's error DROP) and `*-db::diskio` (million-scale baseline). Kept as an opt-in probe (default `false`, like `suppressIdleTransients`) because it documents a leak that only surfaces with rank normalization OFF | a configuration whose top-1 CAN carry a near-zero baseline — i.e. rank normalization disabled — where the guard is load-bearing rather than inert. Any claim that the RE3 gap is "near-zero spikes" is about the raw deviation view and is corrected by the ranking view |
| the rank-collapse hypothesis (`log(1.0) = 0` collapsing the top anomaly to zero) and the `log` → `log1p` change it produced | `rank-collapse-falsified.md` | **net-neutral: 9 of 9 cells byte-identical** to the golden (`34350966725`) — zero gain, zero regression — and the reason is a proof rather than a measurement: `log` and `log1p` are both strictly increasing on `(0, 1]`, so the base term's induced ORDER is invariant and only the adjacent gap changes (`log(1.0) − log(0.98) = 0.0202` against `log1p(1.0) − log1p(0.98) = 0.0101`, i.e. it halves). `log1p` is retained as a CORRECTNESS fix, not a lever: `log(0) = −Infinity` for the minimum-anomaly service is a latent defect for every downstream consumer of `finalScore` (the optimizer, a judge, an average) | a case whose winner is decided AT the rank-1 gap against a secondary signal at the shipped weights — the measurement is the same nine cells, and the gap it would have to cross is now half of what it was |
| the LLM code-level exception classifier as the RE3 log-side lever (Direction B) | `re3-log-ceiling.md` | rejected **before any LLM code was written**, by a deterministic inventory: `classifyExceptionKind` over all **90** RE3 cases (dump run `34198157294`) reads **12 LOGIC / 57 SILENT / 21 UNCLASSIFIED** — `classifyExceptionKind` projects every exception-bearing line into those four buckets and the `unclassified` bucket is the only place an LLM could add value — and **every one of the 21 is a transport-level exception** — `BindException`, `IOException`, `ConnectException`, `MongoSocketOpenException` — i.e. the whitelist already covers **100%** of the recoverable logic semantics. The 57 SILENT cases have no exception content at all (socket drop / cpu / mem / network raise none), so there is no text to reason about; and a class name cannot separate source from victim in a fan-in topology, where one DB outage makes the callee throw `MongoSocketOpenException` and every caller its own `ConnectException` wrapping it | a corpus change that puts a **whitelist-missed LOGIC** exception in the `unclassified` bucket. `classifyExceptionKind` and `scripts/dump-re3-exceptions.ts` are kept as the permanent probe, so that gap is MEASURED if it appears rather than assumed |
| the RE1/RE2 residual failures as a separate frontier | `re1-re2-ceiling.md` | read from run `34176635640` (`3044b29f`, bit-identical golden): the residual failures in RE1/RE2 share RE3's **exact** structural causes, so there is no second frontier. Every one shows the source's gentle change out-ranked by a near-zero-baseline victim spike (`dev` up to `1.94` against the source's `0.20`-`1.40`, `rise` 9×-86×), `topoSource` **unstable in sign across one fault class** (TT RE2 `1.000` against `1.000`, TT RE1 `0.02`-`0.22` against `0.09`-`0.68`, OB RE1 `0.000` against `1.000` reversed while `adsvc loss_2` `0.989` against `0.295` correct), and the source's onset **LATER** in nearly every case (`onset ... (source later ✗)`). `trend` is the one nominally promising shape and it is not a lever: it beats the victim in TT RE1 (`0.22`-`0.43` against `0.00`-`0.28`) but collapses or inverts in TT RE2/OB RE1 (`order cpu_1` top1 `0.574` against `0.341`), and flipping the gap needs `trend` weighted ≈`2.3×` `dev` while regressing RE2/RE3 | a signal that is **not** monotone in a service's own self-anomaly and **not** directional — the same reopening condition as the RE3 metric row, because this row's measurement says they are one axis. Combined with the log row above, the metric-agnostic deterministic ceiling is `~77.4%` Top-1, characterised on every axis of every suite |
| the `fse26-emitter-dominance-falsified.md` record and the `fse26-logicHttpJoint-falsified.md` record — the two FSE'26 log-shape verdicts | named here because their measurements live in the log-signal mode row (`logicHttpDominant`, `logicHttpJoint`, `count`, `all`): the first closed `logicHttpDominant` as an emitter-dominance signal BEFORE its ablation, and the second closed the relative callee-anomaly gate | both are rows of the log mode row above, which carries their numbers (749-753 with 5 regressed types, best zero-regression point `0.2` at +1; `logicHttpJoint` 562 with 8 regressed types, costing `ReplaceCode` −104). Recorded separately so a reader who opens either document finds its axis in the register | the same condition as the log mode row — a new mode measured better on the same cache — and a reader who re-derives either must reconcile with the log-flood denominator first (`fse26-log-flood-verdict.md`) |

## What this register holds besides its axes

Every document in `docs/` is reachable from here, because this is the one file a session is told to read
first and a record it does not name is a record nobody finds. These are records and probes rather than axes —
they carry no closing number, and the rows above remain the place an axis is looked up.

| document | what it holds |
| --- | --- |
| `benchmarks-typecheck-audit.md` | the `benchmarks/` type-check and coverage audit |
| `coverage-gate-audit.md` | which coverage thresholds are enforced, and what the unenforced ones hid — §1 the six packages missing from the CI matrix, §7 that the ROOT command enforced nothing at all and printed a number that was the coverage of nothing in particular, §8 that the python gate's own number read 99.88% in CI against 100.00% locally, entirely from one skipped class reading artifacts by absolute path, §9 that the job claiming to gate the Parquet → JSON bridge EXCLUDED it, the omit list being exactly the three filenames containing a hyphen, §10 that the command §7 introduced asked for coverage with an argument the package manager can drop |
| `declaration-connectivity-audit.md` | a declaration that is not connected to what it names, in three layers — §2 the artifact's cache key was the CONSTANT `RCAEvalJSON` at 26 sites in 11 workflows while the workflow's own trigger said *run when the bridge changes*, so ten runs after the bridge was fixed converted nothing and the 39 GB artifact the nine cells are read from was 48 days old, produced by `pandas 3.0.5 / pyarrow 25.0.0` and recorded nowhere; §3 the coverage request was a flag appended after the task runner's separator, which ran every suite, exited 0 and measured nothing wherever the package manager does not forward it; §8 the producer is a DIFFERENT workflow started by the SAME push, so the benchmark's `consume` refused four jobs on a dataset that did not exist *yet*, and the missing declaration was a bounded wait (`--await`, one `artifact` job, `actions: read`) rather than a looser refusal |
| `tests-typecheck-enrollment.md` | the test suites and tool configs that were the last TypeScript no compiler read |
| `fse26-converter-integrity.md` | the converter-integrity verdict that gates the FSE'26 pipeline |
| `fse26-result-attribution.md` | why the result artifact must carry the configuration that produced it |
| `fse26-logicHttp-ablation.md` | the `logicHttp` mode ablation readback |
| `fse26-error-flood-ablation.md` | the `all`-mode error-flood ablation readback |
| `fse26-logicHttp-regression-diagnosis.md` | why `logicHttp` loses 41 of the cases it wins |
| `fse26-metric-source-attribution.md` | the metric source attribution and fan-out census (P1c-abl) |
| `fse26-per-edge-latency-assessment.md` | the feasibility and cost of per-edge latency evidence, before writing code |
| `prism-head-to-head.md` | the PRISM reimplementation and the 9-cell head-to-head that opened the fusion direction |
| `sota-comparison.md` | the corrected SOTA calibration on RCAEval |
| `sota-roadmap-2026.md` | the roadmap and validation method toward a defensible SOTA claim |
| `artifact-capability-audit.md` | what an artifact CARRIES — the `every` / `some` / `none` census, its refusal, and (Finding 7) the census's own POPULATION: seven hand-written channels against the artifact's thirty-one fields, so **both two-part families were covered in the half the other covers** — `failed-edge` read the SCORE and left `edgeRecords`' COUNT with no channel (AUC 0.908 where the score reads 0.457), `latency-edges` read the COUNT and left the `lat` term's RISE with none, its reach the other half's (**100%** against the rise's **52.0%**) — and six quantities the declared signals read had no channel at all. The population is now a table whose key column is the producer's own literal with each marker DERIVED from it, held by two fences on a two-edge chain: the python test keeps the committed projection equal to the table, and the TypeScript test builds a dump with the PRODUCER and holds the emitted keys, the table's `fields` and `Object.keys(SERVICE_FIELD_AUDIT)` equal in both directions |
| `register-fence-audit.md` | why this register's own fence was keyed on a filename, and the nine closures that were invisible to it |

## The shared kill criterion

Any candidate that changes the shipped ranking must move **both**:

1. **RCAEval golden 9-cell byte-identical** (RE1 80 / 92.8 / 68, RE2 82.4 / 88.9 /
   68.1, RE3 80 / 45 / 51.1), and
2. **FSE'26 with zero regressed fault types.**

A headline gain does not buy silence about regressions — that rule has rejected
+0.14pp, +0.28pp, +0.49pp and +5.8pp alike, and it is what the two above it are
for.

**The criterion is an AND, so it is only decidable where BOTH halves can be
dispatched.** Measured in `docs/dispatch-surface-audit.md`: the FSE'26 workflow dispatches all
14 ranking flags its parser accepts, and `benchmark-rcaeval.yml` used to dispatch **1 of 17** —
which made the decidable set the one-element intersection `{stabilityWeight}`, an element that
existed only because the stability candidate needed it. **That gap is closed**: the workflow now
exposes the four knobs BOTH runners accept, so the intersection is
`{logWeight, rankNormalization, onsetShape, stabilityWeight, temporalWeight}` — five, with 12
ranking flags still unreachable. The four added are exactly the both-runners set; an
RCAEval-only knob would grow the surface without growing the set of answerable questions.
Two consequences are worth keeping: the temporal rejection's `golden: 'unmeasured'` was the
only reading *available* (`run-rcaeval.ts` accepted `--temporal-weight` and no dispatch could
pass it), and the register's note that the temporal axis was once unfalsifiable because
`run-rcaeval` pinned `temporalWeight: 0` acquires a sequel — the pin was removed, the
replacement was unreachable, and **a repaired pin whose replacement is unreachable is still a
pin**. A candidate on an axis whose knob is still undispatchable must say **which input it will
add** before it can claim a golden half.

## The invariants that make a measurement trustworthy

Before reading any number, check that the input was counted:

- the FSE'26 run prints **`Data: failed edges in …`** — a signal that received
  nothing reports the same headline as a signal with no effect;
- an argument the runner cannot honour **fails before a case is loaded** — both benchmark
  parsers used to discard an unrecognised flag silently, so a dispatch asking for a
  configuration it could not express ran the shipped one and printed a confident number for
  it (`docs/cli-argument-rejection-audit.md`). A flag whose *value* is missing was worse: it
  consumed the next flag, so the request was replaced by two defaults. The rule now is
  **an unusable value falls back to a published configuration; an absent one is refused**,
  and the flag itself is never discarded;
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
- **a reader's COUNT must be checkable against the artifact's own declaration.** The census
  that answers "what does this artifact carry" first required a non-empty service id and so
  dropped the unlabelled series the engine ranks — one row per case, **1422** of them on the
  FSE'26 dump — and that error runs one way only: a row that is not counted can never make a
  channel look LESS universal, so every `every` it produced was optimistic. The engine's own
  parser had the same defect for the same reason, and its count disagreed with the header's
  `services=` in **1421 of 1422** cases, unchecked. A block that renders fewer rows than it
  declares is now counted and named, and the row population is asserted against the number the
  engine's parser reaches on the same file (`docs/artifact-capability-audit.md`).
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
- **a tool that reports "nothing to check" must have MEASURED the nothing.** The reader that finds a
  commit's benchmark run asked GitHub for it through the `head_sha` filter, which matches the FULL
  forty-character SHA: `head_sha=d2625d0` answers `total_count: 0` while
  `head_sha=d2625d05d33576f8d2575858c3d04ed3c6d309ca` answers **three runs for the same commit**
  (`ci.yml`, `release.yml`, `benchmark-rcaeval.yml`). A short revision is the NORMAL argument here, so
  the empty answer was the common case — and the reader turned it into the sentence *"this push does not
  touch a path that can move the engine, so no golden is owed"*, which is `benchmark-rcaeval.yml`'s own
  `push.paths` rule restated in prose and applied to a commit it had never been evaluated against. Two
  answers that must never be the same — "the query was wrong" and "no run is owed" — printed
  identically, which is the same shape as a search that cannot fail. The rule now has one owner, under
  the python gate at 100% branch coverage: `scripts/golden_run_selector.py` resolves the revision before
  it is queried, builds the URL at the only place that knows the full-SHA requirement, reads the trigger
  list FROM the workflow rather than restating it, and REFUSES a pattern construct outside the
  implemented subset (`?`, `!`, a segment-internal `**`) instead of reading a filter as something it is
  not. A push that does match raises rather than being explained away
  (`docs/golden-reader-audit.md`).
- **A WAIT MUST BE LICENSED BY THE SUBJECT'S OWN DECLARED BOUND, AND AN UNLICENSED ONE ACTS ON A FEELING.**
  Three golden runs were cancelled because the record said the workflow's three `ablation-*` jobs *do not
  finish* — one of them "still `in_progress` EIGHT HOURS after starting" — so that *a job that never
  finishes denies the record its own standard reader*. Measured over **25 runs and 222 job intervals, the
  longest interval this workflow has EVER produced is 53.0 minutes** (`ablation-re2`, `success`); none
  exceeds an hour and none exceeds three, because every job declares `timeout-minutes: 60` and GitHub
  enforces it — the eight-hour figure is outside the range of anything the workflow can produce. **Every
  run that was not cancelled has all three ablations `success`** (`re1` 12.9–13.8, `re3` 27.9–30.5, `re2`
  32.4–53.0; run total 45–62), and every cancelled one was cancelled by this session at 13.5 / 22.3 / 37.4
  minutes. The cancel **caused** the 404 it was meant to work around and destroyed the evidence it claimed
  to protect: ablation artifacts 3 of 3 on the run nobody cancelled, and 0 of 3, 0 of 3 and 1 of 3 on the
  three that were — the third keeping only the job that had already finished. The rule now has one owner at
  100% branch coverage: `scripts/golden_run_landing.py` reads each job's bound FROM the workflow that
  declares it, falls back to GitHub's own 360-minute default and **names which owner answered**, judges
  every pending job against **its own** bound (`dashboard` declares ten minutes where the ablations declare
  sixty), licences the wait with the soonest boundary, and **has no cancel path at all**
  (`docs/golden-reader-audit.md` §6).
- **A GATE'S POPULATION IS PART OF ITS CLAIM, AND AN EXCLUSION NOBODY DECIDED IS NOT AN EXCLUSION.** The
  `converter-tests` job says in its own comment that the Parquet → JSON bridge is gated on unit tests with
  branch coverage, and its `--omit` excluded that file — the one that produces `~/RCAEval-json`, which every
  RCAEval benchmark including the golden is read from. The three omitted names were **exactly the three in
  `scripts/` containing a hyphen**, i.e. a name `import` cannot address, and the proof that NAMING rather than
  judgement decided the list is the third of them: `evaluate-openrca.py`, **264 lines of pure standard
  library**, needing no dependency at all to be tested. Of the eight hyphen-less non-test scripts, all eight
  read **100.00%**. Enrolling the bridge found a silent success on its first run: `read_parquet` on a path that
  is a DIRECTORY **does not raise** (pandas 3.0.6 returns a `(0, 0)` frame), so the defensive `except` never
  fired, a **one-byte `traces.csv` containing a newline** was written and the case reported as **converted** —
  while the metrics arm refuses exactly that frame. The rule is now a fence
  (`scripts/test_coverage_omissions.py`) with the omit list read FROM the workflow, the script list DERIVED
  from the filesystem, the remaining two exclusions recorded as decisions whose reasons are **re-derived**
  (`download-and-benchmark.py` executes on import, checked by AST), and the complement asserted too: every
  measured script must have a test that NAMES it — which found its second instance immediately,
  `fse26_convert_tar.py` at 100% from twelve references inside another module's tests and no test of its own
  (`docs/coverage-gate-audit.md` §9).
- **"THE ARTIFACT BINDS IT" IS A CLAIM ABOUT SCALE, and a scale has to be measured at more than one.** The
  screens' refusals were read as proof that the dump's three decimals were the binding constraint on BOTH
  axes and that a finer render would buy decidable windows — a claim argued from the SIZE of the error bar
  and never measured at another size. It is false in that form. A sweep that moves the box and nothing else
  (a quantum `10^-k` smaller in every field, same seed and trial counts, `k = 0` returned from the ensembles
  the report already has) shows FSE'26's `earliest-only` unchanged by six more digits: the weakest gain
  survives **56.0% of draws at a millionth of the quantum against 56.0% at the artifact's own box**. An
  UNMOVED survival rate is the signature of a rendered TIE, which a finer render CHANGES rather than
  refines. **CORRECTED IN PLACE 2026-09-18**: what this bullet then said was that two windows —
  `re3`'s and `re3-noinject`'s stability `flip` — answer `needs 1` and that only those justify a finer
  dump. **Every RCAEval coordinate in that reading came from `.bench-cache/rcaeval-dumps/*.txt`, which
  hold ONE system per suite** (`re3` 30 of 90 cases, `re1` 125 of 375, first case `rcaeval-re3_re3tt_…`),
  and on the artifacts the workflow produces now **no RCAEval suite answers `needs 1`**. What was measured
  and stands is FSE'26's plateau and the three traps below. **CORRECTED AGAIN 2026-09-18, because the
  generalisation was one word wider than the measurement**: the sweep's stated population is *every window
  the verdict refuses*, the FSE'26 STABILITY screen is one of them, and its `flip` window — on
  `35107871516`, the only FSE'26 dump whose producer emitted `metricDecisive` — answers **`needs 1`**. No
  table in the record ever listed it, so the population was short by exactly the member that had a positive
  answer, and the sentence "no window anywhere answers `needs 1`" was false. The render is the obstacle for
  ONE measured window, and the prediction it licenses (a four-decimal FSE'26 dump admits it) is UNTESTED.
  **CORRECTED AGAIN 2026-09-19, and this one was false in the direction the record least expects**: the words
  "`--diagnose-decimals` makes it one dispatch" were true of the RCAEval benchmark and FALSE of the one the
  prediction is about. Seven dump steps accept the flag and all seven are RCAEval suites; on the FSE'26 side
  no parser tested it, no runner threaded it — the shared builder's `fieldDecimals` was OPTIONAL and the
  FSE'26 caller omitted it, so every FSE'26 dump took the producer's three decimals — and no workflow input
  declared it. The prediction was not one dispatch away; it was **unreachable**, which is the sentence this
  register already carries one bullet down (*a repaired pin whose replacement is unreachable is still a
  pin*). The FSE'26 chain now accepts and forwards it, and the census asserts the general rule that would have
  found it: an artifact-shaping flag a runner accepts must be reachable from the workflow that drives it, or
  be named as an exception WITH its reason.
  **AND THE PREDICTION ITSELF WAS TESTED THE SAME DAY, AND IT HELD.** Run `35436069639` rendered the same
  1422 cases at four decimals (declared in all 1422 headers), and the stability `flip` window goes from
  `needs 1` — with the menu verdict *"no shape in this menu has an admissible gain at any weight"* — to
  `refinement: the render already decides this window` and **`flip ADMISSIBLE`**. So `needs 1` was TRUE here:
  the render really was the obstacle and one more digit really admits the window. **That is the first
  VINDICATION of a `needs` clause in this project, against exactly one refutation** (`re3`'s, whose premise
  came from a 30-case subpopulation) — and the two together say what the clause's own text does not: it is
  **checkable per artifact, not sound in general.** The finer render MOVES a window even when it clears it
  (the left end `0.021536 → 0.021353`, `ship` `0.023209 → 0.023118`; and `rank`'s gain count falls `6 → 5` on
  the same cases), so a `needs d` describes a DIFFERENT artifact than the one it solved. **This does NOT
  re-open the axis:** the screen's `flip` window is not the criterion's solved window, the shipped weight came
  from the intersection whose FSE'26 gain half is the `rank` shape — the shape `computeStabilityScores` IS —
  and `DEFAULT_STABILITY_WEIGHT = 0.007352` is untouched by a screen-level reading at a different precision.
  What it names is the NEXT question rather than an answer: whether an admissible `flip` window at a
  four-decimal artifact survives the criterion's OWN intersection on BOTH halves.
  Three traps travel with the bullet: **a resolution
  shortfall does not imply the resolution is the OBSTACLE** (the reachable refusal reasons are scale-free
  by construction, so the inference was structural, not empirical); **a refusal's two channels are
  correlated**, so a clause must name the bar that is still failing rather than assert the mechanism its
  own trajectory contradicts (`re1`'s `order` has a weakest gain CLIMBING to 100.0% while the window is
  still refused); and **a column a screen does not read must not spend a draw**, because one shared
  sequence means an unread column's draw shifts every value after it — the box identical and the numbers
  not (`docs/fse26-cv-screen.md`).
- **A `min` ACROSS ARTIFACTS CARRYING DIFFERENT ROLES IS A BOUND ON NOTHING.** The criterion's halves are
  asymmetric — gain on one benchmark, cost nothing on another — and an instrument that takes one `min` over
  every artifact for both halves is wrong in both directions at once: it CREDITS a gain on the half that must
  not move (temporal `earliness` "admissible" from `0.001664`, where nothing on the gain side moves) and it
  lets the gain artifact's own permission BOUND the other half (stability printed `NO ADMISSIBLE WEIGHT` for
  both shapes when both have a region). Declare the role per reading, print it, and state which half an empty
  side leaves unread — an absent bound is not a permissive one.
- **A READER'S BOX IS PART OF EVERY NUMBER IT REPORTS, AND THE CRITERION DROPPED IT IN TWO PLACES.** Both were
  silent. **First**, `dumpPrecisionOf` took the population's box from `cases[0]`, and its own doc asserted the
  premise — *"the cases of one dump share a header, so they share a precision"* — while NAMING the case that
  breaks it (*"a set that disagreed would mean two artifacts concatenated"*) and waving it through, because
  *"the parser already treats as two blocks"*. **The parser handing those two blocks back as ONE case list is
  precisely why the premise had to be checked**: a file holding a three-decimal block and a four-decimal one
  was read entirely at the FIRST block's box, so every error bar drawn from the second block's cases was out
  by a power of ten while the report named a precision with confidence. It now REFUSES a population that no
  single quantum describes, naming each precision with its count — a number it could return would be true of
  some cases and false of the rest. **Second**, `CriterionReading` identified its artifact by RUN and said
  nothing about the box, though a weight is drawn in a quantum and every boundary in the row is one. The
  screen already carried it (`GainResolution.box.precision`); the criterion's structural interface exposed
  only `{shape, solved}`, so one benchmark's two runs at two precisions printed rows that differed only by the
  label a caller had chosen — on the exact comparison this instrument exists to make, and the one every
  `needs d` prediction is. The reading now carries the screen's OWN object (**not** a re-derivation, asserted
  by identity) and the report prints it per row, with `*` and a legend for an INFERRED box, because a box the
  reader SUPPLIED is a different claim from one the artifact made. `stated` is a fact about the POPULATION, so
  it is true only when EVERY case carries the field — a set that is half stated has one effective precision
  and no declaration.
- **A POPULATION ASSEMBLED FROM A TABLE MISSES EXACTLY THE MEMBER THAT WAS NEVER IN ONE.** The refinement
  sweep's stated population is *every window the verdict refuses*, and its table listed the FSE'26 temporal
  screen, `re1`'s temporal and stability screens and `re3`/`re3-noinject`'s — missing FSE'26's STABILITY
  screen, which `admissibilityOf` refuses and which is the ONLY window that answers `needs 1`. The record
  then generalised the absence ("no window answers `needs 1`") from a hand-assembled list, which is the
  discovery-by-filename defect one level up: a list is a copy, and a copy needs a guard. Ask what the
  population is DEFINED as, and check the definition against the list rather than the list against itself.
- **A measurement is about the artifact it ran on, and a record that a fix landed does not refresh the file
  it fixed.** The RCAEval dumps used above were TrainTicket-only COPIES made before the dump-completeness
  fix, sitting on disk beside a log that said all seven dumps hold every system; an evidence table and a
  pre-registered prediction were derived from them, and both were about a subpopulation. So a row names its
  artifact's COVERAGE (`re3` 90 cases, FSE'26 1422) and a comparison states it is like-for-like — which is
  how the same iteration found that a finer render does not refine a window but **MOVES** it (`ship`
  `0.177070 → 0.181919` on the same 90 cases, because the printed margins are INPUTS to the solve), while
  lifting the gain channel's own-box survival `98.8% → 100.0%` and leaving the cap channel as the failing bar.
  **A DIRECTORY NAME IS NOT PROVENANCE**: THREE directories of "the dumps" existed and the one whose name read
  as canonical was written 83 minutes BEFORE the completeness fix, while two newer complete ones sat beside it
  under names that read as drafts. So the rule is enforced rather than intended — `scripts/dump_coverage.py`
  reads a dump's population from its case IDS and `require_like_for_like` REFUSES a comparison whose two
  artifacts are about different populations, naming the per-group difference; the declared precision is
  deliberately NOT part of that check, because it is the quantity such a comparison is about.
- **"REFUSED" AND "NOT EVALUATED" ARE DIFFERENT STATEMENTS.** A `--no-inject-time` artifact does not print a
  window table at all — it prints *"the term is INERT … no weight on any shape can change a ranking — a window
  here is an artefact"*, with `with an injection anchor 0`, and `admissibilityLines` prints nothing because no
  shape admits. Recording that as *"refused — no shape has a gain at all"* invites a search for a gain, while
  the truth is that the evaluation is empty BY CONSTRUCTION. A refusal is a verdict about a menu that ran; an
  inertness is a statement that it did not (`docs/fse26-cv-screen.md`).
- **AND WITHIN "CANNOT ACT" THERE ARE TWO ABSENCES, SO THERE ARE TWO WORDS: `INERT` versus `UNEVALUABLE`.**
  Each menu printed ONE sentence — *"the engine leaves every service neutral"* for the temporal screen, *"no
  case holds two distinct coefficients of variation"* for the stability one — for causes that include the
  artifact not carrying the input AT ALL. On run `35035314921`'s FSE'26 dump that sentence is TRUE AND VACUOUS:
  1422 cases, 72527 service rows, **not one** decisive composition, because the dump predates the line the
  composition is rendered on, while run `35107871516` — the same benchmark, a later render — holds **71161**
  and reports the windows the record quotes. So the cause is NAMED (`no-cases | no-anchor | no-onset |
  no-order`, `no-cases | no-composition | no-spread`), the label says which question is open, and ONE owner per
  screen serves both menus: `INERT` for a term that cannot reorder what the artifact RECORDS (a result about
  the axis, `docs/fse26-cv-screen.md`), `UNEVALUABLE` for one whose input
  the artifact does not carry (a finding about the ARTIFACT, which invites a different artifact rather than a
  conclusion). **And the detector of the earlier mistake was itself a defect**: `fetch_dump2.log` recorded
  `metricDecisive lines: 0` for the artifact that holds 71161, because it counted lines STARTING with the
  literal while the transport prefixes a BOM and an ISO timestamp to every line start — a probe measuring the
  TRANSPORT, reported as a property of the artifact.
- **THE GOLDEN IS THE RUN A *PUSH* STARTED, not the newest run at the commit.** One commit can carry two
  benchmark runs — a push and a `workflow_dispatch` — and a dispatch runs at whatever inputs the caller
  passed, so its cells measure that configuration rather than the bytes the paths rule owes. A selector
  keeping the newest run per workflow per `head_sha` reads the dispatch: measured on `4a370b8`, where it read
  `35316048737` under the heading "GOLDEN" while the owed run was `35316003267`. `owed_golden_run` reads
  `event`, REFUSES rather than picks when two push runs share a SHA, and raises on a page that failed to
  carry the field — defaulting it would answer "no golden is owed" in exactly the direction that hides one
  (`docs/golden-reader-audit.md`).
- **A FLAG WHOSE BAD VALUE KILLS THE RUN IS A DIFFERENT CLASS FROM ONE THAT ANSWERS WRONGLY.** A weight's
  malformed value produces a plausible benchmark at the ablation's configuration; a render precision's
  malformed value makes `toFixed` raise `RangeError` — accepted domain `[0, 100]`, so `200` is out — on the
  first rendered case, after a suite is loaded and inside a loop that runs once per field per service. So the
  bound is EXPORTED FROM THE MODULE THAT CALLS `toFixed` and imported by the parser that reads the flag,
  never restated, and the test measures it against `toFixed` itself (`docs/fse26-cv-screen.md`).
- **AN ARTIFACT MUST DECLARE THE QUANTITY A READER'S ERROR BAR COMES FROM.** The ensembles draw each rendered
  field inside the cell its print stands for, and they took that cell from a constant the reader and the
  producer shared — a copy of `3` that is correct only while the two AGREE, and that models the box of the
  dump the reader EXPECTED: a dump rendered at four decimals would have been drawn at three, by a factor of ten
  per digit, with nothing in the pipeline saying so. The header already carried `services=` for exactly this
  reason; it carries `decimals=N` now, `fmt` renders at a PARAMETER, and the box comes from
  `resolutionBoxFor(screen, precision, …)` with `halfQuantumFor(decimals)` as the ONE owner of a cell's width
  — replacing a constant whose NAME asserted that there is a single quantum "of the dump". The clearest
  statement of the change is a lint warning: once the box stopped reading the shared constant, the analyzer
  imported it and no longer used it. Two traps travel with the fix. A dump that PREDATES the field must fall
  back to a HISTORICAL binding, not to the current default — the two are equal today, so naming the default
  would satisfy every assertion and silently re-model the whole archive the day it moves, and only a text
  check can tell the two bindings apart. And the report must SAY which of the two it used, because an
  inference is a claim by the reader while a stated precision is a property of the artifact
  (`docs/fse26-cv-screen.md`).
- **A DECLARATION IS A CLAIM ONLY WHEN SOMETHING CONNECTS IT TO WHAT IT NAMES — and a fence that reads the
  SPELLING cannot see the connection.** Two sites, measured on 2026-09-25, share no code and share this:
  the converted artifact's cache key was the CONSTANT `RCAEvalJSON`, typed at 26 sites in 11 workflows, in
  the very workflow whose trigger says *run when the bridge changes* — so the commit that FIXED the bridge
  hit the cache the bridge had produced and `Convert Parquet to JSON` read `skipped`, ten times over, the
  last real conversion being 48 days earlier and its reader (`pandas 3.0.5 / pyarrow 25.0.0`) recorded
  nowhere. And the coverage request was `-- --coverage`, an argument appended after the task runner's
  separator: it travels nx → package manager → script, so `pnpm coverage` ran all 14 projects, ran every
  suite, **exited 0 and measured nothing**, while the SAME form on CI did forward. Both instruments reported
  success. The remedies have one shape: DERIVE the declaration from its subject (the key from the bridge's
  files, the flag from a target's script body), STATE it in the artifact and refuse a mismatch at use time,
  and fence the DERIVATION in both directions — because `expect(script).toContain('--coverage')` and a check
  that a constant appears nowhere are both satisfied by the broken form. **A gate's own number belongs to its
  population, its bar and its environment; whether the gate RAN belongs to neither, and only the connection
  can say** (`docs/declaration-connectivity-audit.md`). **The reading that closes the loop is `9 of 9 cells
  byte-identical` at `c787b6c` — on an artifact RE-CONVERTED 20 minutes earlier by the fixed bridge under the
  pinned reader, so "the reader's patch bump (`pandas 3.0.5 / pyarrow 25.0.0` → `3.0.6 / 25.0.1`) and the
  bridge's guard leave the published benchmark alone" is a measurement of a NEW artifact rather than a
  derivation from a change's shape: its counts are identical (`736 · 735 · 599 · 39G`, 735/736 converted,
  ZERO refusals), its stamp names its producer, and the consumer's own log shows the derived key restored and
  verified (`docs/declaration-connectivity-audit.md` §7).** **The third site of the same law is the TRIGGER
  GRAPH**: the artifact is produced by a different workflow started by the SAME push, so the benchmark's
  `consume` refused four jobs on a dataset that did not exist *yet* — correctly, and the missing declaration
  was a bounded wait, which is now one `artifact` job every consumer reaches transitively and which took
  **4 seconds and one check** on its first production fast path (`docs/declaration-connectivity-audit.md` §8).

- **AND A GATE'S POPULATION IS DECIDED BY ITS CONFIG, WHICH IS NOT THE SAME AS ITS NAME** — the coverage gate's
  population is the `include`/`thresholds` in each project's config, and the TYPECHECK's is the `tsconfig` it is
  pointed at. `nx run @agentix-e/micro-kinetic-benchmarks:typecheck` does NOT cover `benchmarks/__tests__`;
  `pnpm typecheck` is `nx run-many --target=typecheck --all && tsc -p tsconfig.workspace.json`, and the
  workspace config does. So a new test file that passes every check run here was red on CI in two places, and
  the number that mattered was the one the GATE printed rather than the one the local command did
  (`docs/artifact-capability-audit.md` Gates, the fix commit `e40639f`).

- **AND A RULE APPLIED TO A VALUE'S CONTAINER IS NOT APPLIED TO THE VALUE** — the absent case has to be stated
  for every number, not for the object that holds them. `RenderedInventory` is `undefined` when the block
  rendered no inventory, which is the rule; `bestDev` and `bestRise` inside it were a `0` sentinel for "no
  kept metric was decomposed", which is the same rule one level down and was not applied — so a maximum taken
  over an EMPTY set was reported as a measurement, and **319 pairs became ties at 0.500 instead of
  `unmeasurable`** (`docs/fse26-separator-verdict.md` §2.3). Two corollaries the same measurement gives: the
  COUNTS next to them are a different kind of number (a rendered `metricKept(0):` IS a measured zero, so a fix
  that made all four `undefined` would be wrong), and a maximum over the DECOMPOSED subset is a **lower bound**
  rather than a total — the block renders a decomposition for at most three of the kept metrics. The reach of
  the defect is a question about the ARTIFACT and only the census answers it
  (`docs/artifact-capability-audit.md` Finding 7): `metric-kept` 1888 of `re1`'s rows against `metric-top`
  1887, and 2095 against `none` on `diag-34684319273` — invisible on the shipped dump, an entire screen on
  that one.

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

**And a candidate must now say what its ARTIFACT carries** (`docs/artifact-capability-audit.md`). Three
iterations each found, by hand, a claim resting on a quantity its artifact does not hold — a precision
nobody declared, a population that was a subset, a composition the named run never rendered — and the
generalisation is an instrument: `scripts/dump_capability.py` reports every channel as `every` / `some` /
`none`, over the artifact's own case and row counts, and refuses a read the artifact cannot serve.

Two facts from it bear directly on the lever above, and both are about the artifacts rather than about the
engine:

- The FSE'26 dump this record reads (`35035314921`, 1422 cases, 72527 rows) carries **no declared precision,
  no decisive composition and no `both=`** — 141 MB in which `metricDecisive` appears zero times. A
  composition-based candidate is **UNEVALUABLE** there and must name the artifact that carries it, exactly as
  the stability rows had to name `35107871516`.
- Where the decisive composition does exist it reaches **`some`**, not `every` — 86.45% of `re1`'s rows,
  90.72% of `re3`'s — while the field's own comment opened by claiming it "exists for EVERY service". A term
  built on the composition has to be simulated over *every* candidate a case could promote, so its
  precondition is a **producer change**, and that is now what the comment says instead of the claim it
  contradicted two sentences later.

A candidate that has not named the channels it reads, the reach it needs of each, and the artifact — by run
— it reads them from, has not engaged this either.

**And the reach is now TWO numbers, because the composition's own line stopped being selective.** The
producer renders `metricDecisive` on **every** row now (the `-` marker where the named metric carries no
decomposition, the same marker `onset` and `latRise` use), so the channel is universal while the composition
itself reaches **98.13%** of the shipped artifact's rows (`71161/72527`) — and the 1566 rows that used to
carry no line at all were exactly the rows whose inventory is not rendered either, so their absence was
unattributable. A candidate must therefore say whether it needs the channel or the VALUE: `onset` is the
warning, reaching every row and carrying a number on **87.5%** of them.

**And it must now say WHICH HALF OF A FAMILY, because the census's own population was seven hand-written
channels against the artifact's thirty-one fields** (`docs/artifact-capability-audit.md` Finding 7). Both
two-part families were covered in the half the OTHER one covers: `failed-edge` read the SCORE, leaving
`edgeRecords`' COUNT — the one signal the separator verdict reports as HOLDING, **0.908** where the score reads
**0.457** — with no channel, and `latency-edges` read the COUNT, leaving the `lat` term's RISE with none and
reporting the other half's reach (**100%** against the rise's **52.0%**). Six quantities the declared signals
read had no channel at all, so the gate above could not be satisfied by the candidates this record calls live.
The population is a table whose key column is the producer's own literal with each marker DERIVED from it
(which is how the drift happened: one pattern was written for `latEdges` and used for a `latRise` read), held
by two fences on a two-edge chain — the python test keeps the committed projection equal to the table, and the
TypeScript test builds a dump with the PRODUCER and holds the emitted keys, the table's `fields` and
`Object.keys(SERVICE_FIELD_AUDIT)` equal in both directions. **A candidate that names `failed-edge` for a count
read, or `latency-edges` for a rise read, is naming the other half of the pair and will be told the other
half's reach.** For the inventory the halves are not even the same LINE: `metric-kept`/`metric-drop` reach 1888
of `re1`'s rows, `metric-top` 1887, and `artifacts/diag-34684319273` carries the first pair for 2095 rows and
the second not at all.

**And the criterion itself is now an intersection rather than a comparison in prose.** Its two halves live on
two benchmarks — a candidate must GAIN on one and cost another nothing — so the object it asks for is the
intersection of two sets of WEIGHTS, and the record compared them by hand four times, three of them ending up
with a number the artifacts did not support. One command now computes it (`criterionReadings` +
`criterionVerdicts` + `formatCriterionReport`, by repeating `--dump`, each artifact solved on its own
population and in its own box). **The halves are ASYMMETRIC and the readings now say so**: the artifact named
FIRST is the one a candidate must improve and every other is one it must leave untouched, because a first
version that took a `min` across all of them produced a wrong headline in BOTH directions — it credited a gain
on the protected half (temporal `earliness` "admissible" from `0.001664`, a weight at which nothing on the
gain side moves) and it folded the gain artifact's OWN permission into the protected side's ceiling, which
falsely closed the stability axis. Corrected, the stability axis has an admissible region on BOTH shapes —
`flip` `[0.004134, 0.007528)` and `rank` `[0.006672, 0.008032)`, each worth ONE case, with FSE'26's own tie
class permitting a loss from `0.003873` as the one bar a run must settle — while the TEMPORAL intersection is
empty on all four shapes: `earliest-only` is the only one whose FSE'26 gain is free on FSE'26, and the golden
caps that shape at `0.004717`, **2.2× below the first weight at which FSE'26 gains anything there** and 7.7×
below the `0.036552` the solver recommended. **A proposal that spans both benchmarks must state its
intersection, name each artifact's role, and it can now be computed rather than argued.** **And the first
candidate it named has now CLEARED BOTH HALVES and been ENROLLED** (`fse26-cv-screen.md` §"The dispatched criterion verdict"):
`stabilityWeight=0.007352` on `2f10a82` — the `rank` region's midpoint — gives FSE'26 **757/1422 = 53.23%**
(was 756), Top@3 66.5%, Top@5 70.4%, **0 regressed fault types** (`HTTPResponseReplaceCode 160 → 161` is the
only move), with the RCAEval golden **9 of 9 byte-identical** (`35411810992`). The prediction was **+1** and
the run delivered +1 case for case. **So the stability axis's re-opening condition is MET and the term has been ENROLLED**: `DEFAULT_STABILITY_WEIGHT`
is now `0.007352`, guarded as text and required to be a key of `MEASURED_STABILITY_WEIGHTS` with BOTH halves
recorded, alongside the REJECTED `0.030170` kept as data. **And it has now walked the DEFAULT path**: run
`35416576350` passes no input at all and reads `stabilityWeight=0.007352` off the constant, giving `757/1422`
against the same-commit control `35416580279` at `756` — one case, `HTTPResponseReplaceCode 160 → 161`, nothing
moving the other way — with the push's own golden (`35416556932`) 9 of 9 byte-identical. That is the
`defaultPath` sub-record, and the guard now requires it: a point measured by passing a flag is a measurement
of the flag and not of what ships.

**AND THE CLOSURE HAS NOW BEEN RE-SOLVED IN A TEN-TIMES-FINER BOX, which is the one thing those numbers had
never been asked.** Every window above was computed from a dump rendered at three decimals, and the two
preceding iterations proved twice over that a finer render MOVES a window rather than refining it. There is
now a four-decimal FSE'26 artifact of the SAME 1422 cases (run `35436069639`, identical fault-type
histogram), so the gain half was re-solved in it against the identical golden protect half:

| gain artifact | `flip` | `rank` |
| --- | --- | --- |
| 3 dec (`35107871516`) | gains from `0.004134`, `[0.004134, 0.007528)` width `0.003395` | gains from `0.006672`, `[0.006672, 0.008032)` width `0.001360` |
| 4 dec (`35436069639`) | gains from `0.003765`, `[0.003765, 0.007528)` width `0.003764` | gains from `0.006096`, `[0.006096, 0.008032)` width `0.001937` |

**`0.007352` is inside BOTH shapes' regions in BOTH boxes, so the weight is not box-fragile and the axis stays
closed.** Only the GAIN end moves; both ceilings are identical (`0.007528` from `re2`, `0.008032` from `re1`)
because the protect half is the same three-decimal golden in both invocations — a clean decomposition worth
stating: **a window's gain end is a function of the gain artifact's box, its ceiling a function of the protect
artifacts' box.** The finer render widens the region at the gain end rather than narrowing it (`flip`
`0.004134 → 0.003765`, `rank` `0.006672 → 0.006096`), so what moves is not admissibility but the weight's
POSITION in it: `0.007352` is the `rank` region's midpoint at three decimals (50.0% up) and sits 64.8% up the
finer one. **The midpoint rationale is therefore box-dependent and the weight is not** — and the weight is
what the criterion asks about, since the render is a dump-only parameter that moves no cell (the same
dispatch that produced this dump is 9 of 9 golden byte-identical and reports `correct at 0 756`, unchanged).
A candidate at the finer midpoint `0.007064` is a NAMED follow-up, not a re-opening: it would have to clear
the criterion's own two halves by a dispatch, and the criterion is satisfied where the weight already is.
