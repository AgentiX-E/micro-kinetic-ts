# The eliminator: one table in, one verifiable claim out

Iterations 267–281 built an elimination layer from the scoring end backwards. `scoreArm` could price a **ceiling**
(remove every candidate above the truth, where a claim can be made), a **deterministic rule** (fault-free rate and
departure), and a **recorded** arm that replays claims somebody else proposed — and nothing in the repository ever
produced one. The ceiling was a bound with no method under it, and the study printed three rows where four were
promised.

This iteration is the producer. It is deliberately three modules and a command, because the thing that has to be
right is not the model call:

| module                            | what it owns                                                          | why it is separate              |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| `packages/ai/agent/eliminator.ts` | the prompt, the reply contract, the parser                            | pure: no IO, no clock, no key   |
| `benchmarks/agentic-claims.ts`    | the artifact an answer is stored in, and the replay's three refusals   | the artifact outlives the call  |
| `benchmarks/chat-completions.ts`  | one HTTP turn, with retry, timeout and token accounting               | the transport is the failure    |
| `benchmarks/agentic-proposer.ts`  | ordering, concurrency, failure-as-abstention                          | the driver, and nothing else    |
| `benchmarks/agentic-eliminator-study.ts` | join → propose → replay → score → price                        | the table a reader quotes       |

---

## 1. What the model is asked, and what it may answer

The input is a **table per case**: the fault type, then the candidates in rank order with their channels —
`pre`, `post`, the fault-free `band`, the fault-free outlier `rate`, and the `onset` in milliseconds after the
injection. Everything in it comes from the fingerprint dump the engine already wrote; nothing is re-measured,
re-sampled or summarised by a second implementation.

The output is **one JSON object** and nothing else:

```json
{"eliminate":[{"remove":"ts-auth-service","keep":"ts-order-service","channel":"latency_p99",
               "statistic":"post","observed":98.25,"band":[11,14.2],"rate":0}]}
```

An empty array is a **legitimate answer** — "the ranking is right" — and it is counted as one. A model that says
nothing and a model that agrees with the engine are different events; pooling them would make a silent model look
like a confident one.

### The statistic the prompt does not offer

`delta` is a member of the claim space (`post − pre`) and is **absent from this prompt**. The table prints `pre` and
`post`, so `delta` is the one number a model would have to compute, and a subtraction that rounds is
indistinguishable from a value that was invented. `verifyClaim` would refuse it for a value mismatch and the refusal
would read as fabrication. So the protocol offers `post` and `onset` — the two quantities that appear in the table
verbatim — and the parser refuses `delta` by name.

### Why every printed number is `String(v)`

A claim's `observed` is compared with the fingerprint's value using `===`. `String(v)` is the shortest
representation that round-trips, so a faithful copy is never refused for a rounding error, and a wrong copy is
always refused. A test reads a row back out of the table and asserts `Number(cell) === value` for a deliberately
awkward double (`0.1 + 0.2`), because the alternative is a prompt that quietly disagrees with its own verifier.

---

## 2. A reply is applied whole or not at all

`parseEliminatorReply` refuses by shape and `verifyClaim` refuses by content, and the split is what makes a refusal
name something a reader can act on. Shape refusals:

| refusal                                              | what it catches                                    |
| ---------------------------------------------------- | -------------------------------------------------- |
| `the reply is not JSON` / `is not a JSON object`      | prose, an array, `null`                            |
| `has no eliminate array`                             | a different key, a different schema                |
| `carries N eliminations against a bound of M`         | a model that ignores the presentation width        |
| `elimination i cites statistic delta…`                | the statistic this prompt does not offer           |
| `elimination i does not carry a two-number band`      | a fabricated band, a band of one                  |
| `elimination i does not name a channel`               | a preference stated as evidence                    |

A reply whose *second* element is malformed is refused whole. A truncated response's surviving claims are the ones
the model happened to emit first — an accident of generation order — and admitting them would make the arm's
accuracy a function of `max_tokens`.

What the parser does **not** do is judge. A reply whose every field is true and whose conclusion is wrong is
accepted here and scored as wrong, because a verifier that also policed judgement would be a second scorer hidden
inside the layer.

---

## 3. The claims artifact, and three refusals on the way back

One JSON line per case, written as soon as it exists:

```json
{"datapack":"…","model":"deepseek-chat","protocol":1,"digest":"3f2a…","claims":[…],"ms":812,
 "promptTokens":940,"completionTokens":61}
```

`digest` is a 64-bit fingerprint of the exact prompt (`system` and `user` concatenated). `protocol` is the version of
the reply contract. `malformed` carries the reason a reply could not be read — or the reason a call failed — so an
unreadable case stays in the denominator instead of leaving it.

`replayOf` pairs recorded answers with the questions the *current* build asks, and refuses three ways, separately:

| refusal          | meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| `stale`          | the prompt changed; the answer belongs to a different question   |
| `foreignProtocol`| the reply contract changed; the answer was read by another parser |
| `unknown`        | the case is not in this population                              |

Pooling them would let one number stand for three different mistakes.

**A failed call is an abstention, not a dropped case.** The proposer catches the transport error, records
`malformed: "the call failed: …"` under the digest of the question that was asked, and keeps the case in the
population. Dropping it would let a network outage improve the accuracy by shrinking the denominator — and, because
the record carries the digest, a resumed run does not pay for the same failure twice.

**A reused answer is counted, not re-emitted.** The first version of the proposer called `onRecord` for reused
records too, which appended a second copy of every line to the artifact on a resumed run. The resume test caught it:
the file grew by one line per reused case, and a file read by line count would have reported a run that asked twice.

---

## 4. The four arms, and the price of each

```
engine    0.00    1422   75.5%     0       0      0     …
oracle    1.00    1422   88.8%   237     237      0     …
evidence  1.00    1422   76.4%   …       …        …     …
recorded  1.00    1422     ?       ?       ?       ?     ← this iteration's arm
```

The **delta against the control** is priced by `certifyLosses`: `lost = control − arm` per family, read at
`--delta` under Holm over **every family in the population** — not only the ones that moved, because a claim covers
the corpus it is about and narrowing it to the families that happened to break would buy a smaller number by saying
less.

Two arms are not priced, for opposite reasons:

* the **ceiling** reads the label, so there is nothing to certify about a rule that has the answer;
* an arm that loses a whole family has **no budget at all** — the bisection's ceiling is checked and the row says
  `none`, rather than printing the corpus's own size as if it were a claim (the defect §281 closed one level up).

---

## 5. What this iteration does *not* claim, and what the first dispatch said anyway

The machinery ships in the same iteration that dispatches it, so the reading below was produced **after** the
machinery and **by** it. Run `43548386087`, 1 422 cases, model asked `deepseek-chat` and served `deepseek-flash`:

| arm        | top1       | moves | claims | silent | delta              |
| ---------- | ---------: | ----: | -----: | -----: | ------------------ |
| `engine`   | **75.5 %** |     0 |      0 |      0 | control            |
| `oracle`   | 87.7 %     |   174 |    269 |  1 248 | +174 (ceiling)     |
| `evidence` | 44.2 %     |   695 |    695 |    727 | −444               |
| `recorded` | 33.1 %     |   925 |  5 335 |    348 | **−602**           |

The three properties the reading was to be judged on, read in order:

1. **ceiling gap** — there is none to close: the arm is 602 cases *below* the control and the whole verifiable
   headroom is 174 cases above it.
2. **refusal rate** — 2 014 of 5 335 claims (37.8 %), of which **1 774 are `unknown-channel`** and exactly **one**
   is `value-disagrees-with-fingerprint`. The model copies numbers essentially perfectly and fails on a rule the
   prompt never states: `verifyClaim` needs the cited channel on *both* candidates, while the table prints each
   candidate's channels independently and the five presented candidates share only 2.2 labels on average.
   Acceptance among claims that clear the channel rule is **93.3 %**, so the contract, not the reasoning, is what
   the refusals are measuring.
3. **the price** — printed as 105 and meaningless at a delta of −602; a budget cannot permit a loss.

Two facts live in the artifact and not in the table: 1 253 replies used the full four-claim bound and exactly one
was an empty array, so the model never concluded that the ranking was right, on a corpus where it is right 75.5 % of
the time; and `evidence` at the same weight reads 44.2 %, so eliminating on departure is not a signal either. A
repaired channel contract is therefore **necessary and not sufficient**.

Both documents record the state rather than a promise: `docs/closed-axes-register.md` §282 carries the verdict row
for this arm, and the study prints `MODEL ARM NOT MEASURED: <reason>` when the key is absent rather than a row a
reader would take for a refusal.

---

## 6. Reproduction

```bash
# One dispatch produces the artifacts (the corpus lives on a release; the study job has none).
gh workflow run benchmark-agentic.yml -f model=deepseek-chat

# Or, offline, from a pair of artifacts plus a claims file:
pnpm exec tsx benchmarks/src/run-agentic-eliminator.ts \
  --fingerprints artifacts/agentic/fingerprints.ndjson \
  --verdicts     artifacts/agentic/per-case.ndjson \
  --claims       artifacts/agentic/claims.ndjson \
  --propose --model deepseek-chat --concurrency 6

# Every ablation after that is a re-read: no key, no tokens, no run.
pnpm exec tsx benchmarks/src/run-agentic-eliminator.ts \
  --fingerprints … --verdicts … --claims … --weight 0.5 --max-candidates 20
```

`--weight 0` is the control arm by construction — `applyClaims` returns the input unchanged at zero — so the
ablation's baseline is the same code path as the method.
