# The cache serves 81 % of the tokens at 1/50 the price

**The bill fell by 4.9× and no model was changed.** Run `45595943761` — the acceptance run of the certainty floor, 1 422
cases, 1 062 model calls — is the first artifact in this programme that records what the endpoint *says* it served and
what it served *from cache*, per call. Three readings follow, and one of them withdraws a conclusion published two days
ago.

## 1. The probe could not see the cache; the workload can

Iteration 349 (`endpoint-probe-349.md`) sent the same 191-token body twice and read `prompt_cache_hit_tokens: 0` both
times, on both models, and on that evidence withdrew 348's 75 % saving as never available at any price.

The workload:

```
prompt tokens   7 636 769
cache hits      6 204 649   = 81.25 % of input
cache misses    1 432 120
per call        7 191 prompt = 5 842 hit + 1 349 miss   (1 062 calls)
```

**The system prompt is cached and the case is not**, which is exactly the shape the tariff rewards: ~5 800 tokens of
instruction and tool grammar are identical on every call, and ~1 350 tokens of telemetry are not. A 191-token probe
caches nothing because there is nothing stable enough to cache — so what 349 established is narrower than it was
published as, and it is worth stating precisely:

> A short prompt does not cache. An agent, which recurs on a long stable prefix, hits at 81 %.

That is not a defence of the withdrawal — the withdrawal was right about the probe and wrong about the workload, and the
column that would have said so did not exist until this run wrote it.

## 2. The old table was the peak column, not an estimate

The published CNY card has two time tiers, per million tokens:

| | off-peak | peak |
| --- | -------: | ---: |
| input, cache hit | **0.02** | 0.04 |
| input, cache miss | **1** | 2 |
| output | **4** | 8 |

Peak is exactly double, Monday–Friday 01:00–04:00 and 06:00–10:00 UTC. So the **2 / 8** every artifact was priced with
is a real tariff — **the peak one** — and 349's "1.87× over-statement" was an artefact of converting the USD off-peak
figures at 7.13 instead of reading the CNY card.

`TokenRates` gains an optional `cacheHitPerMillion`, and its **absence is the no-cache bound**: a table that states only
a miss price bills every prompt token at that price, so the conservative reading is the one you get without asking, and
a cheaper number nobody named cannot appear in a report.

## 3. What the run cost

| reading | CNY | per case |
| ------- | --: | -------: |
| peak tariff, no cache (the two-number table) | 15.55 | 0.01093 |
| off-peak tariff, no cache | 7.77 | 0.00547 |
| **off-peak tariff, cache as measured** | **1.69** | **0.00119** |

The run started at 18:32 Beijing time, which is off-peak, so **1.69 CNY** is the invoice and `0.00119 a case` is the
figure. The dominant line flips with the cache:

| line | CNY | share |
| ---- | --: | ----: |
| input, cache miss | 1.432 | **84.6 %** |
| output | 0.137 | 8.1 % |
| input, cache hit | 0.124 | 7.3 % |

**Every earlier recommendation to shorten the system prompt was worth 1/50 of what it looked like.** `cost-structure-348.md`
§5 ranked "shorter transcripts" third, at 15–25 % of input, behind two items that are now either automatic (the cache)
or much smaller. Shortening the transcript — the 1 349 uncached tokens a call — is the first lever, at fifty times the
weight per token.

## 4. What this does to the standing

| system | Acc@1 | CNY / case | multiple |
| ------ | ----: | ---------: | -------: |
| **ours, floor 1.5 + the measured cache** | **93.32** | **0.0012** | — |
| ours, floor 1.5, cache priced as a miss | 93.32 | 0.0055 | 4.6× |
| RCLAgent V2 · Qwen | 53.4 | 6.39 | **5 370×** |
| Sonnet · ThinkDepth.ai | 90.0 | 32.94 | **27 673×** |

Against the field's best published accuracy the standing is **+3.32 points at 0.0012 CNY a case**, which is 1/27 673rd
of the only closed competitor's published per-case price.

## 5. Three things the same artifact settled

- **The floor's prediction held exactly.** 360 cases at `rounds: 0` and zero tokens, all answering `engineWinner` under
  `certainty`, **0 repaired against 0 broken**; corpus 93.32 % against the anchor's 93.39 %, with the whole difference
  inside the 1 062 that still called the model. `certainty` now reads **360 cases, 0.00 CNY, 360 correct**.
- **The `priorTop` identity.** `priorTop` equals `engineWinner` on **1 422 of 1 422** cases, because the fallback order
  *is* the engine's ranking. The two-signal floor I planned to price from it is therefore not a second signal: it
  collapses to the engine arm, 81.29 %. The column earns its place as the proof of that identity — and as the reason
  iteration 348's rule mismatch was *latent* on this arm rather than live, since `--fallback engine` makes the prior and
  the engine the same name. A `--fallback seed` arm would have shipped a different answer.
- **The `deepseek-chat` retirement, end to end.** `servedModel` reads `deepseek-flash` on **1 062 of 1 062** calls.
  Iteration 349 inferred it from one response; this is the whole corpus confirming it.

## 6. What to do next, in the order the numbers put it

1. **Shorten the transcript.** 1 349 uncached tokens a case is 84.6 % of the bill. `--transcript-chars` is already a
   flag — **and iteration 354 found it reached nothing**: `buildUserPrompt` rendered the transcript at the harness
   default regardless of the flag, so every prompt ever dispatched used 9 000 characters and the knob had never been
   connected. `transcript-lever-354.md`. What is missing is still the reading of what a shorter transcript costs in
   accuracy, and that dispatch now measures something.
2. **The floor's frontier.** 0.8630 remains the corpus-fitted optimum, worth a further 15.7 points of saving. It is
   priced, not shipped.
3. **The refusal stratum.** 427 cases, 0.66 CNY — the largest remaining block, and the one where the engine was *not*
   sure.
4. **Stop pricing prompt tokens that are cached.** Any future report that quotes a bill without the hit column is
   quoting the peak tariff with no cache, which is now 4.6× too high.

**One inconsistency this iteration did not close, stated rather than hidden.** The runner's own last line —
`tokens 7636769+34277 · est. ¥15.55 at the declared prices` — still multiplies the summed prompt tokens by the peak
miss price. It is labelled `est.` and it is the conservative bound, and the authoritative figure is
`run-cost-audit.ts`, which prices per row with the cache split. Making the runner print the audit's number means
carrying the hit count through `summariseQueryArm`; that is the first task of the next iteration, not a footnote here.
