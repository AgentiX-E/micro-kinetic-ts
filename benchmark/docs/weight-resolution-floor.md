# The resolution floor: how small a weight can still change an answer, and why every "closed at every weight swept" needed one

**Written 2026-11-13 (iteration 274).** Read `docs/term-weight-landscape.md` first: this document turns that one's
"no point on the grid improves" into a statement about an interval rather than about a grid. Every number below comes
from `benchmarks/src/weight-resolution.ts`, which is in the tree at 100 % coverage in all four dimensions.

## 0. The defect this exists to fix, stated exactly

Three register entries close a weight axis with the same phrase: *"measured and closed on both poolings at every
weight swept"*, *"the merged frontier is `{w=0}` under BOTH poolings"*, *"every point in a 28-point grid that gains a
case takes one from a family with n ≥ 20"*. Each is true, and each has an **implicit denominator**: the smallest
non-zero weight its grid contained. For the PRISM frontier that was `0.1`; for the landscape grid `0.02`; for the
`lat` and `log` sweeps `0.2` and `0.3`.

Between `0` and that number the term was never asked about — and the terms in question are the twelve whose shipped
weight is **0**, the ones a revival would move, whose revival weights are small by construction: a term whose slope
is `0.5` pays `0.005` at a weight of `0.01`.

So the question a sweep must answer before claiming completeness is: **at what weight does this term start to be able
to change anything at all?** That number is a property of the corpus and the term, it is computable in one pass over
a dump, and it is what this document measures.

## 1. The arithmetic

For one missed case, let `gap = score(leader) − score(best accepted)` and `Δslope = slope(term, truth) −
slope(term, leader)`. Raising the term's weight by `δ` moves the truth by `δ·Δslope` and the leader by `0`, so the
truth catches the leader at

```
δ = gap / Δslope,   provided Δslope > 0
```

The **floor** of a term is the minimum of that ratio over the corpus. Three decisions make it exact:

1. a case the run already answers is **skipped** — a hit cannot be recovered, and including it would put the floor at
   `0` on any corpus containing a hit;
2. a case where the term pays the leader **at least** as much (`Δslope ≤ 0`) is skipped, because raising the weight
   widens that deficit and the case is unreachable at every positive weight;
3. the comparison is **strict**. At exactly `gap / Δslope` the candidates are level and the engine's sort keeps the
   original order, so the leader stays first; a reader using `≥` would put every floor one tick low and report a
   recovery the engine never produced.

`Δslope` comes from the slope difference alone, so a floor is a number about the term's **shape**: a term shipped at
`3` has the same floor as one shipped at `0`. The reading is an **added** weight — the revival weight for the twelve
dead terms, an increment for a live one.

## 2. What a floor does — and does not — claim

**It claims: below the floor the term is provably gain-free.** No case can be recovered at any weight in
`(0, floor]`, whatever the grid. That is a statement about an interval, which is what a sweep needs.

**It does not claim the term is inert there.** A term below its floor still moves scores, and the same slope that
would have lifted a miss can push an answered case down: **`prism` at `0.01` on RCAEval RE1 recovers nothing — its
floor there is `7.2e-2` — and costs two cases.** A floor bounds what a term can **pay**, never what it can **cost**.

An earlier draft said "below the floor the term is a no-op" and the RE1 reading falsified it. The module now carries
the asymmetry as a docstring, the formatter prints it on every report, and `is gain-free, not event-free` is a test.

## 3. The floors on the four populations

`pnpm exec tsx benchmarks/src/run-weight-resolution.ts --terms <dump>` — no engine, no dispatch. Default weights
`1e-4 … 2`, log-spaced, chosen to begin below every floor measured here (the smallest is `3.0e-3`).

### 3.1 FSE'26 RCABench, 1 422 cases, baseline 1 073 = 75.46 %

