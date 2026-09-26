# The weak-fault-type block: two hypotheses, both closed by one control

`JVMMemoryStress` (12/171), `ContainerKill` (6/89), `PodFailure` (0/24) and `PodKill` (1/10)
are the largest block of misses on FSE'26 and the one the register has called "the signal
gap and the top lever" since `fse26-data-gap-verdict.md`. This document closes the two
hypotheses a reader arrives with, using a control that needs no run, no rebuild and no
weight: **the cases the engine already gets right, inside the same fault type.**

Reproduce with one command on the shipped dump:

```bash
npx tsx benchmarks/src/analyze-fse26-diagnose.ts --dump <dump> --guard-census
```

## 0. Correction: which service the "source side" column was about

The census originally took the case's source as `groundTruth[0]`. Five fault types name **two
acceptable roots** — the FSE'26 network faults declare a `mysql`-side service and the service
it is co-located with — and for those the first root is not always the most anomalous one, so
the column was sometimes about a different service than the one a reweighting would have to
lift. The definition is now one rule, shared with the separator screen
(`sourceOf`: the ground-truth service with the highest self-anomaly, ties by id), and **five
rows moved**:

| fault type | column | was | now |
| --- | --- | --- | --- |
| `NetworkPartition` | source drop rate wrong / ok | 25.3% / 21.2% (Δ +4.1pp) | 22.2% / 16.1% (Δ **+6.2pp**) |
| `NetworkLoss` | Δ | −1.4pp | **−0.5pp** |
| `NetworkCorrupt` | drop rate, Δ | 17.6% / 21.2%, −3.6pp | 14.9% / 17.5%, **−2.5pp** |
| `NetworkBandwidth` | Δ | +6.8pp | **+9.0pp** |
| `NetworkDelay` | ok rate, Δ | 18.4%, +1.1pp | 17.7%, **+1.8pp** |

Nothing else moved: **every row the block's conclusions rest on is unchanged**
(`JVMMemoryStress` 66.4%/66.8%, `ContainerKill` 65.9%/66.5%, `ReplaceCode` 32.5%/20.6%), and
neither is the register's row, whose numbers all come from types with a unique root. What the
correction does change is §Hypothesis 2's second family: with the correct root the network
types mostly stop separating instead of separating 2–4×, which **narrows** the "the source is
weak" description to the HTTP types and strengthens this document's conclusion rather than
weakening it. It is also the more general lesson: two modules answering "which service is this
case about" differently is a defect that shows up as a moved table, not as an error.

## Hypothesis 1 — "the transient guard is hiding the fault"

The engine discards **44% of the source side's metrics** across the 666 misses under one
guard, `transient-return`, against **24% of the wrong winner's**. On `JVMMemoryStress` the
source side loses **66%** of its inventory (4838 transient drops against 2453 kept) while
the winner loses 30%. The guard's own comment states its premise — "the fault source's
shift is PERMANENT (its head ≠ tail)" — and a duration-bounded chaos fault does not satisfy
it: the series returns during the window, `permanence < 0.3`, and the metric is dropped as
a symptom. A `JVMMemoryStress` source with `container.memory.*` in the dropped set is the
picture this hypothesis predicts.

The census, over every case of each type. `Δ` is the source's transient-drop rate in the
**wrong** cases minus the rate in the **correct** ones:

| fault type | n=ok/all | drop rate: wrong / ok | Δ |
| --- | --- | --- | --- |
| `HTTPResponseReplaceCode` | 160/231 | 32.5% / 20.6% | **+11.8pp** |
| `HTTPResponseReplaceBody` | 45/51 | 23.3% / 16.4% | +6.9pp |
| `HTTPResponseAbort` | 34/44 | 28.2% / 20.3% | +7.9pp |
| `HTTPRequestReplaceMethod` | 127/190 | 27.7% / 22.6% | +5.1pp |
| **`JVMMemoryStress`** | 12/171 | 66.4% / **66.8%** | **−0.5pp** |
| **`ContainerKill`** | 6/89 | 65.9% / **66.5%** | **−0.6pp** |
| `HTTPRequestAbort` | 47/60 | 21.9% / 23.6% | −1.7pp |
| `NetworkCorrupt` | 24/46 | 14.9% / 17.5% | −2.5pp |
| `JVMReturn` | 12/21 | 24.9% / 24.6% | +0.3pp |
| `PodKill` | 1/10 | 74.6% / 63.4% | +11.2pp |

**The footprint does not separate, and on the block it is flat.** On `JVMMemoryStress` the
guard fires on the source at 66.4% in the cases that fail and 66.8% in the twelve that
succeed — it fires on essentially every case of the type, so it carries **no information
about which is which**. The largest Δ is on the type the engine is BEST at
(`ReplaceCode`, 69.3%), which is the opposite of what "the guard hides the signal" predicts.

