**Iteration 340 · 2026-11-24 · cost ¥0 (no dispatch, no endpoint) · surface unchanged at 1 328 / 1 422 = 93.39 %**

# What a weight ablation costs, and why the last two were priced at ¥21

## 0. The finding in one paragraph

The next two planned arms — `--self-anomaly-weight 0.5` and `fingerprint_top_k = 22` — were carried in the queue at
**≈ ¥21 each**. Neither costs anything. The figure was not a measurement of those arms: it is `¥0.0147 × 1 422`, the
price of ONE full-cloud arm dispatch, applied to two changes that never touch a cloud call. The engine is **¥0.00 per
case** and always has been; the only reason the queue still carried the number is a single sentence in
`term-marginal-338.md` §6.2 — *"the arm's answers were produced from the shipped engine, so the published 1 328 cannot
be verified without a dispatch"* — and that sentence contradicts the arm's own protocol. This iteration corrects the
sentence, builds the instrument the correction requires, and re-measures the arm locally for ¥0.

## 1. Where the number came from, and the three prices it conflates

| what a "run" can mean | unit price | why |
| --------------------- | ---------: | --- |
| the engine on one case, any weight | **¥0.00** | `docs/sota-comparison.md:92` states it in the cost row: `¥0.00` (the engine) · `¥0.029` (W30) |
| one full arm dispatch, 326-byte brief | **¥0.0147 / case** | the arm reads telemetry through five tools; one 326-byte brief per case, no ranked order shown |
| one full arm dispatch, 30-wide table | **¥41.46 list / ¥10.53 cache** | W30's own bill over 1 422 cases, 14.5 k prompt tokens each |
| a join over artifacts already paid for | **¥0** | `run-miss-ledger.ts`, `run-engine-certainty.ts`, `run-conjunctive.ts`, `run-cutoff-accuracy.ts` all read files |

`¥0.0147 × 1 422 = ¥20.9`. That is the second row, and it is the only row that produces ≈ ¥21. The two queued arms are
firings of the FIRST row: one multiplies a term's slope (`packages/tree/src/pruning/pruner.ts:4269` —
`buildTerm('selfAnomalyLog1p', selfAnomalyWeight, Math.log1p(selfScores.get(id)!), …)`), and the other does not even
reach the ranking.

`fingerprint_top_k` is the sharper case, because it cannot change an answer at all:

> "`fingerprintTopK` … is the only member that changes what an ARTIFACT CONTAINS rather than where it is written: it
> sets the width of the PRESENTATION dump and leaves the published ranking at `analyze(graph, 5)`. … the ranking is
> computed before the field is read, so a run at any width writes the same `per-case` rows and the same terms dump."
> — `benchmarks/src/fse26-run-config.ts:87-95`

A field that is read after the ranking exists has a price of zero by construction. Its arm is not "cheaper than
estimated"; it is not an arm.

## 2. Why the ¥21 sentence was wrong, and what it cost

`term-marginal-338.md` §6.2 withheld the weight change for a reason stated as a property of the artifact: the arm's
answers came from the shipped engine, so a new weight would need new answers. The arm's protocol says otherwise, in
three places:

| source | statement |
| ------ | --------- |
| `benchmarks/src/query-agent.ts` (module doc) | "It does **not** show the engine's ranking. … Seeding is a SEPARATE arm and is off here, so the free arm means free." |
| `docs/closed-axes-register.md:8067` | "It does **not** show the engine's ranking, because seeding an investigation with the strongest prior in the repository makes the arm a reranker of that order" |
| `docs/free-investigation.md:156` | same sentence, same arm |

The artifact agrees: an arm row carries `entry`, `entryChildErrors`, `belowFails` and a transcript of five TOOL calls
(`edges`, `metric`, `logs`, `failed`), and `engineRank`/`engineWinner` are written BESIDE the answer as a comparison —
never read by the loop. A weight change therefore cannot move an arm answer, and the published surface's movement is
entirely the engine-side rules': the first hop and the certainty guard.

**What the sentence cost.** Not ¥21. A queue in which every weight costs an approval is a queue that runs one weight
per iteration instead of nine, and 338's own nine-row table is the proof that the throughput is where the accuracy
came from: `lat` −70, `failedEdge` −46, `selfAnomaly` ×2 −37 are all readings that exist because the nine were cheap.
The sentence converted a free instrument into a paid one and then deferred it.

## 3. The instrument the correction requires, and the defect it exposed

A weight change is only shippable if it moves the PUBLISHED surface, and that surface is a join of four artifacts. Two
of them change with the weight (`per-case`, `terms`), two do not (`answers`, the corpus walk). So the comparison is:

```
run-fse26.ts  --self-anomaly-weight w  --per-case-out … --terms-dump …
run-miss-ledger.ts --answers … --cases <per-case> --edges … --terms … --surface-out <surface>
run-surface-diff.ts --before <base surface> --after <w surface> --answers …      # folds from the answers file
```