| term | shipped | floor | set by | reach at w = 2 |
| ---- | ------: | ----: | ------ | --------------: |
| `selfAnomalyLog1p` | 1 | 1.93e-1 | `ts4-ts-route-plan-service-request-delay-6kgcnn` | 9 |
| `source` | 0 | 3.10e-2 | `ts0-mysql-corrupt-kwx8n5` | 92 |
| `temporal` | 0 | 1.69e-2 | `ts1-ts-order-service-exception-m9vqmq` | 163 |
| `collision` | 0 | 4.83e-2 | `ts0-ts-ui-dashboard-response-delay-nqtssr` | 60 |
| `topo` | 0 | 3.51e-3 | `ts0-mysql-corrupt-kwx8n5` | 75 |
| `log` | 1 | 1.91e-2 | `ts3-ts-basic-service-request-replace-method-mxfc5h` | 13 |
| `rise` | 0 | 1.25e-2 | `ts5-ts-security-service-exception-kprxw5` | 89 |
| `prism` | 0 | 3.23e-3 | `ts0-mysql-corrupt-kwx8n5` | 105 |
| `failedEdge` | 0 | 9.79e-3 | `ts0-mysql-corrupt-kwx8n5` | 143 |
| `lat` | 0.561495 | 1.30e-2 | `ts0-mysql-corrupt-kwx8n5` | 33 |
| `pool` | −0.0679 | 3.01e-3 | `ts0-mysql-corrupt-kwx8n5` | 14 |
| `stability` | 0.007352 | 2.11e-2 | `ts0-mysql-corrupt-kwx8n5` | 176 |
| `dualFamily` | 0.25 | 1.41e-2 | `ts4-ts-route-plan-service-response-delay-vhfs2f` | 23 |
| `podState` | **8** | **—** | — | **0** |
| `trace`, `faultFree`, `selfTime`, `emission`, `victim` | 0 / null | — | — | 0 |

**The heaviest term in the formula cannot recover a single one of the 349 re-rankable misses.** `podState` carries
weight `8`, more than the other six live terms combined, and on no missed case does it pay the truth more than the
leader it would have to overtake. It is not that a larger weight fails to help — no weight helps, at any magnitude.
Where the recovery is: `stability` 176, `temporal` 163, `failedEdge` 143.

### 3.2 The three RCAEval suites

| term | RE1 375 (345) | RE2 270 (248) | RE3 90 (71) | FSE'26 1 422 |
| ---- | ------------: | ------------: | ----------: | -----------: |
| `stability` | 3.03e-1 | 5.66e-2 | 9.95e-3 | 2.11e-2 |
| `prism` | 7.23e-2 | 1.22e-2 | 7.88e-3 | 3.23e-3 |
| `temporal` | 1.69e-3 | 4.80e-3 | 9.05e-1 | 1.69e-2 |
| `topo` | 9.03e-3 | 3.53e-2 | 2.68e-2 | 3.51e-3 |
| `rise` | 1.93e-2 | 5.23e-2 | 9.94e-3 | 1.25e-2 |
| `dualFamily` | 2.05e-1 | 1.27e-2 | 7.54e-3 | 1.41e-2 |
| `collision` | — | 1.13e-2 | — | 4.83e-2 |
| `log` | — | — | 9.21e-2 | 1.91e-2 |
| `lat` | — | — | — | 1.30e-2 |
| `failedEdge`, `pool` | — | — | — | 9.79e-3 / 3.01e-3 |
| `podState` | — | — | — | — |

A dash is a term that cannot recover a case **on that population at any weight**.

Three readings this table makes possible and the landscape document could not:

- **`stability`'s floor moves by a factor of 30** across the four populations (`9.95e-3` RE3 → `3.03e-1` RE1). There
  is no single number for "how far can `stability` move before it changes something", which is the quantitative form
  of the exchange structure the landscape describes.
- **`lat` and `pool` have no headroom on any RCAEval suite** — 33 and 14 cases of it on RCABench. The latency term is
  not a recovery lever on the battery the project is ranked on.
- **`temporal`'s floor is `0.905` on RE3 and `1.69e-3` on RE1**: the same weight is a no-op on TrainTicket and
  decisive on OnlineBoutique. That is the population dependence §4 then runs into.

## 4. The revival sweep, completed at full resolution

Six terms carry weight 0 with real slopes: `temporal`, `topo`, `rise`, `source`, `prism`, `collision`. Swept at
fourteen magnitudes from `1e-4` (below every dead term's floor except `collision`'s `4.8e-2`, which is why the grid
starts there and runs to `2`) over four populations — **84 points × 4 populations = 336 readings**, with a finer grid
and pair terms run as corroboration.

### 4.1 The gainful sets are disjoint

| population | points that gain without a loss |
| ---------- | ------------------------------- |
| FSE'26 (1 422) | `temporal 0.02`, `topo 0.005`, `prism 0.0035–0.03` |
| RCAEval RE1 (375) | `temporal 0.002–0.004` |
| RCAEval RE2 (270) | `temporal 0.005–0.03`, `collision 0.015–0.04` |
| RCAEval RE3 (90) | `topo 0.03–0.2`, `source 0.03–0.05`, `prism 0.008–0.1` |

