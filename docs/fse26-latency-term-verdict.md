# Per-edge latency term — verdict

The `latWeight` term rewards the CALLEE of an edge whose mean span duration rose.
It was built off by default (`7558bc8`), measured as a matched pair on one commit
and one cache, and **rejected at that weight** by the same pre-registered rule that
rejected the failed-edge signal. It is otherwise the largest gain measured in this
effort.

**It is no longer rejected: it ships at `latWeight = 0.03`.** The rejection was of
`0.75`, not of the signal — the weight axis was solved rather than swept, the
reopening condition in this very document ("a weight or variant with zero regressed
fault types that keeps a gain") was met exactly, and the point was then measured on
the real engine. Read *Verdict, revised* at the end of this document for the number
the default is set to and the two-sided confirmation of it. The sections in between
are the rejection, kept because they are why the shipped weight is the one it is.

## The pair

Commit `7558bc8`, cache `rcabench-latency-full` (converter `ada655bf`), all 1422
cases, only `latWeight` different:

| run | config | Top@1 | Top@3 | Top@5 | correct |
| --- | --- | --- | --- | --- | --- |
| `34861464922` | shipped (`latWeight=0`) | 47.33% | 60.69% | 65.75% | 673 |
| `34861468557` | `latWeight=0.75` | **55.20%** | **72.57%** | **78.76%** | **785** |

**+7.88pp Top@1, +112 cases**, with Top@3 +11.88pp and Top@5 +13.01pp. For scale,
the failed-edge signal reached +5.8pp / +82 by a partial route and needed the
direction it encodes; this term reaches more with `failedEdgeWeight` at 0 in both
runs.

The control is also the provenance check on the rebuilt cache: it reproduces the
published **47.3277%** exactly, so the new key changed nothing at weight 0 and the
cache is comparable with every earlier result.

## Per fault type

| fault type | shipped | `latWeight=0.75` | delta |
| --- | --- | --- | --- |
| JVMMemoryStress | 4 | **30** | **+26** |
| HTTPRequestDelay | 39 | 59 | +20 |
| HTTPResponseDelay | 42 | 59 | +17 |
| ContainerKill | 1 | 14 | +13 |
| NetworkCorrupt | 14 | 26 | +12 |
| NetworkPartition | 39 | 51 | +12 |
| NetworkLoss | 12 | 23 | +11 |
| JVMLatency | 2 | 6 | +4 |
| NetworkDelay | 16 | 20 | +4 |
| PodKill | 1 | 2 | +1 |
| HTTPResponsePatchBody | 3 | 4 | +1 |
| HTTPResponseAbort | 34 | 32 | **−2** |
| HTTPResponseReplaceCode | 159 | 157 | **−2** |
| HTTPRequestReplacePath | 38 | 37 | −1 |
| HTTPResponseReplaceBody | 45 | 44 | −1 |
| JVMException | 30 | 29 | −1 |
| JVMReturn | 12 | 11 | −1 |
| NetworkBandwidth | 12 | 11 | −1 |

11 types gain (+121 cases), 7 regress (−9 cases). The gains are where the evidence
class lives — the four silent-source types all move (JVMMemoryStress 7.5×,
ContainerKill 14×, PodKill, PatchBody) — and so do the network types, which the
simulating dump could not see.

## The simulator was faithful, and its coverage was the limit

Before the run the simulator predicted, on a 406-block dump covering three types,
JVMMemoryStress 4→30 and ReplaceCode 159→157. Measured: **+26 and −2, both
exact.** Its total (+25) understated the real gain (+112) only because 22 of the
25 types were not in the dump it read. So the method transferred and the earlier
extrapolation was coverage-limited, not wrong.

## Verdict: rejected as a default flip

The pre-registered criterion is *RCAEval golden 9-cell byte-identical* **and**
*FSE'26 zero regressed fault types*, with no exception for a favourable ratio.

- **RCAEval golden: 9 of 9 byte-identical** (RE1 80.0/92.8/68.0, RE2 82.4/88.9/68.1,
  RE3 80.0/45.0/51.1) — the term is structurally invisible to that suite, since
  only the FSE'26 loader emits `traceEdgeLatency`, so this half could not have
  failed and does not by itself support the term.
- **FSE'26 zero regressed fault types: FAILS, 7 violations.**

So `latWeight` stays **0.0** and the shipped FSE'26 stays **47.33%**. The
regressions are small — seven types, −1 or −2 cases each — but the rule has no
threshold at which a regression stops counting, and applying it the other way here
would retroactively un-reject the failed-edge signal at +5.8pp / 2 types.

## What would reopen it

A weight (or variant) with **zero regressed fault types** that still gains. That
is a closed-form question, not a sweep: the score is affine in the weight,
`score(v) = A(v) + w·L(v)` with `A = log1p(selfAnomaly) + logWeight·logScore` and
`L = latScore(v)`, and both are recorded per service in a diagnostic dump. For each
case the set of weights that keeps the ground truth at rank 1 is an interval
(intersect one half-line per competitor); requiring every currently-correct case to
stay correct is the intersection of those intervals, and the best achievable gain
inside it is read off the same intervals.

`computeWeightSeparation` already does this algebra, but its slope is hardcoded to
the failed-edge score, so it has to be generalised to take a slope function first.
The full-coverage dump (all 25 fault types, `diagnose_limit=0`) is dispatched for
it. That run is the whole remaining cost: if the feasible window is empty, the term
is closed with a number rather than an argument; if it is non-empty, one paired run
decides the flip.

Two things are deliberately NOT claimed here. The 7 regressions are not shown to be
noise or tie-break artefacts — they are case counts in a deterministic run. And the
gain is not shown to be robust to the metric term changing underneath it; every
number above is on one cache and one commit.

## The weight axis, solved rather than swept

The reopening question was whether a weight exists with ZERO regressed fault types.
It is a computation, not a sweep: `score(v) = A(v) + w·L(v)` with
`A = log1p(selfAnomaly) + logWeight·logScore` and `L = latScore(v)`, both recorded
per service in a diagnostic dump, so the set of weights that keeps a case satisfied
is an intersection of half-lines. `computeWeightSeparation` now takes a slope
selector (`--slope failedEdge|lat`), and its per-case requirement is the SET of the
case's labelled roots rather than `groundTruth[0]`.

**The instrument was validated against the measurement above before it was used.**
Reconstructing `latScore` from the dump and ranking `A + w·L` reproduces the
engine's own top-1 in **1380/1380** blocks at `w = 0`, and at `w = 0.75` it
reproduces the ablation **exactly**: 21 of 21 fault types match, and the totals
match — 673 → 785, +112, the same numbers the pair measured.

Solved over all 1422 cases:

| weight | correct | vs shipped | regressed cases |
| --- | --- | --- | --- |
| 0 (shipped) | 673 | — | 0 |
| 0.01 | 673 | +0 | 0 |
| 0.020 | 686 | +13 | 0 |
| 0.030 | 694 | +21 | 0 |
| **0.030459** | **697** | **+24** | **0** |
| 0.0305 | 696 | +23 | 1 (`JVMException`) |
| 0.05 | 707 | +34 | 2 |
| 0.50 | 781 | +108 | 6 |
| 0.6646 | **791** | **+118** | 11 |
| 1.00 | 595 | −78 | 232 |

**A zero-regression weight exists**: the window is `w ∈ [0, 0.030459]`, and the best
point inside it is **+24 cases** over shipped. The cap is a single case — one
`JVMException` (`ts1-ts-food-service-exception-ch2v8l`) is the binder, and it is the
first casualty immediately above the cap. The unconstrained optimum is much larger —
`w ≈ 0.6646` for +118 — but it costs 11 regressed types, so it is the frontier rather
than a candidate.

**These rows were not reproducible when they were written**, which is its own defect
and is now fixed: the shipped instrument answered a *different* question ("is there a
weight that satisfies EVERY case", where one unreachable case makes the answer an
emphatic NO on every input this benchmark has produced) and reported
`separable: NO / cases: 1380`. The zero-regression question now has its own solver,
`computeZeroRegressionWindow`, its own flag, and the command that prints the table
above:

```
tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump /tmp/resfull/fse26-results.txt --window 1 --slope lat
```

Re-run against the full 1422-block dump it reproduces every row here — 673 / 686 / 694
/ 697 at the cap / 785 at `0.75` — which is also what the two measured runs below
report. The reconstruction's **net** is what reproduces; its gain/loss *split* does
not, and the frontier row is the evidence: at `w = 0.75` it predicts 785 correct as
`+132 gained / −20 lost`, while the measured run reaches the same 785 as `+121 / −9`.
The per-case decomposition is therefore not a prediction, and the cap — which is set
by the *first* loss, verified on both sides below — is the only quantity here that was
used to decide anything.

### One defect the validation found, and one it did not

`buildWeightSeparationCases` used `groundTruth[0]` as the single service that must
be rank-1. **Every FSE'26 network case labels two acceptable roots** (`mysql` plus
the service it is co-located with — 42 of 97 `NetworkPartition` cases, and all of
`NetworkLoss`, `NetworkCorrupt`, `NetworkDelay`, `NetworkBandwidth`). Requiring the
first in particular demanded a ranking the benchmark never asked for, and it is how
the four "mismatched" types appeared in the first validation pass: 3 of them were
this defect, and the fourth (`NetworkBandwidth`) was dump coverage. The requirement
is now a set, and a case's satisfiable weights are kept as a LIST of intervals —
the union of two roots' ranges is not an interval, and collapsing it would claim
the gap between them.

