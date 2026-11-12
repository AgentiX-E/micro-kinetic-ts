# The ceiling before the bill: what an elimination layer can win on RCABench, measured for nothing

Iteration 267. `docs/agentic-layer-plan.md` specifies a layer and a cost model. This document reports the two
measurements that had to come before either could be spent on: **how much there is to win**, and **whether the
layer's deterministic arms already win it**. Both are computed offline, from one run's artifacts, at $0.

## 0. Headline

| arm                                               | Top@1 (711 cases) |             Δ | moved | claims | refused |
| ------------------------------------------------- | ----------------: | ------------: | ----: | -----: | ------: |
| engine (control, shipped configuration)           |        **68.07%** |             — |     — |      — |       — |
| `oracle` eliminator (ceiling, reads the label)    |        **84.70%** | **+16.63 pp** |   118 |    173 |       0 |
| `evidence` rule (EBR, best held-out thresholds)   |             68.2% |       −0.6 pp |     4 |      4 |       0 |
| `evidence` rule (EBR, most permissive thresholds) |             46.3% |      −21.8 pp |   310 |    310 |       0 |

Two conclusions, and they point in opposite directions:

1. **There is a large, verifiable ceiling.** A perfect eliminator that may only remove candidates by producing a
   claim the engine re-checks reaches **84.70%**, i.e. **+16.63 pp over the shipped engine**, and it does so
   without a single refused claim. The layer is not chasing a rounding error; it is chasing a sixth of the corpus.
2. **The deterministic version of it does not work.** The expected-outlier rate, stated as an elimination rule
   instead of as a weight, is worse than the engine at its most permissive setting and indistinguishable from it at
   its best — in sample and on a held-out half. That is the third distinct presentation of this quantity to fail,
   and §5 records why the axis is now closed rather than deferred again.

## 1. Population, artifacts, and what "offline" means here

One run of the shipped engine over **711 converted RCABench cases** (the `waveB2` half of the 1 422-case corpus;
the other half was never converted in this environment, so every number here is over 711 and is labelled so):

```
pnpm exec tsx benchmarks/src/build-fault-free-profile.ts --data-dir <corpus> --out profile.json
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> \
  --fault-free-profile profile.json --fingerprint-out fp.ndjson --per-case-out percase.ndjson
pnpm exec tsx benchmarks/src/run-agentic-headroom.ts --fingerprints fp.ndjson --verdicts percase.ndjson
```

The profile is a corpus artifact — 2 077 channels over 50 services, counted from the same 711 cases, whose windows
are the **pre-injection** segments only (`pruning/fault-free-profile.ts` records why a case is one window). The
fingerprint dump is the bounded view a layer would have seen, and the verdict file is the run's own answers beside
the corpus's label sets. Neither artifact carries the other's information, which is what makes the join an
experiment rather than a restatement.

Engine reading on this population: **Top@1 68.07% (484/711)**, Top@3 82.98%, **Top@5 84.81%**.

## 2. What the fingerprint actually contains

The census the dump writes, summed over the corpus:

| counter        |   count | share of considered |
| -------------- | ------: | ------------------: |
| `considered`   | 234 477 |               100 % |
| `offered`      |  28 395 |              12.1 % |
| `unprofiled`   |  89 955 |              38.4 % |
| `capped`       | 110 707 |              47.2 % |
| `unmeasurable` |   5 420 |               2.3 % |
| `shadowed`     |       0 |                 0 % |

Three facts follow, and the third one decides a design question the plan left open:

- **A candidate carries 7.99 channels on average**, i.e. the eight-channel cap binds and is what a model would
  actually read. 47.2 % of the measured channels are dropped by it — but they are dropped from the _tail_ of an
  order sorted by departure, so what is dropped is the least decisive evidence a candidate has.
- **38.4 % of channels have no published band.** A channel is published only when it is profiled over at least
  three fault-free windows _and_ has a positive scale; the rest cannot support a verifiable claim, so offering
  them would produce refusals that read as the model's fault rather than the corpus's.
