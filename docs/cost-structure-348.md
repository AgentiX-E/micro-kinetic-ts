# What the money buys: 98 % of it is the question, and 55 % of it is discarded

**The bill is not expensive per case. It is expensive per case that did not need a model.** Run `45531140696`
cost **20.81 CNY** for 1 422 cases — 0.0146 each, against the only competitor that publishes a price at about
**6.39 CNY a case**. The problem is not the rate. It is that **786 of the 1 422 cases were settled by something other
than the model**, after each had already paid for six turns: **11.41 CNY, 54.8 % of the run**, spent on answers the
resolver then discarded.

This entry is the audit, the mechanism, and the one saving that is taken *before* the call instead of after the run.

## 1. The bill, from the artifact's own columns

```
cases 1422 · 20.81 CNY · 0.0146 per case
input  10 221 261 prompt tokens = 98.23 % of the bill
output     46 085 completion tokens
the question costs 7 188 tokens a case; the answer costs 32.4
```

**222 input tokens per output token.** At 2 and 8 CNY per million that is 20.44 of input against 0.37 of output: every
lever that does not move prompt tokens moves 1.8 % of the bill. This is the first thing the audit had to establish,
because four iterations of discussion about "model cost" had been conducted as though the tokens were comparable.

## 2. Where it went

| settled by | cases | correct | CNY | per case | wasted |
| ---------- | ----: | ------: | --: | -------: | -----: |
| `model` | 636 | 582 | 9.40 | 0.0148 | 0.00 |
| `prior` | 516 | 481 | 7.51 | 0.0146 | **7.51** |
| `interface` | 148 | 148 | 2.15 | 0.0145 | **2.15** |
| `entry` | 74 | 69 | 1.07 | 0.0144 | **1.07** |
| `door` | 28 | 28 | 0.40 | 0.0143 | **0.40** |
| `certainty` | 20 | 20 | 0.29 | 0.0144 | **0.29** |

`wasted` is the cost of a stratum the model did not settle: six turns bought, answer discarded, correctly. **11.41 CNY
(54.8 %).** The `interface` row is the sharpest: 148 cases, **148 correct**, and not one of them needed a call — the
answer was in the case's failing interfaces before the first turn.

Every row spent about the same per case (0.0143–0.0148), which is the tell: the loop's budget is spent whether or not
its result is used, and **the 786 discarded cases cost the same as the 636 that counted**.

## 3. Why this is not a bug in the resolver

The resolver is right to discard those answers. `interface` is 148/148 because it reads the failing interface and the
model does not. `door` is 28/28 because the first hop is deterministic.

The defect is **placement**: whether a model will fail is not knowable before it fails, so the loop investigates every
case and the resolver decides afterwards. That is a sound design and an unsound budget — the decision that could have
been taken at the door was taken at the exit.

## 4. The one signal available at the door

The engine's own margin. It is already computed, already in the artifact, and it separates the two populations almost
perfectly: engine hits sit at a median margin of **0.872**, engine misses at **0.081**. Simulated on the artifact —
skipped cases answer with the engine's winner, kept cases keep their recorded answer:

| floor | skipped | saved CNY | cases | accuracy |
| ----: | ------: | --------: | ----: | -------: |
| 0.30 | 964 | 14.18 | −23 | 91.77 % |
| 0.50 | 771 | 11.32 | −12 | 92.55 % |
| 0.80 | 603 | 8.85 | −2 | 93.25 % |
| **0.87** | **582** | **8.55** | **+0** | **93.39 %** |
| 1.00 | 520 | 7.64 | +0 | 93.39 % |
| 1.20 | 442 | 6.49 | +0 | 93.39 % |

**582 cases (40.9 % of the corpus) at a saving of 8.55 CNY (41.1 %) with the corpus accuracy unchanged.** The curve
turns between 0.80 and 0.87, which is what makes this a measurement rather than a knob: the loss-free region is
bounded on both sides.

**Stated as a bet, in the same units.** At 0.80 the floor loses two cases; at 0.30 it loses twenty-three. The audit
prints the loss column beside the saving column for exactly that reason — a floor that only reported what it saved
would be a sales sheet, and this programme has retracted three of those.

**What the simulation cannot say.** It answers skipped cases with `engineWinner`; the shipped path answers with
`fallback`'s first name, which is the same name when `fallback: engine` and the ranking is the artifact's. So the
figure is a projection that one dispatch has to confirm — at about **12.3 CNY**, because 582 of the cases it runs
cost nothing.

## 5. The three savings, ranked by what they cost to find out

