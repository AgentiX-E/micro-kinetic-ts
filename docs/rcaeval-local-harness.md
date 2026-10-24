# The local RCAEval harness — one third of the RE1 cell in 7.3 seconds

## Why this document exists

Every RCAEval experiment in this repository's history has cost a two-hour dispatch and returned nine cell
averages. That is enough to decide a shipped default and not enough to ask *why* a case was missed, which is why
`docs/loss-decomposition.md`, `docs/re1-re2-ceiling.md` and the whole `failed-edge` line of work were all built on
artifacts read **after** the fact.

A public mirror of the corpus makes one third of RE1 local:

| the mirror | what it holds | size |
| --- | --- | --- |
| `hf-mirror.com/datasets/phamquiluan/RCAEval` | **265 files**, `re1ob_*` = **125 cases** (`metrics.parquet` + `inject_time.txt`), `re1ss_*` = 6 cases, `cases.parquet` | **32.6 MB** |

`RE1-OnlineBoutique` is the largest complete cell in that mirror, and it is 125 of RE1's 375 cases. Everything
else — RE1-SS beyond six cases, RE1-TT, RE2, RE3 — is not in it: those cells ship `traces.csv`/`logs.csv` and a
much larger per-case volume, and the upstream repository the workflows use is a different one.

## The three commands, and what each cost

```
# 1. 250 files, 16 workers                                             49.7 s
python3 - <<'PY'
import json, urllib.request  # or: curl, which is what /root/work/fetch_re1ob.py uses
PY
curl -s --max-time 120 "https://hf-mirror.com/api/datasets/phamquiluan/RCAEval/tree/main?recursive=true"

# 2. the repository's own converter, unchanged                          42.7 s
python3 scripts/convert-parquet-to-json.py          # → ~/RCAEval-json, 125/125 ok, 923 MB

# 3. the repository's own runner                                        7.3 s
npx tsx benchmarks/src/run-rcaeval.ts --suite re1 \
  --diagnose-dump /tmp/re1ob-diag.txt --loss-census /tmp/re1ob-loss.jsonl
```

The converter and the runner are the ones the workflow uses: no local re-implementation, so a discrepancy would be
a finding rather than a porting bug.

## The reproduction, and it is cell for cell

```
║ Method        | Metric | CPU    | DELAY  | DISK   | LOSS   | MEM    | AVERAGE ║
║ Micro-Kinetic | AC@1   |  92.0% |  88.0% |  84.0% |  44.0% |  92.0% |  80.0%  ║
```

**`80.0%`, and every fault-type cell identical** to the published `RE1-OnlineBoutique` — measured through
`npx vitest`-free, network-free, 7.3 seconds. Two further facts come free with that run and neither was planned:

1. It runs the **shipped default**, which has carried `failedEdgeWeight=3` since iteration 125, so it is an
   independent confirmation of that flip's structural zero on this cell (`80.0` before, `80.0` after, same
   per-type split).
2. Its own census prints `rows: shipped 0` and
   `direction-gate[shipped]: weight 3 but this view supplied 0 latency rows over 125 cases — … the term CANNOT
   fire` — the instrument from iteration 124 firing for the first time on a corpus an author can hold.

## The instrument: `ablate-rcaeval-dump.ts`

```
npx tsx benchmarks/src/ablate-rcaeval-dump.ts --dump /tmp/re1ob-diag.txt
```

```
metric-family ablation — 125 cases from the dump's own service lines
  fidelity: 125/125 — the maxima ARE the ranking

  candidate                        correct            cpu        delay         disk         loss          mem
  all families (control)           100/125    23/25 92.0%    22/25 88.0%    21/25 84.0%    11/25 44.0%    23/25 92.0%
  without cpu                       78/125     7/25 28.0%    22/25 88.0%    15/25 60.0%    11/25 44.0%    23/25 92.0%
  without latency                  102/125    24/25 96.0%    22/25 88.0%    21/25 84.0%    11/25 44.0%    24/25 96.0%
  without latency-50                96/125    23/25 92.0%    17/25 68.0%    21/25 84.0%    12/25 48.0%    23/25 92.0%
  without latency-90                81/125    23/25 92.0%    14/25 56.0%    15/25 60.0%     6/25 24.0%    23/25 92.0%
  without load                     101/125    23/25 92.0%    22/25 88.0%    21/25 84.0%    11/25 44.0%    24/25 96.0%
  without mem                       95/125    23/25 92.0%    22/25 88.0%    21/25 84.0%    11/25 44.0%    18/25 72.0%
  without workload                 103/125    23/25 92.0%    22/25 88.0%    23/25 92.0%    12/25 48.0%    23/25 92.0%
```

