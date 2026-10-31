# The cascade model propagates along the wrong edges

## 1. What the number is supposed to be

`WaveCascadeModel.simulateCascade` publishes a `propagationDistance` — the BFS distance from the injected
service to the farthest service that still carries alert intensity above `0.01` on the **last** simulated step.
It is the only field of `CascadeResult` that describes the *spread* of a cascade rather than the intensity at a
point, and `rca-pipeline.ts` carries it into the pipeline's return value.

Every assertion on it in `packages/wave/__tests__/unit/cascade/cascade-model.test.ts` was `>= 0`, which a constant
`0` satisfies. The field had never been observed to take any other value.

## 2. What it actually computes

`buildInteractionKernel` builds the three-wave tensor

```
T(i, j, k) = coupling · A(i,j) · A(i,k) · A(j,k)
```

from the **out-edge** adjacency: `A(i,·)` holds the calls service `i` **makes**. The intensity update for node `i`
is then

```
di = propagationSpeed · Σ_{j,k} T(i,j,k) · (n_j n_k − n_i (n_j + n_k)) − γ n_i
```

For a node `i` that sits **downstream** of the injected service, none of its own callers appear in `A(i,·)` — a
callee does not carry a row entry for the service that calls it. Every triple `(i, j, k)` that would let `i` draw
energy from its caller therefore contains a zero factor, and `Σ T (n_j n_k − …)` reduces to the **self-interaction**
term `T(i,i,i) = coupling · 1 · 1 · 1`, which is `coupling · (n_i² − 2n_i²) = −coupling · n_i²` — strictly negative.

A downstream node can only lose intensity. Measured, twice:

| graph | coupling | `svc-b` max intensity | `svc-b` final intensity | `propagationDistance` |
| --- | --- | --- | --- | --- |
| `a→b→c` (acyclic, 1000 calls/s) | 0.9 | **0** | 0 | 0 |
| `a↔b` (mutual, 1000 calls/s) | 0.9 | **1.0** | 0 | 0 |

The second row is the whole diagnosis. The wave term is live — the neighbour saturates at the ceiling — but only
when the two services are connected in **both** directions, because only then does `A(i,j)·A(i,k)·A(j,k)` have a
non-zero triple with `j` and `k` outside `i`. A real service call graph is a near-DAG: `frontend → cart →
currency`, never back. On such a graph this model has never propagated anything, and its published
`propagationDistance` has been `0` for every case it has ever been given.

## 3. Why the second row still reports 0

The BFS reads intensity on the **last** step, and the explicit Euler update overshoots: once `n_b` approaches 1 the
self-interaction term dominates `di`, `n_b + di·dt` goes negative, and `Math.max(0, …)` pins it at exactly 0. So even
the one topology that propagates reports a distance of 0 — for a second, independent reason.

That is also why the branch in `computePropagationDistance` that assigns `maxDist` has never executed, and it is the
whole of `cascade-model.ts`'s remaining coverage gap (`99.21%` statements, `93.93%` branches). It is recorded as a
measurement rather than papered over with an input that happens to land on the right step: a test written to hit the
branch would assert a trajectory that the model does not produce for any real graph.

## 4. What the repair has to decide

Two independent questions, and neither is a one-line change:

1. **Direction.** The interaction tensor must read the edge between `i` and its caller. Options are a symmetrised
   adjacency `S(i,j) = max(A(i,j), A(j,i))`, an explicit in-edge term, or restating the kernel over the undirected
   service graph — a cascade in the WKE sense is energy exchange between modes, which is symmetric, while the
   *service* direction is what makes one of them the source. Which of these is faithful to Deng Yu's three-wave
   formulation is a decision with a paper behind it, not an implementation detail.
2. **Stability.** The explicit Euler step with `dt` up to 100 and no limiter saturates and then collapses. A
   trajectory that reaches 1.0 and falls to 0 within one horizon is not a cascade shape; the fix is either a
   smaller step tied to the coupling, a limiter, or a semi-implicit update.

Either one moves **every trajectory this package has produced**, which is why it is its own iteration rather than a
coverage pass. The measurement above is what makes that iteration possible: it names the two ends (0 and 1.0), the
topology that separates them, and the reason the published number is 0 in both.

## 5. What this does not affect, and why it is still worth fixing

`packages/wave` reaches the ranking only through `rca-pipeline.ts`, which attaches `cascadeResult` to its **return
value**; no ranking term reads it, and `enableWave` gates the whole stage. So the RCAEval numbers in
`docs/sota-comparison.md` are unaffected — this is a defect in a published field, not in the leaderboard.

It is worth fixing anyway for the reason the failed-edge term was worth fixing one iteration earlier: a field that
is structurally always zero is indistinguishable, in an artifact, from a field that was measured and came out zero.
The difference between those two is the entire content of this document.
