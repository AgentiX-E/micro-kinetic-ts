# The agentic layer: two roles, four flags, and a cost model that does not spend scope

Iteration 266. The layer this document specifies is the one `0d6ae609` removed — rebuilt with a different shape,
measured on a different population, and gated rather than shipped.

## 0. Why it is being rebuilt, in the register's own words

`closed-axes-register.md:145` records the retirement of `RerankingEngine` and `InvestigatorEngine` and then states
the condition under which either may return:

> a reopening needs the presentation to change, not the weight

That sentence is also a diagnosis of iteration 265. Two consecutive iterations spent their whole budget on
`faultFreeWeight` — a weight. The closed axis was not reopened; it was walked past again.

Three things differ from the retired attempt, and each is a reason the earlier verdict cannot be transferred:

| dimension    | `0d6ae609` measured                                     | this layer                                                     |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------------- |
| population   | RE3:TrainTicket's three error-value families, ~30 cases | **RCABench / FSE'26, all 1 422** plus the nine RCAEval cells   |
| shape        | ReAct walking an evidence dump with a retrieval toolkit | a **typed elimination claim** the engine can verify, not prose |
| presentation | unchanged                                               | changed: the agent sees a **fingerprint**, never a dump        |

## 1. Two roles, and why both exist

The 2026 literature reports a result that decides the architecture rather than decorating it. `arXiv:2608.21310`
(§V-A, Finding 1) finds that **none of the top agents was built for RCA, yet every agent built for it trails
them**: open-ended frameworks reach 79.2 / 79.6 / 77.6 %, while purpose-built ones sit at 65.2 / 46.6 / 42.6 %.
It also finds the **backbone model is the dominant lever** — Sonnet leads Qwen by 10.8 pp on the same framework,
five times the 2.0 pp that separates the whole top band.

Read together those two findings say the same thing from opposite sides: _what the agent is allowed to decide_
matters more than _how cleverly it reasons_, and the ceiling is set by the model only where free-form judgement is
required. So the layer ships two roles, and they are deliberately not the same component wearing two prompt:

- **`eliminator`** — the engine ranks first. The agent receives the top-K posterior and may only **remove** or
  **promote** a candidate by producing a claim the engine then verifies against the same arrays it ranked on. Its
  judgement is a numeric comparison, so a weak model suffices and a wrong claim is caught rather than trusted.
  This is the `No LLM in the signal path` structure of `soul-bits/rca-agent` (Zenodo 19720128).
- **`investigator`** — the agent decides what to look at, in what order, and when to stop. This is the shape that
  reaches 90 %, and it is the shape that costs $0.2/case.

**Both are built** because the axis that separates them — _anchored to the engine's posterior_ vs _free_ — has no
non-LLM control in any published table. Building only one would answer "is this better" without answering "why".

## 2. Four flags, and what each one is a function of

| flag               | type                                    | default                         | what it selects                                     |
| ------------------ | --------------------------------------- | ------------------------------- | --------------------------------------------------- |
| `--agentic-mode`   | `off` \| `eliminator` \| `investigator` | `off`                           | which role runs at all                              |
| `--agentic-weight` | number                                  | `0`                             | how far a **verified** claim may move the posterior |
| `--agentic-budget` | `<rounds,tokens,usd>`                   | `3,9000,0.01` / `12,60000,0.05` | the three gates; first hit stops the loop           |
| `--agentic-model`  | provider string                         | `deepseek`                      | routed through `ILLMProvider`, never a vendor SDK   |

`weight = 0` is not "the layer runs and is ignored" — it is **the layer does not run**: `buildTerm` is never
called, no cache is opened, and an integration test asserts the ranking is bit-identical to the engine that has no
agentic code at all. This is the same contract `faultFreeWeight` carries, for the same reason.

`mode` and `weight` are separate because they answer different questions. Collapsing them would make "the agent
was wrong" indistinguishable from "the agent was right but under-weighted", and the first ablation table this
layer has to produce is exactly that distinction.

## 3. What the agent is allowed to see, and why it is a fingerprint

The retired `InvestigatorEngine` handed the model an evidence dump. On the RCABench cases that is 37 thousand to
5.6 million telemetry rows; the top-band agents in `arXiv:2608.21310` spend **1 500+ ktok** and 45–54 rounds
reaching 79 %ish. Almost all of that budget is re-reading what a deterministic scan already summarised.

So the input is a fingerprint, built by the engine:

```
Candidate#1  ts-auth-service
  ch  cpu            pre 0.11  post 0.19  band [0.09,0.14]  rate 0.00   <- outside the fault-free band
  ch  latency_p99    pre 12.4  post 91.0  band [11.0,14.2]  rate 0.33   <- outside, and it fires in 1/3 clean windows
  ch  error          pre 0.00  post 0.00  band [0.00,0.00]  rate 0.00   <- constant, no evidence either way
Candidate#2  ts-order-service
  ...
onset: ts-auth-service t0+3s  ->  ts-order-service t0+11s        (topoPrecedence fires)
```

