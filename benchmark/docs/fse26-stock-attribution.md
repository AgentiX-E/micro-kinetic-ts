# The silent-source stock, attributed case by case

Run `34813401805` (commit `ccecee1`, cache `rcabench-full-v3`) with
`diagnose=JVMMemoryStress,ContainerKill,PodFailure,PodKill,HTTPResponseReplaceCode`
and `diagnose_limit=0`: **522 diagnostic blocks**, read back with
`analyze-fse26-diagnose --log-weight 1 --misses` at `logWeight=1`.

This is the first attribution of the whole block from the score side. Its purpose
is routing: 294 cases at ~2% Top@1 is the largest remaining stock, and the first
question is which part of it is even addressable.

## The table

| fault type | cases | wrong | silent both sides | `metric` | `log` | `both` |
| --- | --- | --- | --- | --- | --- | --- |
| JVMMemoryStress | 171 | 167 | 32 | 62 | 62 | 43 |
| ContainerKill | 88 | 87 | 25 | 44 | 24 | 19 |
| PodFailure | 23 | 23 | 9 | 9 | 2 | 12 |
| PodKill | 9 | 8 | 4 | 6 | 1 | 1 |
| **stock total** | **291** | **285** | **70** | **121** | **89** | **75** |
| *(contrast)* HTTPResponseReplaceCode | 231 | 72 | **53** | 67 | 1 | 4 |

`metric` = the winner's own anomaly is higher; `log`/`both` = error evidence
pointed at the winner; `silent both sides` = neither the source nor the winner
emitted a single error line. `tie` and `unexplained` are **0 across all 522
blocks** — the engine's order is self-consistent with the two terms the dump
carries, so nothing here is an engine defect.

## It reproduces the published split, independently

`docs/fse26-metric-competition-verdict.md` split this block as **166 log-decided /
122 metric-rank-decided**, from the score decomposition of a different run.
Measured here, from the dump's own terms and a different classifier:

| | published | this measurement |
| --- | --- | --- |
| log-decided | 166 | **164** (`log` 89 + `both` 75) |
| metric-decided | 122 | **121** (`metric`) |

Two cases apart on 285. That agreement is the point: it means the instrument is
sound, and — more usefully — it means the block's internal structure is
over-determined by two independent readings, so the next candidate does not need
to re-measure it. **The log-side axis is closed** (`docs/fse26-logweight-sweep-verdict.md`:
per-fault-type oracle ceiling +2.67pp → 50.00%), and this table says why: of the
164 log-driven misses, 70 have no log evidence at all and the rest are decided by
**the victim's** lines, which no weight can re-point.

## What it routes to

Two numbers to act on:

1. **160 of the 357 wrong cases in this dump (45%) are silent on both sides** — no
   log-side intervention can move them. They are metric-layer losses by
   construction.
2. **`HTTPResponseReplaceCode`, the largest type (231 cases) and the largest
   headroom (159 → 231 possible), is 53 of 72 wrong for this reason** — 74%
   both-silent, and only 1 log-decided.

So the remaining axis is the one the verdict already nominated: **the metric
term's shape**. Its constraints, all already measured and none of which the next
candidate may re-open:

- `rankNormalization` is load-bearing (Train Ticket RE3 36% → 51.1%) — not
  revertible;
- a global min-max normalisation of the metric score measured **+0.00pp**;
- a monotone compression of the total was proved non-reordering and measured
  **−2.67pp**;
- the dimension theorem bounds any reweighting: both terms are normalised, so a
  log-silent service can overtake only within `logWeight < m(s) − m(w) ≤ 1`.

What is NOT yet measured is a monotone transform of the **metric term alone** —
which does change the spacing between two services' scores and is therefore not
the non-reordering case. That is the next falsifiable candidate, at the step size
the theorem names: the metric term is a uniform rank with step `1/(n−1) ≈ 0.020`
at 51 services, while the log term's first step is already 1.0 = 50 rank positions.

## Correction: `HTTPResponseReplaceCode` is two populations, not one

`docs/fse26-data-gap-verdict.md` characterises this type as "signal gap, the top
lever" from a diagnostic of **12 case dumps across 4 fault types**, in which the
ReplaceCode samples had `ts-basic-service` as the source. A census of all 231
blocks says that generalisation does not hold at the type level:

| source service | cases | Top@1 | rate | source emits logs |
| --- | --- | --- | --- | --- |
| **`ts-ui-dashboard`** | **58** | **0** | **0.0%** | **0 / 58 — never** |
| the other 10 backends | 173 | 159 | **91.9%** | 173 / 173 — always |
| total | 231 | 159 | 68.8% | 173 / 231 |

So the type is not weak: it is **at 91.9% for 173 of its cases and 0.0% for the
other 58**. The gate mechanism the verdict identified is correct and is what the
173 cases exercise — the source floods `HttpClientErrorException` and the
`isLogicException` gate drops it, yet those cases still score 91.9% because the
source is rank-1 on the metric term anyway. The 58 dashboard cases are a different
population with a different cause.

