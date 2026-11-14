# A knob that was declared, registered, accepted — and forwarded by nothing

Internal audit record. Iteration 134. The subject is not a ranking term: it is the instrument that was
supposed to measure one, and the fact that a nine-cell run can be dispatched, succeed, publish artifacts,
and answer a different question than the one asked.

## 1. The dispatch that measured nothing

Run `40173250606` was dispatched with `topo_discount=0.25`, after `topoDiscount` had been implemented,
unit-tested, plumbed through the runner's CLI, and registered in the dispatch census. Its own
configuration line — the line every artifact prints precisely so a reading can be attributed — says:

```
signals: stabilityWeight=0.007352 collisionWeight=0 topoWeight=0 topoDiscount=0 logWeight=1 ...
```

`topoDiscount=0`. The dispatch built the **shipped** configuration. Every number in that run is the number
the previous run published, and the reading it invited — "the multiplicative discount changes nothing" —
would have been a conclusion about a knob that was never turned.

Two things caught it, and both are cheap:

1. the runner prints the configuration it *resolved*, not the one it was asked for, so the artifact
   contradicts the dispatch;
2. the request and the artifact were compared **before** the numbers were interpreted.

The second is a discipline and not a mechanism. The mechanism is the census below, and it did not have
the direction that would have caught this.

## 2. Why the census could not see it

`dispatch-surface-census.test.ts` holds the knob table, and its assertions all read **NAMES**:

| direction | question asked | would it catch this? |
| --- | --- | --- |
| input → option | the input `topo_discount` derives the flag `--topo-discount`; is that flag bound to an option the runner accepts? | no — the runner did accept it, and parsed it correctly |
| table → workflow | every dispatch a workflow declares is recorded in the table | no — it *was* declared |
| workflow → table | every input the workflow has maps to a recorded knob | no — it mapped |
| **workflow step → flag** | **does the workflow ever PASS the flag?** | **this is the missing one** |

The census asked whether a *name* was consistent; it never asked whether a *step* carried it. An input
declared in `workflow_dispatch:` and forwarded by no step is a knob only a commit can turn — the exact
failure `docs/dispatch-surface-audit.md` names — and the census was green on it.

## 3. The fence, and its own first failure

The new direction, written RED first: for every knob in the table that declares a workflow input, the
workflow's own **code** must reach that knob's flag (`reaches()` already strips comments and matches at a
token boundary). Run against the tree before the repair, it named exactly one offender and nothing else:

```
rcaeval: topo_discount declares topoDiscount but never passes --topo-discount
```

That single line is also the evidence that the other eighteen knobs are wired. Then the fence was
mutated — one of the seven forwarding blocks deleted — and it **still passed**. `reaches()` answers
"does any step spell this flag", and six other occurrences remained. A run whose seven golden invocations
disagree about a knob is precisely the failure being guarded, so "somewhere" is not the invariant:

```
steps(yml) = yml.split(/^ {6}- /m)          # step boundaries
carrying(yml, flag) = steps.filter(step => reaches(flag, step)).length
carrying(rcaeval, '--topo-discount') === carrying(rcaeval, '--topo-weight')     # 7 === 7
```

The yardstick is the knob's own **sibling**: `--topo-weight` is the additive form of this discount and is
wired at every invocation, so wherever a step expands the ranking array with the weight it must expand it
with the discount. Re-mutated, the fence is RED. Restored byte-identically (`sha256` compared).

## 4. A second defect, found because a mutation survived

`parseUnitInterval` — the `[0, 1]` parse the discount needed — was written as

```ts
const value = Number(raw);
return Number.isFinite(value) && value >= 0 && value <= 1 ? value : shipped;
```

`cli-args.ts` had **100% statements, 100% branches, 100% functions, 100% lines**. And no test in the
repository mentioned the function. Both facts are the defect: the branches were *executed* — an `if`
whose two arms each produce a number — and nothing *asserted* which number. Mutating the upper bound from
`1` to `2` left all 1417 benchmark tests green.

The second problem is inside the first: `Number('')` is `0`, and `0` is a legitimate fraction. An empty
flag value therefore became the setting `0` rather than "no value" — the same defect iteration 125 found
inside `parseWeight` and fixed there with `if (raw.trim() === '') return shipped`. Writing this function
with a raw `Number` reintroduced it one iteration later, in the same module.

Both are now tested, and both mutations are RED:

| mutation | result |
| --- | --- |
| `value <= 1` → `value <= 2` | RED — "refuses anything outside [0, 1]" and the CLI binding |
| `parseWeight(raw, NaN)` → raw `Number(raw)` | RED — "treats an EMPTY value as absent rather than as zero" |

