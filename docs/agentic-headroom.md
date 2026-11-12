# The ceiling before the bill: what an elimination layer can win on RCABench, measured for nothing

Iteration 267. `docs/agentic-layer-plan.md` specifies a layer and a cost model. This document reports the two
measurements that had to come before either could be spent on: **how much there is to win**, and **whether the
layer's deterministic arms already win it**. Both are computed offline, from one run's artifacts, at $0.

## 0. Headline

| arm                                                 | Top@1 (711 cases) |      Δ | moved | claims | refused |
| --------------------------------------------------- | ----------------: | -----: | ----: | -----: | ------: |
| engine (control, shipped configuration)             |         **68.07%** |      — |     — |      — |       — |
| `oracle` eliminator (ceiling, reads the label)      |         **84.70%** | **+16.63 pp** |   118 |    173 |       0 |
| `evidence` rule (EBR, best held-out thresholds)      |             68.2% |  −0.6 pp |     4 |      4 |       0 |
| `evidence` rule (EBR, most permissive thresholds)    |             46.3% | −21.8 pp |   310 |    310 |       0 |

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

| counter        |      count | share of considered |
| -------------- | ---------: | ------------------: |
| `considered`   |    234 477 |               100 % |
| `offered`      |     28 395 |              12.1 % |
| `unprofiled`   |     89 955 |              38.4 % |
| `capped`       |    110 707 |              47.2 % |
| `unmeasurable` |      5 420 |               2.3 % |
| `shadowed`     |          0 |                 0 % |

Three facts follow, and the third one decides a design question the plan left open:

- **A candidate carries 7.99 channels on average**, i.e. the eight-channel cap binds and is what a model would
  actually read. 47.2 % of the measured channels are dropped by it — but they are dropped from the *tail* of an
  order sorted by departure, so what is dropped is the least decisive evidence a candidate has.
- **38.4 % of channels have no published band.** A channel is published only when it is profiled over at least
  three fault-free windows *and* has a positive scale; the rest cannot support a verifiable claim, so offering
  them would produce refusals that read as the model's fault rather than the corpus's.
- **99.6 % of candidates carry at least one out-of-band channel** (3 542 of 3 555). The `evidence` arm's whole
  premise — "the leader's evidence is ordinary, a rival's is rare" — has to separate on *rates*, because the
  presence of *evidence* is universal.

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
save 138 model calls out of 711. A fixable case is, mechanically, a case where a *symptom* outranks the source
confidently, i.e. exactly a case with a wide margin and many deviating channels. The rule's signal and the layer's
value live on the same cases.

**Consequence for the cost model.** The honest spend is the full corpus with no gate: 1 422 cases × ~$0.0037 ≈
**$5.3**, not $2.7. The 54× gap to the published $284 stands; the extra 2× does not, and the plan is amended rather
than left carrying a saving this measurement refused.

## 5. The evidence rule, refused — and why the axis now closes

`evidenceClaims` states the expected-outlier baseline as an elimination rule: *demote the leader when the least
ordinary thing it can point at leaves its fault-free band in most clean windows, in favour of a rival whose
evidence is rarer*. It reads no label, so it is a candidate method rather than a ceiling. Swept over six floors and
three margins, on a hash split of the corpus:

| rate floor | margin | in-sample Top@1 | moved |
| ---------: | -----: | --------------: | ----: |
|       0.00 |   0.00 |          49.3 % |   147 |
|       0.33 |   0.00 |          49.6 % |   134 |
|       0.67 |   0.00 |          55.1 % |    89 |
|       0.80 |   0.00 |          61.5 % |    47 |
|       0.00 |   0.10 |          63.0 % |    51 |
|       0.80 |   0.10 |          65.6 % |    19 |
| **0.00**   |**0.25**|      **67.1 %** | **8** |
| **0.80**   |**0.25**|      **67.1 %** | **5** |

The in-sample engine reading on the same half is **67.35 %**; the best point re-read on the held-out half is
**68.2 %** against the engine's **68.75 %** there. So the arm's entire effect, once the margin is wide enough to
stop it damaging cases, is **four moves and −0.6 pp** — indistinguishable from the identity, on the wrong side of
it.

This is the third presentation of the same quantity:

| presentation                                 | where                                    | result                    |
| -------------------------------------------- | ---------------------------------------- | ------------------------- |
| additive term `w·(1 − r)`                    | iteration 265, `--fault-free-weight`     | +1 case at slope 130, CI crosses zero |
| fingerprint column (evidence the model sees) | iteration 266/267, `docs/agentic-layer-plan.md` §3 | kept: it is what makes the ceiling checkable |
| elimination rule over the posterior          | this document, §5                        | **−0.6 pp held out; refused** |

The middle row is why the axis stays open in a *different* role: as a column, the rate tells a model which channels
are evidence and which are noise, and §3 shows a verifiable claim built on that column can reach the truth in 118
cases. As a **decider**, it cannot: on a corpus where 0.8 % of channels are clean by this measure, "this channel
swings anyway" does not distinguish two candidates.

**Register entry.** The rule is closed. What remains open is the layer *using* the column, which requires a model
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

| artifact                    | command                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| profile                     | `build-fault-free-profile --data-dir <corpus> --out profile.json`         |
| fingerprints + verdicts      | `run-fse26 --fault-free-profile profile.json --fingerprint-out fp.ndjson --per-case-out percase.ndjson` |
| ceiling, gate, rule, sweep   | `run-agentic-headroom --fingerprints fp.ndjson --verdicts percase.ndjson`  |

The analyzer refuses to score artifacts from different runs: it compares the dumped order with the published order
case for case and stops if they disagree, because a dump left over from an earlier commit produces a number for a
configuration neither run had.

## 8. Where the next reading runs, and why it is not on a workstation

§1 labels every number above "over 711" because the other 711 datapacks were never converted **in this
environment**. That sentence hides a decision, and iteration 269 made it explicit: the converted corpus is not
something a machine should build. It is something a **release** holds.

| resource | where it lives | size | measured cost to reproduce locally | cost in CI |
| --- | --- | --- | --- | --- |
| converted `case.json` corpus (1 422 cases) | release assets, `AgentiX-E/rcabench-data` | 2.48 GB compressed | ~19 GB of disk, one conversion run | **114 s** (`43055506630`, 16:09:45 → 16:11:39) |
| fault-free profile | derived | 437 KB | **6 m 46 s** for 711 cases | cached, key derived from corpus × builder |
| fingerprints + verdicts | run artifact | 4.8 MB / 711 cases | the run itself | one job |

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
that *is* reused — `RCAEvalJSON-*`, 3.95 GB, ~30 minutes to rebuild — competes with entries whose next reader does
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

| arm                                              | Top@1 (1 422 cases) |            Δ | moved | claims | refused |
| ------------------------------------------------ | ------------------: | -----------: | ----: | -----: | ------: |
| engine (control, shipped configuration)          |          **75.50%** |            — |     — |      — |       — |
| `oracle` eliminator (ceiling)                    |          **87.69%** | **+12.19 pp** |   174 |    269 |       0 |
| `evidence` rule at the CLI's default thresholds  |              44.20% |      −31.30 pp |   695 |    695 |       0 |

The rule's *best* point is a separate measurement and a separate population, because it is chosen in sample: the
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
   engine *does* rank those services — a stratified 106-case sample finds the answer somewhere in the order in
   **106 of 106** cases, at a median miss depth of 4 and a maximum of 42 (§10). `87.8%` is the width of the
   PRESENTATION (`At-K` reporting stops at five), not the reach of the ranking, and the reachable ceiling over a
   twenty-wide window is `97.2%`, not `87.8%`.
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

## 10. The depth split: the ceiling is a PRESENTATION, not the order

§9 called `87.69%` the ceiling and explained it as "an eliminator that may only remove candidates cannot reach a
service the engine never ranked". The second half of that sentence is wrong, and one artifact settled it: the
answer is almost always **in the order**, below the fifth line, and `Top@5` was measuring the width of the
presentation rather than the reach of the ranking.

### 10.1 The instrument

`--depth-out` (benchmarks/src/ranking-depth.ts) writes one compact row per case: the first-hit depth in the order
the engine actually sorted, the candidate count, and the head of that order with the `finalScore` the sort used.
Two reasons it is a row and not a wider `Top@K`:

- a depth **separates** two families the averages merge — *ranked too low* (a scoring defect a re-ranking can
  recover) from *not ranked at all* (a graph or label defect no re-ranking can touch). The second family is what
  §9 assumed the 173 misses were;
- the head carries the **margins**, which is what a tie-break premise is a claim about. A rule that only fires
  when two candidates are within a few percent has to be checked against the margins that actually occur.

