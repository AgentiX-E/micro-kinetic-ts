# The loop-suppression decay — falsified before any code was written

**Written 2026-11-13 (iteration 273).** This document closes the axis the 271 and 272 reflections both named as the
highest-value unspent item: replace the hand-fitted decay parameters with Deng Yu's graph-expansion law,
`α = ε^k`, `k` the number of loops and `ε` a measured small parameter. It is closed because **neither decay
parameter can reach a ranking**, and that was established by reading the code and by one measurement, in less time
than one dispatch takes to start.

The claim it falsifies, quoted from `PROGRESS_2026-11-13b.md` §7.3:

> the theorem's transferable content is that loop diagrams are suppressed by one small factor per re-collision … The
> principled form is `α = ε^k` … That is a testable one-dispatch change with a pre-registered direction (steeper
> decay on longer cycles), and it is the **first place where the Fields-medal result would change a number rather
> than a sentence.**

The last clause is wrong, and that is what this document records.

## 1. Three routes by which a decay parameter could reach the answer, and all three are closed

A parameter can change a ranking through at most three channels: the score sum, the cycle contribution the pruning
uses, or the pruning itself. Each was read at its source rather than inferred from a name.

**Route 1 — the score sum. Closed, deliberately.** `options.decayAlpha` is read once in the tree pass, at
`pruner.ts:3074`:

```ts
const latencyDecay = Math.pow(options.decayAlpha, 1);
childContrib += childScore * weight * latencyDecay;
```

`childContrib` becomes `totalScore = mixedSelf + childContrib × fanOutDilution` (`pruner.ts:3102`) and is stored in
`scores`. The ranking does not read it. Three lines later, `pruner.ts:3108` stores `selfScores.set(node, nodeAnomaly)`
and the comment above the ranking says why:

> Rank by the node's OWN raw anomaly — … The collision energy (Q(f,f)) aggregates upstream signals and amplifies
> convergence points (fan-in/bottleneck), which would let a healthy convergence node outrank the true source, so it
> is **deliberately excluded from the primary ranking signal.**

So α multiplies a channel the ranking excludes on purpose. Note also `Math.pow(α, 1)`: the exponent is the literal
`1`, so the attenuation does not even depend on the hop count — it is one global scalar on the whole
child-propagation channel.

**Route 2 — the cycle contribution. Closed, and by a second, different α.** The `CollisionContributionAnalyzer` does
carry the law the theory is about — `w₁(C) = ∏ p(e) × αⁿ`, `n` the cycle length (`contribution.ts`) — but `analyze`
hands it `topoResult.computedDecayAlpha` (`pruner.ts:2185`), not `options.decayAlpha`. That value comes from
`computeAdaptiveDecay(callGraph.nodes.size)` (`topology-fault-graph.ts:1699`), a **three-tier constant**: 0.90 below
20 nodes, 0.85 below 50, 0.75 above. There is no way for a caller to set it, and `BuildFaultGraphOptions` does not
expose `adaptiveDecay`. The resulting contribution is reported as `totalCycleContribution` on the graph
(`pruner.ts:2466`) and as `cycleContribution` / `marginBelowThreshold` on each pruned-edge record; **no term carries
it**, so it cannot be in the sum.

**Route 3 — pruning. Closed.** `pruneCycles` breaks the **weakest edge by `propagationWeight`** in every cycle,
"significant and insignificant alike", and never reads `contribution`. So a steeper decay does not even change which
edge is cut.

## 2. The measurement, and it takes eight lines

A four-node graph with exactly one cycle, `alpha → bravo → charlie → alpha`, run at the two extremes of the option's
declared range, `α ∈ (0, 1]`:

| α | `finalScore` (rank 1…4) | `terms` | `rank` | `propagationErrorBound` | `totalCycleContribution` |
| --: | --- | --- | --- | --- | ---: |
| 0.20 | 1.162317861, 0.702659439, 0.382419815, 0.142307949 | identical | identical | 0.96, 0.80, … | 0.729000 |
| 0.95 | 1.162317861, 0.702659439, 0.382419815, 0.142307949 | identical | identical | 0.0975, 0.05, … | 0.729000 |

**The answer is identical to the last bit. Two reported fields move, and nothing else does.** They are
`propagationErrorBound = 1 − α^depth` (`pruner.ts:3569`, `estimatePropagationError`) and the `confidence` derived
from it. Both are *statements about* the answer, not inputs to it: no consumer in the FSE'26 or RCAEval path reads
either one to make a decision — they are recorded per case and never gated on.

So α moves the uncertainty the engine states about its answer, and not its answer. `ε^k` would replace the exponent
of that expression — `1 − α^depth` becoming `1 − ε^k` — which is a change to a confidence interval with no reader.

## 3. What this closes, and what it does not

**Closed: the decay law as a ranking lever, and the framing that produced it.** The 271 reflection's error was
inferring a lever from a *name* (`decayAlpha`, "1-hop decay factor") and a *docstring* (mean free path attenuation)
rather than from the data path. The parameter is fitted, as the reflection said; it is also disconnected, which the
reflection did not check. A parameter that no score reads cannot be improved by any theorem.

**Not closed: the loop-suppression question itself, which needs a term before it can need a law.** The theorem's
content would become measurable the moment a cycle contribution is a **term in the sum** rather than a reported
number — because then it has a weight and a slope, and `α` versus `ε^k` becomes a difference in the term's shape.
That is not a decay-law axis; it is a *new-observable* axis, and the register already carries the reason to be
careful about it: the directional-source row (`re3-fault-ceiling.md`) closed `ratioContrib`, `topoSource` and
trace-activity because **the sign of a direction-of-explanation signal inverts between populations**, and a cycle
contribution is a direction-of-explanation quantity. A proposal here reopens that row, and owes both populations.

**The reopen condition, stated so it can be checked in a minute:** either

1. a cycle contribution becomes a named term with a weight and a slope — at which point `docs/closed-axes-register.md`'s
   directional-source row must be re-measured before the term's law is discussed; or
2. the ranking reads the `totalScore` channel that `childContrib` feeds — at which point α becomes live and the
   theorem's `ε^k` is a candidate *for that channel*; or
3. any consumer acts on `propagationErrorBound` or `confidence` — the agentic arm's abstention would qualify — at
   which point a decay law changes a decision, and the same pre-registration discipline applies to it.

## 4. The fence

`packages/tree/__tests__/unit/decay-parameter-jurisdiction.test.ts` pins all of it, and pins it in the asymmetric
form on purpose: a test that only asserted "nothing changes" would pass on a parameter that had been deleted. It
asserts that the ranking, the scores and the breakdown are **bit-identical** at `α = 0.2` and `α = 0.95`, that
`propagationErrorBound` and `confidence` **do** differ, that the error bound is exactly `1 − α^depth`, that the cycle
contribution is `∏ p × 0.9³` for a three-cycle in a four-node graph, that the cycle α ignores the option, and that no
term is named after a cycle. Any of the three reopen conditions above turns one of those assertions red.

**What this cost, and what it saved.** Two file reads and eight lines of probe: about ten minutes. A dispatch of the
`fse26-benchmark` workflow takes 55, and a pre-registration would have been written first. The register exists
because axes get re-proposed; this is the first time in this project that the same discipline stopped an axis *before*
the proposal reached a document rather than after it reached a table.