The parse now delegates the "is this a number at all" rule to `parseWeight` and adds only the upper bound:

```ts
const value = parseWeight(raw, Number.NaN);   // NaN = parseWeight's refusal, told apart from a legal 0
return value <= 1 ? value : shipped;
```

## 5. What the repaired knob measures, locally

RE1-OnlineBoutique, 125 cases, one variable, `run-rcaeval.ts --suite re1 --topo-discount ρ`:

| ρ | AC@1 | cpu | delay | disk | loss | mem |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 (shipped) | 82.4 | 92.0 | 88.0 | 92.0 | 48.0 | 92.0 |
| **0.25** | **84.8** | 92.0 | **92.0** | **100.0** | 48.0 | 92.0 |
| 0.5 | 82.4 | 84.0 | 92.0 | 100.0 | 52.0 | 84.0 |
| 1.0 | 80.8 | 84.0 | 92.0 | 96.0 | 52.0 | 80.0 |

Two properties worth separating:

- **the curve has an interior maximum**, unlike the additive form whose sweep was monotone decreasing
  from the smallest weight tested (85.6 / 84.8 / 82.4 / 80.0 / 77.6 at 0.1 / 0.2 / 0.5 / 1 / 2). A
  maximum at the smallest weight is the signature of a term whose magnitude is mis-scaled; a maximum at
  0.25 with two fault types up and none down is a term doing work;
- **ρ = 0.25 is the same `+3 cases` as the additive form's best cell**, which is the point of the
  dimensionless form: it reaches the same local gain through a mechanism that does not depend on the
  score's units.

The local pair cannot speak for TrainTicket, and TrainTicket is the cell that matters: it is where the
additive form lost **46.4 pp** because a rank-normalised score has steps of `1/63` and an additive
`[0,1]` term at weight 0.1 is six of them. Whether the ratio form survives that scale is the nine-cell
question, dispatched at ρ = 0.25 and ρ = 0.1 with everything else shipped.

## 6. What this iteration changes about how readings are taken

1. **A dispatch is a claim, and the artifact is its falsifier.** The `signals:` line exists for this and
   it worked; what failed was the habit of reading a number before comparing the request with the config.
2. **A census must ask about the step, not only the name.** Three name-shaped directions were green while
   the knob was dead.
3. **Coverage is not assertion.** 100% on `cli-args.ts` and a surviving mutation on its only bound.
4. **A quantity's own domain is part of its definition.** `2` is not a stronger discount; it is a negated
   anomaly. The flag refuses it rather than clamping it, and the reason is written at the parse.

## 7. The nine cells: the dimensionless form is refused too, and the prediction is falsified

`docs/topological-source-direction.md` and §168 of the progress record predicted that a **ratio** would
survive where a constant failed: *"on TrainTicket the truth is the source and the winner is a caller, so a
multiplicative discount should move TT up where the additive form moved it down 46.4 pp."*

Dispatched at ρ = 0.25 and ρ = 0.1, everything else shipped, both with the repaired forwarding (so both
configuration lines read the value asked for — `topoDiscount=0.25` / `=0.1`):

| cell | cases | shipped | ρ=0.25 | ρ=0.1 |
| --- | ---: | ---: | ---: | ---: |
| RE1-OnlineBoutique | 125 | 103 | **106** | **106** |
| RE1-SockShop | 125 | 116 | 116 | 116 |
| **RE1-TrainTicket** | 125 | **94** | **35** | **46** |
| **RE1** | 375 | **313 (83.47%)** | **257 (68.53%)** | **268 (71.47%)** |
| RE2-OnlineBoutique | 90 | 76 | 77 | 76 |
| RE2-SockShop | 90 | 83 | 82 | 82 |
| **RE2-TrainTicket** | 90 | **67 (74.4%)** | **56 (62.2%)** | **57 (63.3%)** |
| RE2 | 270 | 226 | 215 | 215 |
| RE3 | 90 | 49 | 48 | 49 |
| **all three suites** | 735 | **588** | **520 (−68)** | **532 (−56)** |

**RE1-TrainTicket loses 59 of its 94 hits at ρ = 0.25 (−47.2 pp) and 48 at ρ = 0.1 (−38.4 pp); RE2-TT
loses 11 and 10.** Across the three suites the discount gives back **68 cases at ρ = 0.25 and 56 at ρ =
0.1**, out of 735. The prediction that the ratio form would survive the rank-normalised scale is **false**,
and with it the explanation that the additive form's damage was a UNIT problem: two different functional
forms — a bounded constant added to the score, and a dimensionless multiplier applied to it — cost the same
cells the same accuracy. The unit was not what was wrong.

