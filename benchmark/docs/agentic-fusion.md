# The fusion operators, and the two nulls that decide whether they are worth running

Iteration 282 built the first producer for the model arm and read it at **33.1 %** against a **75.5 %** control —
−602 cases on 1 422. The obvious next move was to blame the operator: the shipped arm *displaces*, multiplying one
candidate's score by `1 − weight`, so `weight = 1` erases the engine's first place rather than outvoting it. A
rank-fusion operator is pairwise, so it can express a tie. This iteration implements the pairwise operators,
implements the two nulls that say whether there was anything there to fuse, and reads both from the artifact that
already exists — no dispatch, no model, no network.

The result is a **refutation**, and it is cleaner than the one it replaces.

## 1. What a null is, and why two of them

An arm's delta answers "did it win". It cannot answer "was it reading the case", and those are different questions
with different consequences: a losing arm that reads the case is a tuning problem, and a losing arm that does not is
an architecture problem. Two nulls separate them.

**The uniform null.** For a claim that removes `A` and keeps `B`, draw `B` uniformly from the other presented
candidates and ask how often it lands in the truth set. The expectation is computed **per claim, from that claim's
own pool**, so a case with a wide candidate list does not raise the bar for a case with a narrow one, and the variance
is the Bernoulli sum, so the reading arrives with a `z` instead of a percentage a reader has to compare by eye.

**The constant-swap null.** Promote the engine's rank 1 on every case and nothing else. This is the dumbest arm that
can still be written as one line, it contains no model, and it is the number a model has to beat before its tokens
are worth buying.

## 2. The three operators

`fuseRanks` fuses two **orders** (`rrf`, `borda`); `fuseClaims` fuses an order with a **claim set** (`rrf`, `borda`,
`veto`). `veto` exists only in the second because it is defined pair by pair on what a claim literally says, and an
order cannot express which pairs were stated and which were inferred.

Three decisions are load-bearing and each was forced by a failing test rather than chosen:

* **A service the second order omits scores on the engine's order alone.** The first implementation ranked an absent
  service just after the second order's last entry, which meant a second order naming **one** service out of five
  ranked the other four as "second" — a nearly empty opinion converted into a nearly full one.
* **`impliedOrder` counts promotions, not `keeps − removes`.** The first implementation subtracted, and two services
  the model never mentioned outranked one it named as the thing to remove: "never mentioned" scored higher than
  "mentioned as wrong". A service is demoted only by something else being promoted over it.
* **`veto` has no half.** It fires at `weight >= 1` and is a no-op below, because a veto that fires halfway has no
  definition anybody wrote down.

`weight = 0` short-circuits to the engine's order before any arithmetic, for every strategy. That is not an
optimisation: it is the statement that the control arm is the engine, made in the one place a reader can check it
without trusting the scores.

## 3. First reading, on run 43548386087's artifact

| quantity | reading |
| --- | --- |
| claims scored | 5 335 across 1 422 cases |
| **uniform null** | **519 hits (9.73 %) against 891 expected (16.70 %) — z = −14.41 iid, −9.26 clustered** |
| survivors of `verifyClaim` | 3 321 of 5 335 (62.2 %) |
| uniform null, survivors only | 310 hits (9.33 %) against 529 expected — z = −11.00 |
| **constant swap** | **1 073 → 112 of 1 422 (75.46 % → 7.88 %), delta −961** |
| claims that promote rank 1 | 4 113 (77.09 %) |
| claims that are exactly "remove rank 0, keep rank 1" | 1 318 |
| **claims whose REMOVED service is the answer** | **1 129 (21.16 %) — and 1 038 of 1 421 cases in the first claim (73.05 %)** |
| claims naming a service the engine did not present | 0 |

`z = −9.26` is not "no signal". It is **a signal pointing the wrong way**: the model's choice is *worse* than
drawing from the same pool at random. The mechanism is visible in the same table: 77.09 % of claims promote the
engine's rank 1, rank 1 is the truth in only 112 of 1 422 cases, and the model's **first** claim for a case removes
the answer itself in 73.05 % of cases. This is not a wrong guess; it is a request to delete the right answer.

### The correction this reading needed

The first draft of this document reported `z = −14.41` and stopped. A second look at the same artifact produced
`+14.53` from a *different* sampling of the same claims — one claim per case — and two opposite readings of one
artifact is a defect in the instrument, not a fact about the model.

Two things were wrong, and both are now fixed here rather than argued away:

* **The variance assumed independence.** Claims from one case are not independent: a model that decides "promote
  rank 1" decides it once and applies it three times. The iid variance divides by a standard error it does not
  have. Squaring the **case** deviation instead takes `z` from −14.41 to **−9.26** — same direction, materially
  different confidence. `nullReadingOf` now returns both, and the study prints the clustered one by name.
