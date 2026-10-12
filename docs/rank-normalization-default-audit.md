# The rank-normalization default, and the three owners of one shipped value

**The engine did not ship the configuration its own numbers were measured under.** `rankNormalization` decides
WHICH rescale a large topology's anomaly scores get above the node threshold — min-max, which lets one outlier
spike crush the genuine source, or uniform-rank, which is semantics-agnostic. The register keeps it ON
("rankNormalizeScores ON — never revert"). Three declarations disagreed about that:

| owner | value | what it says |
| --- | --- | --- |
| `topology-fault-graph.ts`'s `DEFAULT_CONFIG` | **`false`** | `// min-max rescale (shipped behaviour)` |
| the field's own doc comment | — | *"Default: `false` (bit-identical to shipped min-max behaviour)"* |
| `rcaeval-cli.ts`'s parsed defaults | `true` | a literal, restated as the golden's default |
| `fse26-cli.ts`'s parsed defaults | `true` | a literal, restated as the FSE'26 default |

So the value the repository calls shipped had **three owners and two different answers**, and the one that
described itself as "shipped behaviour" was the one the published numbers were NOT measured under.

## 1. What it cost

- **A caller that passed no topology argument ran the unmeasured configuration.** That is the DI container
  (`packages/kinetic/src/di/container.ts`), the tree package's own factory, `run-all.ts`,
  `run-local-bench.ts` — and, as the previous iteration's census found, the **L2 weight search**, whose
  artifact reported seven named weights over a base that differed from the golden in exactly this axis.
- **The doc asserted the opposite of the register.** A reader of the field learned that `false` is shipped;
  a reader of the register learned that the axis is ON and must stay ON. One of the two had to be wrong, and
  the repository's own measurements say it is the doc.
- **Three owners can drift.** This is the failure mode that once published a headline 24.2pp below the
  best-measured one, and the reason every shipped weight was given an exported constant. The topology options
  had never been given the same treatment.

## 2. Why nothing caught it

**The flag is inert below `ANOMALY_NORMALIZE_NODE_THRESHOLD` (20) nodes.** Every tree-suite fixture is small,
so flipping the default moves no assertion there — which is exactly why the defect could sit in a package with
100% coverage on every dimension. Coverage measures what a test touches, not what a default means.

And the runners' artifacts *did* record the value, which made the axis look owned: the golden's line has
printed `rankNormalization=true` since the field was added. What no artifact said was what a caller who
passes nothing gets.

## 3. The repair

- `DEFAULT_RANK_NORMALIZATION = true` is exported from `topology-fault-graph.ts`; `DEFAULT_CONFIG` reads it;
  the field's doc names it instead of claiming a value.
- Both parsers read it: `rcaeval-cli.ts` and `fse26-cli.ts` no longer state a default of their own.
- The optimize package's `UNPASSED_SECOND_ARGUMENT` doc and the line `formatEngineConfigLine` renders are
  corrected from "differs from the golden" to "IS the shipped configuration" — the search's base now aligns
  because the ENGINE changed, not because the runner overrode it.

**This is a behaviour change and it is treated as one.** It moves any run that (a) builds the engine without a
topology argument and (b) uses a graph of ≥20 nodes:

- the golden's nine cells **cannot** move: `rcaeval-engine-options.ts` passes `rankNormalization` explicitly
  from the parser, and the parser's value is unchanged (`true`) — the acceptance checks this rather than
  assuming it;
- the FSE'26 benchmark likewise passes it explicitly;
- the ablation passes it per configuration, by flag;
- **the L2 weight search moves**, because it passes nothing. Its Train Ticket cases have ≥20 nodes and its
  OnlineBoutique/SockShop cases do not, so the delta is expected to be confined to where the flag acts. That
  is the alignment the previous iteration recorded as a candidate change; its numbers are read back from the
  artifact and reported before and after.

## 4. The fence

| assertion | where | what it rejects |
| --- | --- | --- |
| the engine's `DEFAULT_CONFIG` READS `DEFAULT_RANK_NORMALIZATION`, and that constant is `true` | `packages/optimize/__tests__/unit/integration.test.ts` | the literal default coming back |
| `rankNormalization: false` no longer appears in the engine's source | same | the old default surviving in a second place |
| the RCAEval parser's value equals the engine's constant, and the parser states no default of its own | `benchmarks/__tests__/rcaeval-reported-config.test.ts` | the literal default coming back in the runner |

The parser assertion deliberately does not match the `--rank-normalization` handlers, which ASSIGN
(`opts.rankNormalization = true;`) rather than declare a default — a comma after the value is what
distinguishes the two, and conflating them would make the guard fire on the flag it is there to keep.

## 5. Reach, and what it does not cover

- The constant is not re-exported through the published `.d.ts` until the next build, so a PACKAGE cannot
  name it from a cross-package import yet — the same constraint the previous iteration hit. The engine's
  default is what matters for those callers, and it is now correct without them naming anything.
