# The presentation width — one flag, two dumps, and the arm it prices

`--fingerprint-top-k` widens the elimination fingerprint and changes nothing else. This document records the
instrument, the proof that it changes nothing else, the second dump the proof forced into existence, what it
already costs, and the arm it was built for.

## 1. Why the width needed an instrument at all

`docs/agentic-promotion-gate.md` §10 put the gate into the failure decomposition `Top@1 = Retrieval@K × Rerank@1`
and read three numbers off the FSE'26 corpus:

| quantity | reading |
| --- | ---: |
| `Retrieval@5` | 1 249 / 1 422 = 87.83 % |
| `Rerank@1 ∣ Retrieval@5` | 1 156 / 1 249 = 92.55 % |
| `Retrieval@20` | 1 310 / 1 422 = 92.12 % |

The first two say the presentable ceiling at width 5 is **87.83 %**, 2.17 pp below the published best. The third
says the ceiling at width 20 is **92.12 %**, above it. So "is the width axis real" is not a matter of taste: it is
the difference between a ceiling below the target and a ceiling above it, and it is answerable by one arm.

The arm has one requirement, and it is the only reason this flag exists: **the model has to be shown twenty
candidates.** The recorded nominations were asked at five (`DEFAULT_NOMINATION_OPTIONS.maxCandidates`), and a
prompt cannot be widened after the fact — the table is rendered from the fingerprint, and a five-wide fingerprint
has five rows.

## 2. Two ways to widen, and why only one of them is an arm

| | widen the RUN | widen the ARTIFACT |
| --- | --- | --- |
| what changes | `analyze(graph, 5)` → `analyze(graph, 20)` | a second pass at 20, for the dump only |
| `Top@1` | unchanged (positions 1 and 2 never differ) | unchanged |
| `Top@3`, `Top@5` | **can move** — a structural pass permutes the list it is handed | unchanged |
| `per-case` rows, terms dump, results file | different | **byte-identical** (verified, §3) |
| interpretable against arm G | no: two things moved | yes: one thing moved |

A width arm is differenced against arm G, and arm G's control is `1 156 / 1 422`. If widening the run also moved
`Top@5`, the two arms would differ by the presentation window **and** by the published answer, and no reading of
the delta would say which. So the flag widens the artifact.

## 3. The proof that it changes nothing else, and why a proof was needed

The first implementation did not work, and the way it failed is the reason this section exists.

`--fingerprint-top-k 20` produced a twenty-wide order and the run printed `requested width 20` — while the dump
it wrote held **7 110 candidates over 1 422 cases, exactly five each**. The width had a second owner:
`buildCandidateFingerprints` capped at `DEFAULT_FINGERPRINT_OPTIONS.maxCandidates = 5`, and the cap was applied
after the widest order the runner could hand it. The flag lost, silently, and the log printed the number it had
asked for.

> **This is `closed-axes-register.md` §307's shape one layer down.** There the missing input was a profile file
> the record could not see; here it was a default inside the consumer of the flag. In both cases the run reported a
> configuration it had not measured.

The cap is removed rather than passed through: the builder now carries **the order it is given**, so the width has
exactly one owner — the caller's slice — and `--fingerprint-top-k` is the only way to state it. The builder's own
test counted candidates before this and counts them still; what changed is that it now asserts *every* candidate of
the order is carried, which is the assertion that would have caught the defect.

With one owner, the instrument was verified by running both widths and comparing the artifacts:

| artifact | width 5 | width 20 | |
| --- | --- | --- | --- |
| `per-case.ndjson` | `2778b294de9f…` | `2778b294de9f…` | identical |
| `terms.ndjson` | `4b1dadd057f4…` | `4b1dadd057f4…` | identical |
| `results.json` | `068d1af8d96f…` | `068d1af8d96f…` | identical |
| `Top@1` / `Top@3` / `Top@5` | 1 156 / 1 228 / 1 249 | 1 156 / 1 228 / 1 249 | identical |
| `fingerprints.ndjson` | 7 110 candidates | **28 440 candidates** | 20 per case |