Three of those pieces existed. Two did not, and were added this iteration with the tests that make them claims:

1. **`benchmarks/src/surface-diff.ts`** (100 % statements / branches / functions / lines over 27 tests). A net delta is
   not a finding: a repair and a break are two populations, and the module refuses two files whose case sets differ
   rather than scoring their intersection — the denominator defect this programme has already paid for twice. It also
   refuses a duplicated id (the last row would silently win) and a non-boolean `correct` (a truthy string would score a
   miss as a hit), and it assigns the held-out folds itself, because the fold of a case depends on its position in the
   corpus order and two artifacts are only comparable on the same assignment.
2. **`--surface-out` on `run-miss-ledger.ts`**, so the shipped surface can be written by the runner that defines it
   rather than re-derived by a second script that would have to guess which of the three surfaces was shipped.

**And building the comparison found a real defect.** `guardCensusOf` / `formatGuardCensus`
(`benchmarks/src/engine-certainty.ts`, 100 % × 4 over 33 tests) were added because the ledger's certainty guard reads
`top1Score − top2Score`, and an artifact written before those columns existed makes the guard **silent** rather than
failing. Measured on the stored artifact this iteration read first: `guard: not evaluated — 1422 cases carry no
measured pair, so a delta this file shows is the first-hop rule's alone`, against a surface of 1 308. Every earlier
reading of that artifact that quoted 1 308 as "the surface the guard is added to" was quoting a corpus on which the
guard could not fire. The census now prints the population beside the surface, and the two states — *did not fire* and
*was never asked* — are no longer the same number.

## 4. The measurement, at ¥0

### 4.1 The engine's own surface

| arm | flag | Top@1 | delta | source |
| --- | ---- | ----: | ----: | ------ |
| shipped | — | **1 156** (81.3 %) | — | this iteration, local: `Top@1 81.3 % / Top@3 86.4 % / Top@5 87.8 %`, 1 422 cases, 0 load errors, 0 engine errors |
| kinetic term halved | `--self-anomaly-weight 0.5` | **1 159 (81.5 %)** | **+3** | this iteration, local: `Top@1 81.5 % / Top@3 86.5 % / Top@5 87.9 %`, same corpus, same flags otherwise |

`0.8150 × 1 422 = 1 158.9` → **1 159**, which is `term-marginal-338.md` §3's row to the case. Both arms ran with no
API key in the environment, so the semantic layer degraded to TF-IDF and the run carried the `DEGRADED` banner; that
banner is irrelevant to this comparison and the reason is worth stating rather than assuming: **a difference between
two arms with the same degraded topology isolates the weight**, and the absolute number is not what this iteration
quotes.

### 4.2 The published surface, which is the one that ships

Both arms were then joined through `run-miss-ledger.ts` onto the SAME answers (stored, unchanged) and the SAME corpus
walk. The guard census printed `evaluated on 1422 / 1422 cases, margin measured on every one` for both — so this is a
comparison in which the guard could actually fire.

| surface | base | 0.5 | delta | repairs / breaks | fold 0 / fold 1 |
| ------- | ---: | --: | ----: | ---------------: | --------------: |
| arm answers | 1 287 | 1 287 | +0 | 0 / 0 | +0 / +0 |
| + first hop | 1 308 | 1 308 | +0 | 0 / 0 | +0 / +0 |
| **shipped (with the guard)** | **1 328 (93.39 %)** | **1 328 (93.39 %)** | **+0** | **0 / 0** | **+0 / +0** |

`run-surface-diff.ts` prints `delta +0`, `repairs 0, breaks 0`, `no case moved`, and two fold lines at `+0`. The
engine's +3 does not reach the published surface at all — and the reason is nameable, which is what makes this a
measurement rather than a null result.

### 4.3 Where the +3 went: the conversion rate of an engine delta

The two per-case files differ on seven cases (`truthRank` 2/3/8 → 1 on five, 1 → 2 on two), which is the `5 repairs /
2 breaks` of §3. Cross-referencing them against the two published surfaces:

| case | engine | published surface | why the movement did not ship |
| ---- | ------ | ----------------- | ----------------------------- |
| `ts3-…-request-replace-method-mxfc5h` | 2 → 1 | right → right | the arm had already answered it; the surface never reads the engine there |
| `ts4-…-partition-nj8rh5` | 8 → 1 | right → right | same |
| `ts4-…-request-delay-slc8g7` | 3 → 1 | right → right | same |
| `ts4-…-response-replace-body-wpxp9b` | 3 → 1 | right → right | same |
| `ts5-…-request-replace-method-c7p9qz` | 2 → 1 | **wrong → wrong** | the arm is still wrong here and neither rule fires |
| `ts0-ts-ui-dashboard-response-delay-zd6lz6` | 1 → 2 | right → right | the arm had already answered it |
| `ts5-…-request-replace-method-7xn7ks` | 1 → 2 | right → right | same |