| # | Change | Mechanism | Saving | Confidence | Cost to confirm |
| - | ------ | --------- | -----: | ---------- | --------------: |
| 1 | `--certainty-floor 0.87` | skip the model where the engine already decided | 41.1 % | simulated on 1 422 cases | 12.3 CNY |
| 2 | stratified acceptance samples | a paired delta on 266 misses + 200 hits, not on all 1 422 | 67 % **per experiment** | exact binomial power, §6 | 0 — the flag exists (`--sample-misses`, `--sample-correct`) |
| 3 | shorter transcripts | `--transcript-chars` from 2 000 to 1 200 | 15–25 % of input | untested | 15 CNY |

**(2) is the one that answers "why is every step this expensive".** Every arm of the last six iterations was accepted
or rejected on a **full-corpus** run at 20.81 CNY, when the question each asked was a paired delta on the engine's
266 misses. A 466-case stratified sample costs 6.8 CNY and resolves a 5-point difference at p < 0.01 — the full corpus
was bought for precision nobody read.

## 6. Why a stratified sample is not a cheaper measurement, but the same one

The statistic is McNemar on paired cases: only the discordant pairs carry information. With 266 misses and 200 hits,
a 5-point corpus effect concentrated where it is expected (the misses) appears as roughly 25 discordant cases, which
the exact binomial resolves at p < 0.01 with the same power the 1 422-case run had. What the full corpus adds is
resolution below about 1.5 points — and nothing in this programme's decision rule has ever turned on 1.5 points.

The sampling is deterministic and recorded: `--sample-misses` and `--sample-correct` take the first *n* of each
population in artifact order, so two runs of the same sample are the same sample, and `run-metadata.ts` stamps both
counts into the record.

## 7. What ships

1. **`benchmarks/src/cost-model.ts`** — `costOf`, `auditCost` (by settling resolver, sorted by cost), `skipAt`,
   `lossFreeFloor`. **100 % statements / branches / functions / lines** over 26 cases. It refuses an artifact with no
   `engineMargin` column rather than pricing a floor from a file that never recorded one, and it treats a `null`
   margin as *unknown*, not as high: a skip taken on a number that is not in the file is a decision nobody can re-read.
2. **`benchmarks/src/token-rates.ts`** — the two prices, behind an interface, so a different provider is a different
   table. The input rate is the **cache-miss** rate, because the invoice is the miss arithmetic: not one prefix was
   served from cache in the 8 530 calls of run `45531140696`.
3. **`benchmarks/src/run-cost-audit.ts`** — prices any artifact offline, prints the bill, the strata and the floor
   curve. `tsx benchmarks/src/run-cost-audit.ts --artifact <path>`. **This is the answer to "why is it expensive"
   being asked a fifth time: the arithmetic is a command, not a paragraph.**
4. **`--certainty-floor`** — wired through both hops (`args.certaintyFloor` → `investigate` → `runQueryAgent`) and
   pinned by two assertions in `agent-runner-wiring.test.ts`, because a price knob dropped at a hop spends the whole
   budget and reads exactly like a run that never asked for it. Iteration 345's `onset` is the precedent: parsed,
   logged, present in 0 of 532 transcripts. The workflow carries it as `query_certainty_floor` and forwards it to
   **both** the arm and its same-job control — a floor on the arm only would make the paired delta the floor's own
   effect, which is 346 in a new costume — pinned by four more assertions reading the workflow as text.
5. **A skipped case is the same arm at a lower price**: it answers with the name a refusal would have shipped, reports
   `rounds: 0`, zero tokens and an empty transcript, and is attributed to `prior` — no new vocabulary in the artifact,
   and the three zeros are how a reader tells a skipped case from an investigated one.
6. **`certaintyFloor` is a required field of the run record** and appears in `arms` as `floor=0.87`, because a floor
   changes the *answer* on every case it touches and not only the price: two runs at two floors are two
   configurations, and `arm-comparison.ts` refuses to price a delta between them.

## 8. What this does not fix

**The cache.** 10.2 M prompt tokens were charged at the miss rate, so no prefix was reused across 8 530 calls to the
same endpoint with a byte-identical 750-character system prompt. Recovering it would cut the input price by up to 75 %
and is worth more than every other row in §5 combined — but it is an endpoint-side property this repository cannot
assert by reading its own code, so it is stated here as an open question with a measurement attached rather than as a
saving.

**The 266 misses still cost what they cost.** They are the cases the model exists for: 180 repairs, 0.957 precision.
Cutting further means cutting the product.