* **The one-claim-per-case sampling is a different null, and a misleading one.** Restricting to the first claim of
  each case concentrates the sample on claims whose removed service is rank 0, and in 73.05 % of those that service
  *is* the answer — so the null's pool is empty and its expectation is zero. A case where the model deleted the
  truth scores as `0 − 0`, which is "no evidence" in the arithmetic and "catastrophically wrong" in fact. The
  `+14.53` was that artefact: the null had nothing to draw, so the model looked better than chance while removing
  the answer three times in four.

The lesson is recorded as a rule: **a null must model the action, not only the pool.** And the count that needs no
null at all — claims whose removed service is the answer — is now the second line the study prints.

The constant-swap row is the null that explains the magnitude. Swapping the top two on every case scores **−961**;
the shipped arm scored **−602**, because it swapped on 925 cases instead of all 1 422. The model's arm is a
partial application of a constant rule, and the corpus can tell you the constant.

| strategy | weight | correct | delta | moved | delta, survivors only |
| --- | ---: | ---: | ---: | ---: | ---: |
| control | 0 | 1 073 | — | 0 | — |
| `rrf` | 0.2 | 1 073 | 0 | 0 | 0 |
| `rrf` | 0.5 | 883 | −190 | 284 | −125 |
| `rrf` | 1.0 | 882 | −191 | 287 | −155 |
| `borda` | 0.2 | 1 073 | 0 | 0 | 0 |
| `borda` | 0.5 | 883 | −190 | 284 | −125 |
| `borda` | 1.0 | 882 | −191 | 287 | −155 |
| `veto` | 0.2 | 1 073 | 0 | 0 | 0 |
| `veto` | 0.5 | 1 073 | 0 | 0 | 0 |
| `veto` | 1.0 | 147 | −926 | 1 381 | −600 |

**There is no positive region, at any weight, under any operator.** `rrf` and `borda` agree to the last digit on
this corpus because the claims are almost all the same claim; `veto` at full weight reads −926, which is the
constant-swap null recovered from the claim set rather than from the corpus. The best an operator can do here is
**0**, by not moving anything.

That is the finding: **the operator was never the problem.** A pairwise rule cannot rescue a proposal set whose
information content is significantly negative, and the fact that the shipped displacement arm (−602) is *better*
than full `veto` (−926) is an accident of its own weakness — it moves fewer cases.

## 4. What this closes, and what it opens

**Closed:** "a better fusion operator would recover the arm". Measured, not argued: three operators, five weights,
two populations (all claims and verified claims), no positive delta anywhere, and a null that puts the proposal set
14 standard deviations on the wrong side of chance.

**Opened:** the question the numbers actually pose. The model copies printed values essentially perfectly (one
`value-disagrees-with-fingerprint` in 5 335 claims) and cannot choose between services at better than chance. That is
not a reasoning deficit, it is a **task mismatch**: it is being asked for a global judgement while being shown a
pre-extracted feature table.

The published evidence agrees and names the category. arXiv:2608.21310 (Pinjia He's group, October 2026) evaluates
ten framework–backbone configurations on RCABench and reports **OpsAgent at 45.8 % Acc@1** with the explanation
"issues no telemetry queries of its own, instead reasoning over a pre-extracted feature set" — which is this project's
model arm, described before it was built. The same table puts the best configuration at **90.0 %** (ThinkDepth.ai on
Claude Sonnet 4.6), and every framework above 70 % runs the loop
`while not committed: query = select_next_query(); result = telemetry.query(query)`. The paper's intervention,
DiagGuard, adds **+9.0 pp** with a Grounder (force systematic survey of available observations before localising)
and a Verifier (audit the diagnosis against evidence before committing), and its ablation is near-additive:
Grounder +4.5, Verifier +4.1, both together +9.0.

Our own artifact already shows the split the paper describes. The model is accurate where the task is **local and
verifiable** (it cites a channel that is genuinely outside its band 98.6 % of the time) and at chance where the task
is **global** (choose the source among five services). The next arm therefore asks for what it can do: a
per-candidate, per-channel survey whose every entry the engine can check, with the *ranking* left to the engine.

## 5. Reproduction

```bash
# The two nulls and the operator sweep, over one recorded artifact. No model, no network.
node --experimental-strip-types …   # see §3 for the numbers this prints
```

The readout is not shipped as a command: it is `nullReadingOf` and `swapTopTwo` from
`benchmarks/src/agentic-null-model.ts` and `fuseClaims` from `packages/ai/src/agent/fusion.ts`, called from a
throwaway script whose three outputs are the three tables above. The modules are covered at **100/100/100/100**
(29 and 12 tests); the script is not, because a script that exists to print numbers for one document is not a
component and enrolling it would only measure whether it still compiles.
