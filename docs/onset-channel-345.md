# The onset channel: the first arm that carries evidence without carrying a ranking

Iteration 344 decomposed the shortlist arm's 205-case loss and found the largest single block where the arm's behaviour
was **unchanged**: on the cases the engine gets wrong, neither arm queried the culprit (48 and 43 of 266), and with no
query at all the free arm answered **115 / 218 = 52.8 %** while the shortlist arm answered **14 / 223 = 6.3 %**. That is
a path from global fleet evidence to an answer that never passes through a per-service query, and the section destroyed
it. This entry builds the arm that tests whether the path can be **strengthened from the evidence side**.

## 1. The premise, stated so it can fail

The census says which channel that path does not use: `TOOL logs` — the only tool that carries the first
`ERROR`/`FATAL` **timestamp** — is opened in **0.44** of the five calls per case, while `TOOL metric` is opened **1.33**
times. If the 52.8 % is inference over the fleet's global evidence plus whatever timeline the arm happens to have, then
putting the onset **into the read it already makes** should raise it. If it does not, the 52.8 % is not evidence-limited
and the block is closed to evidence interventions of every kind.

The distinction from the three refused presentations is one sentence: **a timestamp can be weighed against the model's
own order; a list of names replaces it.** Everything about the design follows from that.

## 2. What the arm changes

`--evidence-order onset` appends one field to every line of a per-service `TOOL metric` read:

```
checkout cpu: base=10.00 peak=90.00 delta=80.00 ratio=9.00 z=n/a at=1s err=+2s/7
```

- `err=+2s/7` — the service's first `ERROR`/`FATAL` is **+2 s** after the injection, and it logged **7** of them.
- `err=-` — the service logged nothing. Silence would be read as "this arm does not report errors", which would discount
  the whole line; the dash is a statement and the absence of a dash is not.

What it does **not** change: the instruction (byte-identical to the free arm's), the number of calls (zero extra), the
number of rounds (zero extra), the `fleet` read (asserted byte-identical in a test), the `logs` read (asserted
byte-identical), and the number of lines a `metric` read returns (one suffix, not a section).

Seven tests were written before the code, in `benchmarks/__tests__/query-agent-onset.test.ts`.

## 3. The arm, pre-registered before its artifact exists

Dispatch: the **same 532 ids** as 343 and 342b, `--fleet-order none --schedule none --evidence-order onset`, so the arm is
**free + onset** and nothing else. Control: the free arm on the same ids (**414 / 532 = 77.82 %**), re-read from an
artifact already paid for.

| hypothesis                         | bar                                                    | what a failure would mean                                                                                                  |
| ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **H1** the block is evidence-starved | misses / did-not-query: 52.8 % → **≥ 60 %**          | below 52.8 % the block is not evidence-limited, and no evidence-side intervention can reach it                              |
| **H2** the total moves             | Top@1 **≥ 425** of 532 (+11 cases, +2.07 pp)           | below **414** the channel *costs* accuracy and the axis closes on the spot                                                  |
| **H3** the wins stay won           | engine hits: **≥ 97 %** (the free arm's 98.1 %)        | a gain bought with hits is a reshuffle, not a gain                                                                          |
| **H4** the channel is additive     | `TOOL logs` presence **≥ 70 %** (the free arm's 73.7 %) | a collapse in `logs` means the field **replaced** the tool instead of supplementing it, which is 342b's failure mode again |

**Decision rule, written before the artifact.** Net ≥ **+8 cases** over 414 → keep the channel and price a combination
with `--max-rounds 11` (the only lever with no order attached). Net between **+3 and +8** → keep as an ablation
reference, do not combine. Net **< +3** → close "more evidence inside an existing read" as an axis, beside the three
presentations, and record it as the fourth intervention that changed the context of an investigation and lost.

## 4. Why this is not the shortlist with the serial numbers filed off

| arm                  | what it adds to the context                   | carries an order? | spends a call? | changes the instruction? | measured              |
| -------------------- | --------------------------------------------- | ----------------- | -------------- | ------------------------ | --------------------- |
| seed (§318)          | the order, in the prompt                      | **yes**           | no             | **yes**                  | 81.08 % (−12 pp)      |
| schedule (342b)      | one name per call, through a new tool         | **yes**           | **yes**        | **yes**                  | retention 52.26 %     |
| shortlist (343)      | five names, inside `fleet`                    | **yes**           | no             | no                       | retention 60.15 %     |
| **onset (this)**     | **a timestamp and a count, inside `metric`**  | **no**            | no             | no                       | —                     |

The three losses are consistent with one mechanism — a presented ranking is read as a candidate set — and this arm is
the only one that tests the mechanism's **complement**: whether the model needs *evidence* or a *decision*. If a
timestamp helps and a ranking hurts, the finding is about authority, not about information, and that is the product
statement the whole line is trying to earn.

## 5. Falsifiers

1. **If H1 passes and H2 fails**, the block improved while the corpus did not: the arm is repairing cases it was already
   going to answer and losing more elsewhere. Read the crosstab before writing any conclusion — that is the check 343's
   reading needed and did not have until §3 of `early-convergence-344.md` existed.
2. **If H4 fails while H2 passes**, the gain came from replacing `logs` with a cheaper field, which is a budget
   optimisation rather than an evidence one, and the combination priced in the decision rule would then be measuring the
   same thing twice.
3. **If the `err=-` lines are the ones that move the misses block**, the channel is acting as a *negative* filter — the
   model is using "this service logged nothing" to exclude candidates. That is a real finding and a different one; it
   would be measured by splitting the block on whether the culprit logged anything, which this arm's artifact makes
   possible at ¥0.

## 6. Cost

≈ **¥7.17** at this sample size (532 cases, the same price 343 paid), and nothing to build: the channel is a suffix on an
existing line. If the decision rule closes the axis, the cost of closing it is that one dispatch — against ¥14.53 for
the three presentations that came before it.

## 7. The reading

Filled in after the dispatch, against the four hypotheses above. Nothing in §1–§6 may be edited to fit it.
