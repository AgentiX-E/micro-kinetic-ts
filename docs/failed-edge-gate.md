# The failed-edge gate: a bar, an absent observable, and a count nobody printed

**Status:** the bar is dispatchable (§5); the local arms are run and their outcome is §6; the arm that can
answer the question is a dispatch (§7).
**Knobs:** `failedEdgeGateMode` (`--failed-edge-gate-mode`, packed key `failededgegate`), `failedEdgeGateShare`
(`--failed-edge-gate-share`, packed key `failededgegateshare`).
**Instruments:** `[failed-edge-gate]` (this document's census, per cell) beside `direction-gate[<view>]`
(`latency-routes.md`'s verdict on whether the corpus could supply the term at all).

---

## 1. The defect, in two counts

`DEFAULT_FAILED_EDGE_WEIGHT` is 3 — tied with the base term's coefficient for the largest weight in the ranking —
and the golden corpus has never been scored with it. Measured on the published 735 cases:

| reading | count |
| --- | --- |
| `failedEdge` term `WEIGHT_ZERO` | **734** |
| `failedEdge` term `INPUT_MAP_EMPTY` | **1** |
| cases on which the term contributed anything | **0** |

`WEIGHT_ZERO` is the label a **refusal** wears, not a configuration fact, and §3 is why. So the gate refused 734
cases and admitted one, on a case whose `failedEdgeScores` map was empty — it fired once, and paid nothing.

**That 734 is one number for two mechanisms, and they are different findings.**

| population | cases | what the gate saw |
| --- | --- | --- |
| RE1 ×3, RE2-SockShop, RE3-SockShop | **495** | `edgeLatencyByCallee` is **empty** — those corpora carry no traces. The gate's second half has no value at all. |
| RE2-OB, RE2-TT, RE3-OB, RE3-TT | **240** | a value exists (1080 / 6781 / 356 / 2006 `edgeLatency` rows) and **239 of 240 were still refused**. |

On the 495 there is no bar that could act — the constant, a fleet share, or any other — so the refusal is a
property of the corpus. On the 240 the bar is the only suspect, and **no artifact has ever printed the rise
distribution there**. That gap is what the census in §4 closes on the next dispatch, and it is why this document's
"§6" is a measurement of a smaller thing than §1's title suggests.

The one internal contradiction that needs no new run: the engine credits rises from **`latMinRise` = 10.3** up
through the `lat` term, on the **same per-edge ratio** the gate reads. Two thresholds on one quantity, fitted
separately, disagreeing by a factor of **29**.

## 2. What the artifacts said, and what they could not say

Two lines have been printed beside each other for many iterations and were never read as one sentence.

```
latency-routes[TrainTicket]: 90 cases | … | rows: shipped 0 | capped 0 | whole-file 6781
direction-gate[whole-file]: weight 3 on a view that supplied 6781 latency rows over 90 cases
  — the gate CAN fire, so a change, or its absence, is attributable to the term
```

Both statements are true. The first is about the **view** (it carried rows). The second is about the
**capability** (given a number, the predicate could decide). Neither is about the gate's **decisions**, and on
those four cells the decisions were 239 refusals and one empty map. A reader meeting an unmoved cell on
RE3-OnlineBoutique was told the mechanism had been tested. It had been refused.

This is the repository's oldest defect family — prose asserting a property of code the code does not have — in the
one form a paragraph cannot repair, because the missing quantity is a count. `docs/closed-axes-register.md`
records the axis.

## 3. Why `WEIGHT_ZERO` is the label a REFUSAL wears

The pruner computes a **baseline** ranking with the term's weight forced to 0:

```ts
const baseline = performTreeRCA(…, { ...this.options, failedEdgeWeight: 0 }, …);
```

because the gate's subject has to be the service the *ungated* engine answers with — a gate that needed the term's
own output to name its subject would be circular. A refused case returns that baseline unchanged, so on a refused
case the term's recorded cause is `WEIGHT_ZERO`: **not** because the configuration set the weight to zero, but
because the answer is the weight-0 pass.

Two different facts wear one label, and the zero-term table reports the first while a reader takes it for the
second. This is the conflation the `INPUT_*` family was introduced to break (a map with no entry is not a map with
no value), one level up: **a gate that refused is not a weight that was zero.** The census separates them by
construction — it evaluates the predicate instead of reading the label the predicate leaves behind — and it counts
the engine's own `acted` (a non-zero `failedEdge` contribution anywhere in the ranking) so that
`admissible − acted` is printed as a **mismatch** rather than silently absorbed.

## 4. The two bars, and the census

`failedEdgeRiseBar` gives the predicate a bar and nothing else:

| mode | bar | what it says |
| --- | --- | --- |
| `absolute` (shipped) | `FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR` = 300 | "the rise must exceed a number one dataset produces" |
| `fleet` | `clamp(share, 0, ∞) × maxInboundRise(case)` | "the rank-1 must be among the case's own strong rises" |

The fleet form is the construction `anomalyBreadthGate` and `dualFamilyGate` already use, and it is dimensionless
for the reason they are: it compares a case's rise against that same case's champion, so no corpus's injection
strength enters it. `share` 0 admits every rise the observable can speak about; `share` 1 admits only the case's
champion; the bar narrows monotonically in between.

**It fails closed, three ways.** No per-edge measurement → no champion → `undefined`, and the predicate refuses
before any comparison. A champion that is `0`, negative, `NaN` or `Infinity` → the bar is `Infinity`, which no
finite rise clears. A missing or non-finite rise → refused *before* the bar is computed, because folding it into
`0` would admit the case at `share 0` through `0 >= 0` — the one ordering in the predicate that is the rule rather
than an implementation detail.

**The shipped path is byte-identical, not identical-by-arithmetic.** `absolute` reads neither the share nor the
champion, and the pruner computes the champion only when the fleet bar is in force. §6 verifies this on a real run
rather than by argument.

The census, one line per cell:

```
  [failed-edge-gate] cases=90 | no champion 0 | rank-1 measured 88 | name refused 3 | bar(absolute@300) refused 85 |
    admissible 0 | acted 0 | rise p10/p50/p90/max … | fleet@0.50 admissible 12
```

- **`name refused`** and **`bar refused`** are the two halves of the predicate, counted apart: they close different
  residues, and one "refused" would report the name as the magnitude.
- **`admissible`** is the complement of both; **`acted`** is the engine's own answer, read off the breakdown.
  `acted` below `admissible` is printed as **`mismatch`**, and the one admissible golden case is that shape.
- **`no champion`** is the exclusion, and a cell where it is every case gets a **sentence** instead of a row of
  zeros: `no measurement: 125 of 125 cases carried no per-edge latency`. Five of the nine cells are that sentence,
  which is the count in §1 and the reason the sentence exists — a missing line would be indistinguishable from a
  census that never ran.
- **`rise p10/p50/p90/max`** is nearest-rank, not interpolated: every number in it is one case's measurement, and
  an interpolated p90 on 88 observations reports a rise no case produced.
- **`fleet@<share> admissible`** is a labelled what-if, and it is **omitted when the run's own bar is already a
  fleet bar** — printing it there would restate the bar as a second, agreeing measurement.

## 5. The arm, pre-registered

The arms were pre-registered before the runs, in this order, and are kept verbatim in §6 so a wrong prediction
stays visible.

| arm | dispatch | what it is |
| --- | --- | --- |
| A | *(none)* | control: the shipped bar |
| B | `anomaly_knobs=failededgegate=fleet,failededgegateshare=0.50` | the term at half of each case's champion |
| C | `anomaly_knobs=failededgegate=fleet,failededgegateshare=1.00` | the term at the champion only |

**Predictions.**

- **P1.** Arm A reports `acted 0`, `admissible 0`, and `bar refused` = `rank-1 measured − name refused`, and its
  accuracy is the published one (RE1-OnlineBoutique 107/125).
- **P2.** Arm B reports `admissible > 0`, i.e. the mechanism fires for the first time on this corpus.
- **P3.** Arm B's `mismatch` is ≤ 2, all of it `INPUT_MAP_EMPTY`.
- **P4.** The gain is zero or negative: the term credits a callee's inbound rise, and the golden misses are
  dominated by `selfAnomalyLog1p` (66 of 82 re-ranking misses have the truth's own anomaly as its largest edge).

**Refusal rules.**

1. **A total cannot accept the arm.** An arm that takes +2 on one cell and −2 on another has changed nothing about
   the corpus; the acceptance set is **per cell** and the total is reported, never decisive. (§200.6 records a
   dispatch accepted on a total while two cells moved in opposite directions.)
2. **A move of one case on a 30-case cell is not a result** (3.3 pp). It is recorded and cannot enter a claim.
3. **Zero movement with `acted 0` is not "no effect"** — it is "the arm did not run", and is reported as a
   mechanism failure rather than as a null result.
4. **Any cell down ≥ 2 cases refuses the mode as a default**, whatever the total says.

## 6. The measurement — what this machine can establish

Four runs, on the 155 cases this machine can rank (RE1-OnlineBoutique 125 + RE3-SockShop 30; the RE2 corpus is not
present locally). Every line below is the run's own output.

| arm | cell | `[failed-edge-gate]` | accuracy (per-fault-type average) |
| --- | --- | --- | --- |
| A | RE1-OnlineBoutique | `no measurement: 125 of 125 cases carried no per-edge latency` | **85.6%** (= 107/125, the published cell) |
| B | RE1-OnlineBoutique | `no measurement: 125 of 125 cases …` | **85.6%** |
| A | RE3-SockShop | `no measurement: 30 of 30 cases …` | 63.6% |
| B | RE3-SockShop | `no measurement: 30 of 30 cases …` | 63.6% |

**A and B are byte-identical apart from the `signals:` line** (`diff` on the two artifacts, one timing line
excluded): the fleet mode changed the bar and the run did not change at all, because there is no champion to be a
share of. That is the byte-identity claim of §4 verified on a real run rather than argued, and it is also the
strongest available control for the fleet bar's *inertness where the observable is absent*.

**Predictions, scored.**

- **P1 — CONFIRMED.** `acted 0` and `admissible 0` on both cells, and RE1-OnlineBoutique reads its published
  107/125.
- **P2 — REFUTED, and the refutation is the finding.** Neither local cell can admit anything: 125 of 125 and 30 of
  30 carry no per-edge latency, so the fleet bar has nothing to be a share of. The term is not refused by the
  number 300 on these cells — it is refused by the absence of the observable, and no bar can fix that.
- **P3, P4 — VACUOUS**, and refusal rule 3 is what says so rather than an after-the-fact caveat. Zero movement
  with `acted 0` is "the arm did not run". Reported as a null result it would have read *the failed-edge term has
  no value on the golden corpus* — a conclusion the data does not support, drawn from the one mechanism that was
  never given a subject.

**What the local half therefore settles**, and it is not nothing: 495 of the 735 cases are in the class this run
demonstrates, and the number 300 has never been read against a rise on any of them.

## 7. What is owed, and to whom

The arm that can answer P2 belongs to the **four span-bearing cells** — RE2-OnlineBoutique, RE2-TrainTicket (90
cases each) and RE3-OnlineBoutique, RE3-TrainTicket (30 each) — and it is one dispatch of
`benchmark-rcaeval.yml`, not four:

```
anomaly_knobs = failededgegate=fleet,failededgegateshare=0.50
```

plus, for the census's rise distribution, the same dispatch with `failededgegate=absolute` **first**: the
`[failed-edge-gate]` line at the shipped bar prints `rise p10/p50/p90/max` for the four cells, which is the
composition the fleet bar is about to be read against. A dispatch that runs only the fleet arm would report a
number with nothing to compare it to — which is the defect this document exists to record, one level up.

**Both arms have now run** (`41154322031` and `41154430071`), and §10 is what they said. The short version: the
rise distribution exists, the fleet bar admits **13 cases it was predicted to admit**, and the ranking does not
move — because there is a THIRD mechanism below the gate.

## 8. What this does not claim

- **The bar is not a ranking signal.** Changing it changes *whether* a term the model already has may act. A cell
  that does not move is a statement about the term, not about the bar.
- **`fleet` is not a per-corpus fit.** It has no constant in it. What it cannot express is a case whose champion is
  itself noise: at any share, a case whose largest rise is an artefact admits the term on artefact evidence. The
  `latMinRise` floor is orthogonal and stays where it is.
- **"RCAEval's rises are small" is NOT established.** The metric series behind `latWeight` — a *different*
  observable from the per-edge map this gate reads — gives RE1-OnlineBoutique case maxima of 1.01 (min), 7.68
  (median), 121.01 (p90) and **482.5** (max), with 4 of 125 cases above 300. So the corpus can produce rises of
  that size, in the other observable; the per-edge distribution on the four span-bearing cells is simply
  **unmeasured**, and a document that called the bar "out of scale" for this corpus would be asserting a
  measurement nobody took.
- **The census's subject is the final rank-1.** On a refused case the final ranking is the baseline, so the subject
  is the service the gate judged; on an admitted case it is the second pass's. The `mismatch` column is what makes
  that visible rather than silent.
- **The 25-input budget was not touched.** Both knobs travel in the packed `anomaly_knobs` block, which the
  workflow expands in **seven** copies (one per job); a key added to one copy passes every "the file contains the
  flag" check and fails at dispatch with `unknown key`. `dispatch-surface-census.test.ts` asserts the key from
  every copy.

## 9. The three rules the coverage report made us write down

`src/pruning/**` finished this iteration at 100% of statements, branches, functions and lines, and the last
three branches were not lines nobody had executed — they were rules nobody had written down.

1. **A share the arithmetic cannot read.** The bar is `Number.isFinite(share) ? Math.max(0, share) : 1`, and the
   `: 1` arm had no test. Both wrong readings are silent and both *look like a narrow gate*: a `NaN` bar makes
   every comparison false, and an infinite one refuses everything, so a caller passing `NaN` would be told the
   case has no rise when it has one. The defined reading is the end of the interval that asserts nothing new —
   the champion alone. A **negative** share is clamped to the opposite end, because a bar below zero would admit
   a case the observable never measured.

2. **The two `??` fallbacks in the gate's construction.** They looked like a second copy of the defaults table —
   the exact defect that table exists to prevent — until the type said otherwise: `{ ...DEFAULTS, ...options }`
   copies a key whose value is `undefined`, so a caller forwarding an optional field it never received *erases*
   the default instead of leaving it alone, and `rcaeval-cli` is such a caller. The rule is now a test that drives
   the ranking three ways — omitted, named, and spelled out as `undefined` — and requires one answer.

3. **An unmeasured callee in `computeTopoSourceScores`.** `anomalyScores.get(edge.to) ?? 0` reads an absence as
   healthy, which is the OPPOSITE of what every rise term in this repository does with the same absence. The two
   conventions meet here and disagree *on purpose*: this term subtracts from a source score, so reading "no
   measurement" as "no rise" would discount a caller for a callee nobody instrumented, and the penalty would fall
   on the least-observed neighbourhood in the graph. The asymmetry is now asserted from both sides, together with
   the second half of it — a node that carries no score cannot appear as a source merely because an edge mentions
   it.
\n
## 10. The two arms, and the third mechanism they found

Two dispatches, `scopes=golden`, same commit: `41154322031` at the shipped bar and `41154430071` at
`failededgegate=fleet,failededgegateshare=0.50`. All nine cells were attempted and all but one reported. Six of them
carry the observable and their counts are below; the two SockShop cells report `no measurement`; and RE1 lost its
shipped-bar job to the cache (`micro-kinetic-ts-docs` §202 records that defect), which costs nothing here because
RE1 carries no traces on any view — the fleet arm ran RE1 and its census says `no measurement: 125 of 125` three
times, at the same 330/375 the shipped configuration publishes.

### 10.1 The rise distribution §7 asked for, measured

| cell | cases | champion | rank-1 measured | rise p10 / p50 / p90 / max | `absolute@300` refused | `fleet@0.50` (what-if) |
| --- | --- | --- | --- | --- | --- | --- |
| RE2:OnlineBoutique | 90 | 90 | 88 | 1.05 / 5.30 / 95.56 / **358.80** | 51 | 33 |
| RE2:SockShop | 90 | 0 | — | `no measurement: 90 of 90` | — | — |
| RE2:TrainTicket | 90 | 89 | 88 | 1.47 / 5.74 / 42.53 / **191.71** | 45 | 39 |
| RE3:OnlineBoutique | 30 | 30 | 16 | 0.85 / 0.94 / 1.15 / **1.29** | 8 | 8 |
| RE3:SockShop | 30 | 0 | — | `no measurement: 30 of 30` | — | — |
| RE3:TrainTicket | 30 | 30 | 30 | 0.86 / 1.99 / 18.89 / **26.71** | 9 | 5 |

**This table corrects §8 and it corrects this section's own first draft.** The per-edge observable is not uniformly
small: RE2:OnlineBoutique's tail reaches **358.80**, above the constant, and its p90 (95.56) sits inside a factor of
three of it. So "the bar is out of scale for this corpus" is true of RE3 (233× on OnlineBoutique, 11.2× on
TrainTicket) and **false of RE2**, where the shipped bar admits a case: `admissible 1` on RE2:OnlineBoutique is the
absolute bar firing on real data for the first time on this half.

### 10.2 The what-if column predicted the other arm exactly, four times

`fleet@0.50 admissible 33 / 39 / 8 / 5` was printed by the **absolute** arm as a counterfactual, computed from the
same map the gate reads. The fleet arm's own census then reported `admissible 33 / 39 / 8 / 5`. A predictor that
sits in the shipped arm and gets the next arm's population right on four cells is worth more than the prediction: it
means the census is reading the mechanism rather than repeating a decision.

### 10.3 …and then 85 admissions moved nothing

| | RE2:OB | RE2:SS | RE2:TT | RE3:OB | RE3:SS | RE3:TT | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| absolute arm | 83/90 | 88/90 | 75/90 | 25/30 | 18/30 | 22/30 | **311/360 = 86.4%** |
| fleet arm | 83/90 | 88/90 | 75/90 | 25/30 | 18/30 | 22/30 | **311/360 = 86.4%** |
| admitted (fleet) | 33 | — | 39 | 8 | — | 5 | **85** |

Cell for cell identical, on a run where the gate admitted **85 cases the other arm refused**, and where the shipped
bar itself admitted one. The census's own arithmetic says why: `admissible 33 | acted 0 (mismatch 33)`,
`admissible 39 | acted 0 (mismatch 39)`, and the same 8 and 5 — **every** admitted case, on every cell, including
the one the shipped bar admitted.

### 10.4 The third mechanism: the gate's observable is not the term's input

The breakdown of the fleet arm's misses carries a cause the shipped arm produced only rarely:

```
failedEdge         INPUT_MAP_EMPTY(failedEdgeScores) 13.6% · WEIGHT_ZERO 86.4%     (RE3, fleet arm)
failedEdge         WEIGHT_ZERO 100.0%                                              (RE3, absolute arm)
```

The gate asks a question about **`edgeLatencyByCallee`** — "did this case's rank-1 service sit behind an inbound
edge whose mean span rose" — while the term can only add a number from **`failedEdgeScores`**, which
`directional-evidence.ts` builds from `failedTraceEdges`, and those come from spans whose **`status === 'ERROR'`**. A
slow call is not a failed call, and this corpus carries the first without the second.

The measurement, at its own resolution: **85 of 85 admissions contributed 0** — that count is exact, because
`acted` is read off the breakdown rather than recomputed, and `mismatch` is the difference the census refuses to
hide. The *cause* is sampled rather than enumerated, because the breakdown audits misses: 3 of 22 on RE3 name
`INPUT_MAP_EMPTY(failedEdgeScores)`, and the other admitted cases are not in that population. What is established is
that the admission does not reach the term; what is not is that all 85 were empty for the same reason — though the
mechanism named above predicts they are.

So the term has **four** refusals, and they now have four counts instead of one label:

| refusal | population (the six reporting cells, 360 cases) | counted by |
| --- | --- | --- |
| no observable | 120 of those 360 (RE2:SockShop 90, RE3:SockShop 30), plus 495 over the five trace-less cells | `no measurement: n of n` |
| not a duration-family metric | 108 of the 222 rank-1-measured cases | `name refused` |
| bar | 113 at `absolute@300` → 29 at `fleet@0.50` | `bar(…) refused` |
| **the admission does not reach the term** | 85 admitted (1 of them under the shipped bar), 0 acted | `acted 0 (mismatch n)`; cause sampled at 3 of 22 misses |

The three interior rows sum to the 222 measured cases at both bars — 108 + 113 + 1 at the constant, 108 + 29 + 85 at
the share — which is the property that makes them counts rather than four opinions about one decision.

### 10.5 What this refutes, and what it leaves

It refutes §7's premise — *the bar is the only thing between the term and the golden half* — and it refutes it in the
direction that costs the most: the bar was the **cheapest** of the three, and removing it buys a term with nothing
to add. It also refutes the softer version, that the shipped constant is simply too large for this corpus: on
RE2:OnlineBoutique it fires, and the case it fires on still contributes nothing.

The next question is therefore not a better bar, and not a smaller share. It is whether this corpus carries
failed-call records at all — `directional-evidence.ts` already reports `failedMass rankable=` per run, and on the one
run whose artifact was readable (RE1, 204 cases) it printed `with traces=0`, which is the trace-less case rather than
the answer. `failedEdgeMinRecords` is the knob that already exists for the other half of the question and no arm has
varied it. Until one of those two facts is settled, the honest status of this term on the golden half is *unmeasured*
rather than *unhelpful*, and the fleet bar is an instrument waiting for an input.

## 11. The instrument for the open question, and the third arm's verdict

§10 ended with a question the gate census structurally cannot answer: *does the corpus carry failed-call records at
all?* It cannot, because the gate judges `edgeLatencyByCallee` while the term spends `failedTraceEdges`, and one
census reading one map cannot say what a different map held. So the census grew three counts and a second line.

### 11.1 Three counts, one filter apart

| column | read from | zero means |
| --- | --- | --- |
| `failed records n cases / m rows` | `case.failedTraceEdges` | the CORPUS recorded no ERROR span on a comparable edge |
| `term subjects n cases` | `graph.failedEdgeScores` | the engine's `max(0, failed − baseline)` consumed every record |
| `admitted rank-1 with entry a of b` | `graph.failedEdgeScores.has(rank-1)` | the gate let a case through that the term has no number for |

They are three different findings and the report prints them as three columns rather than one, because collapsing
them is the defect this whole document is about one level up. `failed records none` is a word rather than `0 cases`,
for the reason §2 gives: a number reads as a measurement.

The third column is the one that costs the least to read and says the most. `admitted 8 | rank-1 fed 0 of 8` is the
§10 finding — 85 admissions, 0 payments — stated as arithmetic instead of sampled from an audit of misses.

### 11.2 The third arm: `lat_min_rise=1`

Dispatch `41156831668`, `scopes=golden`, all nine cells, one knob moved from the shipped `10.3` to `1`. The
prediction was registered in `micro-kinetic-ts-docs` §202.6 **before** the run, from the ablation battery's row of
the same name.

| cell | shipped (`10.3`) | arm (`1`) | Δ |
| --- | --- | --- | --- |
| RE1:OnlineBoutique | 107/125 | 107/125 | 0 |
| RE1:SockShop | 117/125 | 117/125 | 0 |
| RE1:TrainTicket | 106/125 | 106/125 | 0 |
| RE2:OnlineBoutique | 83/90 | **82/90** | −1 |
| RE2:SockShop | 88/90 | 88/90 | 0 |
| RE2:TrainTicket | 75/90 | **72/90** | −3 |
| RE3:OnlineBoutique | 25/30 | **21/30** | −4 |
| RE3:SockShop | 18/30 | 18/30 | 0 |
| RE3:TrainTicket | 22/30 | **27/30** | +5 |
| **total** | **641/735 = 87.21%** | **638/735 = 86.80%** | **−3** |

Three of the four predictions were wrong, and the fourth was wrong in the direction that matters:

- **P1 confirmed.** RE1 does not move — 330/375 in both arms, cell for cell. It has no traces, so a floor on a
  latency rise has nothing to mask.
- **P2 refuted.** It predicted RE2:TrainTicket would RISE and RE2:OnlineBoutique would give back a case or two. RE2
  gave back four cases, three of them on TrainTicket.
- **P3 open, and the answer is self-cancelling.** RE3 moved by +5 on TrainTicket and −4 on OnlineBoutique. A cell
  that gains five and a cell that loses four is a redistribution, and the refusal rule written down before the run
  says a redistribution does not ship.
- **Refusal rule applied.** The nine-cell total falls by three cases, from 87.21% to 86.80%. The knob stays at
  `10.3`.

### 11.3 The ablation said +2.22 and the arm said −1.48

That gap is the most valuable thing this arm produced, because both numbers are correct. The ablation battery
measured `latMinRise=1` against **its own baseline**, a 34-configuration grid whose baseline differs from the shipped
configuration in several other flags; its RE2:TrainTicket row starts at 78.9% (71/90) and the shipped configuration
starts at 83.3% (75/90). Moving the same knob on those two starting points moves TrainTicket by **+7** cases in one
and **−3** in the other.

So the knob's effect is not additive. A single-variable ablation answers *"what does this flag do on this baseline"*,
and the shipped configuration is not that baseline — which means an ablation table cannot be summed into a shipping
decision. The cell-level agreement that does hold (RE2:OnlineBoutique, −1 in both) is not enough to rescue the rest.

This is why the arm was dispatched at all rather than read off the ablation: an ablation is a measurement about a
grid, and a dispatch is a measurement about the thing that ships.

### 11.4 What is still owed

`failedEdgeMinRecords` remains unvaried — it is the knob for the half of the question the new columns can now see:
if a cell reports `failed records n cases / m rows` with `term subjects 0`, the records exist and the filter ate them,
and raising the minimum would make that worse rather than better. The next dispatch therefore has a precondition
rather than a hypothesis: read the two columns, and only dispatch if they disagree.