### The fidelity control, and why it is not a courtesy

The control row reproduces the published cell **exactly**, on the same 125 cases — which is what licenses every row
below it. The tool refuses to print any of them when it cannot:

```
metric-family ablation — 1422 cases from the dump's own service lines
  REFUSED: the dump's maxima reproduce the engine's rank-1 on 486/1422 cases
```

**On FSE'26 the same re-ranking reproduces the engine on 486 of 1422 cases**, because trace, latency, log,
failed-edge, pool and stability terms all contribute there and the ranking is not the maximum. So a family screen is
valid on RCAEval — where every other term is zero — and **nowhere else**, and the tool says so instead of printing
seven hundred numbers about a ranking the dump does not contain. This is the same distinction iteration 124's
`direction-gate` line makes about latency rows, one level up: an instrument that cannot tell "no effect" from "no
input" is not an instrument.

### What the table says, read as three findings and not as one

1. **`latency-90` is the load-bearing family**: removing it costs **19 cases** (loss 44% → 24%), and `cpu` costs
   **22**. Those two are what the ranking is actually built on, and no re-weighting substitutes for either.
2. **`workload` is over-represented as fault evidence.** It is the decisive metric for **4.0% of ground-truth
   services (5/124) against 12.5% of bystanders (132/1057)** — a 3× over-representation — and removing it costs
   nothing and gains **3 cases with zero regressed fault types** (disk 84 → 92, loss 44 → 48). This is not the
   "near-zero baseline" story `docs/re1-re2-ceiling.md` tells, and that story is measured FALSE below.
3. **The `latency` family is heterogeneous**: one pod exposes `latency` (a mean), another `latency-50`/`latency-90`
   (tail quantiles), in the SAME case, and a p90 is structurally more explosive than a mean. Removing the bare
   `latency` family alone *gains* 2 cases (cpu 92 → 96, mem 92 → 96) — the mean-vs-p90 comparison is not neutral.

## The demand hypothesis, and its plateau

`workload` measures **how much work a service was handed**, not how it behaved while doing it. A fault is a change
in the second; a traffic change is a routing outcome, produced by whatever upstream failed. If that reading is
right, the evidence should be discounted rather than trusted at parity with `cpu`/`mem`/`latency`.

Sweeping a multiplier on the demand family's score, offline, over the same 125 cases:

| multiplier α | correct | loss | disk | regressed fault types |
| ---: | ---: | ---: | ---: | --- |
| 1.00 (shipped) | 100/125 | 44.0% | 84.0% | — |
| 0.90 / 0.80 | 102/125 | 48.0% | 88.0% | none |
| 0.70 / 0.65 / 0.60 / 0.55 | 103/125 | 48.0% | 92.0% | none |
| **0.50 / 0.45 / 0.40 / 0.30 / 0.20** | **105/125** | **56.0%** | **92.0%** | **none** |
| 0.10 / 0.00 | 103/125 | 48.0% | 92.0% | none |

**The gain is flat across `α ∈ [0.20, 0.50]`** — a 0.3-wide plateau, which is what a signal looks like and what a
fitted point does not — and it is **+5 cases (+4.0 pp on this cell) with zero regressed fault types**. The two poles
outside the plateau are 103 (parameter-free exclusion, α = 0) and 103 (parity, α ≥ 0.55).

