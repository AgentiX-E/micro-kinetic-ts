# The label prior on FSE'26 — the half that had no history

Owner document for the FSE'26 half of the label prior's measurement. The term itself is owned by
`label-prior.md`; this file owns **what that term does on the 1,422-case RCABench panel**, which until iteration
368 could not be asked at all: `run-fse26.ts` built no history, so the census recorded `fse26: null` beside both
dispatch fields and the enrolment the Cloud-OpsBench sweep priced in iteration 367 was blocked on it.

## 1. Pre-registration (written before the first FSE'26 prior number existed)

The Cloud-OpsBench reading (156 cases, `+6.41 pp` gated, `−2.56 pp` ungated) is a reading about **a corpus whose
labels are concentrated**; FSE'26 is Train Ticket, whose RCAEval cell is the one that collapsed when the prior was
ungated (`0.6596 → 0.2340`). So the prediction is not neutral, and it is written down before the run:

> **P-red.** Ungated, the prior loses cases on FSE'26 — the head of the ranking there is separated by about a
> hundredth, which is the regime where the term replaces a correct decision with a frequency.
>
> **P-green.** Gated at `τ = 0.02`, the prior is at worst inert and at best a small gain, because the gate withholds
> it exactly where the head is decided.

### Arms

| arm | weight `β` | gate `τ` | what it measures |
| --- | ---: | ---: | --- |
| A — shipped | 0 | 0.02 | the control every published cell ran, on the same corpus snapshot and the same flags |
| B — ungated | 0.1 | 0 | the price of omitting the gate (P-red) |
| C — gated | 0.1 | 0.02 | the arm the Cloud-OpsBench maximum `CA@1` priced (P-green) |
| D — gated, price | 0.05 | 0.02 | the arm Cloud-OpsBench measured at **zero** cases lost |

All four carry `--fault-free-profile` and `--failure-containment-scope global-measured`, i.e. the configuration the
FSE'26 workflow dispatches, so the four differ by exactly the two numbers under test.

### The decision rule, and it is conjunctive

An enrolment of `labelPrior` at a non-zero weight requires **all four**:

1. `Top@1` on the 1,422 cases is **not below** arm A;
2. **no fault type** loses more than two cases against arm A;
3. the exact McNemar test on the discordant pairs has two-sided `p < 0.05`;
4. the golden half holds — the nine RCAEval cells at `labelprior=<β> labelpriorgate=<τ>` — which is a **separate
   dispatch** and is not claimed here.

A failure of (1) or (2) is a refusal regardless of (3). The shipped weight stays `0` unless all four hold; the
default gate stays `0.02` because the Cloud-OpsBench sweep showed it is the plateau's cell-safe boundary rather
than its maximum.

### What is instrumented, so an inert arm is distinguishable from a blind one

`label-prior-reach.ts` reads the run's own term dump and reports, per corpus, the **base** `top1 − top2` — the
number the gate compares, reconstructed by subtracting the term from each candidate's total. A gated arm that
reads identical to its control is then one of two facts (the gate withheld everywhere, or the term spoke and
agreed), and the census says which. Without it, "no change" would be the whole result.

## 2. The reading

Four arms, one commit, one corpus snapshot, one fault-free profile (`d13793d135e3900e`), one flag apart. All four
carry `--failure-containment-scope global-measured`, which is what the workflow dispatches and which reads **1 186**
where the engine's default scope reads the standing table's **1 156** — so every delta below is against the control
that shares every flag.

| arm | `β` | `τ` | `Top@1` | `Top@3` | `Top@5` | gained / lost | exact p |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **A — shipped** | 0 | 0.02 | **1 186 (83.40 %)** | 1 236 (86.92 %) | 1 255 (88.26 %) | — | — |
| B — ungated | 0.1 | 0 | 1 184 (83.26 %) | **1 260 (88.61 %)** | **1 279 (89.94 %)** | 20 / 22 | 0.878 |
| C — gated at the plateau | 0.1 | 0.02 | 1 176 (82.70 %) | 1 253 (88.12 %) | 1 273 (89.52 %) | 8 / 18 | 0.076 |
| D — gated, lower price | 0.05 | 0.02 | 1 182 (83.12 %) | 1 242 (87.34 %) | 1 267 (89.10 %) | 3 / 7 | 0.344 |

