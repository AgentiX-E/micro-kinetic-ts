# 342b — The dispatch: the schedule arm is refused by its own measurement

## 1. What ran

`benchmark-agentic.yml` dispatch **45414380350**, `query_agent_sample=266`, `query_schedule=engine`, everything else
empty: `deepseek-chat`, six rounds (five executable calls), `--seed none --gate none --fallback none`, concurrency 6.
**532 cases** = every one of the 266 cases the engine answers at rank ≠ 1, plus 266 it answers at rank 1 — a stratified
sample, so its Top@1 is an exchange rate and not a corpus accuracy.

Cost: **¥7.36** (3 611 158 prompt + 17 199 completion tokens, at the declared prices). Wall clock 37 m 20 s for the
whole workflow, of which the arm is 3 m 40 s.

The pre-registration in `schedule-not-seed-342.md` §10 was written before the artifact existed. This entry judges
against it.

## 2. The reading, against the floor it did not choose

```
cases 532 · answered 532 · stops {"answered":532}
agent Top@1 184 · engine Top@1 on the same cases 266
repairs 45 · breaks 127 · precision 0.262
retained 139/266 of the engine's own (0.523) · repaired 45/266 of its misses
```

| hypothesis                              | pre-registered                                               | measured                                                                              | verdict                                     |
| --------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| H1 the route is used                    | mean distinct ≥ 3.0, ≥ 50 % of transcripts carrying a `next` | distinct **1.718** (below the free arm's 1.895); `next` count **not measurable** (§4) | **fails on distinct, unmeasured on `next`** |
| H2 the reach converts                   | ≥ 10 of the 74 repaired                                      | 45 repairs over the whole 266; the 74-case subset is not yet separable                | **fails at the aggregate**                  |
| H3 the route does not cost what it buys | retention ≥ 96 %                                             | **52.26 %**                                                                           | **fails, decisively**                       |
| the decision rule                       | net ≥ +8 to justify a full dispatch; < 3 closes the lever    | **−82 against the engine** (184 vs 266), **−127/+45** within the sample               | **lever closed**                            |

## 3. The control that decides it, at the same denominator

The free arm's own artifact (`/tmp/art328/query-agent.ndjson`, 1 422 rows) read on the same two populations the sample
is drawn from:

| arm                         | repairs on the 266 engine misses | retention on the engine's hits |
| --------------------------- | -------------------------------: | -----------------------------: |
| free (shipped, no schedule) |          **153 / 266 = 57.52 %** |    **1 134 / 1 156 = 98.10 %** |
| schedule (this dispatch)    |           **45 / 266 = 16.92 %** |        **139 / 266 = 52.26 %** |

Projected onto this stratified sample, the free arm's exchange rate is `(266 × 0.575 + 266 × 0.981) / 532 = 77.8 %`. The
free arm's own artifact, read on **the same 532 ids**, scores **414 / 532 = 77.8 %** — the projection is verified to the
decimal place, so the comparison is a re-read and not an extrapolation. Against that, the schedule arm's **34.6 %** is a
**−43 pp** movement on identical cases. The retention column is the one
that cannot be explained away: a prompt line that only ADDS an optional tool has no business destroying half of the
engine's correct answers.

The prediction that would have been made from the artifact was **+2.01 pp**. The measurement is **−43 pp**. The
difference is not a magnitude error; it is a sign error, and it comes from a mechanism the analysis never modelled.

## 4. Root cause: what the tail can say, and what it cannot

The artifact was fetched after all (§6), and it corrects the mechanism this entry first proposed — twice. The first
correction was to blame the mixing of tools; the second, and the one that survives, is that **the recorded transcript
is a tail and cannot price a route at all**.

Three facts, each measured on the 532 rows of this dispatch and on the free arm's own artifact restricted to the same
532 ids:

| fact                                                    |      free arm |  schedule arm |
| ------------------------------------------------------- | ------------: | ------------: |
| rows whose `trace` begins `[earlier results elided]`    | **532 / 532** | **532 / 532** |
| executed directives still visible in the `trace` (of 5) |          4.05 |          4.11 |
| mean distinct services queried (`calls`)                |         1.895 |     **1.718** |
| `TOOL next` visible in the tail                         |           n/a |   **0 / 532** |

`TRACE_CHARS = 2 000` is a record of the END of an investigation, and every row of both arms is elided: the first call
is removed whenever the rest of the transcript is longer. So `0 of 532 traces name next` is a statement about the last
four calls, not about the investigation — a `next` issued FIRST would be invisible by construction. **The route's usage
is therefore not measurable from this artifact**, and the first draft of this section ("the route was never walked") is
withdrawn as an over-read of an instrument that could not answer it. What the route question still has is its outcome
(distinct services fell) and its price (retention 52.26 %), not its mechanism.

What the tail CAN say is what the four calls before the answer were spent on, and that did move:

| presence in the recorded tail | free arm | schedule arm |         Δ |
| ----------------------------- | -------: | -----------: | --------: |
| `TOOL metric`                 |   85.0 % |       81.8 % |      −3.2 |
| `TOOL logs`                   |   73.7 % |   **25.2 %** | **−48.5** |
| `TOOL edges`                  |   60.5 % |   **97.4 %** | **+36.9** |
| `TOOL failed`                 |   82.1 % |       66.9 % |     −15.2 |
| `TOOL fleet`                  |    0.0 % |        0.0 % |       0.0 |
| `TOOL services`               |    0.0 % |        0.0 % |       0.0 |

The two zero rows are a property of the RECORD, not of the arms: `fleet` and `services` are the calls an investigation
makes FIRST, and the first block is the one elision removes. An earlier draft read them as "the fleet read was never
common (0.5 %)", which the paired artifact does not support — on these 532 ids the number is 0.000 on both sides. The
trace cannot say whether a case began with `TOOL fleet`, which is why iteration 343 ships a census counted as the
directives run (`QueryOutcome.tools`, `QueryOutcome.nextServed`, printed in the job log) before it ships another arm.

`TOOL logs` is the channel that carries the **first `ERROR`/`FATAL` timestamp** — the order axis `lagLeads` reads, and
the one signal a victim cannot manufacture. It fell by 48.5 points in the tail while `TOOL edges` — caller/callee
direction, which points AT victims as often as at sources — rose to near-universal. With both arms eliding the same
number of blocks (4.05 against 4.11 visible), the comparison is of like with like, so the reading survives the
truncation even though the `fleet` rows do not: **the four appended lines moved the tail of the investigation from log
evidence to graph evidence**, and topology alone does not separate a source from its callers.

What cannot be said, and is not: that the four lines fought the fleet read (§4), or that the route went unwalked
(§4). What can: the instruction's **semantic prior** shifted — a paragraph about "the pipeline's own order" and "a
route" is followed by a different investigation than no paragraph at all, and the −43 pp is the price of that shift
whatever its channel. Both the wording that sold the schedule as a substitute and the number that misstated the budget
are real defects; neither is established as THE mechanism.

The lesson generalises past this arm: appending ANY paragraph to a standing instruction moves the tool mix, so a
"scheduled vs free" comparison confounds the route with the text. The cleanest way to separate them is not an
equal-length paragraph but an arm with **no text change at all** — which is what iteration 343's fleet shortlist is
(`fleet-shortlist-343.md`): a change of evidence with the instruction byte-identical, so any difference it produces can
only come from what the model was shown.

## 5. What this does NOT refute

- **The 74-case reach reading stands.** 29 of the 74 unqueried misses really are inside the engine's first five
  positions, and the model really did spend 4.99 calls on 1.888 distinct services. Those are properties of the
  artifact, not of this arm.
- **`Retrieval@k` split stands** (99.25 % queried against 26.79 % unqueried): the arm looks where the engine points.
- **What is refuted is the implementation, not the premise.** "Give the model a route it may walk" was implemented as
  "replace the fleet read with a single-service walk", and that is the thing the measurement refuses. A schedule that
  _adds_ engine-ranked services to what the fleet read already shows is a different instrument and remains untested.

## 6. The instrument's gap, closed after the fact

The first attempt to fetch run 45414380350's archive stalled at 2.6 MB of 8 MB and produced a truncated zip; a retry
with `--retry 3` completed after 7 m 55 s and every number in §2–§4 is read from it. The gap this entry first declared
— that H1 had no measurement — is therefore closed, and closing it **changed the mechanism** rather than confirming it.
That is recorded because the alternative reading (a route nobody walked) was the one this file argued first.

What the artifact also confirms: `scheduled: 5` on all 532 rows (the flag reached the arm), `toolCalls: 5` on all 532
(the budget was spent to the last call), `stop: answered` on all 532, zero gate refusals, and `answeredBy: model` on
all 532 — so the collapse is not a harness failure, a refusal loop, or a fallback.

The lesson for the line itself: a job must print `distinct services`, the `next` share and the per-tool presence into
its log, because an artifact that cannot be fetched is an artifact that does not exist, and this one was read two hours
after the conclusion was first written.

## 7. What ships, and what is closed

- **`TOOL next` and `--schedule none|engine` ship**, default `none`, because the instrument is what makes the negative
  result reproducible; the register's practice is to keep a measured arm beside its number rather than delete it.
- **The v1 prompt is repaired** (`SCHEDULE_TOOL_LINE` v2): no call count, and a sentence that says what the route costs
  in width — _"`TOOL fleet` shows eight services at once for one call, so an investigation that spends every call here
  sees FEWER services than one that does not"_. v2 has **not** been dispatched; a reading taken under it is a new arm
  and says so.
- **The lever "a schedule competes with the fleet read" is CLOSED** with its number: −43 pp against the free arm.

## 8. Next, and why it is not another schedule

The premise survives, the implementation does not, and the cheapest test of the premise no longer touches the budget at
all: **`TOOL fleet` should print an engine-order section** — the first five services in the engine's order, in the same
call, in the same tool, with no extra call and no `next` directive. The free arm then sees the engine's shortlist and
its own surprise ranking side by side, at zero extra cost, and the 29 reachable cases are inside the five it would now
read. That is a harness change of about twenty lines and a `fleet` test; its dispatch is ¥7 at this sample size.

Two things are deliberately not proposed: a wider `next` (the same defect at a larger width), and a seeded prompt
(refuted in §318 for a different reason — anchoring).

**It shipped in iteration 343, with one addition the negative result forced**: the shortlist's own census. A job must
print `distinct services`, `next served` and per-tool counts, because this entry's per-tool table had to be computed from
a 2 000-character tail and could not answer the question it was asked (§4). `docs/fleet-shortlist-343.md` carries the
arm, its pre-registration, and the numbers.

## 9. Falsifiers for this entry

1. **Falsifier 1 fired, and its own reading had to be withdrawn one round later.** It read: _"if the transcripts
   contain no `next` directive at all, then the schedule was never used and the −43 pp is a prompt side-effect"_. The
   transcripts contain none — but 100 % of them are elided (§4), so a `next` issued FIRST would be invisible, and the
   falsifier's antecedent cannot be established by this artifact at all. It is therefore recorded as **fired against the
   wrong instrument** and re-registered for 343, whose census counts `tools`/`nextServed` as the directives run. Two
   mechanisms were argued before their columns were read in this line (the fleet competition, then the unwalked route);
   both are now marked as superseded rather than quietly replaced.
2. **If the free arm re-run on this exact 266/266 sample scores materially below the 77.8 % projection**, the projection
   is wrong and the −43 pp is overstated by the difference. The projection assumes the free arm's rates transfer across
   strata, which is stated here as an assumption rather than measured.
3. **Falsifier 3 fired in 343.** It read: _"if a `fleet` with an engine-order section moves accuracy negatively too,
   then the engine's order is counterproductive when shown as evidence, not only when shown as instruction — and the
   whole position-first analysis of `schedule-not-seed-342.md` §1.2 collapses for a third reason."_ Run 45437298998
   dispatched exactly that arm on exactly these 532 ids: **209 against the free arm's 414** (−38.53 pp), retention
   **60.15 %**, with the prompt byte-identical to the free arm's. The order is now refused in three presentations —
   printed, served, and shown — and `fleet-shortlist-343.md` §7.1 names the mechanism: a presented ranking is read as a
   candidate SET, and the model substitutes a sibling of it for the answer it would otherwise have found itself.
