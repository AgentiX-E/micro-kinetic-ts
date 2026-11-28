# The knob that priced the transcript reached nothing

**`--transcript-chars` had never been connected to the prompt.** `buildUserPrompt` called
`renderTranscript(exchanges)` with no budget argument, so every prompt this programme has ever dispatched was rendered
at `DEFAULT_QUERY_BUDGET.transcriptChars` — 9 000 characters — and the runner's flag reached only the `trace`, which
overrides the same field with `TRACE_CHARS` two lines later. The flag changed nothing, and nothing could notice: the
corpus's own final transcripts are ~1 700 characters, so the wall never bound on any run.

That is the same defect class as iteration 351's floor and 353's bill — **a rule priced by one implementation and
shipped by another** — arriving for a third time, and this time the mismatched pair was a flag and a default.

## 1. Why the transcript was the next thing to price

Iteration 352 left a bill and an attribution:

| stratum | tokens | share of the bill |
| ------- | -----: | ----------------: |
| cache-miss input | 1 432 120 | **84.6 %** |
| output | 34 277 | 8.1 % |
| cached system prompt | 6 204 649 | 7.3 % |

At 1/50th the miss price, the cached prefix is nearly free, and output is 5.4 tokens a call. So the money is in the
uncached input, and this iteration began by reading the uncached input as **the opening plus the transcript**: the
incident line, the gate sentence and the seed list repeat on every call, and the transcript grows under them. Only the
second can be shortened without changing what the arm is *told*, which is why a character cap — the crudest member of
the family — was the first thing measured.

**That reading was half wrong, and §9 has the measurement.** The uncached input is not the opening plus the transcript:
it is the **one block that is new on each call**, the opening is served from cache, and the transcript's history is what
the cache is holding. The hypothesis is left standing here because the run is what refuted it, and a document that only
printed the correction would hide that the flag's own inertness is what made the wrong reading plausible.

## 2. The instrument: what the artifact could not say

The anchor carries a **total** `promptTokens` and a `trace` truncated to its last 2 000 characters. Neither separates
the opening from the growth, and a cap can only remove the growth — so from that artifact, a cap's saving is
indistinguishable from zero. Two columns close it:

```ts
// benchmarks/src/query-agent.ts
readonly turnTokens: readonly number[];      // one prompt count per model call, in call order
readonly turnLatencyMs: readonly number[];   // and the wall clock of each, because tokens are not time
```

Both are optional on `QueryArmRow`, for the reason `cacheHitTokens` is `null` rather than zero: an artifact written
before the column existed cannot say, and a decoder that demanded the array would refuse to read every run this
programme has published.

The wall clock is not decoration. `arXiv:2609.32961` varied compression policies over ~35 000 agent runs and found the
counter-intuitive half: on Terminal-Bench with Qwen, a policy using about **a third of the tokens ran 1.2–1.8× longer**,
and strategies with equal success rates solved *different* tasks. A reading that reported the money and not the time
would be reporting the half it can measure for free.

## 3. The acceptance test is the trajectory, not the accuracy

"Accuracy did not move" is the weakest test available, because accuracy is a sum over 1 422 cases: a cap that repairs
one case and breaks another is indistinguishable from a cap that changed nothing. That is the same argument that made
iteration 351 replace a net delta with a per-case identity.

`CoACT` (`arXiv:2607.02911`, ICSE 2027) names the stronger test and the reason it holds: an agent's loop is *read the
observation → choose an action → receive the next observation*, and if the environment is deterministic then
**preserving the next action preserves everything after it**. The object to compare is therefore the trajectory — the
directives in order, plus the answer — and this harness has recorded both since iterations 341 and 318.

So the acceptance test costs no model call:

```
$ tsx benchmarks/src/run-cap-reading.ts --anchor <anchor.ndjson> --capped <capped.ndjson>
transcript cap — paired on 1422 cases
trajectory preserved 656 (46.13 %) · directives changed 751 · answer changed 40
accuracy: +5 gained / -24 lost
uncached prompt 1,432,120 -> 1,503,426 tokens (+4.98 %, the cap ADDED tokens)
model time not recorded
```