That is the check a reader should demand: not "the flag should not affect the ranking" but "two runs that differ
only in this flag wrote the same three files to the byte".

### 3.1 One file could not carry two contracts, and CI was the thing that noticed

The first version of the flag wrote the widened order into `--fingerprint-out`. The arm was dispatched
(`44284042634`), the measure job succeeded, and the **study job refused to score**:

```
DISAGREEMENTS: 17 (first: ts0-ts-basic-service-request-abort-5dlq8r)
Refusing to score: the two artifacts are not from the same run.
```

The guard was right and the instrument was wrong. `--fingerprint-out` has a contract this document had not written
down: `headroom`, `ceiling` and `elimination` all **join** it against `per-case.ranked` case by case, so its
per-case array order *is* the published order. A widened order is not, on exactly the 17 cases §4 counts. One file,
two contracts, and the join guard is the only reader that could tell.

So there are two dumps, with two contracts:

| flag | what it holds | who reads it |
| --- | --- | --- |
| `--fingerprint-out` | the **published** order, as a fingerprint | `agentic-headroom`, `agentic-ceiling`, `agentic-elimination` — by index against the token dumps |
| `--presentation-out` | the engine at the **requested width**, plus a `published` field holding the order this run published | the presentation arm, which renders a table; the join reads the recorded order |

`--fingerprint-top-k` therefore widens the second one only, and is refused without it. The repair is not a guard
relaxation: widening a dump that three readers join by index would make those readers describe a run nobody
dispatched, and a guard that can be argued away is not a guard.

### 3.2 The presentation states which run it came from, because its own array no longer does

Separating the files is only half the repair. The join still has to answer *"is this dump from the run being
scored?"*, and for a presentation the field it used to answer with — the candidate array — is precisely the field
the widening changes. So the presentation dump records the order the run published beside the order it presents:

```json
{"datapack":"ts0-…","faultType":"stress","injectTimeMs":1700000000000,
 "candidates":[…20 rows…],"census":{…},"published":["ts-basic-service","ts-travel-service",…]}
```

`joinHeadroom` then has two shapes and neither is weaker than the other:

| dump | what is compared | strength |
| --- | --- | --- |
| no `published` field (the published dump) | the candidate array against `per-case.ranked`, prefix-wise | the whole claim the file makes |
| `published` field (a presentation) | the recorded order against `per-case.ranked`, **in full** | the same claim, aimed at the field that holds it |

A presentation whose recorded order disagrees is refused exactly as a stale published dump is, and a *shorter*
recorded order is refused too: two runs at different widths publish different-length orders, and a prefix compare
would accept one entry against five. Measured on the artifact this was built for: `published` equals
`per-case.ranked` on **1 422 of 1 422** cases and position 1 is identical on **1 422 of 1 422**, so the guard is
calibrated rather than hopeful.

One further invariant is enforced where the extra rows are produced, not where they are read: `fingerprintSourceOrder`
refuses a widening that **drops** a published candidate. A permutation is expected (the structural pass reorders
the list it is handed) and a shrinking window is not — a model shown twenty rows must still be able to name
everything the run published, which was true on 1 422 of 1 422 cases and is now checked on every case before a
profile is even read.

Two consequences worth naming:

- **The published dump costs nothing when no presentation dump is asked for.** The second `analyze(faultGraph, k)`
  pass is spent inside `if (presentationDump !== undefined)`, so a default run does exactly the work it did before
  the flag existed.
- **The width still has one owner.** `fingerprintSourceOrder` decides which order a dump carries, and it returns
  the published array **by identity** at the published width — asserted with `toBe`, not `toEqual`, so a future
  refactor that slices instead of returning cannot quietly spend a second pass.

## 4. What the widened population does and does not move

The dump is the engine's answer **at that width**, and a structural pass (`containmentOrder`, the failure flow)
permutes *the list it is handed*. So the widened order is not "the published five plus fifteen": it is a second
permutation of a longer list.

| comparison, width 5 vs width 20 | cases |
| --- | ---: |
| position 1 differs | **0** |
| position 2 differs | **0** |
| first difference at position 4 | 2 |
| first difference at position 5 | 15 |
| **any of the first five differs** | **17** |

