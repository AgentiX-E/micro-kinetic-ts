# The three evidence-handling families, as predicates over this engine

**Iteration 243.** Pre-registration: `PREREGISTRATION_2026-11-07e_evidence-audit.md`, written before the module
existed. Instrument: `packages/tree/src/audit/evidence-audit.ts`; census:
`benchmarks/src/evidence-audit-census.ts`.

## 1. Why this instrument, and what it is not

`arXiv:2608.21310` analyses 3 500 RCA-agent trajectories and reports that endpoint correctness hides broken
diagnoses. Its transferable contribution is a **taxonomy**, not a framework:

> failures arise when decisive evidence is **omitted**, retrieved evidence is **misinterpreted**, or
> **unsupported inference** substitutes for missing evidence.

Operationalised as `DiagGuard`, the taxonomy lifts `Acc@1` by `+9.0` on a held-out model, benchmark and topology,
near-additively (`+4.5` grounding, `+4.1` verification), with gains on all nine fault types and **lower** cost per
incident than the grounding stage alone. Those are the numbers that make the taxonomy worth reading as a
mechanism.

This engine takes no actions — it is one deterministic pass — so a literal transcription of "the agent reached
the service but left its metrics uninspected" would be a metaphor. Each predicate below relocates the family's
content onto the artifact standing in the same relation, and each is decidable from `metricDiagnostics` and
`ScoreTerm` alone, with **no ground truth**:

| family           | predicate                                                                                | what a hit means                                                      |
| ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `omitted`        | the service has ≥ 1 `kept` channel but its id is absent from the ranking                 | measured, then not handed to the formula                              |
| `misinterpreted` | the DOMINANT channel has `dropRatio > riseRatio` while the `rise` term contributed `> 0` | the paid direction contradicts the channel's own window shape         |
| `unsupported`    | the top-1 has no `kept` channel while `selfAnomalyLog1p` contributed `> 0`               | the winning answer's self-evidence is a rank share, not a measurement |

## 2. The readings — and two of the three fail the pre-registered criterion

Nine cells, shipped configuration, `--data-dir /root/RCAEval-all`. Every number below comes from ONE code
version; an earlier run mixed two and was discarded (see §5).

| cell               | cases |        `omitted` | `misinterpreted` | `unsupported` | on truth | truth dropped **and** missed |
| ------------------ | ----: | ---------------: | ---------------: | ------------: | -------: | ---------------------------: |
| RE1:OnlineBoutique |   125 |      61 (48.8 %) |                0 |             0 |        0 |                            0 |
| RE1:SockShop       |   120 | **105 (87.5 %)** |                0 |             0 |        2 |                        **2** |
| RE1:TrainTicket    |   123 |        1 (0.8 %) |                0 |             0 |        0 |                            0 |
| RE2:OnlineBoutique |    87 |      41 (47.1 %) |                0 |             0 |        3 |                        **3** |
| RE2:SockShop       |    90 |      68 (75.6 %) |                0 |             0 |        1 |                        **1** |
| RE2:TrainTicket    |     — |                — |                — |             — |        — |                            — |
| RE3:OnlineBoutique |    28 |      11 (39.3 %) |                0 |             0 |        0 |                            0 |
| RE3:SockShop       |    30 |      18 (60.0 %) |                0 |             0 |        0 |                            0 |
| RE3:TrainTicket    |    30 |        0 (0.0 %) |                0 | **1 (3.3 %)** |        0 |                            0 |

The pre-registration named two ways this instrument could fail, and **both fired**:

1. **`omitted` hits on ≥ 50 % of cases in three cells** (RE1:SS 87.5 %, RE2:SS 75.6 %, RE3:SS 60.0 %), which the
   criterion said would mean the predicate restates "the engine ran" rather than naming a defect. It does: what
   it counts is the **topology discount doing its job**. `topoDiscount = 1` computes
   `anomaly'(v) = max(0, anomaly(v) − explained(v))`, so a service whose anomaly a callee accounts for in full
   reads exactly 0 and leaves the pool — absent from the ranking, not last in it. That is the design
   `docs/topo-discount-scope.md` §7.4 records, and the predicate cannot tell it apart from a floor defect.
2. **`misinterpreted` is unreachable in every cell**, and the reason is structural rather than data-side:
   `DEFAULT_RISE_WEIGHT = 0.0`. The `rise` term is opt-in, so "paid as a rise" has no referent in the shipped
   configuration. **The predicate was anchored on a switched-off term** — a defect in the instrument that the
   pre-registration did not foresee.