## 4. Predictions, written before the runs were read

Two arms were dispatched on the full corpus, identical to the anchor `45595943761` (`--seed none --gate contrast
--fallback engine --resolve edge-novel --certainty-floor 1.5`) except for the cap: **1 200** and **600** characters.

| # | prediction | from |
| - | ---------- | ---- |
| 1 | the cap elides in the PROMPT, not only in the trace | the fix, and the two cases that pin both sides of it |
| 2 | transcript characters removed: ≈ **34.9 %** at 1 200 and **65.5 %** at 600 | the anchor's own blocks: 428 characters on average, 5 blocks a case |
| 3 | the cache still serves ~975 prompt tokens per call | elision only rewrites the UNCACHED suffix; the cached prefix is the system prompt, and a `system`-role prefix is what the endpoint indexes |
| 4 | accuracy within 0 gained / 0 lost, or a small two-sided exchange | `arXiv:2611.05306` (70.2 against 70.0 on SWE-bench Verified at one action per context) and `arXiv:2607.02911` (69.0 → 71.0 PASS@1 at −33 % tokens) |
| 5 | the bill falls by roughly the uncached share the cap removes, not by the token share | the opening is uncappable, so the saving is bounded below by zero whatever the transcript does |

Prediction 3 is the one with a mechanism behind it and a way to fail: if the endpoint keyed its prefix cache on the
whole prompt rather than on the leading system block, elision would invalidate it and the hit rate would collapse — a
cost that would swamp the saving, and one that a "tokens went down" reading would report as a win.

**Scored against §5–§8, three of the five were wrong and the one that mattered failed exactly where it said it would.**

- **1 held.** The prompts carry `[earlier results elided]` from the second call on, which is the fix.
- **2 half-held.** 1 200 characters produced **−34.8 %** prompt tokens against a predicted **34.9 %**; 600 produced
  **−38.3 %** against a predicted **65.5 %**, because the opening repeats and the newest block always enters whole.
- **3 failed, at the joint it named.** Hits per call fell **974.7 → 535.8** and the cache was not keyed on the system
  block alone; whether it is keyed on the whole prompt is a question §8 leaves open.
- **4 failed in direction.** The exchange was not two-sided: **+6 against −19** and **+5 against −24**.
- **5 held for a reason it did not name.** The bill fell **11.8 %**, and two thirds of the fall came from the tool
  substitution the cap induced — a channel none of the five predictions contained.

## 5. What the arms measured

Four dispatches on the full corpus, `--seed none --gate contrast --fallback engine --resolve edge-novel
--certainty-floor 1.5`, differing only in the cap. All **succeeded**; each wrote 1 422 rows.

| | anchor (9 000) | cap 1 200 | cap 600 · concurrent | cap 600 · **alone** |
| - | -------------: | --------: | -------------------: | ------------------: |
| correct (Acc@1) | **1 327 · 93.32 %** | 1 318 · 92.69 % | 1 308 · 91.98 % | 1 314 · 92.40 % |
| model calls | 6 366 | 6 372 | 6 372 | 6 372 |
| rounds per case | 4.48 | 4.48 | 4.48 | 4.48 |
| stops | answered 925 · rounds 497 | answered 1 092 · rounds 330 | answered 1 188 · rounds 234 | answered 1 172 · rounds 250 |
| prompt tokens | 7 636 769 | 4 978 588 | 4 695 735 | 4 710 972 |
| served from cache | 6 204 649 · **81.25 %** | 3 365 843 · 67.61 % | 3 192 309 · 67.98 % | 3 414 096 · **72.47 %** |
| **uncached prompt** | **1 432 120** | 1 612 745 | 1 503 426 | **1 296 876** |
| tokens per call | 1 200 | 781 | 737 | 739 |
| **cache hits per call** | **974.7** | 528.2 | 501.0 | **535.8** |
| uncached per call | 225.0 | 253.1 | 235.9 | **203.5** |
| bill at the off-peak column | **1.69 CNY** | **1.81** | **1.70** | **1.49** |
| trajectory preserved | — | 775 · 54.50 % | 656 · 46.13 % | 659 · 46.34 % |
| gained / lost cases | — | +6 / −15 | +5 / −24 | +6 / −19 |