- **99.6 % of candidates carry at least one out-of-band channel** (3 542 of 3 555). The `evidence` arm's whole
  premise — "the leader's evidence is ordinary, a rival's is rare" — has to separate on _rates_, because the
  presence of _evidence_ is universal.

And the rates themselves are, on this corpus, systematically high: mean 0.749, median 0.796, and only **0.8 %** of
channels ever read zero. That is the mechanical reason §5's rule cannot separate: on a corpus where four fifths of
channels leave their fault-free band in most clean windows, "left the band" is not a rare event and the rate that
counts it does not order two candidates by how surprising their evidence is.

## 3. The ceiling, and what bounds it

The oracle removes every candidate above the truth that a **verifiable** claim can remove — the channel must be
outside its band on the removed candidate and present on both. It reaches the truth in **118 of 711 cases**, and
those 118 are exactly the difference between the engine's 68.07 % and the ceiling's 84.70 %.

The ceiling is not a free parameter: it is bounded by the posterior's own recall.

| truth's rank in the posterior | cases |  share |
| ----------------------------- | ----: | -----: |
| absent from the top five      |   108 | 15.2 % |
| 0 (already first)             |   484 | 68.1 % |
| 1                             |    82 | 11.5 % |
| 2                             |    24 |  3.4 % |
| 3                             |     7 |  1.0 % |
| 4                             |     6 |  0.8 % |

- An eliminator can only reorder **within** the top five, so **84.81 % (Top@5) is a hard ceiling** and the oracle
  lands on it to within one case. The one case it cannot reach is a candidate above the truth whose only
  out-of-band channels are ones the truth does not carry — a claim the verifier refuses as `unknown-channel`, and
  refusing it is correct: the comparison it would assert cannot be checked.
- **108 cases (15.2 %) are unreachable for a reason no layer can fix**: the truth never entered the posterior.
  Those belong to the ranking, not to the layer, and they are the largest single block of the remaining 15.3 pp.

**How many rounds the ceiling needs** — measured, and it validates the three-round default in
`DEFAULT_ELIMINATOR_BUDGET` rather than assuming it:

| rounds | cases reached | cumulative share of the 118 |
| -----: | ------------: | --------------------------: |
|      1 |            82 |                      69.5 % |
|      2 |            23 |                      89.0 % |
|      3 |             7 |                      94.9 % |
|      4 |             6 |                     100.0 % |

A fourth round buys 6 cases (0.84 pp) and is outside the eliminator's budget by construction. The budget's own
argument — "an agent that needs more rounds is usually searching" — is what this distribution shows.

## 4. The skip rule, refused

The plan's cost model claimed a 2× saving from a deterministic rule: skip a case whose top-1 margin exceeds 5 % or
whose leader has three out-of-band channels. Measured on this corpus, that rule skips **710 of 711 cases** — and,
worse, it skips **117 of the 118 fixable ones**. It is not a cost gate; it is a blanket skip that happens to look
like a gate.

Relaxing it does not help, because the quantity is anti-correlated with what the rule needs to detect:

| margin | decisive ≥ | skipped | skipped & engine-right | **skipped & fixable** | consulted |
| -----: | ---------: | ------: | ---------------------: | --------------------: | --------: |
|   0.05 |          3 |     710 |                    484 |               **117** |         1 |
|   0.05 |          8 |     670 |                    473 |                **99** |        41 |
|   0.25 |          8 |     624 |                    451 |                **87** |        87 |
|   0.50 |          8 |     588 |                    425 |                **85** |       123 |
|   1.00 |          8 |     573 |                    410 |                **85** |       138 |

The most selective gate in the grid still discards 85 of 118 fixable cases — **72 % of the entire headroom** — to
save 138 model calls out of 711. A fixable case is, mechanically, a case where a _symptom_ outranks the source
confidently, i.e. exactly a case with a wide margin and many deviating channels. The rule's signal and the layer's
value live on the same cases.

