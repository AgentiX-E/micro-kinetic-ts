# The loss decomposition — a miss is retrieval or reranking, and the line that could not say which

**Owner doc for `benchmarks/src/loss-census.ts`, its test, and the `--loss-census` artifact.**

Top-1 accuracy is one number and it hides two failures that have nothing to do with each other. A case whose
root cause never entered the candidate set cannot be fixed by ranking: the right answer was not among the
options. A case whose root cause entered the set and came second can be. Every published RCAEval number is a
single number, so **the benchmark cannot say which of the two it is losing**, and the difference is not
academic — it decides whether the next change should be a better ranker or better inputs.

This document exists because that decomposition turned out to need an instrument the benchmark did not have,
and building it exposed **two defects in the diagnostic layer**, both of the family this repository keeps
finding: something that prints, or lists, a quantity other than the one it is about.

---

## 1. The benchmark's own shape makes the split actionable

`arXiv:2609.27069` records two properties of this benchmark, and the second one frames everything below:

> RCAEval injects faults into only **five services per system** while exposing **12 to 70** in telemetry.

So the candidate space is large and the set of services a fault is ever injected into is small and fixed. That
is a statement about the **inputs**: it predicts that a ranker which reads nothing will still place the true
culprit somewhere in a top-5 list far more often than chance — which is exactly what the same audit measures
(`Avg@5` 0.488 for a telemetry-free prior, "the true culprit in the top five on **99.7 percent** of held-out
incidents", collapsing to 0.192 across systems). It also predicts that **retrieval is nearly saturated**: if
the truth is one of five injected services out of a dozen-plus exposed, the question "is the truth in the pool
at all" should be answered *yes* almost always, and the loss should be almost entirely a *reranking* loss.

That is a testable prediction about our own pipeline, and Section 3 measures it. It matters for the roadmap
because a reranking loss has a completely different remedy from a retrieval one.

---

## 2. Defect — the ladder printed a quantity that was not the one it ordered by

`run-rcaeval.ts` renders the engine's ranked candidates for a failing case as one line:

```
    Top-K: ts-consign-price-service(1.00,d0) | ts-route-service(0.98,d0) | ts-consign-service(0.46,d1) | ts-admin-travel-service(0.20,d3) | ts-travel-service(0.29,d2)
```

Read it as a ranking — which is what it is — and the last two entries say **0.20 then 0.29**. A ranked list
whose numbers rise is not a ranking, so the line reads as unsorted, or as a bug in the engine, or as evidence
that the scores mean nothing. None of those is true.

What is true is that the list is sorted by **`finalScore`** and the line printed **`confidence`**. The two are
different quantities, and the type documentation says so in as many words: `confidence` "folds in
propagation-depth and error-bound penalties **for display**", while `finalScore` is "the exact value the sort
uses, so the gap between two candidates' `finalScore` values is the engine's true ranking margin".

So the defect is not a wrong number. **It is a number in a position that claims to be the ordering key.** The
consequence is precise and it is the reason this had to be fixed before the decomposition could be built: a
reader — or an instrument — that wants to compute `Retrieval@K` or `Rerank@1` from that line gets the
**positions** right and the **magnitudes** wrong, and has no way to tell that it has.

`diag.topK` never carried `finalScore` at all, so this could not be fixed by changing only the renderer: the
record had to start carrying the sort key. The fix has three parts:

1. **The record carries the key.** `diag.topK[]` gains `finalScore?: number`, populated from the engine's own
   result.
2. **One renderer, with a stated contract.** `formatRankingLadder(entries)` lives in `loss-census.ts` and its
   contract is that **the printed number is the sort key**. The value decreases with rank by construction, so
   the line can be checked against itself.
3. **A missing key is printed as missing.** Where `finalScore` is absent — an artifact from before this change —
   the cell reads `-`, never a fallback to `confidence`. Falling back would put a different quantity in the
   score's position, which is the original defect with an extra step.

### The fence, and the mutation that proves it bites

The test asserts the printed numbers are **non-increasing in rank**, on a fixture whose `confidence` values rise
where its `finalScore` values fall. Restoring the old behaviour (`confidence` in place of `finalScore`) fails it
with `expected [ 0.11, 0.98, 0.2, 0.29 ] to deeply equal [ 3.2, 3.1, 2.4, 1 ]` — which is, character for
character, the shape the shipped artifact prints.

---

## 3. Defect — the artifact named a file no default run writes

The benchmark's RE1 upload lists two files:

```yaml
          path: |
            rcaeval-re1-results.txt
            rcaeval-diagnose-re1.txt
```

The second one is **opt-in**: it is written only when the dispatch sets `inputs.diagnose_dump`, which every
push-triggered run leaves empty. On those runs `upload-artifact` warns that the file was not found, **succeeds
anyway**, and publishes an artifact card that looks complete. The reader who tries to fetch the dump gets
nothing — which is what happened while this instrument was being built, and the only way to find out why was to
read the workflow.

**Both directions of the family are in this one block.** A file listed that is not written (the claim exceeds
the content), and the file that *is* always written being listed beside it so that the pair looks uniform (the
condition is not stated). The repair makes listing and writing the same condition:

- the unconditional artifacts now hold only files every run writes, and declare **`if-no-files-found: error`**,
  so a missing one is a red job rather than a warning;
- the dump has **its own upload step**, gated on `inputs.diagnose_dump != ''` — the same input that produces it.

### The fence, and why the existing one had to change shape

The existing assertion was `expect(WORKFLOW).toContain('            ' + dump)` — **the indentation**, not the
property. That is a fact about how a path list is formatted; moving the dump to its own step ships the same file
from the same run and fails it. It now asserts the property — *exactly one upload step names this file* — which
is what the test's own name claims ("gives every invocation its own file and ships it") and which a format change
cannot defeat. Two new tests state the honesty condition directly: no unconditional upload may name an opt-in
file, and every dump's upload must be gated on the input that produces it.

**Mutation-verified.** Putting `rcaeval-diagnose-re1.txt` back into the unconditional path list fails three
tests (the file is now named twice, and it is named unconditionally); removing it passes.

---

## 4. The instrument

`--loss-census <path>` writes **one JSON object per case**, for every case of every group the invocation covers —
correct ones included. That last part is the whole point: the console already prints failure diagnostics, but it
prints **the first few per fault type**, so a split computed from the console is a split of a *sample* while
reading as one of the population. The census is the same question asked of every case.

| field | what it is |
| --- | --- |
| `pool` | how many services the engine ranked: its candidate set for the case |
| `truthInGraph` | whether the ground truth is a node of the case's constructed graph |
| `truthRank` | the truth's 1-based rank in the **full** ranking, or absent |
| `correct` | whether the top-1 prediction is the truth |
| `errored` | whether the engine threw before producing a ranking |

`truthRank` is read from the **full** ranked list, not the recorded top-K prefix, and that is deliberate: a
prefix cannot tell a truth at rank 6 from one at rank 40, and almost the whole value of a reranking fix lives in
that difference. `undefined` means "absent from the ranking", and it is `undefined` rather than a sentinel
because the engine's ranks start at 1 — any number placed there would be a rank that does not exist.

### The pool is the set the engine RANKED, and getting that set required a change

The first version of this instrument recorded `pool` as the size of the graph and took the truth's rank from the
engine's result. Both were wrong, and the reason is one line the runner had carried for as long as the benchmark
has existed:

```ts
const results = await engine.analyze(faultGraph, topK);   // topK = 5
```

`topK` is the **reporting** width — the metrics read prefixes of the ranking and its first element — and the
engine honours it as a hard slice. So the result held at most five entries, and two things followed. The truth's
rank existed only in `{1..5}`, so a truth at rank 6 was indistinguishable from one at rank 400 — the exact
collapse this instrument exists to prevent. And a truth that is a graph node but not among the five ranked came
back with no rank at all, which would have been filed as "not in the pool" when it was in fact in the pool and
merely unranked.

The repair asks the engine for **the whole candidate set**:

```ts
const rankingCaptureDepth = (graph) => Math.max(topK, graph.nodes.size);
const results = await engine.analyze(faultGraph, rankingCaptureDepth(effectiveCallGraph));
```

Bounded by the graph rather than by a constant, because a constant is a silent cap: this benchmark's audit
records telemetry exposing **12 to 70** services per system, and any fixed number above that is correct today and
quietly wrong the moment a system grows past it. `pool` in each record is what the engine actually ranked, so a
shortfall is visible in the artifact rather than inferred from the call.

**The widening is safe because it is measurable, and it is measured.** Every consumer of `results` reads a
prefix (`results.slice(0, topK)`), index 0 or index 1 — so a longer list has the same head. That is not left as
an argument: `benchmark-runner.test.ts` runs one case through an engine asked for the whole graph and another
clamped to five, and asserts `avgTop1`, `avgTop3`, `avgTop5`, `locationAccuracy` and `typeAccuracy` are
**identical to the last digit**, while the first reports `pool` equal to the graph size and the second reports
`pool` of five. The same suite asserts the depth asked for is `max(5, |nodes|)` — at least the graph, so nothing
can be truncated, and at least the reporting width, so the top-5 the metrics read always exists.

### The classes

| class | definition | what it means |
| --- | --- | --- |
| `CORRECT` | the top-1 is the truth | — |
| `RETRIEVAL` | the truth is not in the set the engine ranked | **no ranking of that set could have returned it** |
| `RERANK_SHALLOW` | in the ranked set, placed at rank ≤ 5 | a ranking fix is available |
| `RERANK_DEEP` | in the ranked set, placed deeper than 5 | a ranking fix is available, further away |
| `ENGINE_ERROR` | the analysis threw | there is no pool to be inside or outside of |

The line between `RETRIEVAL` and the two reranking classes is drawn by the **rank** and not by the graph, which
is the correction described above: a truth the graph holds and the ranking never surfaces is still one that no
ranking of *this* pool could have returned.

### Why a retrieval failure is reported as two counts and not as a defect

`truthInGraph` is kept, and it splits the retrieval half into two mechanisms with different owners:

- **`retrievalNotInGraph`** — the truth was never a node of the case's graph. An input problem: topology or
  telemetry never put it there.
- **`retrievalNotRanked`** — the truth IS a node and the ranking never surfaces it.

**The second is not called a defect, and that is a deliberate refusal.** It could be a ranker that dropped a
candidate it was handed; it could equally be the pruner legitimately removing the node from what it scores,
which the node set does not distinguish. Separating them needs the pruner's own scored set, which this record
does not carry — so the census reports the count and the doc states the limit. An instrument that names a
mechanism it cannot see is the failure mode this repository keeps recording, and this is where it would have
been easy to commit.

`ENGINE_ERROR` is its own class for the same reason at the other end: a case whose analysis threw has no
candidate pool, so any node-set claim about it would be a claim about a graph that was never built.

The report prints the split of the misses rather than only the accuracy, and names **retrieval as the part no
ranking change can recover** — because that is the sentence the number is for.

---

## 4. The measurement, over the whole 735

Read from the census artifacts of run `38045797356` — **one JSON line per case, all 735** (RE1 375 / RE2 270 /
RE3 90), through this module's own `summarizeLoss` / `formatLossReport` rather than through a re-implementation;
the raw rows are kept so every figure below can be re-derived.

```
  suite  system           cases  correct  RETRIEVAL  shallow   deep  notG   ERR   pool
  RE1    OnlineBoutique     125      100          1       19      5     0     0   10.0
  RE1    SockShop           125      116          0        6      3     0     0   14.0
  RE1    TrainTicket        125       85          0       26     14     0     0   64.0
  RE2    OnlineBoutique      90       78          1       11      0     0     0   10.0
  RE2    SockShop            90       83          0        7      0     0     0   13.0
  RE2    TrainTicket         90       64          0       12     14     0     0   68.0
  RE3    OnlineBoutique      30       22          0        2      6     0     0   10.0
  RE3    SockShop            30       11          0       17      2     0     0   13.0
  RE3    TrainTicket         30       15          0        1     14     0     0   68.0
  TOTAL                     735      574          2      101     58     0     0
```

**161 misses. RETRIEVAL 2 (1.2%) · RERANK_SHALLOW 101 (62.7%) · RERANK_DEEP 58 (36.0%) · ENGINE_ERROR 0.**

### 4.1 What the split says, and it is the opposite of the thing worth fixing

**The loss is 98.8% reranking and 1.2% retrieval.** No ranking change recovers 2 cases out of 735; the other 159
are failures of *ordering* a candidate the engine already had. Read against the two published claims:

- **`arXiv:2609.27069`'s "a ranker reading no telemetry still reaches `Avg@5` 0.488"** is a statement that the
  truth is in a short prefix cheaply, and this census is its Top-1 counterpart: the truth is in the ranked pool
  on **99.73% / 99.63% / 100.00%** of RE1 / RE2 / RE3, and inside the top five on **93.87% / 94.44% / 75.56%**.
  Their claim is **reproduced on our corpus, by our own instrument** — retrieval is not the problem here.
- **The NeurIPS 2026 decomposition's `Retrieval@K` vs `Rerank@1`** is therefore already saturated on this
  benchmark, and the headroom it points to is the reranking half. That is now a measured statement about *our*
  engine rather than a borrowed one.

### 4.2 The one suite where it is not shallow reranking

RE3 is the outlier and the numbers are unambiguous: **top-5 in-pool 75.56%** against 93.87% and 94.44%, and of
its 18 misses **14 are `RERANK_DEEP`**. RE3 TrainTicket alone is 14 deep of 15 misses; RE3 SockShop is the
mirror image (17 shallow, 2 deep). So the two RE3 systems fail differently, and the RE3 router candidate
(iteration 77–79, +11.11pp held out under the zero-regression rule) is a *shallow*-reranking fix on SockShop
alone. **Nothing in the repository addresses `RERANK_DEEP`**, which is 58 cases and concentrated in TrainTicket
(14 + 14 + 14 = 42 of the 58).

### 4.3 The accuracy the census prints, and the convention it is in

The census prints **78.10%**, which is not the published **78.75%** — and the difference is a convention, not a
defect. `docs/accuracy-aggregation.md` owns the rule: the published cell `AVERAGE` is the **unweighted mean of
the fault-type accuracies**, while the census weights **every case equally**. Re-derived from the same 735
records, the two agree exactly on RE1 (`80.27%`) and RE2 (`83.33%`) and separate only on **RE3: 53.33% at the
case level against 58.69% per fault type**, because RE3's fault types do not carry equal case counts.

That separation had been recorded once, as a study-versus-golden discrepancy investigated for three runs. What
this iteration adds is that it is **reproducible on demand from one artifact**, and that the report now **names
its own convention** — the fix for a pair of numbers that differ under one noun is a label, and a percentage
cannot assert its own unit. **Neither figure is wrong; quoting one as the other is.**

### 4.4 What is NOT claimed

`retrievalNotRanked` is **0** in every group and `retrievalNotInGraph` is **0** as well, so the 2 retrieval
failures are the two RE1/RE2 OnlineBoutique cases where the truth is outside the pool while still being a graph
node — which is exactly the shape §3 refuses to name a mechanism for. They are reported as a count, and the
refusal stands.

---

## 5. The DEEP half's first instrument: did anything move at the origin?

§4 measured where the loss is (98.8% reranking) and which block carries it. It did not answer the question the
block raises, and §3 records why in advance: the census knows the truth's **rank** but not its **score**, so it
cannot tell a truth ranked 26th among comparably-moving candidates from one ranked 26th because 25 services moved
and it did not.

### 5.1 The motive, from §4's own rows

Cross-tabulating the 735 rows of run `38045797356` by fault type rather than by system moves the target and makes
the missing question unavoidable. The 58 `RERANK_DEEP` misses are **not** a TrainTicket story:

| block | DEEP | median truth rank |
| --- | --- | --- |
| RE1-OB / RE1-TT / RE2-TT `loss` (packet loss) | 3 + 7 + 6 = **16** | 1 – 3 |
| RE1-TT `disk`, RE2-TT `disk` | 6 + 2 = **8** | 2 |
| RE3-TT `f3` | **6 of 10** | **26** |
| RE3-OB `f1` | **6 of 9** | **6** |
| RE3-TT `f1`, `f4` | 3 + 3 = **6** | 1, **26** |

Two facts fall out of that table and neither was visible at cell level. **`loss` alone is 16 of the 58**, which
matches the published per-fault-type column where RE1-OB `loss` is **44.0%** — the weakest fault type in the whole
benchmark — so the weakness is a property of the fault, not of the system. And **RE3-TT `f3` and `f4` have a
median truth rank of 26 in a 68-service pool**: "ranked a little low" and "placed near the bottom of the pool" are
different mechanisms, and a median of 26 names the second.

### 5.2 What is now recorded

The truth's **own evidence**, read from the result the engine already produced for it and carried in the same
record as its rank: `rcaScore` — the self-anomaly term of `finalScore(v) = log1p(selfAnomaly(v)) + Σ signalWeight ×
signal(v)` — **together with the threshold it was judged against**, plus `collisionGain`, `finalScore`, `depth`,
`viaTreeSearch` and the count of evidence metrics.

**The threshold travels in the record, and that is the design rather than a convenience.** The boundary between
"nothing moved at the origin" and "something moved and was still outranked" is then the **engine's own cut**, which
cannot drift away from the record that reports it; a constant restated in the reader would move silently the moment
the engine's changed. It also means the value and its bar are one datum: a record carrying `rcaScore` without the
threshold it was compared against is not half an answer, it is an unusable one, which is why `TruthEvidence` keeps
both on one object rather than as two fields of the row.

**Which also settles the missing case.** A metric the engine did not record stays `undefined` rather than
defaulting to zero — the difference between "the engine reported nothing" and "the engine reported zero" is what
the third class exists for.

### 5.3 Three classes, and the boundary is not invented

| class | condition | what it means |
| --- | --- | --- |
| `NO_LOCAL_EVIDENCE` | `rcaScore ≤ rcaThreshold`, both recorded | the origin did not clear the engine's own bar. **A reweighting has nothing to weight** |
| `LOCAL_EVIDENCE_PRESENT` | `rcaScore > rcaThreshold` | the origin deviated and was still placed deep. **A ranking problem** |
| `UNSTATED` | either value absent | this split **cannot decide**, reported as its own count |

`NO_LOCAL_EVIDENCE` is not called a data defect. The engine's bar is what it requires to count something, and a
truth below it may be a fault whose signature is absent from the metric tier, a fault whose signature arrives
after the detection window, or a formulation question about the self-anomaly term — the record does not separate
those and the doc does not name one. What the class DOES settle is the work: **no reweighting of a candidate
whose self-anomaly term did not clear the bar will lift it, because there is nothing there to weight.** That is a
statement about where the remaining 58 cases can and cannot be won, and it is the first time the repository can
make it.

`UNSTATED` is a class rather than a default for the reason §3 gives: filing a row under either answer because a
value is missing is an instrument naming a mechanism it cannot see.

### 5.4 The measurement — and it refutes the hypothesis this section was built to test

Run **`38107549281`** on the revision that carries the field. All 735 rows, read through this module's own
`summarizeLoss` / `classifyDeepEvidence`:

```
  of the 58 DEEP misses: NO local evidence above the engine's own threshold  2,
                         local evidence PRESENT and still ranked deep       56 (a ranking problem),
                         undecidable                                        0
```

**The instrument was built to find out whether the deep block is a signal problem. It is not.** 56 of the 58 —
**96.6%** — had a `rcaScore` **above the engine's own threshold** and were still placed beyond rank 5. The
"nothing moved at the origin, so no reweighting can lift it" reading that §5.3 was written to make room for
covers **2 cases**, and both sit inside `loss` groups (RE1 SockShop and RE3 OnlineBoutique), not in the
TrainTicket blocks the median rank of 26 was expected to explain.

**So the whole remaining loss is reachable by ordering alone.** §4's sentence was that 98.8% of the loss is
reranking and 1.2% is retrieval; the deeper cut is that the reranking half is **itself 96.6% orderable evidence**
rather than a mixture of signal and ordering. Nothing in the 735 requires a new signal, a new metric tier or a new
formulation of the self-anomaly term before it can be won — which is a materially stronger statement than the one
§4 could make, and it is stronger in the direction that makes the remaining work cheaper rather than harder.

**The shape of the empty class is worth recording too.** `UNSTATED` is **0**: every deep row carried both a
`rcaScore` and the threshold it was judged against. §5.3 kept that class rather than folding it into either answer
because the record might not always say, and the measurement says it always did on this corpus — **a guard that was
needed in advance, is empty here, and would be the thing that kept a future row out of a false answer.** It stays.

**And the nine cells are unchanged.** RE1 **80.0 / 92.8 / 68.0**, RE2 **86.7 / 92.2 / 71.1**, RE3 **80.0 / 45.0 /
51.1**, and the per-cell retrieval / shallow / deep counts are identical to the run before it (RE1-OB 1/19/5, RE1-TT
0/26/14, RE2-TT 0/12/14, RE3-TT 0/1/14, …). The census file itself is **larger by the added field and equal in
every count**, which is the correct signature for an instrument-only change: the payload grew, the ranking did not
move.

### 5.5 What the split changes about where to work

- **The two `NO_LOCAL_EVIDENCE` cases are the only ones in the 735 for which a reweighting is provably idle**, and
  they are worth a look precisely because they are two: a bar that two `loss` cases fall below is either the right
  bar or a bar that is wrong for that fault's signature, and two cases cannot settle which.
- **The 56 `LOCAL_EVIDENCE_PRESENT` cases are an ordering problem with the evidence already in hand**, and the
  per-fault-type head of that block is unchanged from §5.1: `loss` 16, `disk` 8, RE3-TT `f3` 6 at a mean rank of
  26, RE3-OB `f1` 6. **A truth with local evidence at rank 26 of 68 is a candidate the ranker scored and did not
  prefer**, so the question for these blocks is which term it lost on — a question the next instrument must carry,
  because `finalScore` alone sums the terms and cannot say which one dominated.

---

## 6. The attribution: *which* term the winner won on

§5 ended with the question its own measurement created. 56 of the 58 `RERANK_DEEP` misses had local evidence
above the engine's own threshold and were placed beyond rank 5 anyway — so none of them is excused by a missing
signal, and all of them are "ordering". **Ordering along which term?** A rank cannot say, and neither can
`finalScore`, because it is a sum:

```
winner − truth = Σ (winner_i − truth_i)
```

**A sum can say that one candidate outranked another and never which term did it.**

### 6.1 What is now recorded, and where the numbers come from

`ScoreTerm` — a name and a contribution, weight already applied — and **`terms` on every result the pruner
emits**, not only on the top-1. That last part is the load-bearing one: the attribution is a question about a
GAP, the gap has two sides, and the winning side is by definition not a miss — so a breakdown carried only on
the winner would make the comparison impossible on exactly the cases it exists for.

**The breakdown is not a second computation of the score.** `finalScoreOf` assembles the thirteen terms into one
array and the total IS that array's sum, rather than a parallel expression beside it. A breakdown kept beside a
total is two descriptions of one score, and they agree until one of them is edited — at which point the artifact
reports a decomposition of a number it did not come from. Here the two cannot disagree, and the term order is
the formula's own, so the floating-point sum is unchanged to the last bit.

That invariant is asserted rather than trusted: **`sumScoreTerms(terms) === finalScore`, exactly, on every
result**, in `packages/tree`. The term NAMES are additionally enumerated as an exact set, because the identity
alone cannot see the failure that matters most — a term dropped from *both* sides still sums correctly, and only
an exact population catches it. Mutation-verified in both directions: an emitted total nudged by `1e-9` fails the
identity, and dropping one term from the breakdown fails the name set.

### 6.2 The derivation, and its three refusals

`dominantLostTerm(truthTerms, winnerTerms)` returns **the term with the largest POSITIVE truth-to-winner
difference** — the term that decided the case in the winner's favour. Three refusals are built in rather than
documented around:

- **A term the truth LEADS on is never returned.** Only positive gaps are candidates, and the condition sits in
  the selection rather than in a later filter, so an implementation that seeded its answer with the first term
  would not exist. A truth can lead on a term and lose the case anyway; that term is not where it lost.
- **Either side missing ⇒ `undefined`.** A gap needs two sides.
- **No shared term name ⇒ `undefined`.** Two breakdowns with no term in common are descriptions of two different
  scores, and a difference between those is not a quantity. Reported as `unattributable` rather than folded into
  any term, for the same reason §5.3 reports `UNSTATED` as its own count.

A tie resolves to the **first term in the formula's order**, never to map iteration order — a distribution whose
ordering depends on how a `Map` happened to yield is a different table on a different engine, and an artifact
that changes when nothing changed is one nobody can diff.

### 6.3 What the name is, and what it is not

**It is a lead, not a verdict.** A term can hold the largest gap for two different reasons: the winner earned
more there, or the truth was penalised there. This function measures the *difference* and does not separate the
two ends — so it names where to look, and the terms themselves (both on the record) are what confirm it. The
name `dominantLostTerm` says "the largest gap", not "the cause", and the doc is the place that distinction lives.

`loss` remains the head of the per-fault-type block from §5.1 and the attribution is read against it: if the
sixteen `loss` cases and the six RE3-TT `f3` cases fail on the *same* term, that term is a weight to move; if
they fail on *different* terms, then §5's "the weakness is the fault's" becomes a statement about two mechanisms
rather than one, and the block splits further.

### 6.4 The measurement — and the answer is a single term

Run **`38119497656`** on the revision that carries the breakdown. All 735 rows; the nine cells unchanged; the
attribution computed by `dominantLostTerm` over the truth's and the winner's terms.

```
  of the 58 DEEP misses: the winner's largest per-term advantage was
      selfAnomalyLog1p 54 · trace 4
```

And over **all 159 reranking misses** (101 shallow + 58 deep), per term, with `truthMean|·|` and `winnerMean|·|`
the mean absolute contributions:

| term | truth mean | winner mean | mean gap | times the largest positive gap |
| --- | ---: | ---: | ---: | ---: |
| **`selfAnomalyLog1p`** | **0.5891** | **0.7438** | **+0.1548** | **149 of 159** |
| `log` | 0.0000 | 0.0252 | +0.0252 | 4 |
| `trace` | 0.0000 | 0.0377 | +0.0377 | 6 |
| `source`, `temporal`, `collision`, `topo`, `rise`, `prism`, `failedEdge`, `lat`, `pool` | **0.0000** | **0.0000** | 0.0000 | **0** |
| `stability` | 0.0025 | 0.0007 | −0.0019 | 0 |

Of the total positive margin across those cases, **71.5% sits in the base term and 28.5% in all twelve weighted
terms together** — and that 28.5% is carried by `log` and `trace` alone.

**The reranking loss is decided by `log1p(selfAnomaly)`.**

### 6.5 What that does NOT say, stated before what it does

**Nine terms are exactly `0.0000` on both sides of every reranking miss, and this record does not say why.** Three
different causes produce the same zero, and separating them is the next instrument's job:

1. **The weight is zero in the shipped configuration.** `prismWeight=0` is a recorded never-revert fact, so the
   `prism` term is zero *by configuration* and nothing about the corpus can be inferred from it.
2. **The input map is absent from the graph.** `topo`, `lat`, `pool`, `collision` and `rise` read OPTIONAL graph
   fields; a term whose map is empty contributes zero for every candidate, which is a fact about the GRAPH rather
   than about the fault.
3. **The value is genuinely zero for both candidates** — a real absence of evidence for that term on that case.

**A difference cannot distinguish these, and naming one of them from this table would be the defect this
repository keeps recording.** So the finding is stated at the level the data supports: *the margin is decided by
the base term, and the weighted terms carry none of it on these cases.* **Which of the three reasons makes them
zero is registered as the next instrument, not as a conclusion.**

### 6.6 What it changes, and what it does not

**It removes the only lever the previous roadmap had.** "Which weight do we move?" now has the answer: on these
159 cases, **none of them** — twelve weighted terms carry 28.5% of the margin between them and nine carry
nothing. A reweighting cannot move a case decided by a term with no weight.

**And it names the one mechanism that CAN**, which the repository already has and has never A/B'd per fault type:
`rankNormalizeScores` is ON, so `selfAnomaly` is **rank-normalized** before the base term reads it — meaning the
base term is a monotone function of each service's anomaly RANK rather than of its magnitude. Whether that is the
right ordering principle for the deep block is now a measurable question about a shipped fact rather than a
guess. The anomaly detector feeding it (`detectMADOnset` and the directional deviation it consumes) is the other.

**Two consequences already visible, and one caution.** Visible: the ablation ledger's pattern — every tool wired
as a SCORE measures negative, every numeric prior 0.0 — is exactly what a base-term-decided ranking predicts, so
that ledger is now *explained* rather than merely recorded. And PSC-GRCA locating its gain in the **prior** term
while ours contributes nothing is a difference in what the two architectures let decide a case, not a difference
in tuning. Caution: `topo` contributes `0.0000` to every miss here while the ledger measures it at
**−42.4 / −37.8 / −3.1** when enabled, and those are consistent only if `topo` moves cases that are not these —
which is a statement about which cases a term decides, and is why §6.5 refuses to call a zero an absence.