The fourth column exists because the two capped arms were dispatched within four minutes of each other and shared one
API key while the anchor ran alone — §8 states what that cost and what it did not, and it is the difference between
**1.70 and 1.49**.

## 6. The accuracy reading: monotone, and not noise

The cap costs cases, and it costs them in order: **−9 at 1 200, −19 at 600** concurrent and **−13 at 600** alone, with
the paired discordants **+6/−15**, **+5/−24** and **+6/−19**. Nine cases on 1 422 is ±0.6 pp, so the 1 200 arm's delta
alone would be arguable; the three readings together are not, because they move in the same direction by amounts that
scale with how much was removed, and every capped arm loses two to four cases for every one it gains. The dispersion
between the two 600-character arms — 6 cases — is the arm's own run-to-run noise at temperature 0, measured rather than
assumed.

**Where the nineteen cases went is not where the cap's story suggests.** The stop reason moves a lot — 367 cases that
exhausted six rounds in the anchor now produce an answer — and it moves for free:

| anchor stop → cap stop | cases | correct in the anchor | correct under the cap |
| ---------------------- | ----: | --------------------: | --------------------: |
| answered → answered | 821 | 770 | **759** |
| answered → rounds | 104 | 98 | **90** |
| rounds → answered | 367 | 339 | **339** |
| rounds → rounds | 130 | 120 | 120 |

The 367 recoveries score *identically*, so escaping the budget is not what costs accuracy — every case the cap lost
was one that had been answering: −11 among those that still answer, −8 among those that now exhaust. And the exchanges
are real in both directions in the first row, which is why the net (−19) is smaller than the sum of the movements.

The alone arm repeats the pattern with its own numbers — answered→answered 821 (770→**767**), answered→rounds 104
(98→**88**), rounds→answered 351 (325→**325**), rounds→rounds 146 (134→**134**) — so the mechanism is the arm's, not the
dispatch's: **the recoveries are free and the losses are all among the cases that were answering**.

The trajectory reading is the sharper one. Only **54.50 %** and **46.13 %** of cases made the *same directives in the
same order* — so this is not a cap that hides text from the model while it behaves identically; it changes what the arm
does. The tool census says what changed:

| tool | anchor | cap 600 · concurrent | cap 600 · alone |
| ---- | -----: | -------------------: | --------------: |
| `TOOL logs` | 794 | **40** | **34** |
| `TOOL metric` | 1 202 | 946 | 990 |
| `TOOL failed` | 1 078 | **1 653** | **1 651** |
| `TOOL edges` | 1 160 | 1 569 | 1 509 |
| `TOOL fleet` | 989 | 1 033 | 1 053 |
| `TOOL services` | 81 | 69 | 73 |

`TOOL logs` falls by 95–96 % in both capped arms — a model that cannot re-read what it found stops asking for long lists
and starts asking for the tools whose output is a verdict rather than a haystack. That is a real behavioural finding
about the arm, it reproduces across two dispatches, and it explains the accuracy loss: the arm trades evidence for
summary. It also turns out to explain the money, which is §7's subject.

## 7. The money reading: the cheap tokens, the expensive ones, and which the cap touched

Three columns, three answers, and the third is the one that is true.

| | anchor | cap 600 · concurrent | cap 600 · alone |
| - | -----: | -------------------: | --------------: |
| prompt tokens | 7 636 769 | 4 695 735 · **−38.5 %** | 4 710 972 · **−38.3 %** |
| cache-served | 6 204 649 | 3 192 309 · −48.5 % | 3 414 096 · −45.0 % |
| **full-price (uncached)** | 1 432 120 | 1 503 426 · **+5.0 %** | 1 296 876 · **−9.4 %** |
| **bill** | **1.693** | **1.696 · +0.2 %** | **1.493 · −11.8 %** |

