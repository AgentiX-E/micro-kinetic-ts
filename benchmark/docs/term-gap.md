# The term-gap census — which term a cell's misses were lost on

**Status:** an instrument, always on, no default moved. It prints one line per RCAEval cell and it has already
refuted one lever and named two others.

**Owner of:** the `[term-gap]` line, and of `truth-evidence.md`'s question "which term did the truth lose on".

---

## 1. What could not be answered before

Every failure block this repository prints describes the **anomaly** that lost — its breakdown, its metric, its
head and tail — and never the **ranking term** that lost it. A miss at rank 2 of 68 and a miss at rank 40 of 68
can carry identical anomaly breakdowns and be lost to completely different terms, so "what would have to change
to win here" was answerable only by reading thirty blocks by eye, one case at a time, with no aggregate.

The runner already records both sides of every case it predicts: the truth's own `terms` (inside
`truthEvidence`) and the winner's (`top1Terms`), read from the ranking rather than recomputed, because
`sumScoreTerms(terms) === finalScore` is an invariant the producer's own fence asserts. The census subtracts them.

```
[term-gap] failing=11 compared=11 | costs: trace=+5.000(5) selfAnomalyLog1p=+2.303(11) | helps: dualFamily=-1.750(7) stability=-0.043(10)
```

That is TrainTicket RE3. `costs` are the terms on which the winner out-scored the truth, summed, with the number
of cases that contributed; `helps` are the terms the truth won. The line is the arithmetic identity behind the
cell's 11 misses.

## 2. The nine cells

| cell | fails | costs (sum, cases) | helps (sum, cases) |
| --- | ---: | --- | --- |
| RE1 OnlineBoutique | 18 | **selfAnomalyLog1p +6.277 (17)**, dualFamily +0.500 (10) | stability −0.048 (14) |
| RE1 SockShop | 9 | **selfAnomalyLog1p +3.092 (9)** | dualFamily −0.250 (3), stability −0.022 (8) |
| RE1 TrainTicket | 21 | **dualFamily +3.000 (12)**, selfAnomalyLog1p +0.306 (21) | stability −0.007 (18) |
| RE2 OnlineBoutique | 10 | **lat +5.053 (9)**, dualFamily +0.250 (7) | selfAnomalyLog1p −0.508 (9) |
| RE2 SockShop | 5 | log +1.000 (1), dualFamily +0.500 (2) | selfAnomalyLog1p −0.093 (4) |
| RE2 TrainTicket | 15 | **lat +5.615 (10)** | selfAnomalyLog1p −0.599 (12) |
| RE3 OnlineBoutique | 6 | **trace +1.000 (1)**, selfAnomalyLog1p +0.582 (3) | dualFamily −0.500 (2) |
| RE3 SockShop | 12 | **selfAnomalyLog1p +3.318 (12)**, log +3.000 (3) | dualFamily −0.500 (4) |
| RE3 TrainTicket | 11 | **trace +5.000 (5)**, selfAnomalyLog1p +2.303 (11) | dualFamily −1.750 (7) |

Three things this table says that no earlier artifact could:

1. **The base term is where most misses are lost.** `selfAnomalyLog1p` heads five of the nine cells: on RE1 and
   RE3 the winner simply *is* the bigger anomaly. No prior is the problem there, and no prior can fix it — which
   is the honest form of the near-zero-baseline question this campaign has now priced from four directions.
2. **On RE2 the base term HELPS the truth and `lat` costs it the cell.** On both TrainTicket and OnlineBoutique
   RE2 the truth wins the anomaly term outright (`selfAnomalyLog1p −0.599 / −0.508`) and loses to the largest
   shipped ranking weight (`lat +5.615 (10) / +5.053 (9)`). That is the opposite failure and it is new: on those
   two cells the propagated-latency term is what stands between this engine and the truth in **19 of the 22
   compared misses** — the one place where the formula's heaviest weight is the thing to question.
3. **`dualFamily` is the second-largest cost on three cells and the largest help on two.** A membership that pays
   a constant can be both: it wins TrainTicket RE3's misses back (`−1.750` over 7) and costs RE1-TrainTicket
   (`+3.000` over 12). A term's cell-level net is what the enrolment measured; its per-term accounting is what
   says where the next arm should look.

## 3. The refutation this instrument earned on its first day

The line names `trace` as the largest cost on the blocking cell — a full unit on 5 of 11 misses — and the obvious
reading is that the term should be weakened. It was dispatched on the same commit:

| arm | RE1 | RE3 | RE3-TrainTicket |
| --- | ---: | ---: | ---: |
| `trace_weight = 0` | 327 | **51** | 8 of 30 |
| `trace_weight = 1` (shipped pin) | 327 | 61 | 19 of 30 |
| `trace_weight = 2` | 327 | 61 | 19 of 30 |

**Ten cases is what the pin buys, and doubling it changes nothing.** A cost is not a cause: a term can be the
biggest thing standing between the truth and the top on the cases it loses while being worth ten cases overall.
Every refusal in this register has to be read against that distinction, and this is the first time the same
instrument has produced both the accusation and the acquittal within one iteration.

## 4. Four semantics, each a test

- a **correct** case is counted and dropped — a term that helps the truth win is not a term that costs it its
  place, and mixing them would make every list a wash of the cell's successes;
- a term **absent on one side** reads as `0`, not as a skip: the winner paid by a term the truth never received is
  the largest gap there is, and skipping it would drop it silently;
- a name appearing **twice** on one candidate is SUMMED, as the score summed it, or the census would disagree
  with the score on exactly the candidates built from the most evidence;
- a side carrying **no terms** is `UNMEASURED`, not a zero gap — "the terms were not built" and "the terms
  contributed nothing" are the same number and different findings.

## 5. What it does not say

- It is not a counterfactual. Zeroing a term changes every case's ranking, not just the ones in the list; §3 is
  the measurement of how far apart the two can be.
- It cannot see a term that never fires: `WEIGHT_ZERO` and `ENTRY_ABSENT` both read as `0` here, and the
  zero-cause taxonomy is what separates them (`truth-evidence.md`).
- It says nothing about FSE'26, whose ranking is a different formula path; that half's own attribution is the
  directional-evidence report.