Two properties matter and both are testable:

1. **It is bounded.** K ≤ 5 candidates × ≤ 8 channels × 5 numbers ≈ 1 600 tokens, against 1 500 000. That is the
   single largest cost term in the whole design, and it is bought by _summarising deterministically first_ — which
   this engine already does better than any of the published agents.
2. **Every number in it is re-derivable.** A claim that cites `rate 0.33` is checked against the profile artifact
   from iteration 265; a claim that cites a channel outside the fingerprint is **rejected as unsupported**, which
   is the `unsupported reasoning` failure family the same paper names.

The fault-free band earns a second purpose here. In iteration 265 it was a ranking slope that moved nothing; as a
_fingerprint column_ it tells the model which channels are evidence and which are noise, which is the difference
between `omitted evidence` and `misinterpreted evidence` — the two dominant failure families in the trajectory
study.

## 4. The claim type

```ts
export interface EliminationClaim {
  readonly remove: ServiceId;
  readonly keep: ServiceId;
  readonly because: {
    readonly channel: string;
    readonly statistic: 'post' | 'delta' | 'onset';
    readonly observed: number;
    readonly band: readonly [number, number];
  };
}
```

`observed` and `band` are checked against the fingerprint before the claim is applied. A claim that fails
verification is **counted and discarded**, not clamped — the count is a reported quantity, because a layer whose
claims are 60 % unverifiable is a layer whose accuracy number means nothing.

Prose is never the output. The retired engine's failure mode was `9 of 16 conclusions still answer the symptom` —
a natural-language conclusion cannot be checked, so it could not be wrong in a way anyone could see.

## 5. The cost model

The user's constraint is that cost falls **without dropping a single case from the scope**. Three structural
changes do that; none of them is truncation.

| term                  | retired / top-band    | this design                                  | factor   |
| --------------------- | --------------------- | -------------------------------------------- | -------- |
| input per case        | 1 500 ktok (raw dump) | ~9 ktok (fingerprint, 3 rounds)              | **166×** |
| rounds per case       | 45–54                 | 3 (eliminator) / 12 (investigator)           | **15×**  |
| model                 | Sonnet-class          | DeepSeek-class for eliminator                | **~10×** |
| cases actually called | all                   | ~50 % skipped by a deterministic margin rule | **2×**   |

Worked, at DeepSeek list prices ($0.27/M in, $1.10/M out):

| arm                         | per case | 1 422 cases | note                                                    |
| --------------------------- | -------: | ----------: | ------------------------------------------------------- |
| top-band agent as published |    $0.20 |    **$284** | 45–54 rounds, 1 500 ktok                                |
| `eliminator`, no skip       |  $0.0038 |    **$5.3** | 3 rounds × 9 ktok                                       |
| `eliminator`, with skip     |  $0.0038 |    **$2.7** | ~50 % of cases resolve on margin                        |
| `investigator`              |   $0.017 |   **$24.7** | 12 rounds; needs a stronger model, so ~$50–70 realistic |

The eliminator's 74× is **not** bought by using a weaker model on the same task. It is bought by making the task
smaller than a model's judgement: comparing two numbers against a band is not a reasoning problem, and the answer
is verified either way. The investigator cannot be made cheap by the same trick, which is why it is the expensive
arm and why it runs second.

Two free arms sit underneath:

- ~~the **skip rule** is deterministic — `top1_margin > θ ∧ top1 anomalous channels ≥ 3`~~ — **refused, iteration
  267.** Measured on 711 RCABench cases it skips **710 of 711**, and the cases it skips include **117 of the 118**
  a perfect eliminator could fix. The reason is mechanical and reverses the rule's premise: a fixable case is one
  where a *symptom* outranks the source confidently, so a wide margin and many deviating channels are evidence
  **for** consultation, not against it. `docs/agentic-headroom.md` §4 carries the grid; the honest spend is the
  full corpus, $5.3, not $2.7;
- the **cache** (record/replay) means every weight/mode/budget ablation after the first costs **$0**. The 500-case
  arm and the full-1422 arm then differ in _replay_, not in spend. Iteration 267's offline harness
  (`benchmarks/src/agentic-headroom.ts`, `arm: 'recorded'`) is the scoring side of that cache: it takes claims
  keyed by case id and reports accuracy, refusals, moves and the skip census without calling a model.

## 6. Sampling that holds the scope

500 cases is not a truncation if the strata are the population's own. The plan stratifies on **fault family ×
engine correctness × causal-chain depth** (1–5, the axis `arXiv:2608.21310` shows accuracy collapsing along), with
proportional allocation and a floor of 3 per non-empty stratum. Two consequences are asserted by test rather than
claimed:

- every fault family present in the 1 422-case corpus is present in the 500;
- the per-stratum proportions are within one case of the corpus proportions.

