# The shipped-value declarations, and the five that outlived the stability enrolment

**One change, five declarations.** `DEFAULT_STABILITY_WEIGHT` was `0` when five doc comments were
written. The constant became `0.007352` when the decisive-stability term was enrolled and BOTH halves
of the shared kill criterion were measured at it. The comments did not move, so five SHIPPED
declarations still told a reader the term was off — including one in the declaration file
`@agentix-e/micro-kinetic-core` publishes, and one in the runner that PRODUCES the golden. One of
them named `0.03017`, the FSE'26-only window's midpoint, as "its weight", although that value had
been REJECTED for moving four of the nine golden cells, one of them by 15.8pp.

This is the register's own named failure mode — **a summary outlives its own correction** — and it
is the sixth time the repository has paid for it. It is recorded here rather than fixed quietly
because the shape recurs, and because the one place it survived longest is the one no guard read.

---

## 1. The chain that already existed, and the link that did not

The repository had already closed this defect class twice, one level up and one level down:

- **A workflow input's description is a second owner of any value it quotes.** Two had drifted to
  the pre-ship configuration (`lat_weight` "0.03" for a shipped `0.561495`, `lat_min_rise` "1" for a
  shipped `10.3`). A guard now reads each description and requires it to name the shipped value
  (`fse26-reported-config.test.ts`, "workflow descriptions agree with the code they describe").
- **A constant's own doc comment is a third owner.** `DEFAULT_STABILITY_WEIGHT`'s own comment was
  updated by the enrolment, because the enrolment touched it.

What nothing read was the link BETWEEN those two: **the option's doc comment** — the declaration on
`TreePrunerOptions.stabilityWeight`, on `RankingWeights.stabilityWeight`, on the runners' CLI option
interfaces and on the report writer's config type. Those are the comments a proposer actually reads
to decide whether an axis is open, and the register's own rule is that a knob is found by its NAME
and owned by a document — for a comment-only knob the owner IS the doc comment.

So the surface was guarded at both ends and open in the middle, and the enrolment went through it
five times.

## 2. What the census derives rather than remembers

`packages/kinetic/__tests__/unit/shipped-declaration-census.test.ts`.

1. **The SHIP-ON population is the constructor's own defaults.** It parses
   `DEFAULT_TREE_PRUNER_OPTIONS` out of the engine's source, FOLLOWING the spread into
   `DEFAULT_RCA_OPTIONS` (which the core package declares, so the resolver is cross-file), and takes
   an option as ship-ON when the constructor fills it with a number that is not `0`, or with `true`.
   Measured: **22 options filled, 8 ship-ON**. An option added tomorrow is enrolled without editing
   the test.
2. **The declaration sites are WALKED.** Every `.ts` under `packages/*/src` and `benchmarks/src`,
   skipping `node_modules` and `dist` by name, so a fourth surface is picked up automatically.
   Measured: **183 files**, **73 doc-block sites that document a filled option**.
3. **A claim is judged NUMERICALLY.** The first version of the arm matched a `0` followed by a
   character-class lookahead, and the probe that sized the population exposed it in both directions
   at once: `Default: 0.8` was read as a claim of zero, while the sentence-final `Default 0.` was
   REJECTED because the next character is a period. A lookahead is wrong in both directions here, so
   the arm now CAPTURES the number token and compares `Number(token) === 0`. Both halves are pinned
   by controls.

Five arms, each shown to fire on its own control so that a quiet arm is a measured quiet:
`ships-at-zero`, `zero-is-shipped`, `enrolled-at-zero`, `default-zero`, and `ships-inert` (which
carries no number, because the word IS the claim).

**One arm is scoped, and the scope is a statement rather than an exemption.** `default-zero` states
a claim about an INTERFACE's own default, which is the shipped value exactly where the constructor
fills it. `RankingWeights` is the optimizer's serializable search space, whose documented convention
is that a zero weight disables a signal — so a `Default 0` there is a claim about the CUBE. Scoping
one arm keeps the three engine-level arms applied to every surface, and the scope is asserted:
`NUMERIC_DEFAULT_SURFACE` must equal the engine's option surface.

## 3. The five sites, kept as refuted CONTROLS

The rule this repository follows for a refuted declaration is to KEEP THE ROW with its text quoted,
because a value can only be rejected against the run that rejected it. All five are quoted here in
the form the census read, and all five are now corrected in place.