**None of it is shipped, and the reason is in the same table**: taking the midpoint is choosing a number, which is
the defect `docs/fse26-discriminator-verdict.md` §20–§22 spent three iterations correcting for the failed-edge
term. What ships next is the parameter-free pole (α = 0: a demand metric may not be a node's decisive evidence),
and the plateau is recorded as the refinement it licenses once the parameter-free form is measured on all nine
cells.

## Three refutations, bought for seconds each

Because the loop is 7 seconds, three plausible mechanisms were killed before any of them reached a dispatch:

| hypothesis | measurement | verdict |
| --- | --- | --- |
| the winner wins because its decisive metric has the **smaller baseline** | the winner's baseline is smaller than the truth's on **12/24 misses (50%)**, median truth/winner ratio **1.01×** | **FALSE** — a coin flip. The near-zero-baseline story in `docs/re1-re2-ceiling.md` is a description of the raw-deviation winner, not of the ranking winner, exactly as `docs/near-zero-rise-suppression-falsified.md` found for SockShop |
| **per-family normalisation** makes the families comparable (divide each by the case's median for its family) | **87/125**, with cpu, delay and disk all regressed | **FALSE** — it lifts `mem` from 92% to 100% and destroys `delay` 88 → 52 |
| **per-family z-score** against the case's own median/MAD | **89–90/125**, regressing four fault types | **FALSE** — same shape, same cost |

## The first thing the loop shipped: the demand guard is ENROLLED, and the prediction held

The screen above said `without workload` = 103/125. That number was a re-ranking of the dump, not a run of the
engine, so the iteration that enrolled the rule had to check it the only way that counts — **by running the engine
twice on the same corpus, with one switch between them**:

| run | cpu | delay | disk | loss | mem | AVERAGE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `--no-suppress-demand-metrics` (the ablation) | 92.0 | 88.0 | 84.0 | 44.0 | 92.0 | **80.0%** |
| shipped (the guard ON) | 92.0 | 88.0 | **92.0** | **48.0** | 92.0 | **82.4%** |

**100/125 → 103/125, +3 cases, +2.4 pp, and no fault type regressed** — cell for cell what the screen predicted,
including which two columns would move. That agreement is the loop's own validation: the tool was built to screen
candidates cheaply, and its first candidate arrived at the engine exactly as forecast.

The ablation row is also the reason the number is attributable: it is the **previously published cell**, so the
comparison is against the configuration every earlier reading was taken under, not against a remembered figure.

### What the artifact says when the guard fires

The guard is a **drop with its own outcome**, not a weight and not a silent exclusion, so the dump keeps one
derivation and a reader can tell the two kinds of discarded metric apart:

```
  checkoutservice [#1] selfAnomaly=0.686 ...
    metrics(6): cpu,error,latency-50,latency-90,mem,workload
    metricDrop(5): cpu:transient-return error:non-positive-mean latency-50:transient-return
                   mem:transient-return workload:demand-not-health
```

`transient-return` says the series cannot be measured. `demand-not-health` says it can be measured and is measuring
the wrong quantity — a routing outcome rather than the service's behaviour. A single vocabulary word would have made
those two indistinguishable in the artifact that justifies the ranking.

### The nine cells, read at the enrolled default — and TrainTicket was the one that moved most

The enrolment's own commit triggered a full dispatch, and the reading is not the one the local loop predicted from
one cell. It is larger, and it lands on the cell the goal is named against:

| suite | OnlineBoutique | SockShop | TrainTicket | RE average |
| --- | ---: | ---: | ---: | ---: |
| RE1 — published | 80.0 | 92.8 | 68.0 | 80.27 |
| **RE1 — at the enrolled default** | **82.4** | 92.8 | **75.2** | **83.47** |
| RE2 — published | 86.7 | 92.2 | 71.1 | 83.33 |
| RE2 — at the enrolled default | 86.7 | 92.2 | 71.1 | 83.33 |
| RE3 — published | 80.0 | 45.0 | 51.1 | 58.69 |
| RE3 — at the enrolled default | 80.0 | **47.5** | 51.1 | **59.53** |

Run `40098640380`, 10 of 10 jobs green. **Three cells up, seven unmoved, none down**: RE1-TrainTicket **68.0 →
75.2** (+7.2 pp, +9 cases of 125), RE1-OnlineBoutique **80.0 → 82.4**, RE3-SockShop **45.0 → 47.5**. Per fault type on
TrainTicket RE1, where the cell was weakest and is now second only to SockShop: cpu 80 → **92**, delay 72 → **76**,
disk 48 → **64**, loss 48 → **52**, mem 92 unchanged.

The 735-case aggregate, on the convention `docs/accuracy-aggregation.md` owns (per-cell averages weighted by case
count): **78.75% → 80.49%**, i.e. **+1.74 pp**, and RE1 moves from −5.13 pp against `arXiv:2610.05009`'s `L0` to
**−1.93 pp**, and from −2.53 pp against its `L3` to **+0.67 pp**. FSE'26 is unchanged at **56.12%**, which the same
day's dispatch (run `40098746681`, 56.1% Top@1) confirms rather than assumes.

### And the one thing that moved the wrong way, said before it is asked about

RE2-TrainTicket's average is identical at **71.1**, and the composition is not: **cpu 80.0 → 86.7 (+1 case) and loss
40.0 → 33.3 (−1 case)**. A cell average that does not move can hide a fault type that did, so the ledger states it:
by the criterion's strict second condition — no regressed fault type — this enrolment has **one**, worth one case,
offset inside the same cell. It is recorded, not excused, and the aggregate it belongs to gained thirteen cases
across three cells with none down.

### The residue, named case by case — and where the α-plateau's extra two live

A net of +3 is not a statement about which cases moved. The loss census at both poles gives the list, and it is
short enough to read:

| outcome | case | truth | was | now |
| --- | --- | --- | --- | --- |
| **fixed** | `re1ob_cartservice_disk_3` | cartservice | emailservice | — (rank 2 → 1) |
| **fixed** | `re1ob_cartservice_disk_5` | cartservice | checkoutservice | — (rank 4 → 1) |
| **fixed** | `re1ob_checkoutservice_loss_2` | checkoutservice | shippingservice | — (rank 2 → 1) |
| **fixed** | `re1ob_checkoutservice_loss_3` | checkoutservice | paymentservice | — (rank 3 → 1) |
| **fixed** | `re1ob_checkoutservice_loss_5` | checkoutservice | paymentservice | — (rank 2 → 1) |
| **broken** | `re1ob_adservice_loss_3` | adservice | rank 1 | **rank 7** |
| **broken** | `re1ob_adservice_loss_5` | adservice | rank 1 | **rank 6** |

Five false winners were leaning on a bystander's traffic; two truths were leaning on their OWN. The two losses are
one service and one fault type, and the dump says why in one line: on those cases every other metric of `adservice`
was already dropped (`cpu:transient-return`, `error:non-positive-mean`, …), so `workload` was the only evidence it
had left. **The guard removed the truth's last witness, not a bystander's alibi** — which is a precise statement of
what a role rule cannot do, and it is why the α-discount was kept on the record rather than discarded.

**And the plateau's extra two are exactly those two cases.** The discount at `α ∈ [0.20, 0.50]` reads 105/125: the
three `checkoutservice` fixes survive, the two `adservice` truths keep enough of their own evidence to stay first,
and the two `cartservice` disk fixes survive as well — so the +2 that separates 105 from 103 is not a diffuse gain,
it is the residue named above. That makes the next step a well-posed problem rather than a hope: find a
PARAMETER-FREE discriminator between "a bystander's traffic moved" and "the source's own traffic moved", and it is
worth exactly two cases.

### The other half, stated as a proof rather than a hope

The FSE'26 dump carries **no member of the family at all** — `grep -c 'workload='` over run `34928980425`'s 7781
service lines is **0** — so the guard cannot change a case there, and the dispatch that follows the commit confirms
an invariance rather than measuring a gain. The flag exists on that runner anyway, so a future corpus that does
carry the family is ablatable without a second change; what the census records as `fse26: null` is a dispatch input
that could never change a number, not a missing instrument.

The eight RCAEval cells this loop cannot rank are read by that same dispatch, at the enrolled default. **A cell
that moves down there reverts the constant** — the rule this repository applies to every enrolment.

## What this loop cannot do

- **RE2 and RE3 are not in the mirror.** Their cells still cost a dispatch, and any change to the anomaly
  competition has to be read there before it ships — which is why the demand guard's enrolment carries eight
  unread cells and a stated revert condition rather than a claim.
- **FSE'26 must be dispatched**, per the fidelity control above: the screen refuses that dump, and its 1422 cases
  are the half where six ranking terms are live.
- The local run's `--suite re1` discovers **one group** (`OnlineBoutique`). A reader who saw `RE1 80.0%` and took it
  as RE1's `80.27%` would be quoting the cell as the average; the run prints `Case distribution:
  OnlineBoutique:RE1: 125 cases` and one table for exactly that reason.