- `ANOMALY_NORMALIZE_NODE_THRESHOLD` remains a separate axis: below it, NEITHER rescale runs, so a reader
  holding a score vector still needs the node count to know which quantity it has. That is unchanged and
  deliberately so.
- The claim in `docs/construction-site-census.md` that a no-argument construction is "the strongest form of
  configured — the shipped configuration IS the engine's defaults" was **false when it was written** and is
  true only for the axes that are actually shipped-valued. This iteration repairs it for this axis; the rest
  is not audited, and that is stated there as the residue.

## 6. The axis's POPULATION, measured — and it became a value

§5 registered the threshold as *"a separate axis… unchanged and deliberately so"*, and §2 explained that the flag
is **inert below 20 nodes** as the reason no tree-suite assertion could catch the default defect. Neither drew the
consequence for the CORPUS, and this section is that: **a flag that is inert below a node count is inert on every
case below it, and on this benchmark most cases are below it.**

### 6.1 The free read, and it is a partition

From the loss census of the published run (`38240322295`, all 735 cases), the pool — the graph the ranker chooses
from, which is the node count the guard tests — splits the corpus:

| pool | cases | which cells | accuracy |
| --- | ---: | --- | ---: |
| **≤ 20** (the flag is NOT read) | **487** | RE1 OnlineBoutique 125 · RE1 SockShop 125 · RE2 OnlineBoutique 90 · RE2 SockShop 90 · RE3 OnlineBoutique **28** · RE3 SockShop **29** | **83.98%** |
| **> 20** (the flag IS read) | **248** | RE1 TrainTicket 125 · RE2 TrainTicket 90 · RE3 TrainTicket 30 · RE3 OnlineBoutique **2** · RE3 SockShop **1** | **66.53%** |

The rates are in the CENSUS's convention, which `docs/loss-decomposition.md` §4.3 owns and names: every case
weighted equally, against the one recorded truth — this corpus's case-level accuracy is **78.10%**, not the
published per-fault-type average `78.75%`. Quoting one as the other is the error that section exists to prevent, and
the same applies here.

### 6.2 Four statements, and the fourth is a refusal

1. **The split is the SYSTEMS, not a property of the cases.** TrainTicket is 63–69 services; OnlineBoutique and
   SockShop are 3–15. So a *per-fault-type* A/B of `rankNormalization` cannot be run at all — the axis is a
   per-system question, and on six of the nine cells the answer is fixed by construction before the flag is
   consulted.
2. **The register's `rankNormalization ON — never revert` verdict has never been testable on 66.3% of the corpus.**
   Not "was tested and held": the value is not read there, so no run made through this engine can have measured it
   on those 487 cases — including the 3.6% → 51.1% TrainTicket recovery that is the verdict's whole evidence.
3. **And the split is inhomogeneous WITHIN two cells.** Three of RE3's 60 cases are at or above the line
   (`re3ob_adservice_f3_2` and `_f3_3` at 28 nodes, `re3ss_carts_f1_3` at 26) while their 57 cell-mates are below
   it. That is the failure the constant's own docblock names — *"a below-threshold vector's values are a different
   quantity, not a differently-scaled one"* — arriving inside a single cell, so those three cases are scored on a
   different quantity from the ones they are reported beside.
4. **The 17.5pp difference between the two rows is NOT the axis's effect, and this document does not claim it is.**
   The populations differ in system, fault mix, fault-to-service ratio and graph size at once, so the only thing
   the table establishes is **membership** — which cases the flag can reach — and that is exactly what it is used
   for below. A reader who took 83.98% against 66.53% as the flag's value would be reading a confound, and this
   sentence is here so that reading is not available.

### 6.3 What became a value

`TopologyFaultGraphConfig` gains **`anomalyNormalizeNodeThreshold`**, defaulting to the exported constant; the
step-1b guard reads the config field rather than the constant. The option is threaded the way the axis's flag is:
`RCAEvalTopologyOptions` and the FSE'26 topology object carry it, both CLIs parse
`--anomaly-normalize-threshold` through one shared `parseNodeCount`, both workflows expose
`anomaly_normalize_threshold`, and both configuration lines name it.

**The lines name it unconditionally, and the rule is the one `fse26-report.ts` already records**: a field may be
omitted while it holds its default **only if that default is zero**. This one's default is 20, so an
omitted-when-default rule would render the shipped run and a run that rescaled every graph **byte-identically**.
The consequence for acceptance follows from the same rule and is stated rather than discovered: **the `signals:`
and `Config:` lines grow by one field by design, so the acceptance for this change is the nine CELLS plus the new
field's value — never the line's bytes.**

