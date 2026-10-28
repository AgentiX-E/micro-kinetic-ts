# The trace vote — a binary term scored on its decisions, and the mask that withholds it from the leader

**Status:** the term SHIPS ON for RE3 and OFF everywhere else, unchanged. `traceSkipsLeader` ships **`false`** and
its arm is **REFUSED**: measured on all nine cells the mask moves nothing at all, and the rank census shows why —
the two votes it can act on are both votes for the TRUTH. What lands here is the arm's numbers, the three
instruments that explain them, and the disagreement between this document's own prediction and its measurement.

**Owner of:** `traceSkipsLeader`, the `[trace-vote]` census line, `CasePrediction.traceVote` and
`CasePrediction.traceVoteRank`.

---

## 1. The term, and why it is the odd one

`finalScore(v) += traceWeight × traceActivity(v)`, where `traceActivity(v)` is `1` for the **unique** service
whose span count rose after injection while its peers held or fell (`minPreCount` 500, `riseThreshold` 1.15,
`minPostCount` 1), and `0` for everyone else. It is the only term in the formula whose value is a **decision**
rather than a magnitude.

It exists because of one case: TrainTicket RE3's `ts-auth-service` wrong-value fault throws no exception — no log
signal — emits no error span, and moves its metrics only mildly, so every prior this engine has ranks it below its
own victims. Its one deterministic signature is that it does **more work per request** and therefore emits more
spans while route/latency symptoms collapse.

That is a good reason for a vote. It is not a reason for the vote to be *always* right, and no artifact in this
repository had ever asked whether it was.

## 2. The two measurements that disagree, and why both are true

Iteration 148's term-gap census (`docs/term-gap.md`) subtracts the winner's ranking terms from the truth's, per
cell, and on the blocking cell it reads:

```
[term-gap] failing=11 compared=11 | costs: trace=+5.000(5) selfAnomalyLog1p=+2.303(11) | helps: dualFamily=-1.750(7)
```

`trace` is the single largest cost: **a full unit on 5 of TrainTicket RE3's 11 misses.** The obvious reading is
that the term should be weakened or removed, and the same commit was dispatched with `trace_weight=0`:

| arm | RE1 (375) | RE3 (90) | RE3-TrainTicket |
| --- | ---: | ---: | ---: |
| `trace_weight = 0` | 327 | **51** | 8 of 30 |
| `trace_weight = 1` (shipped pin) | 327 | **61** | 19 of 30 |
| `trace_weight = 2` | 327 | 61 | 19 of 30 |

**Ten cases on the block is what the pin buys**, and doubling the weight changes nothing — the term is binary and
already dominant at 1. So the term wins more than it loses and is still the term that loses the cases a reader
stares at: **a cost is not a cause.** The weight axis is a plateau on both sides.

## 3. The instrument: the vote, scored

The failure diagnostics print the service with the highest post/pre ratio, which is **not** the service the rule
chose — `pre >= 500` disqualifies the highest-ratio service in most TrainTicket cases. `CasePrediction.traceVote`
records the decision itself, read from the graph's own `traceActivityScores`, and `trace-vote-census.ts` counts it:

| cell | votes | hits | share | abstained | wrong | decisive |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RE3 OnlineBoutique | 1 / 30 | 0 | 0.0% | 29 | 1 | 1 |
| RE3 SockShop | 0 / 30 | — | — | 30 | 0 | 0 |
| **RE3 TrainTicket** | **20 / 30** | **15** | **75.0%** | 10 | **5** | **5** |
| RE1 / RE2, all three systems | 0 | — | — | 375 / 270 | 0 | 0 |

Three findings, and the third is the one that matters:

1. On RE1 and RE2 the term **abstains on every case** — `traceWeight` is 0 there, so the census reports
   `abstained=645` and the pin's asymmetry is a measurement rather than something a reader infers from a
   configuration line.
2. On SockShop the rule never finds a unique riser; on OnlineBoutique it fires once and is wrong.
3. On TrainTicket the rule votes in 20 of 30 cases and is right in 15 — and **all five wrong votes became the
   top-1**. That is exactly the five cases the term-gap census charges `+1.000` for. **Two instruments, built for
   different questions, name the same five cases.** That agreement is the reason to trust either of them.

## 4. The mask: withhold the vote from the anomaly leader

The term's own reason to exist says what the refinement has to be. It was written for a source whose metrics moved
mildly; a candidate that is **already the cell's largest anomaly** needs no corroboration, and a vote landing on
it is more often traffic re-routed toward a loud victim than a silent source. So:

```
trace(v) = weight × 1[v is the unique riser]
masked  when traceSkipsLeader ∧ v is the unique riser ∧ selfAnomaly(v) = max_w selfAnomaly(w)
```