**Consequence for the cost model.** The honest spend is the full corpus with no gate: 1 422 cases × ~$0.0037 ≈
**$5.3**, not $2.7. The 54× gap to the published $284 stands; the extra 2× does not, and the plan is amended rather
than left carrying a saving this measurement refused.

## 5. The evidence rule, refused — and why the axis now closes

`evidenceClaims` states the expected-outlier baseline as an elimination rule: _demote the leader when the least
ordinary thing it can point at leaves its fault-free band in most clean windows, in favour of a rival whose
evidence is rarer_. It reads no label, so it is a candidate method rather than a ceiling. Swept over six floors and
three margins, on a hash split of the corpus:

| rate floor |   margin | in-sample Top@1 | moved |
| ---------: | -------: | --------------: | ----: |
|       0.00 |     0.00 |          49.3 % |   147 |
|       0.33 |     0.00 |          49.6 % |   134 |
|       0.67 |     0.00 |          55.1 % |    89 |
|       0.80 |     0.00 |          61.5 % |    47 |
|       0.00 |     0.10 |          63.0 % |    51 |
|       0.80 |     0.10 |          65.6 % |    19 |
|   **0.00** | **0.25** |      **67.1 %** | **8** |
|   **0.80** | **0.25** |      **67.1 %** | **5** |

The in-sample engine reading on the same half is **67.35 %**; the best point re-read on the held-out half is
**68.2 %** against the engine's **68.75 %** there. So the arm's entire effect, once the margin is wide enough to
stop it damaging cases, is **four moves and −0.6 pp** — indistinguishable from the identity, on the wrong side of
it.

This is the third presentation of the same quantity:

| presentation                                 | where                                              | result                                       |
| -------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| additive term `w·(1 − r)`                    | iteration 265, `--fault-free-weight`               | +1 case at slope 130, CI crosses zero        |
| fingerprint column (evidence the model sees) | iteration 266/267, `docs/agentic-layer-plan.md` §3 | kept: it is what makes the ceiling checkable |
| elimination rule over the posterior          | this document, §5                                  | **−0.6 pp held out; refused**                |

The middle row is why the axis stays open in a _different_ role: as a column, the rate tells a model which channels
are evidence and which are noise, and §3 shows a verifiable claim built on that column can reach the truth in 118
cases. As a **decider**, it cannot: on a corpus where 0.8 % of channels are clean by this measure, "this channel
swings anyway" does not distinguish two candidates.

**Register entry.** The rule is closed. What remains open is the layer _using_ the column, which requires a model
and therefore a spend decision the ceiling in §3 has now been made against.

## 6. What this changes in the plan

1. **§5's cost model loses its 2× term.** Gate refused by measurement; the shipped arm is full-corpus at ~$5.3.
2. **§6's order of arms gains its first result.** The nine-cell identity arm is still owed, but the RCABench
   ceiling is now known before any spend: **+16.63 pp available, 84.7 % ceiling, 3 rounds covering 95 % of it**.
3. **§7's builder moved.** The fingerprint is built in `benchmarks/src/agentic-fingerprint.ts`, not in
   `packages/tree`. The reason is a dependency fact rather than a preference: the builder joins **three** artifacts
   — the case's metrics, the engine's posterior and the corpus profile — and its output type (`CandidateFingerprint`)
   belongs to `packages/ai`. Building it in `tree` would force `tree` to import the `ai` value type or to duplicate
   it, and duplicating it is the one defect this repository refuses by name. `benchmarks` already depends on both,
   so the join happens there, and `ai` still does not import `tree`.
4. **§9's acceptance gains a measured status.** Requirement 5 (RE3:TT error-value conversion) is untouched and
   still unmeasured; requirements 1–3 are now testable against the artifacts above and requirement 4 has a ceiling
   to clear, which it did not have before.

## 7. Reproduction

