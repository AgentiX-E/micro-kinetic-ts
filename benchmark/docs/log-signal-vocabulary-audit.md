# The log signal's vocabulary had two owners, and the sentence that hid it

Iteration 42. This iteration set out to run the free pre-screen that `fse26-separator-verdict.md` names as
"the next iteration", and found on the way that **the axis it was aimed at had already been measured and
closed** — by a document the register indexes, in a number the register's own row for that axis carries. What
it delivers instead is a real defect fixed, a stale claim corrected, and an independent corroboration of the
closed measurement from a second corpus and a second instrument.

---

## 1. The defect: one union, two vocabularies, and four modes that were thrown away

`benchmarks/src/rcaeval-cli.ts` opened with the two runners' vocabularies side by side:

```
run-fse26.ts    --log-mode <count|novelty|logicHttp|logicHttpJoint|logicHttpDominant|all>
run-rcaeval.ts  --log-signal-mode <count|novelty>
```

and `fse26-cli.ts` opened with the argument that makes that second line a defect:

> A list of names cannot be checked against a union. `LOG_MODE_ACCEPTED` is a `Record<LogSignalMode, true>`
> instead, so **adding a member to the union fails to compile until it is added here**, and the fallback is
> reserved for values that are genuinely not modes.

The union has **six** members (`packages/tree/src/pruning/ranking-signals.ts`), the engine implements all six,
the RCAEval loader classifies every line they need (`isLogicException`, `isHttpException`, `isStackTrace`,
`deepestExceptionClass` — read, not assumed, in `rcaeval-loader.ts`), and the FSE'26 parser accepted all six.
The RCAEval parser accepted two and wrote:

```ts
opts.logSignalMode = mode === 'novelty' ? 'novelty' : 'count';
```

So `--log-signal-mode all`, `logicHttp`, `logicHttpJoint` and `logicHttpDominant` were each replaced by
`count` — **the same defect `fse26-cli.ts` records having closed on its own side** (a dispatch asking for
`count` ran `logicHttp` and printed a confident 47.3%), left open one module away — and `run-rcaeval.ts`
wrote the same two-member subset a **third** time, in its own DI signature. **Measured as a failing spec
before the fix**: `parseRCAEvalArgs(['--log-signal-mode', 'logicHttp']).logSignalMode` read `'count'`.

---

## 2. The finding: a sentence that sent this session after a closed axis

`fse26-separator-verdict.md` closes with this paragraph, quoted here as it stands:

> The engine already has a mode that admits every ERROR/FATAL — `all`, **named in the register's log-signal
> row as built and never measured** — and the dump already carries the two counts it needs (`err`, `fatal`).
> So this cell is a precondition the register asked for, met, and **the mode's free pre-screen is the next
> iteration, not this one**.

**Both halves of that sentence are false, and the register is where the truth already was.** The register's
row for this axis carries the measurement, and it names the document that holds it:

> **and for `all` as well: measured at the shipped configuration it reaches 569 with 17 regressed fault
> types**, the worst row on the table (its costs concentrate on the HTTP types it was written for:
> `HTTPRequestDelay` −48, `HTTPResponseDelay` −44, `ReplaceCode` −27), and **the gate-side precondition the
> separator census supplied … does NOT survive the case-level normalisation.**

The source is `fse26-term-oracle-verdict.md`, at the shipped configuration:

| configuration | correct | +/− cases | regressed types |
| --- | --- | --- | --- |
| `recorded` (shipped) | 756 | +0/−0 | 0 |
| `logicHttp` (the dump's own mode) | 730 | +0/−0 | 0 |
| `dominant@0.2` | 731 | +1/−0 | 0 |
| **`all`** | **569** | **+95/−282** | **17** |
| `count` | 531 | +130/−355 | 8 |

So the axis was closed by a case-level measurement, and the separator document — itself indexed by the
register — was still describing it as unmeasured and naming its pre-screen as the next iteration.

**This is the register's founding failure mode, committed in a document the register holds.** The register
was written because *"four times now an axis has been re-derived and proposed again"*, and its own one-line
summary of the failure is **a summary outlives its own correction**. This session is the fifth time: it read
the indexed document, took the sentence at face value, and began deriving a candidate for a mode whose
refutation was one row away — in the same register, three columns over. **The register is the authority; a
document it indexes is not.** The repair is below, and it is a correction with the refuted text quoted rather
than a silent edit.

---

## 3. The change

**One owner for the vocabulary.** `LOG_SIGNAL_MODES: Record<LogSignalMode, true>` and `isLogSignalMode`
moved beside the union they guard (`packages/tree/src/pruning/ranking-signals.ts`) and are exported from the
package entry. `fse26-cli.ts` drops its local table and re-exports the guard. `rcaeval-cli.ts` widens
`logSignalMode: LogSignalMode` and parses with the shared guard against
`DEFAULT_RCAEVAL_LOG_SIGNAL_MODE = 'count'`. `run-rcaeval.ts`'s duplicate subset becomes the union.

**The knob the criterion measures with.** `benchmark-rcaeval.yml` gains a `log_signal_mode` input, passed as
`--log-signal-mode` at **all seven** `RANKING_ARG` construction sites, each beside the `log_weight` block it
belongs with — a weight is a claim about which lines count, so the two travel together or neither is a
configuration. The default stays unpassed so the runner remains the single source of truth for the shipped
value. This is what makes the four other modes **decidable** rather than merely implementable, and it is owed
independently of whether any of them is any good: a dispatch that names a mode the runner discards is worse
than no dispatch at all.

**And the join the intersection was missing.** The census keys its rows by `opts.<name>`, the name a runner
*assigns*. The two runners spell one engine axis twice — `fse26-cli.ts` assigns `opts.logMode` for
`--log-mode`, `rcaeval-cli.ts` now assigns `opts.logSignalMode` for `--log-signal-mode`, and both become the
engine's single `logSignalMode` (`fse26-engine-options.ts`: `logSignalMode: opts.logMode`). Because
"dispatchable on both" was computed over **rows**, an axis spelled twice could never appear in it: adding the
golden input would have left the intersection at five while the axis had become decidable. The census now
records `AXIS_OF_OPTION` — an exact map asserted to name two rows that exist — and asks the question of axes.
**A join with no owner, one level up from the flag↔option join the census was written to close.** The alias
is not invented here; `fse26-engine-options.test.ts` already records `{ logMode: 'logSignalMode' }`.

**And the chain is read end to end, because a reachable-but-inert knob is the same defect from the other
side.** A flag a workflow passes, a parser that accepts it and a value that stops one step short is a
dispatch that reports a configuration it did not run — the failure `cli-argument-rejection-audit.md` records
in the *absence* direction. Read, in order:

| step | site | evidence |
| --- | --- | --- |
| input | `benchmark-rcaeval.yml` | `log_signal_mode` → `--log-signal-mode` (the census' own transform, asserted) |
| flag | `rcaeval-cli.ts` | `hasValue` + the shared guard; a missing value is REFUSED, not defaulted |
| option | `rcaeval-cli.ts` → `run-rcaeval.ts` | `opts.logSignalMode` is a field of the object `createContainer` receives |
| pruner | `run-rcaeval.ts` | the first `TreePruner` argument IS that object, and the file says so: *"every field on it … reaches the pruner without a second restatement here"* |
| engine | `pruner.ts` | `computeLogScores(options?.logs, …, this.options.logSignalMode, …)` |

The two value-level failures this rules out are both real in this repository's history: a mode replaced by
`count` in the parser (this iteration), and a weight that a runner pinned while a dispatch believed it had
set it. **The change adds a mode the engine already implements; it does not add a second implementation.**

---

## 4. The fences that had to be told, in three languages

| structure | where | what it forced |
| --- | --- | --- |
| `isLogSignalMode` | `fse26-cli.ts` | re-exported from the union's module; the local table deleted |
| `opts.logSignalMode` | `rcaeval-cli.ts` | `'count' \| 'novelty'` → the union |
| the DI signature | `run-rcaeval.ts` | the third hand-written copy of the same subset |
| `readAcceptedModes` | `fse26-reported-config.test.ts` | the anchor moved from `const LOG_MODE_ACCEPTED` (runner) to `const LOG_SIGNAL_MODES` (union) — recorded and **not loosened**: `expect(accepted.length).toBeGreaterThan(0)` is what makes an anchor that found nothing FAIL rather than pass vacuously |
| `KNOBS.logSignalMode` | `dispatch-surface-census.test.ts` | `rcaeval: null` → `'log_signal_mode'` |
| `DISPATCHABLE_ON_BOTH` | same | five → **six** |
| `UNDISPATCHABLE_ON_RCAEVAL` | same | `--log-signal-mode` leaves; 16 of 17 unreachable → 11 |
| `AXIS_OF_OPTION` | same | new — the row↔axis join |
| the census' workflow direction | same | reads the workflow's inputs and requires the table to agree; it refused the table that claimed a dispatch the workflow did not yet have |

**And the build is part of the fence.** `pnpm typecheck` runs after `pnpm build` in `ci.yml`, because the
package tests import the **built** declarations: a new export in `packages/tree/src/index.ts` is invisible to
`tsc` until `tsup` has run, and the failure reads `has no exported member named 'isLogSignalMode'` in a test
file rather than in the source that has it. Recorded because the local run reproduces it exactly.

---

## 5. The free pre-screen — run, and what it is now worth

The pair is taken as `fse26-separator.ts` takes it (source = the case's highest-self-anomaly ground-truth
service, id ascending; winner = rank 1; hits excluded), over the 7 local diagnose dumps: **1,320 cases, 198
pairs**. Counts are compared *within* a case while the engine max-normalises per case, so a monotone per-case
rescale cannot change the order.

| population | n | `errLines` (what `all` scores) | `sigLines` (what the gate scores) |
| --- | --- | --- | --- |
| **ALL** | 198 | 47–21, AUC **0.589** | 0–17, AUC 0.457 |
| RE1 | 51 | 0–0, 0.500 | 0–0, 0.500 |
| RE2 | 18 | 3–1, 0.583 | 0–0, 0.500 |
| RE3 | 20 | 13–7, 0.662 | 0–5, 0.375 |
| RE3 `novelty` | 20 | 14–6, 0.667 | 0–6, 0.350 |
| `delay` / `disk` / `loss` | 34 / 26 / 48 | 0–0, 0.500 | 0–0, 0.500 |
| **RE3 `f3`** | 27 | **24–3, AUC 0.914** | **0–0, AUC 0.500** |
| **RE3 `f4`** | 19 | 6–13, AUC **0.307** | 0–12, AUC 0.184 |

Walk-forward folds (five, assigned by a hash of the case id, so the assignment is not a choice made here):
`f3`/`errLines` **`1.00 / 0.70 / – / 1.00 / 1.00`** against `f3`/`sigLines` **`0.50 × 4`**; `f4`/`errLines`
`0.40 / 0.50 / 0.00 / – / 0.00`; the three silent types `0.50 × 5` both ways.

**What this is, now that the axis is known to be closed: a corroboration and a mechanism.**

1. **Globally `all` does not separate: AUC 0.589, below the 0.60 bar.** That is an independent second reading
   of the same conclusion as `all` = **569, +95/−282, 17 regressed types** — different benchmark, different
   instrument (a paired census rather than a full run), same verdict. **It also explains the 17 regressions**,
   which the run could only count: the mode is a **per-population** signal, so a *global* `all` must regress
   exactly the cells where the flood belongs to the victim.
2. **The cells are the mechanism.** In one cell the mode separates **24–3, AUC 0.914**, stably, **precisely
   where the engine's gate is blind in every fold (0–0)** — the shape `fse26-separator-verdict.md` measured on
   FSE'26 (`errLines` 30–3 / 0.781 against `sigLines` 0–29 / 0.198). In another it **reverses** (6–13, 0.307),
   and there the gate is against the source too (0.184). So the register's own reading — *"the gate-side
   precondition … does NOT survive the case-level normalisation"* — is exactly what a per-case census shows,
   from the other end: the precondition holds in a population and inverts in another.
3. **The `discarded` lines are the whole of `all`'s contribution**, and they are 24–3 in the cell that
   separates because `sigLines` is 0 there. There is no version of "admit more lines" that helps one cell
   without carrying the other cell's flood with it — unless a discriminator says which cell a case is in, and
   this census does not supply one.
4. **The population is named by its datapack code, not by a fault class.** The corpus carries six named types
   (`delay`, `disk`, `loss`, `cpu`, `mem`, `socket`) and five numbered ones (`f1`–`f5`), and the repository
   says of the numbered ones, in `run-rcaeval.ts`'s own parser comment: *"and RE3 generic labels: f1, f2, f3,
   f4, f5"* — **`f3` and `f4` are generic labels with no semantic class recorded anywhere in this
   repository**, so naming them after an FSE'26 fault type would be a claim this iteration did not measure.

---

## 6. Disposition

- **The vocabulary defect is FIXED**, and it was a bug rather than a tidiness issue: four of six modes were
  silently replaced, so any RCAEval run asked for `logicHttp`, `logicHttpJoint`, `logicHttpDominant` or `all`
  ran `count` and published `count`'s number.
- **The golden half can now express all six modes**, and the census asserts — in the direction that finds a
  table claiming more than the workflow does — that the flag the workflow passes is one its runner accepts.
- **`all` remains CLOSED**, now with two measurements instead of one, and the new one explains the old one's
  regressions rather than merely repeating its verdict.
- **The stale sentence is corrected where it is**, with the refuted text quoted, because a document that
  sends the next session after a closed axis is the defect the register exists to prevent and the fix is not
  to edit the sentence quietly.
- **What is genuinely open** is not a mode: it is a **discriminator**, and it is open for the same reason
  every other candidate in the register is — the obstacle is conflict between cases, not absence of evidence.
  This iteration adds one datum to that: the conflict now has a cell vector on a second corpus.

---

## 7. What is not claimed

- **The pre-screen is not an ablation.** It reads an artifact; it does not run the engine with `all`. It
  corroborates a measured rejection, and it does not replace one.
- **No claim that the two runners now share a FLAG.** They deliberately do not: RCAEval throws on
  `--log-mode`, and FSE'26 does not accept `--log-signal-mode`. They share the **vocabulary and the engine
  option**, which is the part that drifted.
- **The 0.914 is a small-n reading** — 27 pairs, twelve decisive. It is recorded with its fold vector rather
  than as a rate.
- **The golden 9-cell is expected byte-identical and this change cannot move it**, because the shipped value
  is `count` and `count` is still what the default path produces. Checked on the run that lands this, not
  asserted here.
- **`f3` and `f4` are datapack codes.** No semantic name is claimed for them anywhere in this document.