**P-red is falsified, and P-green is falsified too.** The pre-registration predicted the ungated arm would lose cases
because `trainticket`'s head has no room. The ungated arm loses **two** cases and is flat within noise (p = 0.878); the
gated arm loses **ten**, which is *worse* than the ungated one (p = 0.076 against A, in the wrong direction). Both
predictions were built on a margin scale that does not transfer, and the census says why:

### 2.1 The gate is not a gate on this corpus

| statistic | Cloud-OpsBench `trainticket` (47 cases) | FSE'26 (1 422 cases) |
| --- | ---: | ---: |
| median base `top1 − top2` | **0.0102** | **0.6277** |
| share of cases below 0.05 | 74.5 % | 16.1 % |
| cases τ = 0.02 withholds | 100 % | **6.3 %** (89 of 1 422) |

`report-prior-reach.ts` reads the gate's own input off the run's term dump — the base total reconstructed by
subtracting the term from each candidate's `score` — so this is the number the engine compared, not a proxy. A gate
whose threshold is 1/61st of the corpus's median margin is not protecting anything; it withholds 89 cases out of 1 422,
and the arm that *has* it reads seven cases worse than the arm that does not.

### 2.2 And it could not have protected anything, because the flips are margin-blind

The 42 cases the ungated prior flips have base margins with the same distribution on both sides:

| group | n | median | p10 | p90 | max | share < 0.10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **gained** (engine wrong, prior right) | 20 | **0.0142** | 0.0090 | 0.0960 | 0.3670 | 90.0 % |
| **lost** (engine right, prior wrong) | 22 | **0.0531** | 0.0106 | 0.1432 | 1.0051 | 68.2 % |
| all cases | 1 422 | 0.6277 | 0.0439 | 3.7977 | — | 16.1 % |

Raising the threshold does not separate them — it shrinks both:

| `τ` | flips the gate still admits (gained / lost) | net |
| ---: | ---: | ---: |
| 0.02 | 8 / 18 | **−10** |
| 0.05 | 6 / 12 | −6 |
| 0.10 | 2 / 7 | −5 |
| 0.20 | 2 / 1 | +1 (on three cases) |
| 0.50 | 0 / 1 | −1 |

So the statement this corpus licenses is not "τ needs calibrating" but something sharper: **the margin is a measure of
how decided the head is, and this term's errors are uncorrelated with it.** The prior wins when the engine's head is a
bystander and loses when the engine has correctly named a rare root cause; both look identical to `top1 − top2`.

### 2.3 What the term is actually doing, case by case

Train Ticket's labels over 1,422 incidents are a long tail: `ts-basic-service` 14.2 %, `ts-ui-dashboard` 11.6 %,
`ts-route-plan-service` 9.8 %, `ts-preserve-service` 6.8 %, `ts-travel-service` 6.6 %, `ts-seat-service` 5.6 %,
`ts-travel-plan-service` 5.2 %, `mysql` 5.1 %, and 22 more services below that.

Read at the case level, the two directions are not symmetric mistakes:

* **the 20 it gains** are cases where the engine's head was an unrelated bystander — `ts-consign-service`,
  `ts-price-service`, `loadgenerator`, `ts-cancel-service`, `ts-order-other-service` — and the prior restored
  `ts-ui-dashboard` (4 of them), `ts-order-service` (2), `ts-travel-service`;
* **the 22 it loses** are cases where the engine's head was a correct RARE label — `mysql`, `ts-config-service`,
  `ts-station-service`, `ts-route-service`, `ts-travel2-service`, `ts-order-service` — displaced by a frequent one:
  `ts-seat-service` (4 of them), `ts-basic-service`, `ts-travel-service`, `ts-route-plan-service`.

Concentrated by family, the loss is one block: **`NetworkDelay` −7 of 21 cases** in every armed arm, at both prices and
both gates, because on a delay the engine's head is usually right and the prior's modal answer is not the delayed
service. `JVMLatency` loses 3 at `β = 0.1` and none at `β = 0.05`.

### 2.4 The verdict

The pre-registered rule is conjunctive and criterion (1) fails in all three armed arms, so **`labelPrior` is REFUSED on
the FSE'26 panel and the shipped weight stays 0. No default moved.**

What the iteration bought instead is the only thing a refusal can buy: a mechanism. The term is **worth +1.69 pp at
`Top@3` and `Top@5`** (24 cases at each depth, in every armed arm) and **−0.14 to −0.70 pp at `Top@1`**, and the
separation between those two facts is not the threshold — it is *which position the term is allowed to touch*. That
makes the one remaining arm on this axis a structural rule rather than a price: **pin the base rank-1 and let the prior
reorder 2..n**. `Top@1` is then unchanged by construction, and the depth gain is kept. It is registered in
`label-prior.md` §6(d) with its prediction written before it runs, and it is explicitly *not* a `Top@1` improvement on
any board this project competes on.