The concurrent reading said the cap removes tokens and none of the money, and that reading is **wrong twice over**. It
is wrong about the cache — §8 shows the loss is the window, and it is 92 % of the cache the cap destroyed — and it is
wrong about the money, because the arm run alone is **0.20 CNY cheaper** than the anchor. The decomposition of that
0.20 is exact, at the published rates:

| term | tokens | CNY |
| ---- | -----: | --: |
| full-price input: smaller newest blocks | −135 244 | **−0.135** · 67 % |
| cache-served input: the region the cap destroyed | −2 790 553 | −0.056 · 28 % |
| completion: shorter answers | −2 326 | −0.009 · 5 % |
| **total** | | **−0.200** |

**Two thirds of the saving comes from a channel nobody designed.** The cap does not shrink the block the model is
currently reading — `renderTranscript` never elides the newest block, and nothing truncates a result. What it changes
is *which tools the arm asks for*: `TOOL logs` falls from 794 calls to 34 (−96 %) and `TOOL failed` and `TOOL edges`
rise in its place, and the arm's newest block gets **21.5 tokens smaller on average** (225.0 → 203.5 a call) because a
list of verdicts is shorter than a dump of log lines. The transcript wall was never the lever; it moved the arm onto a
narrower tool, and the narrower tool is what the invoice noticed.

That is the accidental proof of §10's lever, and it is a better proof than a projection: **the bill tracks the size of
the observation, not the size of the history.** One caveat, in the same breath: the substitution is not free. It costs
13 cases (0.91 pp) and it leaves only 46 % of trajectories intact, so 0.20 CNY was bought with accuracy — the price is
¥0.0154 a case, and a product that wanted both would have to cut the block *without* changing which tool the arm
reaches for, which is what an entry cap can do and what this cap could not.

The cache column keeps its own lesson, and it is the one §8 resolves: **hits per call halves, 974.7 → 535.8 with the
run alone**, and it *halves* rather than sloping with the cap, because 1 200 and 600 differ by 44 tokens a call but land
on the same figure. What the cap removes from the cache is the **stable region of the transcript the endpoint had been
serving at 1/50th the miss price** — which is why destroying 45 % of the cache-served tokens saved only 0.056 CNY.

Two consequences, and the second is the one that changes the plan:

1. **A front-eliding window is cache-hostile by construction**, which is exactly the objection `CoACT` raises against
   the whole family: rewriting history from the front moves the prefix, and the cache pays for it. Compression that
   keeps the history byte-identical and shortens only what ENTERS it is the design that survives this measurement.
2. **Iteration 352's attribution needs a correction, and the correction is narrower than "the transcript".** "84.6 % of
   the bill is uncached input" is true in money and was read as "the transcript is 84.6 % of the bill". It is not: the
   uncached input is **225 tokens a call**, and those 225 are the one block that is new on that call — the observation
   the model has never seen before — plus the budget line, which is reissued every turn. The transcript's *body* was
   already being served at 1/50th the miss price. Section 9 prices that split to the token.

## 8. The confound, resolved — and the dichotomy that was wrong