Three properties, each a test in `pruner.test.ts`:

- the mask is a **MASK**, not a weight: the term's value is zeroed and the breakdown reports `MASKED` with
  `mask: 'traceSkipsLeader'`, the shape the `rise` term's logic-exception gate established;
- it **keeps** the vote for a candidate that is not the leader — the silent source is the entire point, and a
  refinement that suppressed it would be the removal arm again;
- it is **inert at `traceWeight = 0`**, which is the shipped weight on six of the nine cells, so the flag cannot
  move a cell that does not vote.

`traceSkipsLeader` ships **`false`**. The prediction worth writing down before the sweep: on the five wrong votes
the voted service is the loud one (its own anomaly is 1.1–2.7), so the mask removes its unit and the truth —
sitting at ranks 2, 4, 7 and 13 — gains the gap it needs; on the fifteen right votes the truth is either silent
(and keeps its vote) or already loud (and loses a unit it did not need). The risk is the second half of that
sentence, and the nine cells are the only way to price it.

**Measured verdict: the first half is false.** The votes that landed on the cell maximum were 2 and both were
RIGHT (§4.3); the "loud vote" the prediction was about does not appear among the five that are wrong. The
prediction stays in the document rather than being quietly replaced, because the second half of it — the risk — is
the half that turned out to be the whole story.

### 4.1 The arm: a measured null, on every system

`anomaly_knobs=traceskipsleader=1`, dispatched on `aba38243` and read against the push-triggered run of the same
commit (identical corpus, identical protocol, only the knob differs):

| cell (default protocol) | shipped | `traceSkipsLeader = true` |
| --- | ---: | ---: |
| RE1 OnlineBoutique | 107 / 125 | 107 / 125 |
| RE1 SockShop | 116 / 125 | 116 / 125 |
| RE1 TrainTicket | 104 / 125 | 104 / 125 |
| RE1 total | **327 / 375** | **327 / 375** |
| RE2 OnlineBoutique | 80 / 90 | 80 / 90 |
| RE2 SockShop | 85 / 90 | 85 / 90 |
| RE2 TrainTicket | 75 / 90 | 75 / 90 |
| RE2 total | **240 / 270** | **240 / 270** |
| RE3 OnlineBoutique | 24 / 30 | 24 / 30 |
| RE3 SockShop | 18 / 30 | 18 / 30 |
| RE3 TrainTicket | 19 / 30 | 19 / 30 |
| RE3 total | **61 / 90** | **61 / 90** |
| three suites | **628 / 735 (85.4%)** | **628 / 735 (85.4%)** |

**Not one case moves on any of the nine cells**, and the identity holds per SYSTEM rather than only in sum — 107/116/
104, 80/85/75, 24/18/19, the same twelve numbers on both sides — so this is not a pair of compensating ±1s. It holds
on the second and third invocations each job also runs (`--no-inject-time`, and `--no-inject-time
--log-signal-mode novelty`: RE1 323, RE2 231, RE3 42, both sides). The `[trace-vote]` census is unchanged too
(`votes=20 hits=15 … wrong=5 decisive=5` on TrainTicket), which is the shape the instrument was built to keep: it
reports the rule's DECISION, and a mask changes who is paid, not what the rule chose.

A null arm has two causes and they call for opposite next moves:

1. **the mask never fires** — no vote ever lands on the candidate holding the cell's largest self-anomaly, so the
   premise ("a loud candidate needs no corroboration") is never instantiated on this corpus, and the arm is not
   evidence about the refinement at all;
2. **it fires and buys nothing** — the premise holds and withholding the unit changes no ordering.

The prediction in §4 assumed the second half was the risk. Nothing in the arm distinguishes them, and reading the
null as a verdict on the refinement would be reading it as the second cause by default.

### 4.2 The instrument that separates them: where the vote landed

`CasePrediction.traceVoteRank` records the vote target's rank in the cell's per-node anomaly ordering —
`1 + |{v : anomaly(v) > anomaly(vote)}|`, over `faultGraph.anomalyScores`, which is the very map the pruner copies
into its own `selfScores`. Rank 1 therefore means "no service scored louder", which is exactly the condition the
mask tests (`selfScores.get(id) === anomalyLeaderScore`); on rank-normalised anomalies (the shipped
`rankNormalization`) the values are distinct, so the two definitions coincide rather than merely agree.

The census counts them as a histogram instead of a mean, because a mean hides the shape that is the whole
question — one vote at the maximum and nineteen at rank 30 has the same mean as twenty at rank 16:

```
[trace-vote] cases=30 votes=20 hits=15 (75.0%) | wrong=5 decisive=5 | atMax=2/0 rank2-3=0/0 rank4-10=3/0 rank11+=15/15
```