| # | file | the declaration, as it was | the arm that read it |
| - | ---- | -------------------------- | -------------------- |
| 1 | `packages/tree/src/pruning/pruner.ts` | "Ships at **0** — … the golden half of the kill criterion cannot be measured offline … so the term is evaluated by passing the flag and the default path stays bit-for-bit the configuration the golden was taken on." | `ships-at-zero` |
| 2 | `packages/core/src/types/ranking-weights.ts` | "The candidate is a WINDOW, not a shipped weight: … so it ships inert and is evaluated by passing the flag." | `ships-inert` |
| 3 | `benchmarks/src/fse26-cli.ts` | "Weight on the decisive-stability prior. **0 is the SHIPPED value**, not the ablation: the window is solved but the golden half of the kill criterion has not been run…" | `zero-is-shipped` |
| 4 | `benchmarks/src/fse26-report.ts` | "Weight on the decisive-stability prior; `0` is the SHIPPED value and the candidate is reached by passing the flag, because the golden half of the criterion has not been run." | `zero-is-shipped` |
| 5 | `benchmarks/src/rcaeval-cli.ts` | "…the golden was bit-identical while the term was enrolled at weight 0 … Its weight is the same 0.03017 the FSE'26 screen solved for…" | `enrolled-at-zero` |

Every one of the five is refuted by the same two facts, and neither is an inference:

- `DEFAULT_STABILITY_WEIGHT = 0.007352` and `DEFAULT_TREE_PRUNER_OPTIONS.stabilityWeight` reads that
  constant, so the DEFAULT path carries the term;
- run `35416576350` passes NO input at all and reads `stabilityWeight=0.007352` off the constant,
  giving FSE'26 **757/1422** against its same-commit control `35416580279` at **756** — one case,
  `HTTPResponseReplaceCode 160 → 161`, nothing moving the other way — with the push's own golden
  `35416556932` **9 of 9 byte-identical**.

**Site 5 carried the worse defect**, because it named a value rather than a state: `0.03017` is the
FSE'26-only window's midpoint, and the golden half REJECTED it (`docs/fse26-cv-screen.md`; the
register's stability row). An operator following that sentence would have dispatched the one weight
known to move four golden cells.

## 4. The repairs

Each site now NAMES the constant instead of restating a value — `{@link DEFAULT_STABILITY_WEIGHT}`
where the link resolves, and "the engine's own constant" where the file's type does not import it.
That is the only permanence a prose guard can buy: **a declaration that names the constant cannot
drift from it.**

- Site 1 states the intersection and the DEFAULT-path runs, and points at the REJECTED point the
  constant's own comment records.
- Site 2 states the transfer object's `absent means 0` convention AND that it is not the engine's
  default, with both halves' runs; its evidence paragraph now says the `[0.029860, 0.030480]` window
  is the FSE'26 half alone and that its midpoint was rejected.
- Site 3 says the term SHIPS ON and that the input exists to ABLATE it.
- Site 4 says the shipped value is the engine's constant and that the flag path and the DEFAULT path
  agree.
- Site 5 keeps `0.03017` on the record as the REJECTED point, quoted with the reason, so the number
  a reader may have seen elsewhere is accounted for rather than deleted.

**No number moved.** The whole change is doc comments in four source files plus one benchmark source
file; `DEFAULT_STABILITY_WEIGHT`, `DEFAULT_TREE_PRUNER_OPTIONS` and every other constant are
byte-identical, which is what the acceptance below re-measures rather than assumes.

## 5. Reach, and the residue it does not cover

Stated rather than implied, because a fence's reach is the property that decides what it is worth:

- A stale claim phrased with **no number and none of the five spellings is invisible**. The five
  sites happened to use four spellings, which is why four arms were enough — that is a fact about
  this finding, not a property of the rule.
- `dist/` is not read, and does not need to be: it is gitignored and built from `src`, so the
  corrections reach the published declarations through the build.
- The **`RankingWeights` numeric convention is deliberately NOT policed** (`Default 0` on a
  search-space field whose engine value is `1.0` for the log term). It is a different contract, and
  the scope is asserted rather than left to a reader's judgement.

## 6. Acceptance

- **Census fence**: 6 tests, of which the finding is one: the violation list goes from **5 entries to
  empty**, with every arm's positive control and the numeric-reading control in the same file.
- **Register fence**: `packages/kinetic/__tests__/unit/closed-axes-register.test.ts`, 14 tests, with
  the new main-table row and the entry that keeps this document reachable.
- **Local suites**: `tree` 653 tests at **100 / 100 / 100 / 100** — `pruner.ts` included — and the
  `kinetic` and `benchmarks` legs read back from CI, because those are the gates that ship.

**A note on local cost, measured rather than assumed.** The census's own tests run in **16ms**; the
suite's wall time was **30.9s** on one run and the UNTOUCHED control file took **66.5s** on another,
and `tree`'s collect phase reported **2157s**. The variance is the environment's, not the test's, and
it is recorded here so that a later session does not read a slow run as a regression.
