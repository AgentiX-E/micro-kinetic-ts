# What the arm read, and whether it read the case

Two instruments, both computable from one claims file and one fingerprint file, both with no model and no network.
They exist because the accuracy number cannot tell two arms apart that are failing for opposite reasons — a reader
that reads the table and misjudges it, and a reader that never reads it at all.

## The citation census

`benchmarks/src/agentic-citation-census.ts`

For every claim, ask the table three questions it can answer without the label:

| Question | Counter |
| --- | --- |
| did the eliminated candidate's row carry the cited label at all? | `absent` — a channel nobody measured on that row |
| did the kept candidate's row carry it? | `unshared` — the comparison the verifier needs has one side |
| is the cited channel **ordinary** — out of its fault-free band in at least half of clean windows? | `ordinary` |

`ORDINARY_RATE = 0.5` is a reported bucket, not a decision rule: nothing in the repository acts on it. It is a half
because that is where the channel leaves its band more often than not, so citing it describes the channel's habit
rather than the case.

The unit is the **claim**, not the case. A case with four claims has four chances to cite something plausible, and a
per-case rate would fall as a model got more talkative.

### The reading on 1 422 cases and 5 335 claims

```
citations: 5335 claims · 3561 cite a channel both rows carry (66.7 %) · 774 cite one only the eliminated row
           carries (14.5 %) · 1000 name a label that row never printed (18.7 %)
           mean fault-free rate of a cited channel 0.90 · 3344 cite a channel that swings in at least half of
           clean windows (62.7 %) · most cited: container.filesystem.available ×1609,
           k8s.pod.filesystem.available ×949, container.memory.rss ×134, …
```

Two defects are in those two lines.

**The 774.** `verifyClaim` requires the cited channel on the eliminated candidate *and* on the kept one, and versions
0 and 1 of the prompt never said so. Both failures were reported as `unknown-channel`, so the published census could
not separate a fabrication (1 000) from an answer to a narrower question (774), and
`channel-not-observed-on-both` — declared in `CLAIM_REJECTIONS` from the first commit — was a rejection family no
input could produce. Protocol **2** states the rule in the prompt; the verifier now emits the second reason.

**The 0.90.** The mean fault-free rate of a cited channel is 0.90, and two `filesystem.available` channels take 48 %
of all citations while leaving their band in 99 % of *fault-free* windows. That was not the model's choice: it was
the table's order. `departure` had three definitions and the fingerprint builder's was in **absolute units**, so a
channel measured in bytes led every candidate's table regardless of what it read. See
`packages/ai/src/agent/evidence.ts` — one definition, in band widths, with the profile's own measured rate ahead of
magnitude.

## The preference census

`benchmarks/src/agentic-preference-census.ts`

Split, for one service, the cases it was **presented** in — the model was shown it, so it could have named it — by
whether that service is the source, and count how often the model named it in each half.

A reader that uses the table names a service more often when its row is the source. A model answering from a name
prior names it about as often either way. A model whose prior points the wrong way names it **more** often when it is
innocent.

### The reading on the four most-presented services

| Service | named when it IS the source | named when it is not |
| --- | ---: | ---: |
| `ts-travel-plan-service` | **4 / 80 (5.0 %)** | 251 / 658 (38.1 %) |
| `ts-route-plan-service` | 48 / 134 (35.8 %) | 171 / 571 (29.9 %) |
| `ts-travel-service` | **9 / 98 (9.2 %)** | 170 / 430 (39.5 %) |
| `ts-travel2-service` | **10 / 75 (13.3 %)** | 142 / 367 (38.7 %) |

Three of four are inverted; the largest by 7.6×. The verdict is binary (`inverted`) and read from the rows the table
prints, because a table of forty lifts invites a reader to pick the flattering row.

The denominators are cases where the service was presented **in an answered case**. A case with no claim states no
preference, so it enters neither half; and a half with no denominator prints `-` rather than `0.0 %`, because zero is
the strongest rate the statistic can state and an absent denominator states nothing.

## Reproducing both without a dispatch

Both censuses are pure functions of two files. With the artifacts of a completed `benchmark-agentic.yml` run:

```bash
pnpm exec tsx benchmarks/src/run-agentic-eliminator.ts \
  --fingerprints artifacts/agentic/fingerprints.ndjson \
  --verdicts artifacts/agentic/per-case.ndjson \
  --claims artifacts/agentic/claims.ndjson
```

The study prints both blocks after the replay ledger and before the arm table. A claims file from another protocol
version is refused by name and the censuses print nothing — an answer to a different question is not an answer.

## What these instruments do NOT say

They do not say the arm is useless in every configuration. They say **this** arm, on **this** corpus, is not reading
the row: its citations are dominated by channels the profile itself calls noise, and its preference is stronger for a
service when that service is innocent. Those are two facts about the input it was given and the task it was asked,
and the second one is why the next arm changes the task rather than the protocol.