Four of the five repairs are **masked**: a case the arm already answers correctly cannot be repaired again, because
the published surface does not consult the engine on it. Both breaks are masked for the same reason. The one
unmasked repair is a case where the engine now leads with the truth and the surface still publishes the arm's wrong
answer — i.e. the case a promotion rule exists for, and the family of promotion rules `miss-ledger.ts` prices at
`−52 / −44 / −152 / −70` over the whole corpus. One case is not a mandate for a rule that loses four times its gains.

**This is the general law, and it is the reason engine-side accuracy is a poor proxy for the published surface**:

> An engine delta converts to a published delta only on cases the arm gets wrong AND no rule already settles. On this
> corpus that is 135 cases out of 1 422 — a 9.5 % aperture — so a weight worth +3 on the engine is worth between 0 and
> 3 on the surface, and the expected conversion is under a third.

Which is why the same `+3` that looked like a reason to spend ¥21 is a **rejection** once measured for ¥0: it buys
nothing that ships, and the cliff argument for robustness (§338's real finding: ×2 costs 37 and repairs none) does not
need a dispatcher either — it is a local run and a join.


## 5. The cost model this iteration adopts

1. **A change that does not reach the arm's input is never a dispatch.** Weight, threshold, width, scope, and every
   presentation field are local. The test is mechanical: does the flag appear in the arm's transcript? None do.
2. **A join is not a measurement.** Once one dispatch exists, every weight the engine can express is a local run plus
   a join. `--diagnose-dump` was built for exactly this and 338 already used it.
3. **A dispatch buys answers, so buy as few as the question needs.** If an arm really must be re-run (a changed
   candidate set), the ceiling arm is 74 cases at ≈ ¥2 and a stratified 50 costs ¥0.74 — not 1 422 at ¥21.
4. **A cache hit is the same answer at 25 % of the price.** W30's own bill is ¥41.46 list against ¥10.53 cache over the
   same 1 422 cases.
5. **Unmeasured is a value.** The census above is the general form: any column a rule reads can be absent, and a rule
   that is silent on a missing column must say so, or a reading becomes a claim about a population it never saw.

## 6. What this does not close

1. **The weight is REFUSED, not deferred.** The reading the ¥21 was going to buy exists: `+0` on the published
   surface, `0 repairs / 0 breaks`, both folds `+0`. `--self-anomaly-weight 0.5` therefore stays out of the shipped
   configuration, and the reason is not its small engine gain — it is that the gain cannot ship (§4.3). What the
   ladder's cliff argument retains is a **robustness** reading, not a candidate: ×2 costs 37 cases on the engine and
   repairs none, which says the shipped 1.0 sits near an edge and is worth watching, not moving.
2. **The score columns are newer than the stored artifact, and the census now says so.** The comparison in §4.2 is
   between two per-case files produced by THIS runner version, which is the rule: the guard must be evaluated on both
   sides or the delta is the first-hop rule's alone. The stored artifact every earlier surface reading used carries
   neither column, so its `1 308` was never "the surface the guard is added to" — it was a surface the guard could not
   see. Any future reader of that file gets the census line instead of a plausible number.
3. **The queue's other item is not a run at all.** `fingerprint_top_k = 22` needs a `--presentation-out` on a run that
   already exists; the widening it prices is a WIDTH of a file, and §337's `unwidenable 20` bound is untouched by it.
4. **The aperture is now a number, and it is the next thing worth attacking.** 135 of 1 422 cases can be moved by any
   engine-side change (the arm is wrong and no rule settles it). That is the entire surface on which the next twenty
   iterations can act, and it re-prices the queue: breadth's 28 addressable cases are 21 % of the aperture, while the
   reasoning residue's 37 are 27 %. Any further engine weight is priced against 9.5 % of the corpus, which is why
   §4.3's conversion factor belongs in every future cost estimate.


## 7. Reproduce

```bash
# The engine at any weight, ¥0, no endpoint (~20–35 min of CPU for 1 422 cases).
npx tsx benchmarks/src/run-fse26.ts \
  --data-dir "$HOME/rcabench/json" --fault-free-profile "$HOME/fault-free-profile.json" \
  --self-anomaly-weight 0.5 \
  --per-case-out /tmp/art340/half/per-case.ndjson \
  --terms-dump /tmp/art340/half/terms.ndjson --output /tmp/art340/half/results.json

# The published surface of one weight, ¥0, seconds.
npx tsx benchmarks/src/run-miss-ledger.ts \
  --answers <answers.ndjson> --cases <per-case.ndjson> \
  --edges <corpus-walk.ndjson> --terms <terms.ndjson> \
  --surface-out /tmp/art340/half/surface.ndjson

# The comparison, with the held-out folds taken from the answers file, ¥0, seconds.
npx tsx benchmarks/src/run-surface-diff.ts \
  --before /tmp/art340/base/surface.ndjson --after /tmp/art340/half/surface.ndjson \
  --answers <answers.ndjson>
```
