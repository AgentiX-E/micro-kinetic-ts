# The quiet truth — RE3-TrainTicket's labels invert the ranking's assumption

**Status:** an AUDIT, not a mechanism, in two parts: §1–§5 read the top five, §6 re-reads the same cell at
FLEET scale with the instrument §4 said was missing — and §6 CORRECTS §1's headline. The truthful version is
"mid-pack, not quiet", and it is the stronger claim.

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

## 6. The fleet-scale correction, and it corrects THIS document

§4 said the decisive statistic was not on the artifact. It is now: iteration 143 added `GT rank=<r> of <n>` to
every failure block — the truth's 1-based position in the ranking the correctness checks are already counted
from, and that ranking's length. One run at the shipped configuration (`40451250424`, nine cells, 606/735 to
the case) answers the question this audit could only pose:

| suite | sampled misses | median rank R | median candidates N | R / N |
| --- | ---: | ---: | ---: | ---: |
| OnlineBoutique RE1 | 12 | 5 | 10 | 0.50 |
| OnlineBoutique RE2 | 12 | 2 | 9 | 0.22 |
| OnlineBoutique RE3 | 7 | 4 | 10 | 0.40 |
| SockShop RE1 | 5 | 5 | 14 | 0.36 |
| SockShop RE2 | 5 | 3 | 12 | 0.25 |
| SockShop RE3 | 13 | 3 | 14 | 0.21 |
| TrainTicket RE1 | 16 | **2** | 64 | **0.03** |
| TrainTicket RE2 | 16 | **9** | 68 | **0.13** |
| **TrainTicket RE3** | 14 | **33** | **68** | **0.49** |

**The correction.** The earlier section said the truth on this cell is the *quietest* candidate. At fleet scale
that is not what the numbers say: the truth sits at **median rank 33 of 68** — the MIDDLE of the ranking — and
**no sampled miss anywhere in the corpus has the truth dead last** (`R = N` occurs 0 times in 100 blocks). What
the §1 measurement actually showed is narrower and is still true: the truth is below every *top-five* candidate
in 11 of 14 misses, and the top five is what the block prints.

The corrected statement is stronger for the purpose it serves. On the two other TrainTicket suites the same
engine puts the truth at median rank **2** and **9**; on this one it puts it at **33**. The engine is not
confused about the corpus or the graph — on one cell it ranks the answer as an average component, midway
between the two ends, and the distance to rank 1 is **32 positions**. That is why every re-weighting failed:
each moves candidates by a few places, and a lever would have to move one candidate 32 places without moving
the 32 above it.

**What it does not change.** The exchange rate in §5 stands, and so does the shape finding: a conjunctive
internal∧external test reaches the truth 23 times of 30 where our magnitude ranking reaches it 15. But the
mechanism is now the right one — the truth is *mid-pack*, not *quiet*, and a term has to explain why the
middle of a 68-service ranking should be lifted over its top third.

**And one more reading the instrument makes available**: `ABSENT` — the truth is not a candidate at all — occurs
1, 1, 3, 0, 1, 0, 0, 0, 0 times by cell, i.e. **six of the 100 sampled misses are retrieval failures on Online
Boutique and Sock Shop and none is on TrainTicket**. No reweighting addresses those six, and no reading of this
corpus should average them with the 94.

## 7. The lever that finally moved it without a cost: the shape as PRESENCE

§6 said what a lever must do — lift one candidate 32 places without lifting the 32 above it. The shape test is
the only thing that has ever reached this cell, and three attempts to import it as a **score** failed (PRISM
additive −10 on RE1, conjunctive −37, the symmetry mask −33): each brought an imported z-scale into a ranking
fifteen terms already tune.

Imported as **presence** instead — a 0/1 membership, so the term can claim at most its weight:

```
dual(v) = hasInternal(v) && Sⁱ(v) > 0 && Sᵉ(v) > 0
finalScore(v) += dualFamilyWeight × 1[dual(v)]
```

| dualfam | RE1 | RE2 | RE3 | 735 |
| ---: | ---: | ---: | ---: | ---: |
| 0 (was shipped) | **323** (105/117/101) | **231** (77/85/69) | 52 (22/15/15) | **606** |
| 0.10 | **323** (105/117/101) | **231** (77/85/69) | 54 (22/**17**/15) | **608** |
| **0.25** | **323** (105/117/101) | **231** (77/85/69) | **55** (22/**18**/15) | **609** |
| 0.50 | **323** (105/117/101) | **231** (77/85/69) | **55** (22/**18**/15) | **609** |

**No cell moved down, and RE1 and RE2 are byte-identical at every weight — the first arm this month of which
that is true.** The exchange rate §5 measured is broken, and the reason is the form: a membership cannot
re-weight a ranking, only add its own weight to the components that pass the shape test.

On FSE'26 the same weight reads Top@1 56.4% / Top@3 69.7% / Top@5 72.1% — **exactly the shipped line** (run
`40501641253`). It is inert there rather than harmful, and that is the form working as designed: the corpus is
`Resource,Pod,JVM`, so nearly every candidate carries a moving channel in both families, the bonus is
near-uniform, and a near-uniform bonus cannot reorder anything.

**Enrolled at 0.25** — the left edge of the plateau (0.25 and 0.50 both read 609), on the rule the breadth gate
established. What it does NOT do is move RE3-TrainTicket: the three cases are all in SockShop, so the cell that
motivated the whole audit is still 15 of 30. The shape test finds that cell's truth when it is computed the way
PRISM computes it (23 of 30); as a membership over this engine's own deviations it finds SockShop's and not
TrainTicket's, and **that gap is the next measurement**: PRISM's `Sⁱ`/`Sᵉ` are z-scores of a mean shift, this
engine's are `log₁₀(1 + ratio)` over a max — and the difference between those two statistics on the same
channels is what separates 18 gains from 0.
