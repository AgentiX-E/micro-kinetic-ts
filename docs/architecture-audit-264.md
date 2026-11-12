# Iteration 264: the floor was a wall, and the wall was hiding thirty-six regressions

Iteration 263 closed with a conclusion and a prescription:

> **"No fault type down on held-out" is not a property any training-time constraint can guarantee.**
> It is a property of the corpus being large enough that the held-out count is stable.

> **Therefore the next iteration is not a weight fit.** … The next iteration is a **new measurable
> channel**.

This iteration tested the first statement as an instrument question rather than accepting it, and the
result is that **the statement was true and incomplete**: the floor was not merely un-guaranteeable, it
was **un-attainable through the search that was being run**, because `TypeGate` implements the floor as
a penalty of `n_cases + 1` per lost case — larger than any total the corpus can produce — and a
coordinate ascent that starts inside such a barrier never leaves it. Building the priced version of the
same rule moved the reading from **+1 to +135**. Then the strictest form of the rule — no _case_ the
control answers correctly may be lost — was measured, and it turned out to forbid every gain that
exists: the shipped default is on the frontier, and the +131 arm is not "131 free cases" but
**167 gains against 36 regressions**.

| what was tried                                              | in-sample Top@1 | Δ vs control | floor status              |
| ----------------------------------------------------------- | --------------: | -----------: | ------------------------- |
| shipped (control)                                           |            1073 |            — | met (it defines it)       |
| `TypeGate` barrier, from the incumbent (262, 263)           |            1074 |       **+1** | met                       |
| priced floor, warm start, 1 → 16                            |            1204 |         +131 | 2 types net-down          |
| priced floor, 13-point grid, 5 passes                       |            1204 |         +131 | 2 types net-down          |
| margin surrogate `tanh(margin/τ)`, τ = 0.1, cold            |        **1212** |     **+139** | 3 types net-down          |
| margin surrogate, τ = 0.25, warm                            |            1208 |         +135 | 2 types net-down          |
| **case floor** (no control-won case may be lost), price 10⁹ |            1074 |           +1 | met                       |
| case floor, soft, 4 rounds                                  |            1073 |            0 | met, and it found nothing |

## 1. The barrier, and why it read as infeasibility

`TypeGate.score` charges `n_cases + 1 + |lost|` for one lost case. On this corpus that is 1 423 points
against a maximum obtainable total of 1 422, so the admissible set is a barrier: from the incumbent,
every single-coordinate move that gains anything also loses something, and the objective of the gaining
move is _below_ the objective of standing still. The gated climb therefore returns the incumbent, and
for two iterations that was read as "the floor and the total cannot both be had".

They can both be had for 135 of the 139 cases available. The instrument that shows it is the same rule
with a **finite, per-type price**, learnt by dual ascent:

```python
def learn(self, lost: dict[str, int]) -> None:
    for name in lost:
        self.duals[name] = min(self.cap, self.duals.get(name, 1.0) * self.step)
```