Both capped arms were dispatched within four minutes of each other and **ran concurrently on one API key**, while the
anchor ran alone. A halved hit rate per call therefore had two candidate causes, and those two artifacts could not
separate them: **the window** (elision moves the kept blocks every call, so the stable region the endpoint had been
caching is gone) or **the load** (two runs sharing one account evict each other's prefixes).

The `b9ba1df` run answers it, and it answers it with a number neither branch predicted. Run alone, the 600-character arm
records **535.8 cache-served tokens a call, not 975 and not 501**:

| | anchor | cap 600 · concurrent | cap 600 · alone |
| - | -----: | -------------------: | --------------: |
| cache hits per call | **974.7** | 501.0 | **535.8** |
| hits the cap removed | — | 473.7 | **438.9** |
| of which contention | — | **34.8 a call · 0.22 M tokens · +¥0.22** | — |
| of which the window | — | **438.9 a call · 2.79 M tokens** | — |
| bill | 1.693 | 1.696 | **1.493** |

So **the window is 92 % of the cache loss and contention is 8 %** — a real effect, small, and in the direction I could
not rule out. And the two branches I wrote down were a false dichotomy, because they both assumed the bill would do what
the cache did. It does not: contention moves tokens the run still pays for (from the hit column to the miss column, +¥0.22),
while the window removes tokens that vanish from the prompt and cost nothing to lose. The concurrent arm's "+0.01" was
two nearly equal effects cancelling in the same direction it was read from.

What the alone run therefore **changes in this document**:

1. **"The cap removed none of the money" is withdrawn.** Alone, the cap is **1.493 against 1.693, −11.8 %**, and §7
   decomposes the 0.20: two thirds of it is the arm's own tool substitution shrinking its newest block, not the cache.
2. **"The front-eliding family is closed on this arm" is narrowed.** It is closed *as a lever over the history* — 45 % of
   the cache-served tokens destroyed to save 0.056 CNY is a bad trade — but not as a lever over cost, and not as evidence
   about caps in general, because the saving it produced came from somewhere other than where it acted.
3. **The accuracy reading is confirmed, not revised.** −19 concurrent, −13 alone, both against +6 and +5 gains; the
   six-case spread between two identical arms is the run-to-run noise at temperature 0, and it is smaller than the loss.

What does **not** depend on any of that: the accuracy loss, the trajectory reading (46 %), the tool census's collapse of
`TOOL logs` in both capped arms, and the arithmetic that a cap can only be worth money if it removes full-price tokens.

One question this document cannot settle, and says so rather than burying it: **501 or 536 cache-served tokens a call is
92–99 % of the 543.8-token opening**, and a strict byte-prefix cache could not serve that, because the budget line changes
on every turn and sits in the third line of the head. Either the endpoint caches more generously than a prefix match, or
it accounts for hits differently than its documentation implies. Every figure here prices the *reported* counts — what an
invoice would charge — and none assumes the mechanism; the mechanism is worth a two-call probe, not another corpus run.

## 9. The bill, to the token

The paired reading gives two totals per side. The capped artifact also carries a per-call curve, and its **first point
is the opening, measured**: on the first call there are no exchanges, so `renderTranscript` reduces to `No queries yet.`
and the prompt is the standing instruction plus the head — the incident line, the deliverable line, the budget line, the
seed and the gate. Nothing a cap can reach is in it, which makes that point the one part of the prompt both arms pay in
full and neither can change.

| call index | 1 | 2 | 3 | 4 | 5 | 6 |
| ---------- | -: | -: | -: | -: | -: | -: |
| mean prompt tokens, cap 600 alone | **543.8** | 987.4 | 713.4 | 694.9 | 801.6 | 695.0 |

Two facts fall out of the first column. The **opening is 543.8 tokens**, and it repeats on every call: 6 372 calls ×
543.8 is **3.47 M** of the 4.70 M prompt tokens the capped arm spent. The other five points are flat — 689 to 988 — so
the cap does exactly what it says to the prompt's *size*: it bounds the transcript at roughly one block. The second
call is the widest of the six because **a cap never elides the only block it holds** — `renderTranscript` keeps the
newest block whole even when it exceeds the wall — so the first observation, a full ranked listing, enters at ~444
tokens and the 600-character wall only starts biting on the call after it. That floor is a property of the family, not
of this run: no front-eliding cap can go below "the opening plus the newest result", which is why the arm still spent
739 tokens a call.

Splitting the bill by column instead of by side, at the off-peak rates this programme prices with (¥1 / ¥4 per million
tokens out / ¥0.02 per million served from cache):

| | anchor (9 000) | cap 600 · alone |
| - | -------------: | --------------: |
| model calls | 6 366 | 6 372 |
| opening, paid on every call | 3.46 M | 3.47 M |
| prompt tokens, total | 7 636 769 | 4 710 972 |
| — transcript's share of the prompt | 4 175 000 · 54.7 % | 1 246 000 · 26.5 % |
| — served from cache | 6 204 649 · 81.25 % | 3 414 096 · 72.47 % |
| — of which the opening could explain at most | 3.46 M | 3.47 M |
| — cache-served beyond the opening | **≥ 2.74 M** | **none provable** (the opening alone covers 3.41 M) |
| — full-price (uncached) input | 1 432 120 | 1 296 876 |
| bill: full-price input | 1.432 CNY · **84.6 %** | 1.297 · **86.9 %** |
| bill: cache-served input | 0.124 · 7.3 % | 0.068 · 4.6 % |
| bill: completion | 0.137 · 8.1 % | 0.128 · 8.6 % |
| **bill, total** | **1.693** | **1.493** |

(The concurrent arm's columns are in §5 and §7; the two capped artifacts differ in the cache column only, and the
decomposition below is the same for both up to 0.20 CNY.)

Read down the two middle rows and the cap's economics become legible: it removed **2.79 M tokens the endpoint had been
discounting by 98 %** and paid ¥0.056 less for them — while the column that matters, the full-price one, moved by
¥0.135 because the arm changed tools. It fought in the cheap column and won 28 % of its saving there.

**The bill is the newest observation on each call, multiplied by the number of calls.** 225 tokens a call at full price
is 84.6 % of the anchor's bill; the 6.2 M tokens of accumulated history — every result the model had already seen — are
7.3 %. That is 352's "84.6 % of the bill is uncached input" made structural rather than coincidental: the uncached input
*is* the evidence, one block at a time.

The arithmetic above prices the *reported* counts — what an invoice would charge — and assumes nothing about how the
endpoint decides what to cache; §8 records why that distinction matters here.

## 10. The next lever, with its arithmetic

The arm's bill decomposes into three terms and only one of them is large:

```
bill ≈ calls × block × ¥1/M          the observation this call adds, at full price    (84.6 %)
     + calls × (opening + history) × ¥0.02/M   what the endpoint already saw           ( 7.3 %)
     + answer tokens × ¥4/M                                                             ( 8.1 %)
```

A lever has to move the first term. Two do, and neither of them edits the history — and one of them has already run,
by accident: **the cap's own tool substitution moved 67 % of its saving through this term** (§7), which makes the entry
cut a deliberate version of a channel the corpus has already been observed to respond to.

1. **Cap what ENTERS the transcript, not what stays in it.** Truncating a tool result as it is appended — the block the
   model has never seen — attacks the full-price column directly and leaves every byte the model has already read
   unchanged, which is what §7, point 1 asked for and what the cache behaviour rewards. Applied to the **anchor's** other
   two columns, which the design leaves intact, a 100-token block instead of ~200 takes the first term to ¥0.80 and the
   bill to **¥1.06, −37 %**, with the prompt's history untouched. (Applied on top of the cap arm's already-damaged
   cache the same change reads ¥0.99, but that arm is closed — the lever is meant to be used instead of the cap, not
   after it.)