Seventeen cases in 1 422 — 1.2 % — and the same 17 that `agentic-promotion-gate.md` §9.3 found between the
five-wide fingerprint and the fifty-wide terms dump, at the same positions. It is a property of the width, not of
either writer.

The 17 cases do not move the reachability, though, and that is checkable rather than assumed: the ladder taken over
the **fingerprint's own order** — the table the model actually reads — agrees with the ladder taken over the
fifty-wide terms dump to the case at every rung:

| K | from the terms dump | from the 20-wide fingerprint |
| ---: | ---: | ---: |
| 1 | 1 156 | 1 156 |
| 5 | 1 249 | 1 249 |
| 10 | 1 278 | 1 278 |
| 20 | 1 310 | **1 310** |

and the set newly reachable between K=5 and K=20 is **the same 61 cases** by identity — not "61" on each side, but
the same 61. So the arm's table has exactly the reachability the ladder prices, and the permutation difference is
confined to where it does not matter.

Two consequences, both stated rather than discovered later:

- **The control is untouched.** `engineOrderOf` reads the array order, whose first element never differs, so a
  gate-off arm over this population reads `1 156 / 1 422` — the same number as arm G's.
- **The prompts are not identical to arm G's.** On those 17 cases the model is shown a table whose rows 4 and 5
  are in a different order. The arm therefore varies the window *and*, on 1.2 % of the corpus, the order of the
  last two rows it can see. That is disclosed here because a reader who assumed the prompts were a strict
  superset would be reading a cleaner experiment than the one that ran.

## 5. What it costs

The preregistration estimated `~4.0 M` prompt tokens from the width-5 measurement of 2 743–2 876 tokens per case.
That estimate assumed the per-case cost was a constant of the corpus. It is not: **it is a function of the table**,
and the table is what the flag changes.

| | width 5 | width 20 |
| --- | ---: | ---: |
| table rows over the corpus | 63 897 | 255 181 |
| ratio | 1.00 | **3.99** |
| measured prompt tokens per case | 2 772 mean (median 2 777) | — |
| projected prompt tokens per case | — | ~11 071 |
| projected total, 1 422 cases | 3.94 M | **15.74 M** |

So the arm costs about **4×** what was registered, and the error is the same one this line of work keeps making:
a quantity measured at one width, applied at another. It is corrected here rather than at the end of the arm,
because the point of pricing an arm before dispatch is to be able to decline it — and at `deepseek-chat` pricing
this one is ~$4.6, which is worth paying for a 4.3 pp ceiling difference, but only while the number is stated
honestly.

## 6. The flag, as a user of this project sees it

```bash
# the shipped width: an artifact of five candidates, the width the run publishes
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> \
  --fault-free-profile <profile> --fingerprint-out fingerprints.ndjson

# a wider artifact, and NOTHING else about the run changes
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> \
  --fault-free-profile <profile> --fingerprint-out fingerprints.ndjson \
  --presentation-out presentation.ndjson --fingerprint-top-k 20
```

| value | meaning |
| --- | --- |
| absent | 5 — the width the run publishes, and the code path that existed before the flag |
| `n` | the first `n` candidates of the engine's total order, or a second pass at `n` when `n` exceeds it |
| `0` | every candidate — the same sentence `--containment-depth` uses for the same word |
| negative / fractional / non-numeric | refused by name, not clamped |

`--fingerprint-top-k` without `--presentation-out` is refused, because a width that widens no file is a flag that
does nothing: an arm dispatched that way would read a five-wide artifact and report the width it asked for. The
companion is the presentation dump and **not** the published one, for the reason §3.1 measured.

## 7. What this instrument does not do

- **It does not widen the ranking.** There is no flag that does, and this document is the reason: a run whose
  published width could be dispatched would print `Top@5` for a five-wide answer and a five-wide answer for a
  twenty-wide one.
- **It does not change the prompt's channel budget.** `maxChannels` stays at eight, so a wider table is a table of
  more rows and not of richer ones. An arm that varied both would be two arms.