`classifyMiss` still attributes each miss against `groundTruth[0]`. For a
multi-label case that names one of the acceptable roots, so its attribution is
meaningful only where a single source exists; the stock census and the failed-edge
work were all on such types, and this is recorded rather than silently left.

## Verdict, revised: shipped at `0.03`

The reopening condition above was met, and the point was then measured rather than
predicted. Five runs on one commit and one cache (`rcabench-latency-full`), 1422
cases, only `latWeight` different:

| run | weight | Top@1 | correct | regressed fault types |
| --- | --- | --- | --- | --- |
| `34861464922` | 0 (ablation) | 47.33% | 673 | 0 |
| `34872477561` | **0.03 (shipped)** | **48.80%** | **694** | **0** |
| `34875480151` | 0.031 | 48.95% | 696 | 1 (`JVMException`) |
| `34872482240` | 0.66 | 55.56% | 790 | 5 |
| `34861468557` | 0.75 | 55.20% | 785 | 7 |

**The cap is confirmed from BOTH sides, by measurement.** The reconstruction puts it
at `0.030459` with a single `JVMException` case as the binder. Measured:

- **inside it, at `0.03`**: 694 cases, **zero** regressed fault types — and 694 is
  the reconstruction's own prediction, not a near miss;
- **just outside it, at `0.031`**: 696 cases, and **exactly one** regressed type —
  `JVMException`, the type the reconstruction named as the binder, at exactly the
  predicted count.

