# The probe: the model in every artifact is retired, the cache does not work, and the price was an estimate

Four requests of eight tokens each, ¥0.001. Three answers, and two of them change a published claim.

## 1. `deepseek-chat` is not a model this key can reach

```
GET /v1/models → HTTP 200, 2 models
  deepseek-flash   owned by deepseek
  deepseek-v4-pro  owned by deepseek
```

And a request that names `deepseek-chat` is **served anyway**, by something else:

```
deepseek-chat  #1: model field = 'deepseek-flash'
deepseek-chat  #2: model field = 'deepseek-flash'
```

So **every artifact this programme has written names a model the endpoint no longer offers**, because the record
carries the name that was *asked for*: `--model deepseek-chat`, `model: "deepseek-chat"` in the metadata, and the
served name nowhere. The 93.39 % standing, the 1 328 corrections, the 8-break precision — all of them were produced by
`deepseek-flash` behind a retired alias.

**What this does not change.** The readings themselves are measurements of the thing that ran, and the thing that ran
is named in the response even when the record is not. What it changes is *comparability across 2026-07-24*, the date
the alias was retired: any arm before and after that date is two instruments, and this is the second explanation for
the 236-case difference iteration 346 read as drift — the first, and the one 347 proved, being a configuration delta
worth 186 of the 244 cases. The third exists and is now named rather than assumed.

## 2. The prompt cache does not serve anything, at any price

The same body, sent twice, on both models:

```
deepseek-chat  #1: {"prompt_tokens": 191, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 191}
deepseek-chat  #2: {"prompt_tokens": 191, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 191}
deepseek-flash #1: {"prompt_tokens": 216, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 216}
deepseek-flash #2: {"prompt_tokens": 216, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 216}
```

**Zero on the second identical call.** The endpoint reports a cache split and reports it empty, twice, on both models.
`cost-structure-348.md` §8 lists "recovering the cache would cut the input price by up to 75 %" as the largest open
item; it is now **closed, with a no**, and the audit's inference — that 10.2 M prompt tokens were charged at the miss
rate — is replaced by the endpoint's own field.

The reason is probably shape rather than configuration: a 750-character system prompt is below whatever block the
cache indexes in. It is not worth another probe. **The 75 % was never available.**

## 3. The price this repository quotes is 1.87× the published rate

`run-query-agent.ts` prices a run at **2 CNY per million in, 8 per million out**, and every "CNY" figure in this
programme's documents is that arithmetic. The endpoint's published off-peak rate for the model it actually serves is
**$0.15 / $0.60 per million**, which at 7.13 is **1.07 / 4.28** — **1.87× less**.

So the corrected bill for run `45531140696`:

| | tokens | at 2 / 8 (published here) | at 1.07 / 4.28 (the served model) |
| --- | ---: | ---: | ---: |
| input | 10 221 261 | 20.44 | **10.94** |
| output | 46 085 | 0.37 | **0.20** |
| **total** | | **20.81** | **11.13** |
| per case | 1 422 | 0.0146 | **0.0078** |

**Every "CNY" figure in this programme is an upper bound by 1.87×.** The ratio of input to output — 222 to 1, 98.2 %
of the bill — is untouched, because it is a token ratio and not a price.

**Which table the documents keep using.** `DEEPSEEK_CHAT_RATES` (2 / 8) for anything that has to agree with a
published figure, because re-pricing a month of artifacts at the newer table would make the reports disagree with each
other for a reason that has nothing to do with the arms; `DEEPSEEK_FLASH_RATES` for what the next run will cost. Both
are in `token-rates.ts` with the 1.87 pinned by a test.

**One caveat that is not arithmetic.** The published rate is in USD and this account is billed in CNY, so the 1.87 is
a conversion and not an invoice. The invoice is the only authority and this repository cannot read it. The saving is
stated as a bound, not as a refund.

## 4. A risk the probe found on the way past

The `deepseek-flash` responses carry `completion_tokens_details.reasoning_tokens: 8` — the model spent its entire
eight-token budget thinking. **Thinking is on by default on that name.** The shipped arms spend 5.4 completion tokens
per call, which is impossible with thinking on, so the retired alias was serving it with thinking off.

**Consequence: switching the requested name to `deepseek-flash` without also disabling thinking would multiply the
output bill.** Ten times the output is 2.0 CNY instead of 0.20 — survivable. Ten times on a model that reasons for
thousands of tokens is not, and the failure would look like a price change rather than a configuration one.

So the migration, when it is done, is **`deepseek-flash` with `thinking: {type: disabled}`**, in one change, with the
served name and the reasoning tokens both recorded — which is what §5 ships.

## 5. What ships so this cannot be re-learned the hard way

1. **`ChatCompletion` carries `cacheHitTokens` and `cacheMissTokens`**, parsed from the endpoint's own `usage`. A run
   that claims a cache saving now has to show one; absent reads as zero, because an endpoint that reports no cache
   served nothing from one.
2. **`QueryOutcome.servedModel` and `QueryArmRow.servedModel`** record what the endpoint SAID it served. Empty when it
   says nothing — never the requested name, because that is the defect this section is about.
3. **`QueryArmRow.cacheHitTokens`** sums the split across turns, so a run's own artifact prices its cache.
4. **`DEEPSEEK_FLASH_RATES`** beside `DEEPSEEK_CHAT_RATES`, the 1.87 between them asserted by a test.
5. **`probe-endpoint.yml`** — dispatch-only, four requests, no artifact. The next time a supplier moves, the answer
   costs a hundredth of a corpus case instead of a day of reading two files that disagree.
6. The banner now reads `asked for deepseek-chat`, which is the truth about what the runner does.

## 6. What this does not fix, stated plainly

**The standing is still `deepseek-flash` and is still 93.39 %.** Nothing in this document lowers it: the model that
answered is the model that answered, and its name was wrong in the record rather than in the run.

**The certainty floor's 41 % is unchanged.** It is a ratio of tokens to tokens, and the price table cancels out of it.

**The bill is still 98.2 % input.** A cheaper model makes a smaller bill, not a different shape, and the shape is where
the remaining 54.8 % of discarded answers lives.