- **It does not make width free.** Sixty-one cases in this corpus have their answer at ranks 6–20 and 112 at rank 21
  or deeper; the first group is what a width-20 arm can reach and the second is what no width this side of 50 does.

## 8. What is new here, and what is borrowed

`arXiv:2609.36686` sweeps K — its Table 1 reports **cumulative-budget `Retrieval@K` at K = 5, 10 and 15**, splitting
the pool across magnitude, onset and state-change signals. It also runs a **retrieval-controlled protocol** that
pins `Retrieval@K` to 1 by reserving a slot for the true cause, which is the same construction as the "perfect
reranker" ceiling row in `agentic-promotion-gate.md` §10.

So the pieces are not new, and saying otherwise would be the kind of claim this register exists to refuse. What
this repository has not seen published — in that paper, in the surveys `docs/sota-populations.md` records, or in any
of the artefacts `docs/competitor-artefact-availability.md` tracks — is **`Rerank@1` as a function of `K` on a
microservice corpus**: whether an LLM reranker's *conditional* accuracy survives a wider candidate set, as opposed
to whether the candidate set contains the answer.

That distinction is the whole of arm W. A retriever's `Retrieval@K` is monotone in K by construction — a bigger
pool cannot lose an answer — so sweeping it measures the retriever. `Rerank@1` can move **either way** in K, and
which way it moves decides whether width is a lever or a tax. Arm W measures that direction on 1 422 cases with the
gate held fixed, and `preregistration-305.md`'s W5 states the two outcomes in advance: unchanged (`1 212 ± 20`) is
a lever, and below it is the first measured cost of presentation width in this project.

## 9. The ladder, so a width arm can be priced before it is paid for

`Retrieval@K` is monotone in K by construction — a bigger pool cannot lose an answer — so the curve below is not a
result about any method. It is the **budget** a width arm draws on, and its shape is what makes width worth asking
about at all.

| K | `Retrieval@K` | share | gain over the row above |
| ---: | ---: | ---: | ---: |
| 1 | 1 156 / 1 422 | 81.29 % | — |
| 2 | 1 192 | 83.83 % | +36 |
| 3 | 1 228 | 86.36 % | +36 |
| 5 | 1 249 | 87.83 % | +21 |
| 10 | 1 278 | 89.87 % | +29 |
| 15 | 1 294 | 91.00 % | +16 |
| 20 | 1 310 | 92.12 % | +16 |
| 25 | 1 327 | 93.32 % | +17 |
| 30 | 1 345 | 94.59 % | +18 |
| 40 | 1 400 | 98.45 % | +55 |
| 50 | 1 422 | **100.00 %** | +22 |

Reproduced from one artifact, with no run:

```python
# terms.ndjson: one line per case, `candidates` = the whole scored order, `accepted` = the truth set
hit = sum(1 for r in rows if set(r['accepted']) & {c['id'] for c in r['candidates'][:K]})
```

Four things it says that the three-point summary in §1 could not:

- **The first position is most of the answer.** K=1 is 81.29 % and K=5 is 87.83 %: five candidates buy 6.5 pp, and
  the engine's own leader already holds four fifths of the corpus. An arm that reorders among the top five is
  working on 6.5 pp of reachable mass, which is the number `agentic-promotion-gate.md` §10 puts at +93 cases.
- **The curve is nearly flat between K=5 and K=20** — +61 cases over fifteen more slots, about four per slot — and
  then jumps **+55** between K=30 and K=40. A width arm at 20 is therefore buying the flat part, and the jump is
  where the remaining ones live. That is a statement about what a *width* arm can win, made before dispatching one.
- **Width 30 → 40 is 55 cases, more than width 5 → 20 (61) in a fifth of the slots.** So "wider" is not one axis
  with a slope; it is a curve with a shoulder, and the shoulder is the thing to aim at if width is ever the lever.
- **`Retrieval@50 = 100 %`**, which is the sentence `agentic-promotion-gate.md` §10.2 already requires beside the
  conditional `Rerank@1`: every case's answer is somewhere in the fifty-wide order, so every miss on this corpus is
  a placement miss and none is a coverage miss. Any future gap quoted against a corpus where that is not true is a
  different measurement.