### What the 58 are

- the source emits **no** log line in any of them (0/58);
- its own anomaly is mid-pack: rank 1 in **1 of 58**, typically **#13–19**, with
  values mostly 0.2–0.4 — no fault-specific signature, and its dominant metric is
  a mix of `k8s.pod.network.io` and HTTP duration percentiles;
- **every one of the 58 carries failed-edge records** (58/58), i.e. in-graph
  callers' calls failed against the dashboard. The evidence exists and is
  callee-side.

That last point connects them to the failed-edge signal: enabling it moves this
type 159 → 220 (+61), which is close to the whole dashboard population, and the
`minRecords=2` floor drops it back to 158 — the same single-record population
either way. So the 58 are **addressable by callee-side attribution and were not
addressed only because the same evidence mis-ranks `JVMMemoryStress`**.

### Why no discriminator is proposed here

The credited callee is `ts-ui-dashboard` in **both** populations — correct in the
58 (it is the source) and wrong in the JVMMemoryStress regressions (it is a
victim). Anything that keys on the service's identity therefore cannot separate
them. The two populations do differ in the source's own evidence — max anomaly and
no failed-edge records in the JVMMemoryStress cases, mid-pack anomaly and
failed-edge records here — but every rule built on that difference so far has
excluded both populations together. That is recorded rather than re-proposed:
**a candidate needs a discriminator that is not a function of the credited
service's identity or of its own metric score**, and none has been found yet.

## The discriminator exists, and it is structural

Run `34828878066` (commit `66f7e05`) adds the call graph to the dump, which makes the
question answerable. Read over that dump, the failed-edge term moves 107 cases; 62 of
them it fixes and 7 it breaks (a computed superset of the 5 measured on the pair,
because this recomputation uses a cruder tie-break than the engine).

The first thing the graph shows is a GT-CONDITIONED discriminator that is perfect and
useless: in 62 of the 62 fixed cases the credited callee **is** the source, and in 6 of
the 7 broken cases it is a **direct caller of the source** (distance 1). A rule of the
form "do not credit a caller of the source" separates the two populations exactly — and
cannot be implemented, because the engine does not know the source.

The unconditional form of the same fact does work, and it is a RELATION rather than a
property of the credited service:

> credit the callee only when its own anomaly is not explained by a dependency of its
> own — i.e. when it is a topological source.

| group | gate `selfAnomaly(callee) >= max selfAnomaly(its callees)` |
| --- | --- |
| the 7 broken cases | **rejected in 6 of 7** |
| the 62 fixed cases | **no case has a distinct callee, so the gate never has to decide — it costs nothing** |

The mechanism is visible in the numbers: in the three `ts-ui-dashboard` breakages the
dashboard's own anomaly is 0.34–0.54 while its 22 downstream dependencies peak at
**1.000** — the maxima ARE the sources it waits on. The dashboard's anomaly is
inherited, and the gate says so without being told where the fault is.

This satisfies the reopening condition the closed-axes register set for this axis (a
discriminator that is neither the credited service's identity nor its own metric
score), and it is the same shape the metric-competition verdict left open as its second
surviving family: **expressed against the other services' values**, here against the
callee's own dependencies rather than against the fleet.

Two caveats stated rather than deferred. The gate is not a full repair: one broken case
(`ts-travel-service`, self 0.980 vs downstream max 0.900) satisfies it and would still
break, so the expected regression count is one rather than zero and the kill criterion
is NOT yet met by argument. And this is a separability result computed on one dump, not
a measured gain — the next step is to build the gate and measure the pair, with the
affine solver used first to confirm a weight exists.

## The structural gate is REJECTED — by simulation, before spending a run

The separability result above was computed only over the cases where the credited callee
was DISTINCT from the source, and that is the flaw in it: the gate also has to decide for
the cases where the credited callee IS the source, and there it can only take the credit
away. A simulation over the same 406-block dump shows the cost.

The simulator was validated first: ranking every case by
`log1p(selfAnomaly) + logScore + w × failedEdge` reproduces the dump's own top-1 in
**406/406** cases at `w = 0`, so it is faithful and its deltas are trustworthy.

| fault type | cases | shipped (`w=0`) | `w=1` | `w=1` + gate |
| --- | --- | --- | --- | --- |
| HTTPResponseReplaceCode | 231 | 159 | **219** | **148** |
| JVMMemoryStress | 171 | 4 | 1 | **4** |
| HTTPResponsePatchBody | 4 | 3 | 1 | **3** |
| total | 406 | 166 | 221 | **155** |

`w=1` reproduces the measured ablation (ReplaceCode 220, JVM 1, PatchBody 1) to within one
tie-break case, and the gate recovers both regressed types in full — while costing
**71 ReplaceCode cases**. The net is **155 against a baseline of 166: worse than doing
nothing.**

### Why the gate cannot work here

Asked of the GROUND TRUTH itself, the gate answers **False** far more often than True:

| source service | cases where `self >= max(downstream)` is False |
| --- | --- |
| `ts-ui-dashboard` | **57 of 58** |
| `ts-basic-service` | 50 |
| `ts-preserve-service` | 22 |
| `ts-route-plan-service` | 21 |

The dashboard's median self-anomaly is **0.320** against a downstream maximum of **0.980**.
So the test is not a source detector at all: it is a detector for "is the source the single
most anomalous service in this case", which is precisely what the metric layer is bad at.
Gating a second signal on it re-imposes the failure the second signal exists to repair.

### Corrected

The previous section's claim that the gate "costs nothing on the 62 fixed cases" is wrong
and is corrected here rather than left standing. It was computed on the subset where the
credited callee differs from the source, which is the only subset where the gate has a
choice to make about *another* service — the cases it destroys are the ones where the
callee is the source and the gate takes its credit away. **A gate has to be measured on
both populations, not only on the one it is meant to reject.**

## The whole block, split by whether the source emits at all

One line per fault type over the 522-block stock dump, with `HTTPResponseReplaceCode`
kept as the contrast. Cells are Top@1 correct / cases.

| fault type | blocks | wrong | source EMITS | source SILENT | winner emits |
| --- | --- | --- | --- | --- | --- |
| JVMMemoryStress | 171 | 167 | 1/93 (1.1%) | 3/78 (3.8%) | 115 |
| ContainerKill | 88 | 87 | 0/38 (0.0%) | 1/50 (2.0%) | 48 |
| PodFailure | 23 | 23 | — | 0/23 (0.0%) | 14 |
| PodKill | 9 | 8 | 1/3 (33.3%) | 0/6 (0.0%) | 4 |
| **HTTPResponseReplaceCode** | 231 | 72 | **159/173 (91.9%)** | **0/58 (0.0%)** | 178 |

**Whether the source emits predicts the outcome for exactly one of these types.** On
ReplaceCode it separates 91.9% from 0.0%; on the four silent-source types it separates
nothing — 1.1% against 3.8%, 0.0% against 2.0%, nothing at all, 33% against 0% on three
cases. And on every one of the four the winner emits far more often than not (115 of 167,
48 of 87, 14 of 23), so the log term is not merely unhelpful there: it is usually
pointing at the other service.

This is the correction to "the signal gap is the top lever" that
`docs/fse26-data-gap-verdict.md` proposes. Widening the log gate can only serve the
ReplaceCode block, and **159 of those 173 cases already succeed** — the gate is not what
they depend on. The lever the verdict names is therefore 58 cases plus whatever the 285
of the four other types need, and those 285 cannot be moved by any change to what the log
signal accepts.

## Correction: the attribution now models the LATENCY term

The table above was read on `rcabench-full-v3` at `logWeight=1` with no latency term,
and it says `unexplained` is 0 across all 522 blocks — "the engine's order is
self-consistent with the two terms the dump carries". That sentence is true of the run
it describes and was still **read as a fact about the engine**, which it is not: it is a
fact about a TWO-TERM view, and the shipped engine has had a third term since `fb54fb8`.

Re-read on the SHIPPED configuration (run `34928980425`, commit `eb2042a`, cache
`rcabench-latency-full`, `latWeight=0.561495` + `latMinRise=10.3`), the same command
reported **`unexplained 12`** — a value the diagnostic documents as "a bug, or a wrong
weight — never a result". All twelve were the shipped latency term's own decisions: the
classifier compared only the metric and the log, so the signal that shipped was invisible
to the very report used to decide what to fix next.

`classifyMiss` now models every term the dump carries, the report names them in its
banner, and the combination labels are spelled out (`metric+lat`, `log+lat`,
`metric+log+lat`) because with three terms a single "both" stops saying which two.
All 672 misses on the shipped configuration:

| kind | count | meaning |
| --- | --- | --- |
| `metric` | 275 | the winner's own anomaly is higher, alone |
| `log` | 120 | error evidence points at the winner, alone |
| `lat` | 12 | only the per-edge latency rise favours the winner |
| `metric+log` | 116 | |
| `metric+lat` | 50 | |
| `log+lat` | 25 | |
| `metric+log+lat` | 74 | |
| `unexplained` | **0** | now a real statement, because every shipped term is modelled |
| *silent both sides* | 230 | orthogonal cut: no error evidence on either side |

**The latency term is implicated in 161 of the 672 misses** (12 + 50 + 25 + 74), and 149
of those were previously attributed to the metric or the log — i.e. the two-term report
routed ~22% of the remaining misses to the wrong layer.

Two checks that this is an EXTENSION and not a rewrite: `--lat-weight 0` reproduces the
old numbers **exactly** (275→325 `metric`, 120→145 `log`, +190 `metric+log`, 12
`unexplained`, 230 silent), and the three `lat`-involving labels are exactly the cases the
old report could not explain. The defaults for `--lat-weight` and `--lat-floor` are now
the SHIPPED constants, imported from the engine, so a diagnostic that says nothing
describes the engine that shipped; an ablation has to be written down.