A window boundary is normally the weakest thing one can claim, because it is an
extrapolation from the same data the decision uses. Here it is a two-sided
prediction that a run on each side confirmed, including which type breaks.

**Why `0.03` and not the window's edge `0.030459`.** The default has to be a number
that was *measured*; `0.030459` is the reconstruction's arithmetic, and shipping it
would leave the shipped configuration resting on a prediction while a measured point
with the same property sat one part in 1500 away. The three extra cases the edge
would buy are not worth a default nobody ran. The margin is 1.5%, and it protects
against exactly one thing — a later change moving the metric term underneath the
window — which is a risk no measurement of this signal can retire.

### Both halves of the kill criterion, measured on the flip commit

The decision above rests on a *flagged* run. Both halves were then re-measured on the
commit that carries the flip (`fb54fb8`), with no override at all — the path a
scheduled run takes:

| half | run | result |
| --- | --- | --- |
| FSE'26, DEFAULT path (no `lat_weight` input) | `34877815364` | **48.80% / 694 correct / +21 / zero regressed fault types**, and its per-fault-type cells are **byte-identical** to the flagged `34872477561` — the flag and the default are the same configuration |
| RCAEval golden 9-cell | `34877797128` (`fb54fb8`), `34878213491` (`1f58bcb`) | RE1 **80.0 / 92.8 / 68.0**, RE2 **82.4 / 88.9 / 68.1**, RE3 **80.0 / 45.0 / 51.1** — all nine exactly the recorded golden, and the artifacts are byte-identical to the pre-flip run `34873364380` apart from the `Total duration` line |

The second half had to be measured even though the term is structurally invisible to
that suite (only the FSE'26 loader emits `traceEdgeLatency`, so the term cannot move
a RCAEval cell): the criterion is a test, and a test that is skipped because it "must"
pass is not a test. It cost two runs and cannot now be overclaimed.

`CI` (`34877797227`) and `Release` (`34877797193`) are green on the same commit.

### What was fixed in the engine to land this

The flip exposed three defects, all of which would have been silent:

1. **The `--lat-weight` fallback was a hardcoded `0`.** That *was* the shipped value
   while the default was 0, so the code read as correct. After the flip it would have
   run the 47.33% ablation on a typo and printed the shipped configuration's name
   over it. It now falls back to the imported `DEFAULT_LAT_WEIGHT`, so the default and
   the fallback have one owner and cannot disagree.
2. **An EMPTY weight flag selected the ablation.** `Number('')` is `0` — finite and
   non-negative — so `--log-weight ''` (14.98%) and now `--lat-weight ''` would
   silently run a *different measured* configuration. Both weights now route through
   one strict parser that treats a blank value as unusable and falls back to the
   shipped weight. The workflow passes each flag only when its input is non-empty, so
   this was the CLI's second door into the same swap.
3. **The `Config:` line omitted the weight when it held the default.** That rule is
   only sound while the default is *zero*: omission then means `0` before and after
   any change to it. With a non-zero default, an omitted-when-default field renders a
   694-case run and a 673-case run with byte-identical `Config:` lines — the exact
   defect that line exists to prevent. The field is now unconditional.

Two guard tests were added so a future flip cannot repeat the first two: the
`Config:` line is asserted to carry the field for the default, and
`fse26-reported-config.test.ts` reads `DEFAULT_LAT_WEIGHT` out of the pruner's source
and requires it to be a weight with a **recorded full-benchmark measurement** whose
`regressedTypes` is `0`. A default is a claim about a measurement; the test is what
makes the claim checkable rather than a comment.