| artifact                   | command                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| profile                    | `build-fault-free-profile --data-dir <corpus> --out profile.json`                                       |
| fingerprints + verdicts    | `run-fse26 --fault-free-profile profile.json --fingerprint-out fp.ndjson --per-case-out percase.ndjson` |
| ceiling, gate, rule, sweep | `run-agentic-headroom --fingerprints fp.ndjson --verdicts percase.ndjson`                               |

The analyzer refuses to score artifacts from different runs: it compares the dumped order with the published order
case for case and stops if they disagree, because a dump left over from an earlier commit produces a number for a
configuration neither run had.

## 8. Where the next reading runs, and why it is not on a workstation

§1 labels every number above "over 711" because the other 711 datapacks were never converted **in this
environment**. That sentence hides a decision, and iteration 269 made it explicit: the converted corpus is not
something a machine should build. It is something a **release** holds.

| resource                                   | where it lives                            | size               | measured cost to reproduce locally | cost in CI                                     |
| ------------------------------------------ | ----------------------------------------- | ------------------ | ---------------------------------- | ---------------------------------------------- |
| converted `case.json` corpus (1 422 cases) | release assets, `AgentiX-E/rcabench-data` | 2.48 GB compressed | ~19 GB of disk, one conversion run | **114 s** (`43055506630`, 16:09:45 → 16:11:39) |
| fault-free profile                         | derived                                   | 437 KB             | **6 m 46 s** for 711 cases         | cached, key derived from corpus × builder      |
| fingerprints + verdicts                    | run artifact                              | 4.8 MB / 711 cases | the run itself                     | one job                                        |

So the study moved to `.github/workflows/benchmark-agentic.yml`, which fetches the corpus through
`.github/actions/rcabench-shards` (one owner for the tag, the extraction, and the provenance gate), builds the
profile, runs the engine with `--fingerprint-out` and `--per-case-out`, and re-scores the artifacts in a second
job that has **no access to the corpus at all**. `fse26-benchmark.yml` was moved onto the same action in the same
iteration, which is what makes it one owner instead of one more copy: the three inline steps it carried — resolve,
download, verify — are now in exactly one file, and a test fails if either workflow re-inlines them. That boundary is the point: a number the study prints is then a
property of the artifact, and the control arm (`--weight 0`) is free rather than a second 25-minute run.

### The cache question, answered with the quota rather than with the idea

"Use the Actions cache to reuse the corpus" is the obvious next thought, and the API says no:

```text
GET /repos/AgentiX-E/micro-kinetic-ts/actions/cache/usage
{"active_caches_size_in_bytes": 10743940592, "active_caches_count": 84}
```

10.74 GB against a 10 GB budget. Eighty of the 84 entries are `codeql-overlay-base-database-*` — a pair per commit
SHA, 5.69 GB — and the key embeds the SHA, so **no later commit can address them**. They are written and read
inside one workflow run; afterwards they are a log whose retention is somebody else's policy. GitHub documents that
policy as 10 GB per repository by default (usage beyond it billed), eviction oldest-last-access-first, and removal
of anything not accessed in seven days — so the overlays die by churn and, until they do, they are what the budget is
spent on. Because the quota is exceeded, every save evicts the least recently used entry, which is how the entry
that _is_ reused — `RCAEvalJSON-*`, 3.95 GB, ~30 minutes to rebuild — competes with entries whose next reader does
not exist.

Two decisions follow, both measured rather than argued:

1. **The corpus is not cached.** A 2.5 GB entry would buy the 114 s download and pay for it by evicting the 3.9 GB
   artifact. A cache that wins two minutes and loses thirty is not a cache, and the release asset has no budget,
   no eviction and a digest.