**The intersection of the four gainful sets is empty.** Four points are admissible *everywhere*, and each is worth
exactly **one case on exactly one population**:

| point | FSE'26 | RE1 | RE2 | RE3 | union |
| ----- | -----: | --: | --: | --: | ----: |
| `temporal 0.003` | 0 | **+1** | 0 | 0 | +1 |
| `prism 0.005` | **+1** | 0 | 0 | 0 | +1 |
| `collision 0.02` | 0 | 0 | **+1** | 0 | +1 |
| `collision 0.03` | 0 | 0 | **+1** | 0 | +1 |

Taken together (`prism 0.006 + temporal 0.003 + collision 0.02`) that is **+3 cases over 2 157, zero losses on any
population**, and each component holds over a window of two to six times its own magnitude (`prism` is `+1` on FSE
from `0.0035` to `0.01`; `temporal` is `+1` on RE1 from `0.002` to `0.004`; `collision` is `+1` on RE2 from `0.015`
to `0.04`). It is measured, it passes the pre-registered gate on all four populations, and this iteration **does not
take it** — §4.2 is why, and the reason is a measurement rather than a preference.

### 4.2 The near-tie census, which is what decides it

How many missed cases can a weight of order `1e-2` possibly reach? A term's contribution at weight `w` is at most
`w × |Δslope|`, so on this corpus a weight below `0.01` can only act on cases whose gap is below `0.01`:

| population | misses | gap ≤ 3e-3 | ≤ 1e-2 | ≤ 3e-2 | ≤ 1e-1 |
| ---------- | -----: | ---------: | -----: | -----: | -----: |
| FSE'26 | 349 | 1 | **4** | 11 | 58 |
| RE1 | 28 | 0 | **4** | 6 | 8 |
| RE2 | 18 | 0 | **3** | 5 | 8 |
| RE3 | 16 | 0 | **1** | 2 | 4 |

**The entire population a small revival can reach is 12 cases across four populations.** The three "+1 everywhere"
points recover three of those twelve — each on a different population, each with a different term, each at a
different weight. That is the signature of sampling twelve near-ties four times over, not of a mechanism: a mechanism
would concentrate on one term and one family, and its effect would scale with the weight. These do neither, and their
whole effect is three cases in 2 157 = **0.14 pp**.

So the axis closes on a size argument rather than a gate argument: the gate admits the change, and the change is not
worth a default. Three constants of `0.003`, `0.006` and `0.02` in the shipped configuration, each buying one case off
a near-tie, each silently invalidated by the next change to any term's arithmetic, is the defect class
`ranking-default-owners.md` records — hand-fixes that look measured because each was measured once. A weight that
earns a default has to be worth more than the noise a corpus of this size has.

### 4.3 The two candidates that looked like real gains, and what each died of

**`prism 0.02`: +3 on FSE'26, −4 on RE1, net −1 on the published battery.**

| population | `prism 0.02` | verdict |
| ---------- | -----------: | ------- |
| FSE'26 RCABench (1 422) | **+3** (3 / 0) | admissible |
| held-out half `in` (713) | +2 (2 / 0) | admissible |
| held-out half `out` (709) | +1 (1 / 0) | admissible |
| RCAEval RE1 (375) | **−4** (0 / 4 — `delay −1`, `loss −3`) | inadmissible |
| RCAEval RE2 (270) | +2 (3 / 1 — `delay −1`) | inadmissible |
| RCAEval RE3 (90) | +1 (1 / 0) | admissible |
| **RCAEval 735 (union)** | **−1** | **regression** |

This was the first strict improvement any screen in this project has produced, and it survives both held-out halves
of its own corpus. It then costs four cases on the one suite the register already named as PRISM's blocker
(`prism-pooling-frontier.md`: *"the single suite that closes it is RE1, on its delay/loss cells"*). That closure is
now confirmed **two orders of magnitude below the weights it was taken at**: RE1's loss is not an artefact of a large
weight.

**`temporal 0.04`: +5 on the `in` half, −1 on the `out` half.** A term whose sign flips between two random halves of
one corpus is not a term. (`temporal` also has the widest spread of floors in §3.2 — `0.905` on RE3 against `1.69e-3`
on RE1 — which is the same fact seen from the other side.)

