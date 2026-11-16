# Measurement integrity — a cell is measured or it is not

> A rate over zero cases is not a rate of zero. This document records the run that published one, the two
> populations that tell them apart, and the probe that refuses to start a run whose provider cannot answer.

## 1. The incident

Run `43901259774` (`Benchmark — RCAEval Full Dataset`, head `73dc662`) reached the RE3 cells with a Zhipu account
whose balance was exhausted. Every alignment call answered the same thing:

```
│  [30x, 100%] Embedding API error 429 (retries exhausted): {"error":{"code
│  re3ob_adservice_f3_1: Embedding API error 429 (retries exhausted): {"error":{"code":"1113",
│      "message":"Insufficient balance or no resource package. Please recharge."}}
```

All thirty cases of each RE3 cell failed to load on it, and the run reported:

```
┌── Load Errors: OnlineBoutique/RE3 (30 total)
  [semantic] 0/0 services resolved (0.0%) — embedding=0, llm=0, exact=0
...
║ Micro-Kinetic       | AC@1   |   0.0% ║
║ Micro-Kinetic       | Avg@5  |   0.0% ║
║ Micro-Kinetic       | LA     |   0.0% ║
║ Micro-Kinetic       | TA     |   0.0% ║
...
Loss census — retrieval vs reranking (0 cases -> rcaeval-loss-census-re3.jsonl)
no cases found: nothing to census, and saying so beats printing a zero.
```

Three separate things went wrong, and only the third is about the provider.

1. **The guard asked the wrong question.** `if (stats.considered === 0) { … continue; }` — and `considered` counts
   the cases the loader was **asked for**, not the cases that reached the scorer. It was thirty. The guard that
   existed to stop an empty cell from being reported is the guard that let it be.
2. **The metric row turned an empty population into a zero.** `buildMetricRows` computed
   `average = present.length === 0 ? 0 : …`, so four rows rendered `0.0 %` over a denominator that did not exist.
   The table is the artifact; a reader who stops at it reads a catastrophic measurement.
3. **The provider was discovered to be unavailable fourteen minutes in**, one swallowed exception per case, with no
   exit code, so the workflow went green.

The loss census in the same run got it right — *"nothing to census, and saying so beats printing a zero"* — which
is the standard the rest of the artifact already met. This document is about bringing the rate up to it.

## 2. Two populations, one rate

| name | who counts it | what it answers |
| --- | --- | --- |
| `requested` | the loader's `considered`, summed over memory slices | which cases the dispatch asked for |
| `evaluated` | `Σ RunResult.totalCases` over the cell's fault types | which cases the scorer produced a verdict for |

Only the second is a denominator. `benchmarks/src/cell-population.ts` owns the decision, in one place, so the four
states cannot be conflated by a later edit at the call site:

| `requested` | `evaluated` | verdict | what a reader should do |
| --- | --- | --- | --- |
| 0 | 0 | unmeasured — nothing selected | change the dispatch |
| > 0 | 0, with load errors | unmeasured — corpus or provider failure | restore the provider |
| > 0 | 0, no load errors | unmeasured — silent drop | this is a bug in the loader |
| > 0 | ≥ 1 | measured | read the rate against `evaluated` |

`evaluated > requested` throws. A coverage line over that pair would print a rate above 100 %, and there is no
reading of the artifact in which that is a measurement.

**Partial coverage is not the defect.** A cell at 28 of 30 is a real rate over a stated population, so it still
prints — with a coverage line beside the table:

```
  coverage: 28/30 cases reached the scorer (93.3%) — the rate below is over the 28
```

The line sits beside the table rather than only in the load-error block because a cell at 28 of 30 and one at 30
of 30 print the same format, and only this line tells them apart.

**An unmeasured cell prints no rate at all:**

```
  UNMEASURED: OnlineBoutique/RE3
  requested 30 | evaluated 0
  reason: 0 of 30 cases reached the scorer; the dominant load error (30×) was: Embedding API error 429 …
  no rate is printed: this cell supplied no cases for one to be computed over
```

and the run exits **3** (1 is what an exception returns; "the measurement could not be taken" is a different
event) with a summary listing every cell that produced no rate.

`RCAEvalMetricRow.average` is `number | null` for the same reason, and the printer renders `N/A`. The type is
where the absence is made unrepresentable as a rate: a printer that wants to publish one now has to say what it
means. The unit test that asserted `average === 0` for an empty table asserted the defect, and was rewritten with
it.