One comparison is deliberately **not** made. `arXiv:2609.36686` reports `Retrieval@15` at 0.98–1.00 for microservice
benchmarks and ours reads 0.910. Its retriever is its own, on RCAEval, with a K=15 pool it built deliberately;
this ladder is this engine's total order on RCABench. The two numbers answer different questions, and putting them
in one row is the error `docs/sota-comparison.md` §0a's contract forbids.

## 10. What the arm returned, and why the axis closes

Arm W ran as `44299700032` on `87fcdf0`: 1 422 cases, `--max-candidates 20 --max-ranked 20 --promotion 0.03`,
`deepseek-chat` asked and `deepseek-flash` served (the endpoint's own reply, as in every arm since
`docs/agentic-eliminator.md`). It completed end to end — the presentation dump paired 1 422 of 1 422 cases, which is
the repair in §3.2 working on the corpus it was built for.

| | arm G (width 5) | **arm W (width 20)** | |
| --- | ---: | ---: | --- |
| control (gate off) | 1 156 | **1 156** | identical, as §4 predicted |
| **Top@1 with the gate** | **1 165** | **1 165** | **the same number** |
| net | +9 | +9 | |
| band / engine wrong inside it | 122 / 98 | **122 / 98** | to the digit |
| overrides | 56 | **32** | **fell** |
| … fix / break / neutral | 15 / 6 / 35 | **11 / 2 / 19** | fewer of each |
| conditional precision | 71.4 % | **84.6 %** | rose |
| prompt tokens | 3.94 M (projected from the width-5 measurement) | **13.95 M** (measured) | 3.54× |

So W1 fails (`1 165 < 1 177`), W4 fails in the direction opposite to its registration (`promoted` fell, `reversed`
reads 14 against a registered floor of 26), W2's *bound* holds at 32 while its *reason* is refuted, and W3 holds to
the digit — as it had to, since it was unfalsifiable (§4 of the register entry).

### 10.1 The width was not inert, and that is the interesting part

`+9 = +9` is not "width did nothing". The 11 fixes decompose by where the truth sat in the **published five**:

| truth inside the published five | fixes |
| --- | ---: |
| yes — ranks 2, 2, 2, 3, 3, 5 | **6** |
| **no — absent from it, presented at ranks 6, 9, 9, 14, 17** | **5** |

**Five cases were answered correctly that a five-wide table could not have produced.** They are the width axis
existing, measured: `ts1-ts-config-service-latency-5kkcrc` (truth at presented rank 9),
`ts2-ts-ui-dashboard-response-replace-code-475jm4` (6), `ts4-ts-assurance-service-return-x28fwz` (14),
`ts4-ts-station-service-return-qrsdpz` (9), `ts5-ts-ui-dashboard-response-replace-code-dww7g8` (17).

And four cases that arm G fixed were **not** fixed here, with four breaks avoided in exchange: `15 / 6` became
`11 / 2`. So the wider window moved the gate's *composition* and left its *net* alone — the model, shown twenty rows,
became measurably more conservative and measurably more accurate when it did override, and those two effects cancel
to the case.

That is a result about the model, not about the artifact: nothing in the dump changed the engine, and the control
reproduced to the digit. It is also the answer to "is the axis empty?" — no, it is **net-neutral at 20 on this
protocol**, which for a falsifier written as "at or below arm G's" is the same verdict as empty.

### 10.2 The falsifier fires, and what it closes

> *If arm W's `Top@1` is at or below arm G's, the width axis closes as a class at 20: no arm that widens
> `maxCandidates` is dispatched under this pre-registration, at any width ≤ 20, on this protocol.*

`1 165 ≤ 1 165`. The axis closes as a class. What stays open is stated in the same paragraph of
`preregistration-305.md`: the falsifier was deliberately written at 20, so a failure there does not forbid asking
about 50 — it forbids *this class of arm*, which is the wider statement and was made on purpose. The ladder in §9
says where such an arm would have to aim (the `30 → 40` shoulder), and the five width-only fixes say a window that
deep is not worthless. Neither of those is a dispatch authorisation.