2. **Spend fewer calls.** The stop-reason tables above contain 351 and 367 cases that exhausted six rounds in the anchor
   and answered under the cap with **identical scores** — evidence that some investigations buy nothing with their last
   rounds, though it is selection and not a controlled arm.

Both are measurable with instruments this iteration already built: the per-call curve for the money, and the trajectory
comparison for the accuracy, at ¥0 of extra scoring. What neither this document nor any artifact in the programme can
yet say is how much of a block can be truncated before the next action changes — that is the dispatch, and it is the
one the arithmetic says is worth the money.

Two columns were added to make that dispatch readable rather than inferred: `turnTokens` (one prompt count per call,
which produced the curve above) and `turnHitTokens` (the cached share of each call, so the next arm states *which* call
lost its cache instead of deriving it from a case total).

The lever itself now has an instrument: **`--result-chars`** bounds each result where it enters the transcript, keeps
the head (the tools print strongest-first or earliest-first, so the first characters are the ones that decide the next
action), and marks the cut with the number of characters dropped. It is a different key from `transcript=` in
`run-metadata`, because two arms that used different levers must not be compared as though they used one. The trace
keeps the results whole even under a cut — a row has to be able to say what the model never saw — and the cut spends
the last of the workflow's 25 `workflow_dispatch` input slots, which the wiring test now pins as an exact count.
