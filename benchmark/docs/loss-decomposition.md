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
