# The screen the separator owed, and the direction channel that was dead on the golden half

Iteration 43. The separator census left four surviving cells and stated what they still owe a screen on a
fifth **they were not selected from**. This iteration runs that screen on a second corpus — and finds that
the strongest cell it was supposed to test rests on a channel the golden half has never produced.

---

## 1. What was owed, in the previous iteration's own words

`fse26-separator-verdict.md` §5.4:

> Clear the shared kill criterion … and be screened on a **different** held-out fifth than the cell was
> selected from. The 4 survivors were selected by scanning 250 cells; the fold vector is the weakest
> correction, not the last word.

The four survivors were `HTTPResponseReplaceCode/edgeRecords` (60–2, AUC 0.908, the strongest cell the screen
has ever found), `HTTPResponseReplaceCode/decisiveCv`, `HTTPRequestReplaceMethod/edgeRecords` and
`JVMMemoryStress/decisiveCv` — all selected on **one** dump (the FSE'26 shipped configuration).

---

## 2. The screen, run on a corpus the cells were not selected from

Same instrument, not a re-implementation: the same reader (`parseDiagnosticDump`) and the same census
(`separatorCensus` — the same scalar definitions, the same pairing rule, the same Šidák correction). Only the
corpus differs, which is the point: a second implementation would make a disagreement uninterpretable.
Probe: `.git/probe_outofsample_43.ts`.

**Like for like, or the comparison is refused.** The `-noinject` artifacts are an ablation of the SETUP (the
injection anchor is off, so every onset slope is structurally zero) and `re3-novelty` is a different log
signal mode, so the primary population is the three shipped-configuration artifacts and every other artifact
is printed as its own population rather than as more data for the same table.

**The like-for-like population: 615 cases → 147 pairs.** The census scans **150 non-term cells**, so the
per-test bar is `p < 3.4e-4`.

| cell | source–winner | p | folds | |
| --- | --- | --- | --- | --- |
| `loss` / `decisiveCv` | **36–4** | 1.9e-7 | `0.71/0.86/0.83/1.00/0.90` | stable |
| `disk` / `decisiveBurst` | 18–0 | 7.6e-6 | `0.75/1.00/1.00/1.00/1.00` | stable |
| `disk` / `decisiveTrend` | 18–1 | 7.6e-5 | `0.75/1.00/0.83/1.00/1.00` | stable |
| `loss` / `decisiveBurst` | 24–4 | 1.8e-4 | `0.86/0.73/0.75/0.67/0.70` | stable |

and four cells separate **against** the source, all stable: `loss/bestDev` 2–41 (p=2.2e-10, folds ≈0.00),
`loss/bestRise` 3–40, `disk/bestDev` 0–20, `disk/bestRise` 0–20.

Overall, by signal (AUC over all 147 pairs, with no cell conditioning):

| signal | role | pairs | source–winner–tie | AUC | p |
| --- | --- | --- | --- | --- | --- |
| `decisiveCv` | inventory | 145 | 112–21–12 | **0.814** | 3.3e-16 |
| `decisiveBurst` | inventory | 145 | 95–11–39 | 0.790 | 7.7e-18 |
| `inDegree` | topology | 147 | 84–27–36 | 0.694 | 5.5e-8 |
| `decisiveBaseline` | inventory | 145 | 97–48–0 | 0.669 | 5.8e-5 |
| `errLines` | evidence | 147 | 32–9–106 | 0.578 | 4.3e-4 |
| **`edgeRecords`** | **evidence** | **147** | **0–0–147** | **0.500** | **n/a** |

**Four findings, and the first is the reason this audit exists.**

1. **The signal `decisiveCv` transfers; the CELLS do not.** `decisiveCv` was a survivor on FSE'26
   (`JVMMemoryStress/decisiveCv` 0.689, `HTTPResponseReplaceCode/decisiveCv` 0.884) and it is the best
   non-term signal on this corpus too (0.814, matched-band 0.793). But **not one of the four FSE'26 cells
   reappears**, because the fault types are different populations — so §5.4's requirement, read as "re-screen
   *the cells*", is **unsatisfiable across corpora by construction**, and what transfers is the signal.
2. **Three signals are candidates in ALL SEVEN artifacts**, including the `-noinject` setup ablation and the
   `novelty` log mode: **`decisiveCv`, `decisiveBurst`, `inDegree`**. That is the strongest stability
   evidence this screen has produced, and it says something the fold vector cannot: these signals do not
   depend on the injection anchor or on the log-signal mode.
3. **`edgeRecords` — the STRONGEST FSE'26 cell — is 147 ties out of 147 pairs here.** Not weak: absent. The
   artifact carries `failedEdgeRecords=0` for every service, so the signal has no values to compare.
4. **A stable, strong family runs AGAINST the source**: `bestDev` and `bestRise` (the inventory's own best
   deviation and rise) are owned by the WINNER, 0–20 and 2–41 with folds at 0.00. Recorded because it is the
   inverse of the intuition that a source's signature is the largest excursion — in these populations it is
   the winner's.

---

## 3. The finding: the golden half has never had the channel that carries DIRECTION

Finding 3 above is not a property of the census. It is a property of the artifact, and it has a cause.

**Measured over the whole corpus: 41,426 services carry `failedEdgeRecords`, and `0` of them are non-zero.
41,426 carry `failedEdge`, and `0` are non-zero.** The channel is not quiet; it was never fed.

`FaultFailedEdge` is, in its own type's words, *"the only case input that carries the DIRECTION of a fault:
the log signal credits whoever emits an error (the caller, usually a victim), while this names the service
the error was emitted ABOUT (the callee, the source)"*. And the channel's producer is asymmetric:

| path | derives `FaultFailedEdge[]`? | forwards it to the engine? |
| --- | --- | --- |
| FSE'26 | **yes** — `scripts/fse26_convert.py`'s `read_failed_trace_edges`, from parquet | yes — `run-fse26.ts` via `toFaultGraphOptions` |
| RCAEval (the golden half) | **NO — nothing produced it, anywhere** | yes — `toFaultGraphOptions` has always forwarded the field |

So the runner was never the defect: `toFaultGraphOptions` is the one owner of the case→options mapping and it
names `failedTraceEdges` in its return. **The loader never populated it**, and `rcaeval-loader.ts` does not
mention the field at all.

**And the repository has already recorded this exact failure mode about the other half.** `run-fse26.ts`:

> This call site used to spell the options out inline and had silently dropped `traceActivity` and
> `failedTraceEdges`, so **both signals were dead on the benchmark with the largest case count — reporting
> "no change", which reads as a result.**

The FSE'26 half was repaired. The golden half was never checked, and this iteration is what found it.

**Why it matters beyond tidiness.** Three consequences, all measured or read:

1. **The criterion's second half could not screen the strongest cell at all.** `edgeRecords` is 2 of the 4
   FSE'26 survivors, one of them the strongest cell ever found, and a golden run cannot confirm or refute
   either — not because no knob dispatches them, but because **the evidence does not exist on that half**.
   The register's rule for an undispatchable knob ("say which input it will add") has a twin here: a
   candidate whose *evidence* the artifact does not carry cannot claim a golden half either.
2. **Any golden measurement of the failed-edge weight would have read "no change" for the wrong reason** — a
   signal that received nothing reports the same headline as a signal with no effect, which is the register's
   own first invariant, and the FSE'26 run prints a coverage line for exactly this.
3. **The golden half has never had the only DIRECTION input** while the FSE'26 half has. The two halves of an
   AND criterion were not measuring the same engine.

**The data was there the whole time.** `rcaeval-loader.ts`'s own `tryLoadTraces` comment says the status
column is resolved so that *"the error response code is actually read"* — the loader builds spans carrying
`service`, `parentSpanId` and `status`, which are precisely the four facts the FSE'26 derivation needs
("every outgoing span carries both the calling service and the HTTP response status of the call"). The join
was simply never performed.

---

## 4. The change

**`countFailedTraceEdges(tracesPath, injectTimeMs)`** in `rcaeval-loader.ts`, a sibling of
`countTraceActivityByService`, wired at the two runner sites that already call that sibling
(`run-rcaeval.ts`, `run-ablation.ts`) and exported from the package barrel.

- **One read, and no ordering assumption.** The parent join needs a span that may appear LATER in the file
  than its child, so failing spans are collected during the read and joined after it. Resolving each child
  against the parents already seen would silently under-count on any file that is not parent-first, and a
  quiet under-count is indistinguishable from a quiet fault. Two passes were rejected for a measured reason:
  RCAEval TrainTicket traces exceed a million spans per case, and reading every case twice would cost more
  I/O than the whole golden run.
- **Only failing spans are retained** (three columns each) — a healthy call is not evidence.
- **The FSE'26 rules, restated where the code is**: charge the callee; count the pre-injection failures as
  `baseline` but never let them create a row; attribute nothing when the caller is not in the file; emit in
  `(caller, callee)` order so two builds of one datapack agree byte for byte.
- **The coverage line.** `run-rcaeval.ts` now prints `formatFailedEdgeCoverageLine(summariseFailedEdgeCoverage(…))`
  — the same counter the FSE'26 run prints, and for the stated reason: *"a run whose signal received nothing
  must be indistinguishable from one that received everything only in the numbers, never in the log."*

**And the change cannot move the golden 9-cell, by two independent arguments.** `failedTraceEdges` is read by
exactly one consumer, `computeFailedEdgeScores` — it never touches the call graph's nodes or edges — and the
term is `failedEdgeWeight × score` with `failedEdgeWeight` defaulting to **0.0**. So the ranking is unchanged
while the artifact's direction channel stops rendering a dead zero.

---

## 5. The gates

Specs written **first** and read RED: eight arms of the derivation — the direction rule, the post-injection
rule, the failed/baseline split on one edge, a parent appearing **after** its child, an absent parent, a
missing status column, a missing file, and deterministic order. Then GREEN: `rcaeval-loader.test.ts`
**131 passed**.

Coverage is read from CI rather than from this sandbox, whose ~34 ms per file read makes a local suite run
both slow and fragile; the two `tsc` legs, the register fence, the separator and census fences, `prettier` and
`oxlint` are read locally. The golden is the acceptance: it must be **byte-identical**, and that identity is a
*claim* about the two arguments in §4 rather than a coincidence.

---

## 6. What is not claimed

- **The screen is not a ruling on the FSE'26 cells.** A cell that does not reappear on a different benchmark
  may have been overfit, or its population may simply not exist there. What this iteration establishes is
  narrower and firmer: **the cell identities do not transfer, the signals do**, and for `edgeRecords` the
  question was never asked because the input was missing.
- **`decisiveCv` is not a new candidate.** It is an inventory field the census already screened, and the
  shipped engine already carries a term that reads a cv-like quantity (`stabilityWeight`, enrolled at +1
  case). Nothing here proposes a weight; the register's main table is where that would be argued from.
- **No claim that the derivation's rows are complete for every artifact.** A trace whose caller span is
  absent is dropped rather than guessed, and the count of those is not reported — a reader who needs it needs
  a second counter, which is not in this iteration.
- **The memory characteristic is a design note, not a measurement**: `spanId → service` is held for the whole
  file (O(spans)), and this environment has no traces to measure it on — `rcaeval-data/RE3-TT.zip` is not a
  readable archive and `RE3-TT/` is empty. The claim is that it is one read and bounded by one map; the peak
  is not measured here.
- **The knob is still owed.** Even with the channel live, the golden half has no `--failed-edge-weight` in its
  parser and no `failed_edge_weight` input in its workflow, so the *ablation* of the term is still
  undispatched on that side. That is the input the next candidate must add, and it is named here rather than
  added, because a knob over a channel that was dead until this iteration would have measured nothing.