The published 90.0 % rests on a **500-case random sample**; a stratified 500 of the same size is strictly more
informative, so the comparison is like-for-like on n and better on design.

**Order of arms, and it is fixed in advance:**

1. nine cells (735 cases) + RE3:TT/SS — no spend, replays the `0d6ae609` population under the new presentation;
2. the stratified 500 of RCABench — ≈$2.7, paired, with the pre-registered detection floor of **2.8 pp** at n=500;
3. full 1 422 — only if (2) clears its floor with a CI that does not cross zero.

**Arms 0, added in iteration 267, and they ran first because they cost nothing:**

0a. **the ceiling.** A perfect eliminator that may only remove candidates by a verifiable claim reaches
    **87.69 %** on all **1 422** RCABench cases against the engine's **75.50 %** — **+12.19 pp**, 174 cases, zero
    refused claims (`docs/agentic-headroom.md` §9, run `43253302440`). The first reading was over the `waveB2` half
    and said **+16.63 pp** (`84.70 %` vs `68.07 %` on 711); the full corpus corrects that by 4.4 pp and this row now
    quotes the full-width number. The ceiling equals Top@5 to within one case (87.69 % vs a saturated 87.8 %), so no
    layer can beat 87.8 % without the *ranking* improving first;
0b. **the evidence rule**, refused: −0.6 pp held out at its best thresholds, −21.8 pp at its most permissive. The
    expected-outlier rate survives as a **fingerprint column** — it is what makes 0a's claims checkable — and dies
    as a **decider** (`docs/agentic-headroom.md` §5);
0c. **the skip rule**, refused (above).

## 7. Dependency layering, and the cycle that killed the first attempt

```
core  ←  tree (pruner; owns the fingerprint builder)
              ↑
              │  read-only view types only — `ai` must NOT import `tree`
             ai (agent: pure, zero IO)
              ↑
        benchmarks (gate, cache, sampling, reporting)
```

`packages/ai` depends on `core` alone. It receives a `CandidateFingerprint` **value**, never a `FaultGraph`. The
retired attempt let `ai` reach into the graph, which is why removing it also removed `packages/ai`'s ability to be
tested without a pruner. A test asserts the import direction.

**Amended in iteration 267: the builder is in `benchmarks`, not in `tree`.** The diagram above put the fingerprint
builder in `tree`, and that sentence was wrong for a dependency reason rather than a stylistic one. The builder
joins three artifacts — the case's `MetricMap`, the engine's posterior and the corpus profile — and its output type
belongs to `packages/ai`. Building it in `tree` would force `tree` to import the `ai` value type or to duplicate it,
and `ai` importing `tree` is exactly what the diagram forbids; a duplicated interface would be the defect this
repository refuses by name. `benchmarks` already depends on both packages, so the join happens there
(`benchmarks/src/agentic-fingerprint.ts`), the import direction the diagram states is still asserted, and `tree`
exposes only the two primitives the join must not re-implement: `injectionSplitIndex` and `medianOfRange`.

## 8. What this layer may NOT do

1. It may not see ground truth. Truth isolation is a type-level boundary plus a test, not a prompt instruction.
2. It may not emit a conclusion in prose. Only `EliminationClaim`, or `abstain`.
3. It may not exceed its budget. A gate hit returns the engine's answer — **fallback, never failure**.
4. It may not run by default. `--agentic-mode off` is the shipped configuration and the anchor.
5. It may not be trusted when unverified. Unverifiable claims are counted and reported beside accuracy.

## 9. Acceptance

| #   | requirement                                                      | how it is checked                               |
| --- | ---------------------------------------------------------------- | ----------------------------------------------- |
| 1   | `weight=0` is bit-identical to the engine without the layer      | asserted twice: `agentic-headroom.test.ts` scores `oracle` at weight 0 and requires `moved = 0` with the engine's own Top@1, and each run's own fingerprint dump reproduces the published control digit for digit (75.50 % over 1 422, `docs/agentic-headroom.md` §9). The nine-cell half is still owed |
| 2   | no case leaves the scope at any arm                              | stratum-coverage test (§6)                      |
| 3   | per-case cost is reported with the score                         | `reported-config` gains the three budget fields |
| 4   | the layer's net contribution clears its pre-registered floor     | paired per-case verdicts, CI not crossing zero. **The floor now has a denominator, measured on the full corpus**: the ceiling is +12.19 pp, so an arm that captures a tenth of it clears 2.8 pp at n=500 and one that captures a third clears it easily |
| 5   | RE3:TT error-value class converts, or the layer is refused again | wrong→correct > 0, 3 of 3 reps                  |

Requirement 5 is the one `0d6ae609` failed, and it is kept **unchanged on purpose**: the point of changing the
presentation is to find out whether that specific class was a presentation problem or a real ceiling. If it fails
again under a new presentation, the answer is the second one and the axis closes for good.
