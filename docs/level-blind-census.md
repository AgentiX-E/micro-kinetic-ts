# The level the engine could not see — sixty-one misses where the truth moved and the guard read its ends

**Status:** measured on the RCABench TrainTicket archive (1 422 cases, 1 303 paired), 2026-11-07. The mechanism is
identified on one case and counted on all of them; the arm it licensed is recorded in §6 and its result decides
whether the shipped guard changes.

---

## 1. Where this came from

`docs/failed-edge-evidence-gate.md` §13 closes the failed-edge family: the term is worth +194 over control, its
remaining 16 breaks are structural, and the four predicate families tried on them cost more than they buy. §13.4
hands the work on with a number rather than an opinion — **the 16 breaks are 1.2 % of the arm's 553 remaining
misses** — so the next question is where the other 98.8 % is.

The repository already owns a decomposition of that loss (`docs/loss-decomposition.md` §5): for every deep miss,
does the truth carry local evidence above the engine's own threshold? On the nine golden cells the answer was
**56 of 58 have it**, and the conclusion was that the remaining work is ordering rather than signal.

This document asks the same question of the RCABench archive — and answers it from a different place. §5 reads the
engine's `rcaScore` for the truth. That is the engine's OPINION about whether the origin moved, and a detector that
is blind to a shape reports zero on a case where the input plainly moved. So the measurement below reads the input:
the case's own `metrics.json`, split at the case's own `inject_time.txt`, with no reference to any score the engine
produced. The two readings are not redundant — §5 can say "the engine placed no evidence at the origin", and only
this one can say **"there was evidence at the origin and the engine placed none"**.

## 2. The measurement, and why it needs no threshold but one

For every case, for every metric label the truth owns, the median of its pre-injection samples against the median
of its post-injection samples; the truth's **level rise** is the largest of those ratios. The truth's **score** is
`truthAnomalyBefore`, the self-anomaly term the census already records.

| population       |   cases | level rise ≥ 3× | … and engine score < 0.1 |
| ---------------- | ------: | --------------: | -----------------------: |
| the arm's misses | **553** |         **182** |                   **61** |
| the arm's hits   | **750** |               — |                    **1** |

The last column is the finding. Of 553 misses, 182 have a truth whose own level rose at least threefold — the
signal is in the data — and 61 of those were scored below 0.1. On the 750 cases the arm gets right, the same
condition holds **once**.

The 0.1 is a bar, so it is reported against its own neighbours rather than alone:

| score bar | misses flagged | hits flagged |
| --------: | -------------: | -----------: |
|      0.02 |             13 |            0 |
|      0.05 |             38 |            1 |
|   **0.1** |         **61** |        **1** |
|       0.2 |             62 |            2 |
|       0.5 |             65 |           15 |

The separation is not a knife-edge and it is not a fit: every bar in the table leaves the hit population at or
near zero until the bar is loose enough to be meaningless. The 61 are `st` 30, `ck` 26, `pk` 5 by family, and
`cpu` 38, `latency-*` 23 by metric. Fifty-nine of the 61 carry a rank, so this is `RERANK_DEEP` — the truth is in
the pool and was placed deep — rather than a retrieval failure.

## 3. The mechanism, read on one case

`re3tt_ts-assurance-service_ck_1344`: a container kill on `ts-assurance-service`, one of the archive's kill
faults. Its `cpu` series, in seconds relative to the injection:

```
  t−239  0.0058   t−89  0.0152   t+7    0.128    t+67   3.377   t+126  4.836   t+188  0.0251
  t−209  0.0761   t−59  0.0187   t+37   2.718    t+97   4.782   t+156  4.517   t+218  0.0237
```

Pre-injection median **0.0215**, post-injection median **2.718** — a 126× rise, sustained for about 150 seconds,
which then returns to baseline because the container has restarted and the burst has subsided. The engine's
anomaly for this service, with a 126× level rise in front of it, is **0.000**.

The reason is the guard's STATISTIC rather than its question. The shipped value is `evidence-trimmed`, which on a
case that observed a call boundary reads `trimmed-ends`: the median of a few samples at each END of the post
window. Both ends of this window are baseline — the hump is in the middle — so the guard concludes the channel
settled and the fault is scored as nothing.

`level-window` asks the same question of the two HALVES rather than of the two ends:

```
|median(post) − median(pre)| / range = |2.718 − 0.0215| / 4.836 = 0.558
```

That is not a new statistic and it is not proposed here as one. It is a value this engine already implements, on
an axis that was measured once before and refused (`docs/transient-guard-test.md` §5: it costs six cases on the
weakest golden cell). The refusal is about a corpus whose transients are start-up ramps. **This corpus's
transients are the fault**: a container kill IS a hump, and the statistic that reads the ends of a window cannot
see it by construction.

## 4. Why the guard is not wrong where it was fitted

The guard is a damping mechanism: it exists so that a service whose level drifts upward for reasons unrelated to
the injection does not outrank the source that caused the drift. Fitted on FSE'26, the transient it suppresses is
a JVM warm-up — a ramp that starts at t₀ and decays. Both ends of such a window differ from each other and both
differ from the baseline, so an endpoint reading separates a ramp from a step, which is exactly the discrimination
the guard needs there.