`unsupported` is rare but not vacuous: one case on RE3:TrainTicket (3.3 %), which is the only cell where a top-1
carried no admitted channel.

## 3. The one reading that survived, and the identity behind it

`omitted` is useless as a rate and **sharp as a subset**. Restricted to the case's own answer it names six cases
across 633, and the right-hand column is then not a count but an identity:

> **every one of the six was answered wrong.** `on truth` = 2, 3, 1 on RE1:SS, RE2:OB, RE2:SS; `truth dropped and
missed` = 2, 3, 1.

That is not a correlation. On a single-label corpus `AC@1` is exactly `top-1 == truth`, so a truth that left the
pool **cannot** be answered — the two facts are read from the same record that produced the finding. The six are
therefore six cases the engine got wrong for a reason it can name, and the mechanism is one line:

```text
selfScore(v) = max(0, anomaly(v) − topoDiscount × explained(v))     and     pool = {v : selfScore(v) > 0}
```

A service measured as anomalous, whose anomaly is fully attributed to a callee, is **removed** from the
candidate set. For five of the six that is the discount working as designed on the wrong service; the sixth
(RE2:SockShop) is the same shape. This is the first time that cost has been counted rather than argued, and six
cases is small enough to inspect individually — which is what makes it actionable.

## 4. The finding that matters more than any rate

`misinterpreted` being unreachable is not a null result. It says something about the SHIPPED configuration:

| term that expresses a direction | shipped weight |
| ------------------------------- | -------------: |
| `rise` (tail-vs-head direction) |          **0** |
| `topo` (upstream-vs-downstream) |          **0** |
| `collision` (source shape)      |          **0** |
| `prism` (victim mask)           |          **0** |

**The engine has no directional judgement in the score at all.** Every term that could say "this fell" or "this
rose" or "this is upstream" ships at weight 0, so evidence direction is measured and then discarded. DiagGuard's
middle family has no object here for exactly that reason — not because this engine never misreads, but because
**it never reads direction in the first place**.

That reframes the gap to the agentic class. The 18–29 pp §2c attributes to "evidence navigation" may be less
about querying more and more about **using the direction of what is already retrieved** — which is a term this
engine can compute for free and currently multiplies by zero.

## 5. Engineering record

- **18 + 7 tests**, all green; the two branches the census needs (a finding, a withheld finding, an unauditable
  case) are asserted by name rather than trusted.
- **A mixed-version run was discarded.** The first nine-cell pass began before the cross-count existed, so
  `RE1:SockShop` printed `on truth 2` with no `missed` column — a combination the current code cannot produce.
  Every number in §2 comes from one re-run on one version. Recorded rather than silently replaced, because the
  error was in the measurement, not in the code.
- **`RE2:TrainTicket` did not produce a reading** in either pass: the process was killed with `SIGKILL` (exit 137) after 15 minutes — a local memory ceiling on the corpus's largest graph, not a result and not a code path.
  It is written as `—`, not as zero: a cell that did not run is not a cell that scored nothing. The CI battery
  runs this cell (76/90 on the current anchor), so the reading exists there and is not reproduced here.
- **Coverage** after the change: `packages/tree` **99.95 / 99.61 / 99.48 / 99.95**, `benchmarks`
  **99.87 / 99.50 / 100 / 99.87**. Every dimension ≥ 95 %.
- The project's own `coverage-scope` fence caught the new module on arrival — a test the scope did not list. That
  is the fence working, and it reported the omission before this document did.

## 6. What is owed, in order

1. **Re-anchor `misinterpreted` on a live term.** Anchoring it on `rise` at weight 0 was the instrument's defect.
   The correct subject is a direction the score actually spends, and per §4 there is currently none — so the
   honest sequencing is: enrol a direction term first, then measure misinterpretation against it. Not the other
   way round.
2. **The six `omitted`-on-truth cases are individually inspectable** and are the first defect this project has
   with a named mechanism, a counted cost, and a per-case list. They are the cheapest thing on the board.
3. **The SockShop-vs-TrainTicket 87.5 % → 0.8 % spread is a HYPOTHESIS, not a finding.** The proposal is that
   SockShop's chain topology lets the discount zero out more upstream services than TrainTicket's mesh does. It
   is written here as a hypothesis and nothing in §2 measures it; a census over `explained(v)/anomaly(v)` by cell
   would, and it is not run.
4. **`RE2:TrainTicket`'s missing reading** is a local runner gap, not a result, and is owed on the next pass.