## 8. What is actually wrong: the measure awards LEAVES, and TrainTicket is a graph of leaves

`topoSource(v) = 1 − max over callees c of (w(v→c) × anomaly(c))`. A node with **no callees** therefore
scores **exactly 1.0**, whatever its own anomaly, and can never be discounted; any node that calls
anything loses up to the full ρ. The measure is read as "is this node the origin of the propagation", but
on a sparse graph it is also, and often mostly, "does this node call anything at all".

TrainTicket is exactly such a graph, and the run prints it: `[topo] system=TrainTicket, edges=51 exact +
28 emb, svcs=64` — **79 edges over 64 services**, so most nodes are leaves and the ones that are not are
hubs. OnlineBoutique carries **14 services and 14 edges**, and its anomaly scores are RAW (order 1–3), so
a ≤25% multiplier is small against gaps of ~0.3; TrainTicket's 64 nodes trip
`anomalyNormalizeNodeThreshold = 20` and its anomalies are rank steps of 1/63 = 0.0159, so the same
multiplier is a large ordinal move.

The per-case flips do not spread: TrainTicket injects into **five** services, twenty-five cases each,
and the discount's effect is a property of WHICH service is the truth:

| truth service | cases | shipped | ρ=0.25 | ρ=0.1 |
| --- | ---: | ---: | ---: | ---: |
| `ts-auth-service` | 25 | 13 | **17** | 17 |
| `ts-route-service` | 25 | 17 | **18** | 18 |
| `ts-order-service` | 25 | 19 | **0** | 0 |
| `ts-train-service` | 25 | **25** | **0** | 6 |
| `ts-travel-service` | 25 | 20 | **0** | 15 |
| **TrainTicket** | 125 | **94** | **35** | **46** |

RE2 repeats it on the two services it shares with RE1: `ts-travel-service` 12 → 6 and `ts-order-service`
13 → 8; on the cells that IMPROVE the movement is a single case — OnlineBoutique's `currencyservice`
13 → 14 — and SockShop's `user` 17 → 16 is the only other loss.

**Three columns go to exactly zero — including one that was perfect: `ts-train-service` 25/25 → 0/25.**
A term cannot remove every instance of a service's fault because of that service's *identity* unless the
quantity it multiplies by is a property of the node rather than of the incident. The two services that
survive and improve are the ones whose callees carry no anomaly to be explained away; the three that
collapse are the ones that call other services which are themselves anomalous during the incident. The
losses land at ranks 2–11 (only 2 of 64 at rank 2), i.e. the multiplier's node-to-node variance is larger
than the rank gaps it multiplies, so it replaces the ordering rather than refining it.

This single defect explains three independent measurements that had been read as three facts:

1. the additive form's **−46.4 pp** on RE1-TT at weight 0.1;
2. this form's **−47.2 pp** at ρ = 0.25;
3. the term's recorded FSE'26 verdict of **−42.4 / −37.8 / −3.1 cases** — taken with what
   `topological-source-direction.md` calls the wrong sign, and explained here as a different and more
   basic problem: the sign was never the issue on a graph of this shape.

A unit test pins the defect rather than hiding it: `gives a LEAF exactly 1.0, whatever its own anomaly`.

## 9. What ships, and what is refused

| item | status |
| --- | --- |
| `--topo-discount` forwarded by all seven golden invocations | **shipped** (it produced no number before) |
| the census direction "workflow step → flag", per-step equality with the sibling knob | **shipped**, RED on both mutations |
| `parseUnitInterval` refusing `[0,1]` outside, and an empty value as absent | **shipped**, both mutations RED |
| `topoDiscount` recorded as HELD in the optimizer's mapping with its reason | **shipped** |
| `DEFAULT_TOPO_DISCOUNT` | **0 — the discount is not enrolled.** RE1 83.47 → 68.53 (ρ=0.25) / 71.47 (ρ=0.1) |
| `DEFAULT_TOPO_WEIGHT` | **0 — unchanged**, and now for a second reason: the signal it measures is degree-biased |

The successor is not a different ρ and not a different sign. It is a measure of *explanation* that is
comparable across nodes: the fraction of a node's anomaly that its callees can account for, compared
against the same fraction for the fleet, or normalised by out-degree — anything that does not award a
perfect score for having no out-edges. That is the next iteration's subject, and the yardstick is now
explicit: **on TrainTicket the truth `ts-order-service` must not be demoted for being a hub.**
