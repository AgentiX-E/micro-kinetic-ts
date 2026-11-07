# The cascade propagated along the wrong edges — and three constants that hid it

## 1. What the number is supposed to be

`WaveCascadeModel.simulateCascade` publishes a `propagationDistance`: the BFS distance from the injected
service to the farthest service that the cascade reached. It is the only field of `CascadeResult` that describes
the *spread* of a cascade rather than the intensity at a point, and `rca-pipeline.ts` carries it into the
pipeline's return value.

Every assertion on it in `packages/wave/__tests__/unit/cascade/cascade-model.test.ts` was `>= 0`, which a
constant `0` satisfies. The field had never been observed to take any other value — and it could not, for three
independent reasons. This document is the record of all three, the repair, and the measurements that separate
the repair from the defect.

## 2. Defect one: the interaction kernel read a directed matrix as if it were a vertex

`buildInteractionKernel` built the three-wave tensor

```
T(i, j, k) = c · A(i,j) · A(i,k) · A(j,k)
```

from the **out-edge** adjacency: `A(i,·)` holds the calls service `i` **makes**. The WKE kernel `T(k,k₁,k₂)` is a
*vertex amplitude*: it is symmetric under permutation of its three modes, because the three waves meet at one
vertex and no mode is privileged. Reading a directed matrix three times makes the tensor index-asymmetric, and
the asymmetry has a sign:

For a node `i` downstream of the injection, none of its own callers appear in `A(i,·)`. Every triple `(i,j,k)`
that would let it draw energy from its caller contains a zero factor, so the interaction sum collapses to the
**self term** `T(i,i,i) = c`, whose contribution is `c·(n² − 2n²) = −c·n²` — strictly negative. A downstream
service could only lose intensity.

The direction of transfer in the WKE is a property of the **occupation numbers** — `n_j n_k` filling a mode
versus `n_i(n_j + n_k)` draining it — not of the index. That is the sentence the defect was an instance of, and
it decides the repair: the coupling has to be symmetric, and the direction has to come out of the bracket.

## 3. Defect two: a three-wave term on a graph with no triangles

The second reason is structural and survives the first repair. `T(i,j,k)` is non-zero only when `S(j,k) ≠ 0`,
i.e. only when the three services are mutually coupled — a **triad**. A real call graph is a sparse near-DAG:
SockShop is 15 services and 13 edges, OnlineBoutique 14 and 13. There are almost no triangles, so the
three-wave term is zero on almost every node of almost every case, however its indices are ordered.

And the theory says the same thing from the other side. In Deng's derivation the collision history is expanded
into diagrams, and under the fast phase oscillation every diagram carrying a closed loop cancels — only the **tree**
diagrams survive and carry the energy. That reduction is what produces the scaling law there, and the same
diagrammatic control of cumulants is what he carried over to the hard-sphere problem. A three-wave triad *is* a loop
(three services mutually coupled), and a call graph is nearly a tree, so the discrete model agrees with the theory
twice over: the tree carries the cascade, and the loop term is small exactly where the graph is nearly a tree.

Alert propagation along a call edge is not a three-wave resonance. It is **transport**: the reversible part of
the kinetics, whose generator is the graph Laplacian of the coupling,

```
Q_lin[n]_i = c · v · Σ_j S(i,j) · (n_j − n_i)
```