2. **The profile is cached, and the hit is measured.** 437 KB, keyed by the converter digest times a digest of every
   `.ts` the build reads, so a hit cannot be stale by construction. The full-corpus build costs **11 m 13 s**
   (`43253302440`, 16:01:28 → 16:12:41) — 40 % of the measure job — and the next dispatch skipped it: run
   `43259525921` (a 200-case probe) shows `Build the fault-free profile` **skipped**, the measure job finishing in
   **6 m 04 s** against **28 m 09 s**. What the probe also shows is that the 114 s download is not a constant: the
   same 2.48 GB took **172 s** on that runner (16:31:15 → 16:34:07), which is the number a shard cache would have
   to beat with 2.5 GB of a 10 GB budget.

`scripts/prune_caches.py` reclaims the other half of the measurement: 5.69 GB of per-SHA overlays, keeping the
newest two of each family, denying by default (a key outside the named prefixes is never touched), reporting unless
`--apply` is given, and applying on a schedule where the overlays actually accumulate. 100 % branch coverage over
123 statements.

### What this makes answerable that was not

The ceiling in §3 is a bound on a **711-case** population. The same artifacts over 1 422 cases are now one dispatch
away, at $0 and no laptop: the study's `engine` arm over the full corpus is the control the model arm will be
compared against, and it is the first number in this document that will not carry a population caveat.

## 9. The full corpus, measured: the ceiling on all 1 422

Run `43253302440` at `8e3df293`, the first reading this line has produced outside a workstation. Job `measure`
fetched the corpus through the action, built the profile, ran the engine with both dumps and published the
artifacts; job `study` re-scored those artifacts with no access to the corpus at all.

| arm                                             | Top@1 (1 422 cases) |             Δ | moved | claims | refused |
| ----------------------------------------------- | ------------------: | ------------: | ----: | -----: | ------: |
| engine (control, shipped configuration)         |          **75.50%** |             — |     — |      — |       — |
| `oracle` eliminator (ceiling)                   |          **87.69%** | **+12.19 pp** |   174 |    269 |       0 |
| `evidence` rule at the CLI's default thresholds |              44.20% |     −31.30 pp |   695 |    695 |       0 |

The rule's _best_ point is a separate measurement and a separate population, because it is chosen in sample: the
in-sample half (713 cases) picks `floor=0.8, margin=0.25` at 74.8%, and re-read on the 709 held-out cases it scores
**74.54% against the control's 75.00%** there — **−0.46 pp**, four cases moved out of 709. That is the same verdict
as §5 at the same magnitude, which is what a refusal should look like when the population doubles.

Three things this changes, and one it corrects:

1. **The control is the published number, to the digit.** 75.50% over 1 422 is `1073/1422 = 75.46%`, the figure
   `docs/sota-comparison.md` quotes for this corpus, and the dump's own `Top@3 = 86.3%` / `Top@5 = 87.8%` match the
   battery. `--fault-free-profile` therefore does what it was claimed to do: it supplies the bands and moves no
   ranking term, at the shipped weight of 0.
2. **The ceiling is Top@5, now measured rather than asserted.** `87.69%` against a saturated `87.8%` `Top@5` is a
   gap of one case in 1 422: an eliminator that may only remove candidates cannot reach a service the engine never
   ranked. §3's 711-case reading said the same thing (84.70 vs 84.81) and this is the confirmation at full width.
   **Corrected in iteration 270, and the correction is the more important one:** the last clause is false. The
   engine _does_ rank those services — a full-corpus depth dump finds the answer somewhere in the order in
   **1 422 of 1 422** cases, at a median miss depth of 4 and a maximum of 44 (§10). `87.8%` is the width of the
   PRESENTATION (`At-K` reporting stops at five), not the reach of the ranking: over a twenty-wide window the
   reachable ceiling is `92.12%` (**+16.66 pp**), not `87.83%`.
3. **Both refusals replicate.** The EBR rule loses 0.46 pp on the held-out half (§5 measured 0.6 pp on 711), and the skip rule discards
   **173 of the 174** cases the ceiling can win — it resolves 1 420 of 1 422 cases without a model, and 173 of
   those are cases a claim would have fixed. §4's verdict was not an artifact of the `waveB2` half.
