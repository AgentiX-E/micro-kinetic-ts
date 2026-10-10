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