That is the whole point of the control. A 66% footprint is a property of the population; a
property of the population cannot be the reason two cases in it differ. **The axis is
closed by measurement, not by argument** — and it should not be re-proposed from the
footprint, which is exactly the shape of a necessary-condition count that never converts.

## Hypothesis 2 — "the source's signature is too weak to be seen"

The census reports the source's strongest **rendered** deviation (a lower bound on its
maximum: the block renders the decomposition for the top few kept metrics only), median
over each group, plus the same for the wrong winner:

| fault type | source dev: wrong / ok | wrong winner's dev |
| --- | --- | --- |
| `HTTPResponseReplaceCode` | **0.45** / 1.33 | 1.50 |
| `HTTPRequestReplaceMethod` | **0.52** / 1.21 | 1.69 |
| `NetworkBandwidth` | 1.68 / 2.79 | 2.03 |
| `NetworkPartition` | 1.55 / 2.07 | 2.26 |
| `NetworkCorrupt` | 1.60 / 1.59 | 1.96 |
| `NetworkLoss` | 2.02 / 1.97 | 1.98 |
| **`JVMMemoryStress`** | **0.96** / 1.00 | 1.23 |
| **`ContainerKill`** | **0.85** / 1.23 | 1.38 |
| `PodKill` | 0.82 / 1.60 | 1.66 |
| `JVMLatency` | 0.82 / 1.70 | 1.77 |
| `HTTPRequestAbort` | 0.56 / 1.23 | 1.65 |

**Two families, and they need opposite statements.**

- The **HTTP** types separate: `ReplaceCode` shows the source's excursion 3× weaker in the
  cases that fail than in the cases that succeed (0.45 against 1.33), and `ReplaceMethod`
  0.52 against 1.21. Here "the source is weak" is a real description — and it is also the
  half of the dataset that already works (69.3% and 66.8%).
- The **resource and JVM** types do **not** separate: `JVMMemoryStress` shows the source at
  **0.96 when the engine fails and 1.00 when it succeeds**. The source is equally anomalous
  either way. `ContainerKill` is 0.85 against 1.23 on six correct cases, and `PodKill`
  0.82 against 1.60 on one.
- The **network** types read as a third case, and the correction of §0 is what shows it:
  `NetworkLoss` (2.02 against 1.97) and `NetworkCorrupt` (1.60 against 1.59) are flat, while
  `NetworkPartition` (1.55 against 2.07) and `NetworkBandwidth` (1.68 against 2.79) separate
  by ~30% — weaker than the HTTP types, and on populations where the two acceptable roots are
  a pair rather than a service.

So for the block the source is **not invisible** — it is exactly as visible in the cases
that fail. No change that makes the source's own excursion louder can help, because the
quantity it would amplify does not distinguish the two groups; and the block is precisely
where that quantity is flat.

## What this closes, and what it leaves

Both of the block's headroom hypotheses are now measured and dead, and they are distinct
from the axes already closed around them:

| hypothesis | number that closes it | why it is not a proposal |
| --- | --- | --- |
| the `transient-return` guard hides the source | Δ = −0.5pp on `JVMMemoryStress`, −0.6pp on `ContainerKill`; fires on 66% of BOTH groups | a population property cannot separate two cases in that population |
| the source's signature is too weak | source dev 0.96 (wrong) against 1.00 (correct) on `JVMMemoryStress` | the quantity to amplify does not separate the groups |

Together with the rows already in the register — the metric term's shape and spacing
(`fse26-metric-competition-verdict.md`), the winner-side family penalty
(`fse26-family-screen-verdict.md`), the input ablations (`fse26-httpnet-miss-verdict.md`) —
the block now has a four-measurement closure: **the source is present, the source is as
anomalous as it is in the cases that succeed, the guard that discards it fires equally in
both, and every weight, family and shape that could re-rank it has been solved.**

What is left for the block is therefore the same object as for the rest of the map: the
**wrong winner's own excursion**, which exceeds the source's by a small margin (1.23 against
0.96 on `JVMMemoryStress`), and no transformation of the source's side can reach it. A
candidate must act on the rival — and the rival-side family axis is measured-exhausted, so
what it needs is evidence the dump does not carry: the fault is over in the window while the
victim's cascade is not, and nothing in the dump records which.

## Why the control is the deliverable

The census ships as a section (`--guard-census`) rather than as a paragraph, because the
section is what makes the next reader's question answerable before they write a candidate:
it prints BOTH rates beside their difference, and it prints `n/a` for a group with no cases
rather than a zero. A single "footprint" number — 66%! — is what invites the hypothesis in
the first place, and the guard's own code comment has said since it was written that its
diagnostic exists "to reveal whether a genuine fault signature is being mistaken for a
transient symptom". That question now has an answer, and it took one flag.