4. **The correction: the 711-case ceiling was 4.4 pp optimistic.** `84.70%` on `waveB2` against `87.69%` on the
   whole corpus, from a control of `68.07%` against `75.50%`. `waveB2` was the harder half for the engine and the
   lower half for the ceiling, so every +pp figure in §3 and §6 computed against 711 overstated the win by that
   margin. The direction of the conclusion is unchanged — there is a large, verifiable ceiling and no deterministic
   rule that reaches it — but the size is `+12.19 pp` and not `+16.63 pp`, and this document now quotes the former.

**Artifacts.** `agentic-measure` (1.8 MB: `fingerprints.ndjson`, `per-case.ndjson`, `results.txt`,
`results.json`, `manifest.json`) and `agentic-headroom` (the study's own output), both attached to the run, so
every number above can be recomputed from them with no corpus:

```text
run-agentic-headroom --fingerprints fingerprints.ndjson --verdicts per-case.ndjson --weight 1
```

## 10. The depth split: the ceiling was the width of the window, and nothing is absent from the order

§9 called `87.69%` the ceiling and explained it as "an eliminator that may only remove candidates cannot reach a
service the engine never ranked". The second half of that sentence is false, and one artifact settled it: the answer
is **always** in the order, below the fifth line. `Top@5` was measuring the width of the presentation, and the 173
cases `docs/absent-census.md` files as "absent" are absent from the reported five, not from the candidate set.

### 10.1 The instrument

`--depth-out` (`benchmarks/src/ranking-depth.ts`) writes one compact row per case: the first-hit depth in the order
the engine actually sorted, the candidate count, and the head of that order with the `finalScore` the sort used. Two
reasons it is a row rather than a wider `Top@K`:

- a depth **separates** two families the averages merge — _ranked too low_ (a scoring defect a re-ranking can
  recover) from _not ranked at all_ (a graph or label defect no re-ranking can reach). The second family is what §9
  assumed the 173 misses were;
- the head carries the **margins**, which is what a tie-break premise is a claim about.

`depth-report.ts` turns rows into the two tables a roadmap is read from — the cumulative ladder and the per-family
split — and `run-depth-report.ts` is the console around it. `benchmark-agentic.yml` writes the rows in `measure` and
prints both tables in the corpus-free job **before** any arm is scored; five assertions in
`agentic-workflow-wiring.test.ts` fail if either wire is cut.

### 10.2 The reading, on all 1 422 cases

Every datapack of the corpus, converted from the raw Parquet and scored by the shipped engine with `--depth-out`.
**The run reproduces the published numbers exactly** — `Top@1 1073`, `Top@3 1227`, `Top@5 1249`, which are the
digits `docs/sota-comparison.md` quotes — so the ladder below is a reading of this corpus in its shipped
configuration and not of a nearby one.

| K      | hits / 1 422 |      share | 95% Wilson | what it bounds                                               |
| ------ | -----------: | ---------: | ---------: | ------------------------------------------------------------ |
| @1     |        1 073 |     75.46% |  73.2–77.6 | the control                                                  |
| @2     |        1 184 |     83.26% |  81.2–85.1 |                                                              |
| @3     |        1 227 |     86.29% |  84.4–88.0 |                                                              |
| @5     |        1 249 |     87.83% |  86.0–89.4 | the ceiling §9 published as saturated                        |
| @8     |        1 263 |     88.82% |  87.1–90.4 |                                                              |
| @10    |        1 278 |     89.87% |  88.2–91.3 |                                                              |
| @15    |        1 294 |     91.00% |  89.4–92.4 |                                                              |
| @20    |    **1 310** | **92.12%** |  90.6–93.4 | what a re-ranker over a twenty-wide presentation could reach |
| > 20   |          112 |      7.88% |            |                                                              |
| absent |        **0** |      0.00% |     ≤ 0.27 | the family §9 assumed the 173 misses belonged to             |

The 349 misses split by depth as `{1–4: 176, 5–9: 29, 10–19: 32, ≥20: 112}`, median 4, maximum 44. Half the misses
are within four lines of the answer the engine did print; the tail past twenty is 112 cases and it is the largest
single block of the remaining headroom.

### 10.3 The pilot that was wrong, and by how much

The first reading was a stratified sample of 106 cases (FNV-1a order within each fault family, floor 1, cap 10 per
family), and it said `absent 0/106` and `@20 97.2%`. The first statement survived — the full corpus says
`0/1 422` — and the second did not: **the sample overestimated `@20` by 5.1 pp**, because it drew 3 of the 112
cases past twenty where the corpus holds 7.9% of them. Both readings are published here, and the sample is kept as
what it is: a pilot whose interval (`[92.0, 99.0]`) contained the truth by 0.1 pp at its lower edge, which is a
reminder that a tail is exactly what a 106-case sample is worst at estimating. The corpus is the number.

### 10.4 What it changes

1. **Nothing is absent from the order.** `0 of 1 422` — the graph carries every answer the corpus labels, and the
   173 cases `absent-census.md` calls absent are _deep_. That document's own §4 had already said so ("the service
   is **not invisible** … it loses because every competitor carries more"); the bucket keeps its count and loses its
   inference, and the axis it implied — candidate-set repair — has no population to act on.
2. **Widening the window buys +4.5 pp of ceiling.** A re-ranker that may reorder the first twenty faces **92.12%**,
   i.e. **+16.66 pp** over the control, against the **+12.37 pp** an eliminator over five can reach. The earlier
   framing's error was not the arithmetic, it was reading a five-wide window as the reach of the ranking.
3. **The whole order is worth 100%, which is why the LP bound was 99.30%.** Every case's answer is somewhere in the
   order, so a per-case ordering — a vector fitted to each case — can reach everything; the 99.30% of
   `PROGRESS_2026-11-12.md` §4 is that statement under a non-negativity constraint, and the ten cases separating it
   from 100% are the ones that need a free sign rather than a different order.
4. **The eliminator's premise lost its support in the columns it is shown.** Measured on the full-corpus artifact,
   over the 176 cases a perfect eliminator can fix, none of the fingerprint's own columns separates the source from
   the wrong leader: the source's onset is earlier in `87/176` (49.4%, exact binomial p = 0.94), its largest
   deviation is larger in `102/176` (58.0%, p = 0.042 uncorrected and not significant after a Bonferroni correction
   over four columns), its minimum fault-free rate is lower in `85/176` (48.3%, p = 0.71), and its outside-band
   channel count is _equal_ in `111/176` (63.1%). Any of them as the primary signal scores 26–34% against the
   engine's 75.9%, and the best gated tie-break measured — four keys × seven margins on the top-1/top-2 pair —
   moves **+0.14 pp held out**, one case in 709, while every wider gate loses. That does not prove a model cannot
   reason across the columns jointly; it proves the columns do not carry the split, so an arm that moves has to be
   reading something outside them.
5. **The next instrument is a term decomposition, not another weight.** `docs/depth-reranking-preregistration.md`
   states the hypothesis and the kill criterion for it before any data: if no term in the engine's own sum favours
   the truth in ≥ 65% of a family's deep cases (n ≥ 20, Bonferroni over 18 terms), the term axis closes and the
   depth headroom belongs to a model arm over a twenty-wide presentation.

### 10.5 Reproduction

The whole reading is one command plus the artifact, with no corpus on the reading side:

```text
run-fse26 --data-dir <corpus> --depth-out depth.ndjson --output results.json
run-depth-report --depth depth.ndjson        # ladder + per-family table
```

The rows carry `datapack`, `faultType`, `accepted`, `depth`, `candidates` and the first twenty `[service, score]`
pairs, so any rung, any family and any margin can be recomputed from the file alone.

### 10.6 Replicated on a runner, and where the deep tail lives

The same reading was produced twice, by different machines through different paths: once locally over the raw
Parquet on one worker (62 minutes), and once by the `benchmark-agentic` dispatch `43276123043` on a GitHub runner,
which fetches the converted corpus through the release artifact, builds the profile from cache-or-build and prints
the table from the artifact in a job with no corpus access. **The two ladders agree digit for digit** — `1073 / 1184
/ 1227 / 1249 / 1263 / 1278 / 1294 / 1310`, `beyond@20 112`, `absent 0` — which is the property that makes the
number a property of the corpus rather than of a machine.

The family split is where the work is. `≥6` is the column that did not exist before this instrument: cases whose
answer the engine ranked below the fifth line, i.e. the population a wider presentation would have to carry.

| faultType                | cases |           @1 | 2–5 |     ≥6 | absent |
| ------------------------ | ----: | -----------: | --: | -----: | -----: |
| HTTPResponseReplaceCode  |   231 |  162 (70.1%) |  14 | **55** |      0 |
| HTTPRequestReplaceMethod |   190 |  125 (65.8%) |  27 | **38** |      0 |
| JVMMemoryStress          |   171 | 171 (100.0%) |   0 |      0 |      0 |
| NetworkPartition         |    97 |   64 (66.0%) |  18 |     15 |      0 |
| ContainerKill            |    89 |  89 (100.0%) |   0 |      0 |      0 |
| HTTPResponseDelay        |    89 |   56 (62.9%) |  26 |      7 |      0 |
| HTTPRequestDelay         |    88 |   57 (64.8%) |  20 |     11 |      0 |
| HTTPRequestAbort         |    60 |   46 (76.7%) |   4 |     10 |      0 |
| HTTPResponseReplaceBody  |    51 |   45 (88.2%) |   6 |      0 |      0 |
| NetworkLoss              |    48 |   29 (60.4%) |  12 |      7 |      0 |
| NetworkCorrupt           |    46 |   31 (67.4%) |   9 |      6 |      0 |
| HTTPResponseAbort        |    44 |   34 (77.3%) |   6 |      4 |      0 |
| JVMException             |    43 |   30 (69.8%) |   9 |      4 |      0 |
| NetworkBandwidth         |    42 |   20 (47.6%) |  16 |      6 |      0 |
| HTTPRequestReplacePath   |    39 |   38 (97.4%) |   1 |      0 |      0 |
| PodFailure               |    24 |  24 (100.0%) |   0 |      0 |      0 |
| NetworkDelay             |    21 |   20 (95.2%) |   1 |      0 |      0 |
| JVMReturn                |    21 |   12 (57.1%) |   2 |      7 |      0 |
| PodKill                  |    10 |  10 (100.0%) |   0 |      0 |      0 |
| (six others, n ≤ 7)      |    20 |           10 |   5 |      3 |      0 |

Two facts a corpus average hides:

- the four resource classes (`JVMMemoryStress`, `ContainerKill`, `PodFailure`, `PodKill`, 294 cases) are **100%** and
  contribute nothing to either miss column — consistent with `docs/absent-census.md` §1's "the four resource classes
  are complete";
- **`HTTPResponseReplaceCode` alone holds 55 of the 112 cases past twenty**, 23.8% of its own family, and widening
  the window moves it the least: `70.1% → 76.2% (@5) → 80.1% (@20) → 100% (whole order)`. `NetworkPartition` is the
  family a wider window helps most (`66.0 → 84.5 → 91.8 → 100`), because its misses are shallow rather than deep.
  The distinction is the instrument's point: a re-ranker's payoff depends on **where** a family's misses sit, and
  the two families that dominate the corpus's miss count need opposite amounts of window.

The artifact behind this table is `agentic-measure` on run `43276123043` (`depth.ndjson`, 1 422 rows), and the
corpus-free table is `agentic-headroom`'s `depth.txt` from the same run. The run predates the column-width fix in
`c38a51c7`, so its printed `@1%` column collides with `@1` at 100.0% — cosmetic, and the numbers are unaffected.