## 3. The provider is probed before the corpus walk

`benchmarks/src/semantic-preflight.ts`. `run-rcaeval.ts` resolves the semantic config, probes it, and only then
composes the configuration line and discovers the corpus.

- The probe is one small batch (two texts) and requires **one vector per text**. "The call did not throw" is not
  the question: `ApiEmbeddingProvider.embed([])` returns `{ vectors: [] }` without a request, and a mis-parsing
  provider can do the same, so a provider that answers without embedding anything would otherwise pass.
- A provider whose `meta.backend` is not `'api'` is not probed. The in-process TF-IDF provider cannot lose a third
  party's balance, and probing it would only add a way for a run to fail.
- On refusal, one of two things happens, and both are declared:

| `BENCHMARK_EMBEDDING_FALLBACK` | behaviour |
| --- | --- |
| unset / `abort` (default) | throw before any case is read, naming the provider, the reason, and the way out. Exit 1. |
| `local` | substitute `TfIdfEmbeddingProvider`, print a `DEGRADED` banner, and change the configuration line |

An unrecognised value is **refused**, not defaulted — the policy decides whether a run measures the published
configuration, so a typo must not silently select either arm.

The substitution is never implicit, and it is recorded where the artifact can see it: the configuration string
(`diagnose_dump`'s header carries it verbatim) gained a third line.

```
signals: …
corpus: latencyView=whole-file
topology: yaml-v2 + semantic(api)
```

```
topology: yaml-v2 + semantic(tfidf) DEGRADED from api-embedding:embedding-3 to TF-IDF: Embedding API error 429 …
```

**Why the topology line belongs on the configuration line at all.** The aligner adds edges for every service the
YAML registry does not name, those edges are ranking input, and a TF-IDF-embedded run and an `embedding-3`-embedded
run are not the same experiment — while before this line existed their artifacts were identical in every field a
reader could see. The same rule `corpus:` already follows.

**Scope of the anchor digest, stated rather than assumed.** `configDigest` hashes the `signals:` line, by its
definition in `cell-baseline.ts`. Adding `topology:` therefore does **not** roll `617935621cbc`, and that is
correct for what the digest claims to name — the engine's arguments. What the digest does not cover is printed
verbatim in the same artifact, and a degraded run also prints a banner above every number it produces. The narrow
hole that remains: a digest-keyed comparison cannot tell a degraded artifact from an API-embedded one by digest
alone. Nothing in the golden half compares by digest; the run's own banner and topology line are the attribution,
and a baseline should not be recorded from a degraded run.

## 4. What this does not fix

**The quota.** Restoring the Zhipu balance is the only thing that restores an API-embedded nine-cell reading. Until
then the RCAEval workflow fails at the probe within about a minute instead of producing fourteen minutes of
corrupted readings, and that failure is the honest state — the alternative is a green run publishing a
substitute's numbers under the anchor's name.

**The dependency itself.** A benchmark whose measurement can be switched off by a supplier's billing state is not
reproducible by a reader, whoever they are. The permanent fix is a **cached embedding provider** — a decorator over
`IEmbeddingProvider` that serves vectors from a committed table keyed by `(modelId, text-hash)` and delegates a
miss to the inner provider. It is cheap here because the embedded population is finite and small: the aligner
embeds service ids and descriptor queries, a few hundred distinct strings per system, not free text. Committing the
vectors makes every run byte-identical to an API run with no network at all, which is also what an external
reviewer needs. It needs one successful run to populate, so it is the next iteration that follows a recharge rather
than a substitute for one.

## 5. Reproducing the readings

```bash
# The verdict logic and the probe, in isolation (no network, no corpus).
pnpm vitest run benchmarks/__tests__/cell-population.test.ts \
                benchmarks/__tests__/semantic-preflight.test.ts \
                benchmarks/__tests__/cell-measurement-wiring.test.ts

# The runner's wiring, as text: the guard that asked `considered`, the table printed after the block, the
# single `createSemanticConfig()` call, and the topology line inside `configuration`.
pnpm vitest run benchmarks/__tests__/cell-measurement-wiring.test.ts

# A degraded local run, declared:
BENCHMARK_EMBEDDING_FALLBACK=local pnpm tsx benchmarks/src/run-rcaeval.ts --system onlineboutique --suite re3
```
