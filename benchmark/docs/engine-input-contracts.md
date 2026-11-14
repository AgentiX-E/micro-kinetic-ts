# Engine input contracts — three defects in one family

**Iteration 255.** Three defects were found by auditing the code paths that the previous iteration's defect
("a sparse map's absence was read as a measured zero", `docs/emission-jurisdiction.md`) belonged to. They share
its shape: **a container lookup that did not find what the code assumed, answered with a value that looks like
data.** Each one is silent — none of them threw, none of them printed, and all three were reachable from the
public `TreeRCAEngine.analyze` signature.

They are recorded together because the repair is the same in each case: **state the precondition and check it at
the boundary**, rather than letting an internal default answer a question the caller was never asked.

## 1. A dangling edge endpoint crashed the engine inside an internal helper

`analyze()` documented three preconditions — non-empty tree, scores covering every node, `topK >= 1` — and
checked all three. It assumed a fourth without stating it: every edge endpoint is a node. That assumption was
enforced **three ways in three places**:

| write | guard | effect of a dangling endpoint |
| --- | --- | --- |
| `forwardAdj.get(edge.from)?.push(...)` | `if (fwList)` | source silently skipped |
| `reverseAdj.get(edge.to)?.push(...)` | `if (revList)` | target silently skipped in reverse, **kept** as a phantom parent |
| `inDegree.set(edge.to, inDegree.get(edge.to)! + 1)` | none | `undefined + 1 = NaN` written under a non-node key |

The unguarded write is what made the other two matter. `topologicalSort` iterates `inDegree`, so the phantom
key reached `forwardAdj.get(nodeId)!.length` and the engine died with:

```
TypeError: Cannot read properties of undefined (reading 'length')
```

— an internal helper's line number, on input the caller can fix. The dangling-source direction failed elsewhere
and differently (`reading 'every'`, from the sibling check), which is why the fix has a test per direction: one
test would have pinned one accident and missed the other.

**Repair.** `assertEdgeEndpointsAreNodes` scans the edge list once, before any structure is built, and throws
`KineticValidationError` naming the edge and which side is wrong. The two silent skips are then **deleted** —
with endpoints guaranteed, a `?.` there is a second answer to a settled question.

## 2. `invariantRange` could not see `NaN`

A range check is two comparisons, and `NaN` answers `false` to both:

```ts
if (value < min || value > max) throw ...   // NaN: false || false → passes
```

So the one value that poisons every number it touches was the one value the guard reported as *in range*. The
consequence was measured, not imagined: `boundToConfidence` guards `score` with `invariantRange(score, 0, 1)`,
and a `NaN` score came out of it as a `NaN` confidence on an emitted root-cause row, while the check that was
supposed to catch it reported success.

This had been found before and worked around at ONE call site. `packages/tree/src/causal/topo-deduction.ts`
already ran `invariantFinite(rho, ...)` before `invariantRange(rho, 0, 1, ...)`, with a comment explaining why.
The workaround was right and the tool was wrong; **38 call sites** inherited the hole, and one of them was
discovered by this iteration only because a probe fed the engine an edge list whose latencies were missing.

**Repair.** `invariantRange` rejects `NaN` explicitly. `Infinity` is deliberately *not* rejected: `[0, Infinity]`
is a range in use (`latencyMs`), and `Infinity > Infinity` is false, so an infinite value has always been
admitted by that upper bound. Tightening that would be a different rule with a different justification — reach
for `invariantFinite` when a real number is required.

## 3. A repeated edge record was a second edge

`CallGraph.edges` is a list of records. Nothing forbids the same `(from, to)` pair appearing twice, and the
quantity that would make it meaningful — an observation count — is already a field of the edge (`callRate`). A
second record for one pair therefore carries no topology, only a second measurement of the same edge.

`buildTreeStructure` pushed both records into `forwardAdj`, so the bottom-up accumulation added the child's
contribution once per **record** rather than once per **child**:

```
childContribRaw += child.totalScore × weight × decay
```

