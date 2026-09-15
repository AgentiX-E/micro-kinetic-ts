# The shipped configuration's attribution — and the instrument that misread it

**Verdict (two parts).** (1) The attribution the register recorded as unmeasurable is
measurable, for free: a full 1422-case dump taken at the shipped configuration *minus*
the pool penalty reconstructs the shipped headline exactly. (2) Measuring it exposed a
defect in the instrument itself — one page printed **three mutually exclusive numbers
for one run**, and 14 of its cases were filed under a category the register defines as
an engine bug when they were a footprint of the instrument's own flags. Both are fixed.
(3) The same audit found that the one axis the register's closing paragraph points at
— "a signal that does not exist in the dump yet" — has been measured before, on another
benchmark, at a configuration that no longer exists, and is recorded nowhere but a code
comment. That is a register gap, not a candidate.

## 1. The data was never missing

`artifacts/r34928980425/fse26-results.txt` is a full 1422-case dump whose banner reads
`logWeight=1 logMode=logicHttp rankNormalization=true latWeight=0.561495 latMinRise=10.3`
— the shipped configuration with the pool penalty off. Since `fse26-fourth-term-verdict.md`
the reconstruction carries the fourth term, so `--pool-penalty 0.0679` turns that dump
into the shipped configuration without a run:

| flags | fidelity vs the dump it reads | acceptable root |
| --- | --- | --- |
| `--pool-penalty 0` | rank-1 same as the dump's own recorded: **1422/1422** | **750** (= the recorded run) |
| `--pool-penalty 0.0679` | rank-1 same as recorded: 1319/1422; moved by the pool penalty 103 | **756** (= the shipped headline) |

The second row is the shipped number reproduced from **another run's data**, which is
the licence every figure below rests on. The register's "the routing map at the shipped
configuration is still unmeasured" is now false; §4 is that map.

## 2. The defect: three numbers for one run

Read at `--pool-penalty 0.0679`, one page printed:

| producer | what it read | number |
| --- | --- | --- |
| term-oracle census (`shipped …`) | `kase.prediction` — the dump's recorded array | **750** |
| log-term mode pre-screen (`baseline recorded`) | the modelled score's own rank-1 | **756** |
| miss attribution (`wrong cases`) | `kase.prediction` | **672** (⇒ 666 at the modelled weights) |

All three are "the shipped configuration's Top@1". Two of them cannot be right, and a
reader could not tell which population the attribution below was about. The census line
is the sharper failure: inside **one loop**, the menu-coverage tally ranked the modelled
score while the `shippedCorrect` counter read the recorded array — two renderings of one
configuration inside one function.

The consequence is the 14. On a pool-off dump with the pool term modelled, the
attribution reported `unexplained 14`. The register's second invariant is that a healthy
engine has **zero** `unexplained`, because the category means "the engine ordered a
service below one with a strictly higher score on every term this report modelled".
Fourteen cases reading as engine defects would have sent a reader to the engine; all
fourteen are cases where the modelled weights put the source ahead of the recorded
winner, i.e. the flag difference, not the engine.

## 3. The fix

- **`shippedRank1`** (`fse26-term-oracle.ts`) is now the single owner of "who the
  modelled score puts first", including the engine's tiebreak. Three callers each taking
  their own `argmax` is how the page disagreed with itself.
- **`oracleCensus.shippedCorrect`** ranks the modelled order. It is byte-identical at
  the dump's own configuration (measured: the pool-0 report diffs to two added lines and
  nothing else), so nothing a faithful reconstruction reports can move because of this.
- **`reconcileConfigurations`** (`fse26-diagnose-analyze.ts`) cross-tabulates the two
  configurations and the report prints both counts, each labelled, with `rank-1 moved`
  measuring — never assuming — whether they differ.
- The `unexplained` note fires only when the rank-1 actually moved, and says the
  category is a footprint then and a defect claim otherwise.

## 4. The shipped configuration, measured

```
wrong cases: 672 (the dump's recorded rank-1)
configuration vs the dump's recorded rank-1 (1422 cases):
  both-correct 750   both-wrong 666   fixed 6   broken 0   net +6
correct: recorded 750 / modelled 756; rank-1 moved 103
```

- **The pool penalty's case-level split is 6 fixed / 0 broken.** Its published figure was
  a net (+6) and a per-fault-type split; the cost it paid was never printed, because a
  case the modelled weights *break* is not a recorded miss and therefore never reaches
  the attribution. It is zero, and that is now a measurement rather than an inference
  from "zero regressed fault types", which is a statement about types, not cases.
- **`unexplained 14` against `fixed 6`**: eight cases change winner without becoming
  correct. The two numbers are different footprints of the same 103-case difference, so
  the report prints both and no longer lets the first stand in for the second.
- `broken` is the cell to watch for any future candidate: it is the one a headline hides
  and the one the kill criterion's second half is about.

## 5. The axis the register was about to re-open

The register's closing paragraph says what is left is "a signal that does not exist in
the dump yet". The engine computes exactly one such signal: `postInjectOnsetDelays` —
the delay from `injectTimeMs` to the first sample of a service's dominant metric leaving
its pre-injection baseline — rendered into the score as `temporalWeight × 2 × (earliness − 0.5)`.
It is real, per case, and it is the engine's own theory (collision at `t₀`, propagation
`τ`). It is also **already measured, and off**:

| axis | where it is recorded | the number | lineage |
| --- | --- | --- | --- |
| `temporalWeight` (injection-anchored earliness) | a code comment in `ranking-weights.ts`; no verdict document, no register row | **−2.5pp on RCAEval** (drop committed in `46913ea`, 2026-09-04) | predates `rankNormalization` (`7f483c7`, 09-07 — the largest single measured effect in the repo), the latency pair (`8aa909b`, 09-15) and the pool penalty |
| `sourceWeight` (index-based onset order among causal neighbours) | same file; `#193` | "regressed the benchmark"; the onset index it reads comes from a fault-contaminated baseline, which is why `postInjectOnsetDelays` was added | same |

Both weights default to 0, so every published number in the repo is measured with them
off. A −2.5pp measured on RCAEval at a configuration three large effects older than the
current one is not a verdict about the signal: by this register's own lineage rule its
gain **and** its regression set are stale. Neither has ever been measured on FSE'26.

**This is why the gap mattered.** The register's last paragraph invites the onset axis
and says nothing about it having been measured, so the next session would have proposed
it as new. It is registered now, in `closed-axes-register.md`, with the lineage that
makes the old number unusable and a reopening condition that names the measurement that
would replace it.

## 6. What is next

The onset signal is not in any dump, so it cannot be pre-screened for free — and this
register does not spend a run on a hypothesis a free read can settle. The cheap way to
make every timing hypothesis screenable offline is one field: emit the per-service onset
delay on the DIAG service line (`onset=<ms>`, `-` when undetermined, the same
absent-versus-empty rule the other fields follow) and dispatch **one** full run at the
shipped configuration with `diagnose`. That run also produces the missing 1422-case
pool-ON dump, so it closes the register's last data gap as a side effect. The window for
`w·2·(earliness − 0.5)` is then solved offline by the `--family-screen` solver, and only
a window with a gain and zero case-level losses is worth a CI pair.