`parseNodeCount` refuses a fraction and **keeps `0`**: a node count is a cardinality, so `4.5` is not a coarser box,
and `0` is the widest population the axis has rather than an absent value — the trap `--pool-penalty 0` was
repaired for, one flag over.

### 6.4 The residues this leaves, named

- **`benchmarks/src/fse26-term-oracle.ts` still models the engine at the constant.** It re-derives a run from a
  DUMP, and every dump in existence was produced at the shipped count, so its `rawCases` / `rescaledCases` split is
  correct for all of them and would be wrong for a non-default dump — which must now be told to it. Stated rather
  than threaded, because the oracle has one construction site whose configuration comes from the dump's own header.
- **`summarizePopulation` takes the count as a parameter and carries it on the summary**, so the rendered line
  states the population it used instead of the engine's default. This one IS threaded, because it feeds the
  held-out split design: a summary taken at the default while the run used another count would size the split for
  a population the run did not have.

### 6.5 The prediction, and the candidate

A run at `--anomaly-normalize-threshold 0` rescales **every** graph. Its nine cells must therefore be identical to
the published ones on the 248 cases already above the line, and can differ **only** on the 487 that were raw — so a
difference anywhere else is evidence that something other than this option moved, which is what makes the dispatch a
measurement rather than a hope. It is also the axis's first read: whether an ordering principle that recovers two
thirds of TrainTicket transfers to twelve-service graphs, where the raw deviation is already well-scaled.

**And one external reference is re-confirmed rather than new.** `arXiv:2609.27069` — the controlled RCAEval audit,
already on this repository's record in `docs/sota-comparison.md` §3, `docs/benchmark-corpus-completeness.md` and
`docs/loss-decomposition.md` §1, with `scripts/audit_input_schema.py` built from its second finding — was checked
before anything in this section was written, which is the grep-before-building rule this repository pays for.

### 6.6 The candidate, measured — the axis' widest setting changes NO outcome, and the reason is structural

Run **`38275480566`** on `7847599` (`--anomaly-normalize-threshold 0`), against the run that landed the option
(`38275372681` on `7847599` — the SAME revision, so the only difference between the two is this input). The
candidate's own artifact states `anomalyNormalizeNodeThreshold=0`.

**All nine cells are IDENTICAL, and so is every per-fault-type row inside them.** Per case, from the two loss
censuses:

| suite | outcomes identical | differ | what the difference is |
| --- | ---: | ---: | --- |
| RE1 | 374 / 375 | **1** | same wrong top-1 (`checkoutservice`), truth's rank `None` -> `10` |
| RE2 | 269 / 270 | **1** | same wrong top-1 (`frontend`), truth's rank `None` -> `10` |
| RE3 | 90 / 90 | **0** | — |

**So rescaling every graph — 487 cases that were previously RAW — moved no top-1 on any of the 735 cases, and the
only two movements are a truth gaining a REPORTED rank it did not have while remaining a miss.**

**And the mechanism is not a surprise, it is a property of the axis.** Both of `rankNormalization`'s poles are
**strictly monotone transformations of the same anomaly vector** — uniform rank and min-max are both order-preserving
— and the base term is strictly monotone in that vector too. So the flag **cannot reorder the base term at all**; the
only channel it has is the base term's SPACING, which matters only where a weighted term has to cross its gaps. On
TrainTicket, where the base term's raw span is compressed by one outlier and `traceWeight=1` is in play, that
spacing was worth 3.6% -> 51.1%. On the 487 raw cases it was worth nothing measured.

**Three consequences, and the third answers §6.6 of `docs/loss-decomposition.md` with a REFUSAL.**

1. **My own §6.5 prediction is sharpened rather than confirmed.** I predicted the cells must be identical on the 248
   cases already above the line and may differ only on the 487. Measured: identical **everywhere**, so the predicted
   difference domain was empty. Stated because a prediction that is not read back is not a prediction.
2. **The axis' negative is stronger than "untested".** It is not that nobody measured the flag on two thirds of the
   corpus; it is that the widest setting **cannot** change those cases by reordering anything, and this run shows it
   does not. The register row's "never testable" is now "tested, and a no-op on 733 of 735 outcomes".
3. **`loss-decomposition.md` §6.6 named `rankNormalizeScores` as "the one mechanism that CAN" move the base term
   that decides 71.5% of the margin. That is now REFUTED for this knob**: it cannot move the ordering, because both
   its poles preserve it. What CAN move the base term is a **base term that is not a monotone function of the
   anomaly** — a magnitude-shaped reading, or an explicit mixture of rank and magnitude — and that is a different
   change from flipping a boolean. The axis is closed with a measurement, and the pointer is redirected rather than
   removed.

**The nine cells unchanged is the acceptance the option's own section 6.3 demanded, and it holds on all three
suites** — which is the second half of the "cells plus field, never the line's bytes" criterion, now read from the
candidate's artifact rather than argued from the default.