### 2.5 What the two corpora now say together

| corpus | cases | median margin | shipped `CA@1` | best gated arm | verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| Cloud-OpsBench Hard | 156 | 0.0102 – 0.5294 by cell | 0.5128 | **0.5769** (+6.41 pp, 11/1, p = 0.0063) | refused at the head, priced |
| FSE'26 panel | 1 422 | **0.6277** | 0.8340 | 0.8270 – 0.8326 | **refused** (−0.14 to −0.70 pp) |

The same term, the same gate, opposite signs — and the difference is the corpus's margin scale, which is exactly the
quantity the veto-frontier literature says must be *calibrated* before a threshold on it means anything. Two corpora 61×
apart in median margin, one threshold: the transfer failure is now measured rather than argued.

## 3. What this iteration changed in the engine

One dispatch field pair, and no default moved:

* `--label-prior-weight` and `--label-prior-margin-gate` on `run-fse26.ts`, forwarded to the engine's
  `labelPriorWeight` / `labelPriorMarginGate` and stated on the run's own `Config:` line;
* the history **derived from the corpus the run scores** (`benchmarks/src/fse26-label-history.ts`) rather than read
  from a file — a frequency over one corpus's labels is true of that corpus alone, so a path would be a second
  place where "which history" can be wrong, and the derivation is a prefix scan of each `case.json` rather than a
  second pass over 38 GB of series;
* `label_prior_weight` / `label_prior_margin_gate` in the workflow's packed `ranking_knobs` block, so the arm is
  dispatchable on both halves of the kill criterion.

## 4. The pinned head (iteration 369) — the one arm the panel does not refuse

§2.4 left exactly one arm alive, and stated it as a structural rule rather than a price: **clamp the head of the
order the engine would report without the prior, and let the prior reorder positions 2..n.** It was registered with
its prediction written before it ran. It has now run, twice, on the same corpus snapshot, the same profile and the
same flags as the four arms above.

| arm | `β` | `τ` | jurisdiction | `Top@1` | `Top@3` | `Top@5` | gained / lost vs A | exact `p` |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| A — shipped | 0 | 0.02 | everywhere | **1 186 (83.40 %)** | 1 236 (86.92 %) | 1 255 (88.26 %) | — | — |
| B — ungated | 0.1 | 0 | everywhere | 1 184 (83.26 %) | 1 260 (88.61 %) | 1 279 (89.94 %) | 20 / 22 | 0.878 |
| C — gated | 0.1 | 0.02 | everywhere | 1 176 (82.70 %) | 1 253 (88.12 %) | 1 273 (89.52 %) | 8 / 18 | 0.076 |
| D — price | 0.05 | 0.02 | everywhere | 1 182 (83.12 %) | 1 242 (87.34 %) | 1 267 (89.10 %) | 3 / 7 | 0.344 |
| **E — pinned** | **0.1** | **0** | **tail** | **1 186 (83.40 %)** | **1 260 (88.61 %)** | **1 282 (90.15 %)** | **1 / 1** | **1.000** |
| F — pinned, gated | 0.1 | 0.02 | tail | **1 186 (83.40 %)** | 1 252 (88.05 %) | 1 274 (89.59 %) | 1 / 1 | 1.000 |

### 4.1 The three readings

**1. The head is preserved, and the residue is not the prior's.** Both pinned arms read `1 186` — arm A's number to
the case, `1 186` of `1 422` — with **one case gained and one lost**, `p = 1.000`. So the criterion's first two
conjuncts now hold: `Top@1` is not below A, and no fault type is down by more than two (`HTTPRequestDelay` **+1**,
`HTTPRequestReplaceMethod` **−1**, every other type identical).

**The two cases that move are the containment pass's, and that is measured rather than argued.** The pin makes the
ranking the prior acts on agree with the silent one at position 1 *by construction*; the containment order runs
AFTER it, on that ranking, and it inverts an adjacent caller/callee pair when the callee's own latency excursion is
larger. A rerun of arm E with `--containment-out` records both orders per case, and the two moved cases read:

| case | fusion order's head (what the pin produced) | published head (after the pass) | truth |
| --- | --- | --- | --- |
| `ts0-ts-preserve-service-request-replace-method-48zkx2` | `ts-preserve-service` | `ts-seat-service` | `ts-preserve-service` → **lost** |
| `ts4-ts-basic-service-request-delay-slc8g7` | `ts-travel-service` | `ts-basic-service` | `ts-basic-service` → **gained** |

Both fusion heads are the head arm A **publishes** for that case, which is the invariant stated at its own resolution;
the pass then moves position 1 in **43 of 1 422 cases**
under this arm, and in these two it moves it onto a wrong answer once and a right one once, which is why the residue
is `1/1` rather than `0/2` or `2/0`. The structural claim therefore has exactly one qualifier, and it belongs to a
different module: **the pin is exact for the ranking the prior acts on; a pass applied after it can still move
position 1.**

**2. The pin keeps the whole depth gain, and takes three more cases at `Top@5`.** `Top@3` is `+24` (28 gained, 4
lost, `p < 0.001`), identical to the ungated summed arm; `Top@5` is **`+27`** (30 gained, 3 lost, `p < 0.001`)
against that arm's `+24`. The mechanism is arithmetic rather than lucky: hoisting a head that the silent order
already had at position 1 or 2 can only push a competitor DOWN the list, so a k-window that gains the head loses
nothing it had, and where the head was at position ≥ k the window swaps in a candidate the prior ranks higher.

**3. Under `tail`, the gate is a substitute for the pin rather than a complement.** F withholds the term in 89 of
1 422 cases (`τ = 0.02`, the reach census of §2.2) and reads `+16 / +19` at depth against E's `+24 / +27`, at the
same `Top@1`. The gate was introduced to protect the head from a term that could displace it; the pin removes that
failure mode structurally, at any weight, so every case the gate silences under `tail` is depth the arm paid for and
did not take. **The two knobs are alternatives, and the cheaper one is the pin.**

### 4.2 The criterion, restated for a depth arm — before the golden half is read

The four conjuncts of §1 were written for a term that could move `Top@1`, and their third conjunct (`p < 0.05` on the
head) is unsatisfiable by construction for an arm whose whole claim is that the head does not move. It is therefore
restated here, in the same place and with the same discipline as the original, **before the nine golden cells are
measured**:

1. `Top@1` on the 1 422 cases is **not below** arm A — measured, `+0` at `1/1`, `p = 1.000` (E and F);
2. **no fault type's `Top@1` loses more than two cases** against arm A — measured, worst is `−1` (E and F);
3. **`Top@3` and `Top@5` are both strictly better**, with the exact McNemar `p < 0.05` at each depth — measured,
   `+24` / `+27` at `p < 0.001` (E); the gated variant is `+16` / `+19` and is not the arm to enrol;
4. **the golden half holds** — the nine RCAEval cells at `labelprior=0.1 labelpriorgate=0 labelpriorjurisdiction=tail`
   must satisfy (1)–(3) on their own 735 cases. **This is the conjunct that is not measured**, and it is a separate
   dispatch: `benchmark-rcaeval.yml`'s `anomaly_knobs` carries all three names as of this iteration.

Until (4) is read, **no default moves**: `DEFAULT_LABEL_PRIOR_WEIGHT` stays `0` and
`DEFAULT_LABEL_PRIOR_JURISDICTION` stays `everywhere`. The panel half now passes a criterion it previously failed at
the head; the AND is not satisfied, and the reason is a missing run rather than a disagreement about the corpus.

### 4.3 What this iteration changed in the engine, on top of §3

Three things, and the first is the only one that touches the ranking:

* `LabelPriorJurisdiction = 'everywhere' | 'tail'` with `isLabelPriorJurisdiction`, `DEFAULT_LABEL_PRIOR_JURISDICTION`
  and `pinHeadFirst` in `pruning/label-prior.ts` — the reorder helper is the whole mechanism, and it is a helper
  rather than a branch inside the sort so the invariant is testable without a corpus;
* `TreePrunerOptions.labelPriorJurisdiction`, forwarded by both benchmark runners, printed unconditionally on both
  configuration lines, and carried in the packed `ranking_knobs` / `anomaly_knobs` blocks;
* the order is now built by ONE closure over "which score decides" (`orderNodes`), so the silent order is the same
  pipeline with the prior's contribution read as zero rather than a second approximation of it. It is called twice
  only when a `tail` arm is armed and speaking; the shipped path sorts exactly as often as it did.