The child cap (`min(raw, max(anomaly, maxChild))`) hides this whenever the doubled sum already exceeds the cap —
which is why the shipped corpora, whose anomalies are large, never showed it. It does not hide it below the cap:

| input | `childContribRaw` | capped | `totalScore(P)` |
| --- | --: | --: | --: |
| one edge `P→X`, `P=0.4`, `X=0.3` | `0.297` | `0.297` | **`0.495`** |
| two records for `P→X` | `0.594` | `0.400` | **`0.528`** |

Measured on the engine, both numbers reproduced exactly. A duplicate also pushed the parent into the
topological queue twice; the bottom-up update is idempotent so nothing moved, but a repeated entry is a graph
the caller did not describe.

**Repair.** Pairs are collapsed with a `seen` set: a call graph is a **simple** graph. The `!visited.has(parent)`
guard in `topologicalSort` became unreachable as a consequence — only the *last* of a parent's children to be
processed sees `siblings.every(visited)` true, so a parent is enqueued exactly once — and it was **removed
rather than covered**, because a branch that cannot run is not a measurement.

## 4. A tree edge with no weight in `allEdges`

`allEdges` carries the weights (`propagationWeights[i]` aligned to `allEdges[i]`) and the latencies; the tree
carries only the pair. `edgeWeightMap.get(key)!` and `edgeLatencyMap.get(key)!` are compile-time promises about
a runtime map. A tree edge absent from `allEdges` produced `undefined`, then `undefined × score × decay = NaN`,
and the NaN travelled: `childContrib` → `totalScore` → `confidence`.

**Repair.** `assertTreeEdgesAreMeasurable` checks both quantities for every tree edge and names the edge. The
check is **one-directional** on purpose: `allEdges` is the pre-pruning graph, so it normally contains edges the
tree does not; requiring equality would reject every real tree. There is a test for that direction too.

## Why the nine cells do not move

`666/735` is unchanged, and that is a claim with four separate supports rather than an expectation:

1. the three topologies in `configs/topology/` carry **121 edges, all unique** (`re1ob` 13, `sockshop` 13,
   `trainticket` 95), so the deduplication has nothing to collapse;
2. a corpus edge whose endpoint was not a node would have crashed the previous engine outright — the battery
   has run green for many iterations, so no case reached that path;
3. `invariantRange` only changes behaviour for a `NaN` input, and a `NaN` in a score would have shown up as a
   `NaN` confidence in an artifact already being read every iteration;
4. `TreeRCAEngine.analyze` has **no production caller**: the ranking path used by the benchmark battery is
   `pruner.rank` → `finalScore`. `analyze` is a public API whose contract this iteration repaired, and the
   regression risk it carried was to future callers, not to the current reading.

Point 4 is the honest one and it cuts both ways: it is also why these three defects could sit in a
green-CI repository. A public API with no caller is a public API with no test that matters.

Also verified locally on the two cells the sandbox's data directory can serve: `RE1:OnlineBoutique 113/125`
and `RE3:SockShop 24/30`, both identical to the CI battery `42616136723`. The remaining seven cells are
adjudicated by that battery on the next push, because the sandbox copy is missing six of the nine populations
and nests two of them one directory too deep.

## Coverage

`packages/tree/src/rca/tree-rca.ts` and `packages/core/src/utils/invariant.ts` are at **100 / 100 / 100 / 100**
(statements / branches / functions / lines). The two files gained 15 tests across four new files and one
extended one; the branch that reached 100% did so by **deletion**, not by a test that executes dead code.

| file | tests added | what it pins |
| --- | --: | --- |
| `tree-rca-edge-endpoints.test.ts` | 6 | both directions of a dangling endpoint, a self-edge, an empty edge list |
| `tree-rca-duplicate-edges.test.ts` | 4 | the two scores above, no repeated ranking entry, two *different* children still counting twice |
| `tree-rca-edge-measurements.test.ts` | 5 | missing edge in `allEdges`, non-finite weight, non-finite latency, the valid case, the subset direction |
| `utils/invariant.test.ts` | 5 | `NaN` rejected, label named, `[0, Infinity]` still admits `Infinity`, `-Infinity` below min |
