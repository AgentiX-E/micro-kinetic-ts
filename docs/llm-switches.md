# The LLM switches: where the model can be turned off, and what each position measures

This document exists because "the product has a model in it" is not a design; "the product can be run with the model
off, and here is what changes" is. Every switch below is a **product** switch — an option on a public API or on the
runner that ships — and every position below has a measured number attached, taken from artifacts, not from intention.

There are three layers. They are independent, and a deployment that turns all three off still answers.

---

## 1. `OptimizerOptions.useLLM` — the advisor

`@agentix-e/optimize` takes an option that decides whether an `LLMAdvisor` is constructed at all:

```ts
export interface OptimizerOptions {
  // …
  readonly useLLM: boolean; // default: true
}

// optimizer.ts
this.llmAdvisor = this.options.useLLM ? new LLMAdvisor(llmOptions) : null;
```

- **`false`** — no advisor exists, no client is constructed, **no network call is possible**, and the optimiser runs
  its deterministic search. This is the position every unit and integration test runs in (`useLLM: false`), which is
  the strongest evidence the switch is real: the suite passes with the model absent.
- **`true`** — the advisor is consulted, and its suggestions are scored by the same deterministic objective as every
  other candidate. It cannot bypass the objective.

**No API key is read unless the advisor is constructed**, so the flag is also the deployment's "offline mode".

---

## 2. `--seed` / `--fallback` — what the investigation arm SHOWS and what a refusal SETTLES ON

The agentic arm (`benchmarks/src/run-query-agent.ts`) is where the model actually investigates. Two flags, and their
independence is the finding of iteration 326:

| flag         | values                                             | meaning                                                                                                                                                                |
| ------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--seed`     | `engine` \| `none`                                 | whether the prompt shows the engine's ranked order                                                                                                                     |
| `--fallback` | `seed` \| `engine` \| `none`                       | what a **refusal** (a gate that rejects an override) settles on; `seed` means "the same order the arm was shown", so a seeded arm keeps its exact historical behaviour |
| `--gate`     | `none` \| `cited` \| `cone` \| `contrast` \| `lag` | when the loop may accept the model's name over the incumbent                                                                                                           |
| `--resolve`  | `none` \| `entry-prior` \| `edge-novel`            | the deterministic rules applied to whatever answer is settled                                                                                                          |

The four configurations that matter, all measured on the 1 422-case RCABench corpus:

| position                                                   | command                                                              |                                                           Top@1 |                                                                  cost / case |
| ---------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------: | ---------------------------------------------------------------------------: |
| **model only** (no order, no fallback, no gate)            | `--seed none --fallback none --gate none --resolve none`             |                                                   41.21 % (586) | not dispatched alone — the same 6 rounds on the same cases price at ≈ ¥0.014 |
| **hybrid** (no order shown, refusals settle on the engine) | `--seed none --fallback engine --gate contrast --resolve edge-novel` |                                             **90.37 % (1 285)** |                                                           ¥0.0146 (measured) |
| **seeded** (the arm 325 shipped)                           | `--seed engine --fallback seed --gate lag --resolve edge-novel`      |                                                 89.59 % (1 274) |                                                           ¥0.0163 (measured) |
| **model off**                                              | the engine binary, no arm                                            | 88.33 % (1 256) with the two resolvers, 81.29 % (1 156) without |                                                                        ¥0.00 |

The first and the fourth rows are _re-scores of the same artifacts_: `--fallback none` is what the free arm already
executed under `gate none`, and "model off" is the engine's own answers with `applyResolver` applied to them. Only the
two middle rows were dispatched as configurations, and only they carry a measured price.

**The row to read twice is the first one.** The model, alone, is forty points _below_ the engine. It is not carrying
this product; it contributes **29 cases** over the deterministic floor, and the two resolvers contribute **100**.

### Production guidance

- **`--fallback engine` is the only position that should be deployed with a model available.** A surface that shows
  nothing and settles on nothing is strictly worse than the engine it replaced — that is the 41.21 % row, and it is
  the answer to "why did opening the LLM score below the non-LLM engine".
- **`--seed engine` remains the reference arm** for reproducing every number published before 326, byte for byte.
- **`--gate` is an enforcement, not a preference**: a gate the loop enforces must be a gate the prompt states, which is
  why the prompt is given the incumbent and not the seed.

---

## 3. The dispatch surface — the same switches, reachable from the UI

`.github/workflows/benchmark-agentic.yml` carries each flag as an input, and a workflow input the runner does not
forward is an ablation nobody can run, so `benchmarks/__tests__/agentic-workflow-wiring.test.ts` pins both directions:

| workflow input       | forwarded as   | values                                                              |
| -------------------- | -------------- | ------------------------------------------------------------------- |
| `query_seed`         | `--seed`       | `engine` \| `none`                                                  |
| `query_fallback`     | `--fallback`   | `seed` \| `engine` \| `none`                                        |
| `query_gate`         | `--gate`       | `none` \| `cited` \| `cone` \| `contrast` \| `lag`                  |
| `query_resolve`      | `--resolve`    | `none` \| `entry-prior` \| `edge-novel`                             |
| `query_agent_sample` | `--sample`     | per-stratum case count; **empty means the arm does not run at all** |
| `query_max_rounds`   | `--max-rounds` | rounds per case (default 6)                                         |

An empty input is never forwarded: the runner's own default is the single owner of the configuration, so a dispatch
that says nothing measures the surface every earlier reading measured.

---

## 4. What is _not_ a switch, and why

- **The engine.** There is no flag that makes the deterministic localiser use the model. The direction of the
  dependency is fixed by the design: the model may only _refine_ the engine's answer, and the gate decides whether it
  may. `--fallback engine` is what makes that a property of the product rather than a claim in a paper.
- **The answer's channel.** Every column the resolvers read (`failed`/`baseline` per interface, the entry, the novel
  request shape) is computed from telemetry, never from the model's text.
- **Cost.** There is no "cheap mode": the arm's price is a function of rounds × candidates, and the only lever that
  does not change the answer is `query_agent_sample`, which changes the _population_, not the configuration.