Exclusive buckets, each carrying its own edges in the label so the line cannot be read as cumulative and the
partition is visible on the artifact: `atMax + rank2-3 + rank4-10 + rank11+ = votes - unranked`. Every bucket
prints **`votes/hits`**, so the artifact carries the joint distribution and not two marginals a reader has to hope
are about the same cases. A vote whose rank was not measured is reported as `unranked=` and **not** folded into
`rank11+` — "the vote went nowhere near the top" and "nobody measured where the vote went" are different findings,
the rule every census here keeps.

### 4.3 What it read on its first run: the vote is a TAIL pick, and the loud ones are RIGHT

`cff0bf5` (ranks) and `9aa71bc` (the same ranks with their hits), same corpus and protocol as the arm above:

```
RE3 OnlineBoutique  votes=1  hits=0  decisive=1 | atMax=0/0 rank2-3=1/0 rank4-10=0/0 rank11+=0/0
RE3 SockShop        votes=0  (abstains on all 30)
RE3 TrainTicket     votes=20 hits=15 decisive=5 | atMax=2/2 rank2-3=0/0 rank4-10=3/0 rank11+=15/13
```

**Fifteen of TrainTicket's twenty votes went to a service ranked 11th or worse by the cell's own anomaly** — the
rule does what it was written for, and it does it far more often than the "loud candidate" reading of §4 assumed.
Only **two votes in the entire suite** landed on the cell maximum, so the mask's population on this corpus is 2 of
20 votes, not the five the prediction was about.

The joint table then decided the question, and it went AGAINST the hypothesis the marginals suggested:

| bucket | votes | hits | share |
| --- | ---: | ---: | ---: |
| `atMax` (rank 1) | 2 | **2** | **100%** |
| `rank2-3` | 0 | 0 | — |
| `rank4-10` | 3 | **0** | **0%** |
| `rank11+` | 15 | 13 | 86.7% |

Three things follow, and the first is a refutation of this document's own §4:

1. **The two loudest votes are both CORRECT.** The premise the mask was built on — "a vote landing on the cell's
   largest anomaly is more often re-routed traffic than a silent source" — is false on the two cases this corpus
   offers, 2 of 2. The mask was therefore never merely inert: it withheld a unit from the TRUTH twice, and the cell
   did not move because the truth held its top-1 place on other terms. A mechanism that fires twice, both times
   against the answer, and prices at zero is refused with a reason rather than with an absence.
2. **`traceTailOnly` is dead before it was built.** The non-tail votes are 2/2 and 0/3; confining the vote to the
   tail would keep the three rank-4-10 misses (no change) and withhold the two correct units (a loss in principle,
   zero on this cell). The hypothesis that a rank precondition would filter the wrong votes is measured and rejected
   — which is why the census prints hits per bucket instead of letting a reader act on two matching totals.
3. **The errors are not rank-structured at all.** 3 wrong in `rank4-10`, 2 wrong in `rank11+`, 0 wrong at `atMax`:
   loudness does not separate the votes the term gets wrong, so the next question on this axis is not "which
   candidates may be paid" but "**what distinguishes the five risers that are victims from the fifteen that are
   sources**" — a question about the rule's own evidence (self-time vs propagated rise, failed-edge direction), not
   about its recipient.

## 5. What this does not license

- The mask does not improve the RULE. It is a precondition on **who may be paid**, not a better detector of
  silent sources. The arm being a null means the rule's own thresholds are the open question — `minPreCount 500` is
  an absolute count, and TrainTicket's fleets differ by an order of magnitude in traffic, so "unique riser above an
  absolute 500 spans" may be disqualifying exactly the services it was written for.
- Nothing here says the term should be swept on weight. 1 and 2 are identical, and 0 costs ten cases; the axis is
  closed in both directions.
- The census reports the rule's **decision**, not whether the term was paid: a masked vote is still a vote, so a
  cell run with the mask on will report the same `votes`/`hits` and a different score. That is deliberate — the
  instrument must not change when the mechanism does.
- **A null arm is not a refutation of the premise — a count is.** The `atMax` bucket was the missing half and it was
  read: 2 votes, 2 of them right. The premise ("a vote on the loud candidate is re-routed traffic") is refuted for
  the two cases this corpus offers, and the mask is refused on that rather than on its silence.
- **Two matching totals are not a table.** The five-non-tail/five-wrong coincidence would have licensed
  `traceTailOnly`; the joint distribution says the non-tail votes are 2 of 2 correct and 0 of 3 wrong, which kills
  it. The buckets print `votes/hits` for exactly this reason, and any future count on this axis has to as well.