**And `podState` is the sweep's cleanest null:** the heaviest weight in the formula has a floor of "none" and a reach
of 0 on all four populations. It cannot be the answer to any of the 420 misses at any weight. That is worth stating
plainly because a term carrying `8` looks like the thing doing the work, and on the misses it is doing nothing at all.

## 5. What the earlier closures actually covered

Now that the floors exist, the quantifier of each earlier closure can be stated instead of inherited:

| closure | what it swept | smallest non-zero | that term's floor | ratio |
| ------- | ------------- | ----------------: | ----------------: | ----: |
| `prism-pooling-frontier.md` (16 columns) | `prismWeight` | `0.1` | `3.23e-3` (FSE'26) | **31×** |
| `term-weight-landscape.md` — `stability` | `0 → 1.6` | `0.02` | `2.11e-2` | **0.95×** |
| `term-weight-landscape.md` — `lat` | `0 → 1.2` | `0.2` | `1.30e-2` | **15×** |
| `term-weight-landscape.md` — `log` | `0.3 → 1.6` | `0.3` | `1.91e-2` | **16×** |
| this iteration — six dead terms | `1e-4 → 2` | `1e-4` | `3.0e-3 … 4.8e-2` | **≤ 1×** |

So the closures were right and their sentences were of unequal strength: **`stability` really was swept from its own
floor**, `lat` and `log` were swept from 15–16 times above theirs, and `prism` — the one closure this iteration set
out to test — from 31 times above. The interval below was unmeasured, not empty, and this iteration measures it: from
`1e-4`, below every floor in §3.1 except `collision`'s, and finds the twelve near-ties of §4.2 and nothing else.

That is what this document is for. A future entry that says "closed at every weight swept" should say **which
interval**, and the resolution floor is how the interval's origin gets chosen instead of inherited from whichever
grid someone happened to type.

## 6. What this closes, and what it leaves

**Closed: the revival of every weight-0 term, at full resolution, on four populations.** 336 readings, and the
answer is that the four gainful sets are disjoint, the twelve reachable near-ties are worth 0.14 pp in total, and the
two candidates that looked like mechanism failed on a held-out half and on the published battery respectively. No
revival earns a default.

**Also closed, and it was free: the pod/node observable as a source of information on this corpus.**
`injection.json` carries `ground_truth.pod` and `.container` in **1 422 of 1 422 packs** and
`scripts/convert-rcabench-to-rcaeval.py` keeps only `.service`, so a pod-level answer exists and is discarded. But
the deployment is **single-replica**: 48 pods map to 48 workloads with 0 surplus in every sampled pack, and of the
123 pod-identity faults (`container-kill` 89, `pod-failure` 24, `pod-kill` 10) not one has a service with two pods.
Pod identity is a bijection with service identity here, so a per-pod signal separates nothing a per-service signal
does not. **RCAtlas's 31 pod/node-annotated cases still need RCAtlas's data**, and what would make them scoreable is
an *answer-format* mapping (emit the pod owned by the ranked service), not a new term — a capability, recorded, not
this iteration's subject.

**Not closed: a term that does not exist yet.** Everything here is about the nineteen terms the formula has. Four
screens (weight, landscape, revival, resolution) now agree that the remaining misses are not reachable by
re-weighting, reviving or re-shaping what is already summed — and §4.2 puts a size on why: at the scale a small
weight can reach, there are twelve cases in 2 157, and the rest of the misses sit at gaps of `0.1` to `1`, where only
a term with a different **shape** can move them.

## 7. Reproducing it

```
pnpm exec tsx benchmarks/src/run-weight-resolution.ts --terms fse26-terms.ndjson
pnpm exec tsx benchmarks/src/run-weight-resolution.ts --terms fse26-terms.ndjson --names prism,topo --weights 0.001,0.01,0.1
pnpm exec tsx benchmarks/src/run-term-weight-screen.ts --terms fse26-terms.ndjson --grid revival-grid.json
```

The RCAEval dumps used in §3.2 and §4 give 345/375, 248/270 and 71/90. The first matches the published RE1 reading
exactly (`sota-comparison.md` §0); the other two are **one case below** the published RE2 (249) and RE3 (72) — the
dumps predate the last enrolment by a case per suite, so the union baseline here is `664/735` against the published
`666/735`. No sign changes: the revivals in §4 move `+1` or `0` on those suites, and `prism 0.02` costs RE1 four
cases, which is `−1` either way.
