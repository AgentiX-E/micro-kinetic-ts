# Corpus assembly — one corpus, four assemblers, and the flag that hid it

**Status:** defect found, repaired and fenced. The study and the weight search now rank on **the corpus the
published cells rank on**.

## 1. The defect

An RCAEval case's corpus is not just its metrics. It is the metrics, a call graph **augmented from the case's
own observed spans**, the two direction-carrying inputs, and — on RE3 — the per-service span-activity counts.
Four files assembled it, and **they did not agree**:

| path | augmentation | `failedTraceEdges` | `edgeLatency` |
| --- | --- | --- | --- |
| `run-rcaeval.ts` — **the published cells** | `{ minCallFrequency: 1 }` | streaming pass over `traces.csv` | the capped span list |
| `run-ablation.ts` — **the contribution ledger** | **none at all** | streaming pass | streaming pass |
| `run-optimize.ts` — **the weight search** | `{ minCallFrequency: 1 }` | **the capped span list** | the capped span list |
| `run-fse26.ts` | none (no spans exist on that half) | the FSE'26 loader's own | the FSE'26 loader's own |

So the published cells ranked on the **pruned** graph, the ledger on the **unpruned** one, and the weight search
on a graph whose failed-edge input was a **truncation** of the shipped one. The size of the step two of the
three were missing is recorded by the golden's own artifact:

```
[trace] 50/50 cases with traces, 50 pruned, avg edges: 20 → 9 (55% reduction)     RE2 OnlineBoutique
[trace] 50/50 cases with traces, 50 pruned, avg edges: 218 → 39 (82% reduction)   RE2 TrainTicket
[trace] 30/30 cases with traces, 30 pruned, avg edges: 23 → 9 (61% reduction)     RE3 OnlineBoutique
[trace] 30/30 cases with traces, 30 pruned, avg edges: 218 → 41 (81% reduction)   RE3 TrainTicket
```

RE1 carries no traces and records none — which is why it was the one suite where all four agreed.

## 2. The measured cost — and why the size is not the point

Against the frozen artifacts of run `37785902886`, the augmented and un-augmented corpora differ on
**one cell of fourteen**: RE2 TrainTicket, **+1.8pp in the unpruned direction** (the study read 69.9% where the
golden reads 68.1%), with the other thirteen identical per fault type. The unpruned graph is very slightly
*better* on a cell.

That is small, and it is beside the point. The point is that **which graph a run ranks on was a property of
which runner was invoked.** A ledger whose baseline is a different corpus from the published one cannot be
compared with the published one, and a weight search whose corpus is a truncation of the shipped corpus
searches for the optimum of a different problem. This is the register's law in its fourth appearance —
*a quantity with N implementations is a quantity with no convention* — after `toFaultGraphOptions` (the engine
inputs), the configuration line, and `suite-accuracy` (the fold).

## 3. The repair

`benchmarks/src/rcaeval-corpus.ts` owns `assembleRCAEvalCase(loader, rawCase, meta, callGraph, suiteName,
options)`, and all three RCAEval paths call it with `augmentFromTraces: true`. Graph *construction* stays with
the caller, because the paths configure it differently (the golden can use semantic/embedding enhancement, the
ablation cannot) — what is owned here is everything applied **to** the graph.

**The composition is reproduced exactly, including one asymmetry that is deliberate rather than an oversight.**
`edgeLatency` comes from the case's own loaded span list, which is capped (`loadTraces`'s 10 000 spans);
`failedTraceEdges` comes from a separate streaming pass over `traces.csv` that reads the whole file. The
shipped `latWeight = 0.561495` multiplies the *capped* one, so **a repair that unified the two derivations
would move a published number.** The owner therefore re-derives only the second field, and says so in a
comment, and the fence asserts that it does.

The shipped augmentation's options are a value rather than two omitted arguments:
`SHIPPED_TRACE_AUGMENTATION = { minCallFrequency: 1 }`, which is also `TraceTopologyConfig`'s own default — so
naming it makes the shipped corpus a constant instead of an accident.

## 4. The flag that hid it

`AblationFeatureFlags.traceAugmentation` was named for the **shipped** step while its arm was a **different**
one: it passed `{ minCallFrequency: 0, discoverNewEdges: false, pruneUnobserved: true }` to the runner, on top
of a corpus that had no augmentation at all. Its rows measure:

| row | RE1 | RE2 | RE3 |
| --- | ---: | ---: | ---: |
| `+Trace Topo` | 80.3 (Δ+0.0) | 80.4 (Δ+0.0) | 40.6 (Δ+0.0) |

**`+0.0` on RE2 and RE3 — the only two suites that have traces.** A mechanism that reports no change on the
only population where it could act is either starved or not wired, and this one is the register's own named
failure in its purest form: *an input that does not arrive reports "no change", and "no change" reads as a
measured result.*

It is renamed **`extraTraceValidation`**, which is what it is — a second, stricter validation pass applied by
the runner on top of the corpus. The name was the defect: a flag advertising the shipped step is what made a
run with "trace augmentation ON" and a run with it OFF both able to be missing the shipped step entirely, for
three iterations, without anything failing. No census keyed on it, so no exact set changed.

## 5. The paths that legitimately do not use it

Named as an **exact set** in `benchmarks/__tests__/corpus-assembly.test.ts`, so it cannot grow silently:

- **`run-fse26.ts`** — a different loader and a different case format (`case.json`), with no span data at all.
  The FSE'26 half has never had a trace-topology step to share, **which is itself the reason its corpus must be
  re-checked before any augmentation is enrolled there**: the two halves of the kill criterion do not construct
  their corpora the same way, and that is now recorded rather than assumed.
- **`run-local-bench.ts`** — synthetic cases from `generateCase`; there are no traces, so there is nothing to
  assemble.

## 6. Fences and acceptance

`benchmarks/__tests__/corpus-assembly.test.ts` (6 tests) asserts the **absence** of any other
`toBenchmarkCase(case, graph, suite)` or `augmentTopologyWithTraces(` call under `benchmarks/src`, the exact
outside set, all three assemblers' `augmentFromTraces: true`, the single statement of the shipped options, and
that the owner reads **no feature flag**. Written as an absence, it is what found `run-optimize.ts`'s third
composition — a path I did not know was a third one until the fence named it.

**Acceptance:** the nine cells byte-identical (the golden path's corpus is unchanged, and its composition is
reproduced step by step), and — the measurement this repair is *for* — the study's production rows reproduce
the golden on **all fourteen** cells rather than thirteen, with RE2 TrainTicket moving 69.9 → 68.1.