`benchmarks/src/run-depth-report.ts` reads the artifact in the corpus-free job and prints the cumulative ladder
plus a per-family table. Both are wired into `benchmark-agentic.yml` (`measure` writes it, `study` prints it
before any arm is scored), and four assertions in `agentic-workflow-wiring.test.ts` fail if either wire is cut.

### 10.2 The reading: 106 cases, stratified, run end to end

One worker, no CI: 106 of the 1 422 datapacks, selected by FNV-1a hash order within each fault family with a floor
of 1 and a cap of 10 per family (106 cases, 25 families), converted from the raw Parquet with
`scripts/fse26_convert.py` and scored by the shipped engine. **The sample reproduces the corpus's own `Top@1` to
within 0.04 pp** (`80/106 = 75.47%` against `1073/1422 = 75.46%`), and it agrees with the corpus-wide per-case
artifact on all 106 cases, so it is a sample of this corpus and not of a nearby one.

| K      | hits / 106 | share | 95% Wilson | what it bounds                                             |
| ------ | ---------: | ----: | ---------: | ---------------------------------------------------------- |
| @1     |         80 | 75.5% |   66.5–82.7 | the control                                                |
| @2     |         85 | 80.2% |            |                                                            |
| @3     |         93 | 87.7% |            |                                                            |
| @5     |         94 | 88.7% |   81.2–93.4 | the ceiling §9 published as saturated                      |
| @8     |         96 | 90.6% |            |                                                            |
| @10    |         96 | 90.6% |   83.5–94.8 |                                                            |
| @15    |         99 | 93.4% |            |                                                            |
| @20    |        103 | 97.2% |   92.0–99.0 | what a re-ranker over a 20-wide presentation could reach    |
| > 20   |          3 |  2.8% |            |                                                            |
| absent |          0 |  0.0% | upper 3.50 | what §9 assumed the 173 misses were                        |

The miss population is 26 cases and its depth histogram is `{1:5, 2:8, 4:1, 6:1, 7:1, 10:1, 11:2, 15:1, 18:3,
22:1, 28:1, 42:1}` — median 4, maximum 42. Half the misses are within three lines of the answer the engine did
print; the tail is thin and long.

### 10.3 What it changes

1. **The `absent` family is empty in this sample.** `0/106`, 95% upper bound 3.50 %, i.e. at most ~50 of the 1 422
   cases could be absent even at the upper bound. The graph does carry the answers; the losses are ordering.
2. **The reachable ceiling nearly doubles.** A re-ranker allowed to see twenty candidates faces `97.2%`, not
   `87.8%` — **+21.7 pp over the control against the +12.19 pp** the elimination framing priced, because that
   framing inherited a five-wide window from `At-K` reporting rather than from the order.
3. **The eliminator's premise lost its support in the columns it is shown.** Measured on the full-corpus artifact,
   over the 176 cases a perfect eliminator can fix, none of the fingerprint's own columns separates the source from
   the wrong leader: the source's onset is earlier in `87/176` (49.4 %, exact binomial p = 0.94), its largest
   deviation is larger in `102/176` (58.0 %, p = 0.042 uncorrected and not significant after a Bonferroni
   correction over four columns), its minimum fault-free rate is lower in `85/176` (48.3 %, p = 0.71), and its
   outside-band channel count is *equal* in `111/176` (63.1 %). A rule built on any of them as the primary signal
   scores 26–34 % against the engine's 75.9 %, and the best gated tie-break measured (four keys × seven margins on
   the top-1/top-2 pair) moves **+0.14 pp held out** — one case in 709 — while every wider gate loses. That does
   not prove a model cannot reason across the columns jointly; it proves the columns do not carry the split, so an
   arm that moves has to be reading something outside them.
4. **The next instrument is a term decomposition, not another weight.** The misses at depth 6–42 are not close
   calls the fingerprint can arbitrate; they are cases where the engine's own sum put a symptom ten lines above the
   source. Which term paid for that is a question the existing `--terms-dump` can answer for a sample, and it is
   the question §11 opens with.

### 10.4 The full-corpus ladder, and why it is still owed

The 106-case sample is a rate with a ±7 pp interval, not the number. The corpus-wide ladder comes from one
`benchmark-agentic` dispatch, which now writes `depth.ndjson` beside the dumps and prints the table in the
corpus-free job; §11 records that reading when it lands. Until then every figure above is stated with its
denominator and its interval, and the plan below is conditioned on the full-width ladder agreeing with the sample
in sign.