This is not a loosened rule — `Lagrangian.violations` still delegates to `TypeGate.violations`, so the
admission test is byte-identical. What changed is that the _search_ is allowed to walk through a
violating state on its way to an admissible one, which is the difference between a constraint and a
barrier. The literature says the same thing and says why: a fixed-weight penalty cannot satisfy a
constraint and optimise the objective at once, while a Lagrangian multiplier can (Hashemi et al., 2025,
[arXiv 2505.20628](https://arxiv.org/abs/2505.20628)); and per-component terms must be scalarised
before the multiplier is read or the Lagrangian signal is corrupted (Constrained GRPO, 2026,
[arXiv 2602.05863](https://arxiv.org/abs/2602.05863)).

The second defect was the **cold start**. Every climb in 262 and 263 began at the shipped vector, so a
fit that had already found +131 was discarded before the floor was applied to it. `hill_climb` now takes
`start=`, and the priced floor is given the ungated optimum as its starting point.

**Attribution of the two changes** (§4 has the full table): the price alone, from the incumbent, gives
1191 (+118) at price 2 and collapses to +1 at price 4 — the search falls into the barrier-shaped local
optimum as soon as the price is large enough. The warm start alone, at price 4, gives 1208 (+135). The
two together are what make the deficit small enough to be interesting: 2 net cases in 2 types.

## 2. The deficits are not where the rule looks

The +131 vector's net type table reads: `HTTPResponseReplaceCode` +62, `HTTPRequestReplaceMethod` +24,
… `HTTPResponsePatchBody` −3, `HTTPRequestAbort` −2, `HTTPRequestReplacePath` −1. Three types down, and
that is what the rule reports.

The **gross** table is the one that matters, and it is not a summarisation of the net table — it is a
different object:

| fault type                 |   lost |  gained |      net |
| -------------------------- | -----: | ------: | -------: |
| HTTPResponseReplaceCode    |      4 |      66 |      +62 |
| HTTPRequestReplaceMethod   |      7 |      31 |      +24 |
| JVMException               |      1 |      10 |       +9 |
| NetworkBandwidth           |      1 |      10 |       +9 |
| NetworkPartition           |      4 |      11 |       +7 |
| HTTPRequestDelay           |      1 |       8 |       +7 |
| NetworkCorrupt             |      0 |       6 |       +6 |
| NetworkLoss                |      1 |       7 |       +6 |
| HTTPResponseDelay          |      3 |       7 |       +4 |
| HTTPResponseReplaceBody    |      1 |       4 |       +3 |
| **HTTPResponsePatchBody**  |  **3** |       0 |   **−3** |
| **HTTPRequestAbort**       |  **5** |       3 |   **−2** |
| **HTTPRequestReplacePath** |  **1** |       0 |   **−1** |
| HTTPResponseAbort          |      2 |       2 |        0 |
| JVMReturn                  |      1 |       1 |        0 |
| JVMCPUStress               |      1 |       1 |        0 |
| **total**                  | **36** | **167** | **+131** |

**Thirty-six cases regress and the rule reports three.** `HTTPRequestAbort` loses five and wins three,
so the count says −2 while five distinct failures move into the wrong answer. `HTTPResponseReplaceCode`
gains sixty-six and loses four, so the count says +62 and never mentions the four. A rule that compares
counts is simultaneously **too strict** (it refused +131 over two net cases) and **too lax** (it would
have admitted the arm had the net been level, with all thirty-six regressions intact).

## 3. The strictest form of the rule, and what it says

The rule a delivered default actually owes is per case, not per count: **no case the shipped ranking
answers correctly may stop being answered correctly.** `CaseFloor` implements exactly that, with the
same priced machinery — the price is per lost case and the floor is satisfied only at zero.

Measured on the archive, over ten configurations (hard and soft floors, cold and warm starts, 1 to 4
rounds, prices to 10⁹):

| configuration                       | best total reached | control-won cases lost |
| ----------------------------------- | -----------------: | ---------------------: |
| hard floor from the ungated optimum |               1186 |                 **17** |
| hard floor cold                     |               1074 |                      0 |
| soft floor from the ungated optimum |               1204 |                 **36** |
| soft floor cold                     |               1201 |                     26 |

**No monotone vector exists in the neighbourhood.** The best the search can do while preserving every
control-won case is **1074 (+1)**, and the moment it gains seriously it hands back 17 to 36 cases. The
shipped default is on the Pareto frontier of `(Top@1, cases preserved)` for this feature space, and the
frontier is steep: 113 further cases cost 17 regressions.

That is a _stronger and more useful_ statement than "the floor was not met", because it says where the
next gain has to come from and why no re-weighting will produce it.

## 4. Why: the thin wins are decided by the same coordinates as the gains

For each of the 36 regressions, the term whose contribution to that case's margin changed the most:

| flipping term      | cases |
| ------------------ | ----: |
| `prism`            |    13 |
| `failedEdge`       |    10 |
| `temporal`         |     7 |
| `lat`              |     3 |
| `selfAnomalyLog1p` |     2 |
| `log`              |     1 |

and those are precisely the terms the +131 vector moves: `failedEdge` ×1.5, `podState` ×16, `lat` ×0.794,
`log` ×0.707, `prism` ×0.5, `temporal` ×0.5, `selfAnomalyLog1p` ×0.177, `topo` ×0.177, `dualFamily` ×0.25,
`stability` ×0.021, `collision` ×0.022, `pool` ×−0.017.

The lost cases are the thin wins, and the measurement is unambiguous:

| statistic                                          |         value |
| -------------------------------------------------- | ------------: |
| control-won cases whose margin is a tie (< 10⁻⁹)   | **0 of 1073** |
| median margin of a control-won case                |     **0.947** |
| median margin of the 36 lost cases                 |     **0.260** |
| thinnest lost margin                               |    **0.0063** |
| lost cases inside the bottom decile of all margins |  **16 of 36** |
| median percentile of a lost margin                 |      **21.5** |

So the regressions are not tie-breaks, not absent candidates, and not a deduction: they are the cases
whose evidence was already marginal, and they are decided by the same twelve coordinates that produce
the 167 gains. **That is the mechanical reason no re-weighting can be monotone**: the score is linear in
the weights, the no-loss region is the intersection of 1 073 half-spaces, and the shipped point lies
6 × 10⁻³ from its nearest boundary. Any move that leaves the cell flips the case that defines it.

The corollary is the prescription for the next iteration, and it is not a weight fit: a gain without a
loss needs a **coordinate that is zero on the cases the ranking wins thinly**, so that its contribution
can rise on the cases it is meant to win without moving the ones that are already marginal. That is a
new _measurement_, not a new coefficient.

## 5. The margin surrogate, and what it bought

`Top@1` is the sign of the margin and nothing else, so a fit scored on it cannot tell a case won by
0.006 from one won by five. The surrogate `Σ tanh(margin/τ)` is bounded, monotone, and steepest exactly
where the archive's decisions are decided.

| configuration  |    total |        Δ | types net-down |
| -------------- | -------: | -------: | -------------: |
| τ = 0.1, cold  | **1212** | **+139** |              3 |
| τ = 0.25, cold |     1208 |     +135 |              2 |
| τ = 0.1, warm  |     1209 |     +136 |              2 |
| τ = 0.25, warm |     1204 |     +131 |              3 |
| τ = 0.5, warm  |     1205 |     +132 |              2 |

It produced the programme's best reading (**1212, +139**) and did not repair a single deficit. That is
the third confirmation of the same fact from a different direction: the deficit is not an artefact of
the step objective, it is a property of where the thin wins live.

## 6. What this iteration shipped, and what it did not

Shipped: `Lagrangian` (priced, per-type, dual ascent), `CaseFloor` (per case, the strict form),
`members_of` (one mask normaliser for both floors, since the fold splitter hands indices and the report
hands booleans), `margins`/`margin_paid`/`margin_score`/`Surrogate`, `hill_climb(start=)`, `repair`,
`repair_fit`, and the `--only repair` report with `--rounds`, `--price-step`, `--price-cap`,
`--surrogate`. **630 statements, 202 branches, 100.00 % of both, 100 tests.**

Not shipped: **no weight vector.** The best admissable-by-construction reading remains the shipped 1073. The +131 and +139 arms are recorded with their gross tables and their case-level regressions, and
neither is admitted; the acceptance test `Top@1 ≥ 1082 with no fault type down` is **not met**, and the
stronger per-case form of it is met only by the no-op. **No end-of-programme signal.**

## 7. What the next iteration is, stated as a measurement

Three facts now point at one instrument:

1. The +131 vector's deficits are decided by `prism`, `failedEdge`, `temporal`, `lat` — the terms the
   gains are made of. A new coefficient on those cannot separate them.
2. The LP ceiling says 99.30 % of cases are separable by _some_ non-negative vector, and the best
   single-vector mixture reaches 84.5 % held out. The gap is not in the coefficients.
3. The absent census says 86 % of the 173 unretrievable cases are one service whose only fault-carrying
   channel is dropped before scoring, and `duty-cycle-window.md` §5 measures the drop.

So the next iteration builds the **fault-free baseline frequency** channel named by Lee et al. (2026,
[arXiv 2611.02416](https://arxiv.org/abs/2611.02416)): for each node and channel, how often the signal
is flagged anomalous during the pre-injection period. It is a coordinate the current score does not
have, it is zero on the cases whose evidence is already marginal (they are not thin because they are
noisy — they are thin because their signal is _routine_), and it is measurable in the datapacks this
project already converts.
