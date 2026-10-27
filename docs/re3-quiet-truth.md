# The quiet truth — RE3-TrainTicket's labels invert the ranking's assumption

**Status:** an AUDIT, not a mechanism. It explains, with one table, why five candidate terms were refused on
this cell in one month, and it sets the prior for whatever comes next.

**Owner of:** nothing yet. The term it argues for is *not* built, because the audit's own limit (§4) says the
decisive statistic cannot be computed from the artifacts this repository ships.

---

## 1. The measurement

Every failed case prints the truth's normalised anomaly beside the top-5 candidates' scores. That is enough to
ask one question per miss: **where does the truth sit relative to the candidates that beat it?**

| suite | misses sampled | truth QUIETEST of the top-5 | in between | truth LOUDEST |
| --- | ---: | ---: | ---: | ---: |
| TrainTicket RE1 | 16 | 0 | 0 | **16** |
| TrainTicket RE2 | 16 | 1 | 0 | **15** |
| **TrainTicket RE3** | 14 | **11** | 3 | **0** |
| SockShop RE1 | 5 | 2 | 1 | 2 |
| SockShop RE2 | 5 | 1 | 1 | 3 |
| SockShop RE3 | 13 | 0 | 6 | 7 |
| OnlineBoutique RE1 | 12 | 5 | 3 | 4 |
| OnlineBoutique RE2 | 12 | 1 | 3 | 8 |
| OnlineBoutique RE3 | 7 | 3 | 3 | 1 |

Read the TrainTicket rows together, because they are the same corpus and the same engine: on **RE1 and RE2 the
truth is the loudest candidate in 31 of 32 sampled misses** — those cases are lost to something even louder, a
propagation effect, and every "reward evidence" term is pointed the right way there. On **RE3 the truth is the
loudest in 0 of 14 and the quietest in 11.**

The measurement replicates exactly on two independent runs at the shipped configuration (`40340844173`, the
control of iteration 140's sweep, and `40255890256`, the acceptance run of iteration 137): **11 of 14 both
times, 0 of 14 loudest both times.**

## 2. Why that explains the refusals

The engine's ranking is a reward for evidence: a base term of `log1p(anomaly)` plus eleven priors, every one of
which adds a reason to prefer a service. Five candidates were measured on this cell in one month, and all five
failed in the same direction:

| candidate | mechanism | RE3-TT | RE1 |
| --- | --- | ---: | ---: |
| PRISM additive score | reward internal+external | 15 → 18 | **−10** |
| PRISM conjunctive score | reward internal∧external | **15 → 24** | **−37** |
| symmetry mask | discount external-only | 15 → 15 | **−33** |
| drop symmetry (`log`) | let a collapse say as much as a rise | 15 → 15 (RE3 52 → 36) | −35 |
| ratio ceiling | bound what one metric may claim | **15 → 15, RE3 52 → 56** | **−7** |

Four of the five add or re-weight *evidence*. The one that came closest to helping without a catastrophic cost —
the ratio ceiling — is the only one that *withholds* a claim rather than adding one, and it moved the suite
**up** (52 → 56). That is the pattern the quiet-truth table predicts: on this cell the ranking has to be able to
prefer a service that is *less* disturbed than its neighbours, and no term in the engine can express that.

## 3. What it means for the benchmark

It does **not** mean the labels are wrong. `socket` 18 → 11 is a real, specific change in the truth's own
internal state, and PRISM's conjunctive form finds it 23 times out of 30. It means the cell's ground truth is
defined by a **different quantity** from the one the other eight cells reward: a component that lost its
database connections while its neighbours amplified is, by every magnitude-based reading, the quiet one.

Two consequences worth stating rather than discovering again:

1. **Cross-cell averaging hides it.** RE3 is 90 of 735 cases; a term tuned on the fold will always prefer the
   645 where evidence wins. Every "the fold went up" result this month was a trade against this cell.
2. **A competitor's 76.7% here is not a 26.7 pp engine deficit alone.** PRISM's score is a conjunctive
   internal∧external test, which is a *shape* test rather than a *magnitude* test — and the shape is what this
   cell distinguishes. Our attempts to bolt that shape onto a magnitude ranking cost RE1 10 to 37 cases each
   time, because on the other cells the shape is silent and the magnitude is the signal.

## 4. The limit of this audit, stated before anyone builds on it

The statistic uses **the engine's own top-5**, which is all the artifact prints. "Quietest of the top-5" is not
"quietest in the fleet": to know whether a silence-ranked engine would win these 14 cases, the artifact would
have to print the anomaly of every graph member, and it does not. That is a one-line change to the diagnose
dump (`diagnose_dump`) and it is the precondition for the next build, not this iteration's claim.

What the audit licenses today is narrower and still useful: **any future term for this cell must be able to
rank a candidate BELOW candidates with larger anomalies**, and the acceptance test is the nine cells, not the
fold.

## 5. What would be built next, and the number that justifies trying

A **silence prior**: reward a service whose disturbance is low relative to its own fan-in — i.e. the component
whose traffic collapsed while the components that call it did not. The prior probability of the truth being
that component on this cell is **11 of 14 sampled misses**, measured twice, against **0 of 14** for the loudest.

It is not built here because its form needs the fleet-wide anomaly of every member (§4) and because this
month's record says a term built without that instrument is a term measured on the wrong statistic.