with `S(i,j) = max(A(i,j), A(j,i))` — the stronger direction of the edge, because both mechanisms that carry an
alert are real (a callee degrading its callers, and a caller's retries loading its callee) and the graph records
only one of them per edge. This is the discrete symbol of the linearised collision operator, and its spectral gap
is exactly the "spectral gap" the package's decay claim has always been about.

So the model is now the sum of the two parts the equation actually has:

```
∂_t n = c · v · L n            (transport — the part that propagates)
      + c · Q_triad[n]         (the three-wave correction — only where triads exist)
      − γ n                    (dissipation)
```

## 4. Defect three: the reported instants were constants, and one of them sat below the decay floor

`computePropagationDistance` admitted a service only if its intensity on the **last** step exceeded `0.01`. With
`timeHorizon = 300 000 ms` and `decayTimeConstant = 60 000 ms` the source alone is at `e⁻⁵ = 0.0067` by then, so
the last step is below the threshold for *every* node on *every* graph, for the same reason the horizon is five
decay constants long. The field was structurally zero even for a cascade that demonstrably happened.

The same defect has a coordinate-reading it more clearly: the trajectory shape was decided by `dt`. The update
multiplied a per-millisecond rate by a `dt` of hundreds, so the first step moved a 15-node graph by thousands of
units, trajectories pinned against the `Math.max(0, Math.min(1, …))` clamp, and the clamp — not the equation —
decided what the published series looked like.

Three definitions move as a consequence, and each is stated where the code states it:

| field | was | is |
| --- | --- | --- |
| `propagationDistance` | last step above `0.01` | **peak** above `cascadeThreshold` |
| `timeToPeak` | global argmax — always `0`, since the source starts at 1 | argmax of the mass **outside** the source |
| `decayConstant` | `1 / gap` of a *randomised* power iteration on an asymmetric adjacency | `1 / λ₂` of the transport Laplacian, computed exactly |

## 5. The integration is now a theorem rather than a clamp

The clamp is gone. The update splits into a stiff part treated implicitly and a saturating source:

```
n_i' = ( n_i + dt·c·v·u_i + (1 − n_i)·s_i ) / ( 1 + dt·(c·v·d_i + γ + c·max(0, B_i)) )

u_i = Σ_j S(i,j)·n_j                d_i = Σ_j S(i,j)
s_i = dt·c·A_i / (1 + dt·c·A_i)     A_i = Σ max(T,0)·n_j·n_k      B_i = Σ T·(n_j + n_k)
```

`n_i' ≥ 0` because every term in the numerator is non-negative. `n_i' ≤ 1` because, assuming `0 ≤ n ≤ 1`, the
numerator is at most `n_i + dt·c·v·d_i + (1 − n_i) = 1 + dt·c·v·d_i`, which is the denominator's floor. Both hold
for **any** `dt`, so `[0, 1]` is an invariant set rather than a clamp's fixed point — and the sweep in
`cascade-model.test.ts` asserts it over sixteen combinations of horizon (1 s and 1 h), coupling (0 to 1) and
speed (0.1 and 10) — the 1 h horizon is a 7.2 s step, thousands of times beyond any CFL bound for these rates.

`s_i` is the `(0,1)` Padé form of `1 − e^{−dt·c·A_i}`: a source can fill the headroom that is left and nothing
more, which is what makes the upper bound a consequence of the arithmetic instead of a `Math.min`.

## 6. The A/B, on graphs whose answer is known by hand

Coupling 0.9, speed 1, τ = 60 s, threshold 0.05, horizon 300 s, 1000 calls/s on every edge. "Old" is the code at
`777a4ee`; "new" is this iteration.

| graph | node | old peak | old final | old `propagationDistance` | new peak | new final | new `propagationDistance` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `a→b→c` | `b` | 0.000 | 0.000 | 0 | **0.293** | 0.016 | **2** |
| `a→b→c→d→e` | `e` | 0.000 | 0.000 | 0 | **0.135** | 0.011 | **4** |
| `a↔b` | `b` | 1.000 | **0.000** | 0 | 0.483 | 0.020 | **1** |
| `abc` triangle | `c` | 0.000 | 0.000 | 0 | **0.217** | 0.001 | **1** |

Three readings, and the third is the one that matters:

1. On every acyclic graph the old model moved **nothing at all**, at any coupling — the direction defect.
2. On the one topology that could carry the old kernel (a mutual pair) the neighbour saturated at 1.0 and the
   published series ended at exactly **0**, because the explicit step overshot and the clamp pinned it — the
   stability defect, measured on the same table.
3. The new field is **monotone in distance**: `0.293` one hop out against `0.135` four hops out, and the distance
   field now equals the hop count where the cascade is strong enough — `2` on a chain of three, `4` on a chain
   of five. A number that changes with the topology is a measurement; the constant `0` was not.

## 7. The spectrum, checked against closed forms

`computeDecayCurve` published `τ = 1 / spectralGap` from a **randomised** power iteration on the *asymmetric*
adjacency with a unit diagonal. Three things were wrong with it at once: the answer varied between two runs of
the same graph, `λ₂` of an asymmetric matrix is not an eigenvalue of anything, and the slowest mode of a
diffusion is the second smallest **Laplacian** eigenvalue. The replacement is a cyclic Jacobi sweep — exact for
a symmetric matrix, deterministic to the last bit, no starting vector — and it is checked against the analytic
spectra rather than against itself:

| graph | analytic λ₂ | measured |
| --- | --- | --- |
| path `P_n` | `2 − 2cos(π/n)` | matches to 1e-9 for n = 3, 4, 10, 70 |
| cycle `C_n` | `2 − 2cos(2π/n)` | matches to 1e-9 for n = 4, 6, 20 |
| complete `K_n` | `n` | matches to 1e-9 for n = 3, 5, 12 |
| star `S_k` | `1`, whatever the leaf count | matches to 1e-9 for k = 2, 5, 30 |

The star row is the one worth keeping: it is the counter-example to "more edges means faster mixing". A cascade
through a fan-out hub decorrelates at a fixed rate no matter how many callees hang off it, which is the kind of
statement a benchmark cannot produce and a spectrum can.

## 8. What this does not affect, and why it was still worth the iteration

`packages/wave` reaches the ranking only through `rca-pipeline.ts`, which attaches `cascadeResult` to its
**return value**; no ranking term reads it, and `enableWave` gates the whole stage. The RCAEval numbers in
`docs/sota-comparison.md` are therefore unaffected — this is a defect in a published field, not in the
leaderboard.

It was worth fixing for the reason the failed-edge term was worth fixing one iteration earlier: a field that is
structurally always zero is indistinguishable, in an artifact, from a field that was measured and came out zero.
The difference between those two is the entire content of this document — and this iteration is the first time
the field has been observed to take a value that depends on the graph it was given.

## 9. What would make this field matter

The corrected operator is a **ranking signal that has never been tried**, because until now it could not vary:
`propagationDistance` is the only feature in the pipeline that describes the *spread* of an anomaly rather than
its magnitude at a node. The candidate test is whether the injected service's distance profile — how far the
anomaly reached, and how fast — separates a source from a victim on the cases the ranking currently loses. That
is a measurement, not a plan; it belongs to the iteration that runs it on the corpus, and `docs/sota-comparison.md`
§31's 4.0 pp top-5/top-1 band is where it would show up first.