A kill-and-restart is the other shape: a step UP that is later erased by a restart, i.e. a hump whose two ends are
equal and whose middle is the fault. An endpoint statistic is blind to it, and a half-median statistic is blind to
the ramp it was built for — the two statistics are each correct for one corpus's transient and each wrong for the
other's. That is the same structure this repository has recorded for other instruments: **a statistic is an
instrument for a corpus, not a theorem about one** (`docs/transient-guard-evidence.md`).

## 5. What this does NOT claim

- **It does not say the 61 are fixable.** A score below 0.1 does not guarantee that a correct score would have
  placed the truth first; it says the engine was shown a 3×-or-more level rise and reported nothing.
- **It does not say the other 121 are a ranking problem in the sense §5 of `loss-decomposition.md` means.** Those
  are misses where the truth's level rose ≥3× and the score DID clear 0.1; they are a different population and
  they are counted here only so the 61 are not mistaken for the whole of the 182.
- **It does not generalise past this archive.** The 61 are RCABench-TrainTicket. The nine golden cells keep the
  shipped statistic unless an arm on them says otherwise, and §6 is not that arm.
- **It does not re-open `level-window` globally.** A statistic that wins on one corpus and loses on another is a
  dispatch question, and the dispatch that already exists (`evidence-aware` / `evidence-trimmed`) keys on whether
  the case observed a call boundary. Whether it should key on the SHAPE of the transient instead is the question
  this document hands on, not one it answers.

## 6. The arm this licensed, and its result

Pre-registered before the run (`/root/work/it238/PREREGISTRATION.md`, 2026-11-07 09:36), one variable on top of
the current best arm: `--transient-guard-test level-window` over `--failed-edge-gate-mode evidence
--failed-edge-gate-share 0.10 --failed-edge-weight 3 --failed-edge-override-rule return-path`.

### 6.1 The result: 757 of 1 303, and it is REFUSED

| arm                                                |           correct | vs control | vs its predecessor |
| -------------------------------------------------- | ----------------: | ---------: | -----------------: |
| control (no direction term)                        |     556 (42.67 %) |          — |                  — |
| `evidence @ 0.10`                                  |     725 (55.64 %) |       +169 |                  — |
| `+ return-path`                                    |     750 (57.56 %) |       +194 |                  — |
| `+ return-path`, `transientGuardTest=level-window` | **757 (58.10 %)** |   **+201** |   **+7 (30 / 23)** |

The pre-registered acceptance had three conditions. Two of them fail:

| condition                                            | required |                 measured | verdict   |
| ---------------------------------------------------- | -------: | -----------------------: | --------- |
| total on the same 1 303 paired cases                 |    > 750 |                  **757** | **met**   |
| no family worse than the 750 arm by more than 1 case |     ≥ −1 | **−2** (`rrm` 115 → 113) | **fails** |
| at least 20 of the 61 level-blind cases recovered    |     ≥ 20 |                    **9** | **fails** |

So the statistic is refused as a global setting, and the run is recorded rather than shipped.

### 6.2 What the failure says, and it is not "the mechanism was wrong"

The mechanism was right about WHERE. The two families the census named are the two families that move, and they
move by more than the whole arm's net:

| family | cases | 750 arm | `level-window` |      Δ |   750 arm → arm |
| ------ | ----: | ------: | -------------: | -----: | --------------: |
| `ck`   |    83 |      10 |         **18** | **+8** | 12.0 % → 21.7 % |
| `st`   |   158 |      29 |         **35** | **+6** | 18.4 % → 22.2 % |
| `rrm`  |   174 |     115 |        **113** | **−2** | 66.1 % → 64.9 % |

`ck` +8 and `st` +6 is +14, and the census predicted those two families and no others by name. What the arm
loses is spread thin and wide: 23 breaks over 15 families (`rd` 4, `rrm` 4, `rq` 3, and twelve families of one or
two). That is the shape of a statistic that has been made GLOBAL: it buys its gains on the cases whose transient
is a hump and pays on the cases whose transient is the ramp it was built to suppress — which is the other job the
guard has, and the one §4 says it is right about.

### 6.3 Why 9 of 61 rather than 20

The 61 were selected by the engine scoring the truth below 0.1 while its own level rose threefold. `level-window`
raises the truth's score on all of them by construction — but a score is a RANK, and raising the truth's score
also raises the denominator and, on many of these cases, raises the symptom that was already winning. Nine of the
61 crossed from wrong to right; the rest moved without crossing. **An estimator change is not a ranking change**,
and the pre-registration treated them as one when it set the bar at 20.

### 6.4 The next pre-registration, stated here so it cannot be chosen after the fact

The dispatch that already exists keys on whether the case observed a call boundary. The result above says the
axis it should key on is the SHAPE of the transient:

> **Admit `level-window` for a channel only when `trimmed-ends` reads it as settled AND `level-window` reads it as
> moved.** The conjunction is the hump detector and nothing else: a ramp has a moving endpoint (so `trimmed-ends`
> already sees it), and a channel that genuinely stood still passes neither. Accepted only if it keeps `ck` +8 and
> `st` +6 while returning `rrm` to 115 or better and losing no other family by more than one case.

That is a statistic, not a switch: it needs both readings of the same channel, so it is an engine change rather
than an arm, and it is the first thing the next iteration owes.
