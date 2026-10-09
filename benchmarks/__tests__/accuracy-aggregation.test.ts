/**
 * A census of the sites that fold a per-cell accuracy into a suite number — and the guard that there is
 * one owner of that fold.
 *
 * ## The defect
 *
 * RCAEval's published table reports, per system, an `AVERAGE` column beside one column per fault type.
 * That column is the **unweighted mean of the fault-type accuracies**; the nine published cells are its
 * values. It was implemented inline in `run-rcaeval.ts`. **It was then re-implemented four more times, three
 * of them in the other convention** — the mean over CASES — and nothing on any artifact named which one a
 * number was in:
 *
 * | site | quantity folded | convention |
 * | --- | --- | --- |
 * | `run-rcaeval.ts` (the table's AVERAGE) | fault-type accuracies → a system's AC@1 | **published** |
 * | `run-ablation.ts` (per system) | the same | case-weighted |
 * | `prism-sweep.ts` (`analyzePrismSweep`'s `overall`) | the same, over cells | case-weighted |
 * | `benchmark-runner.ts` (`runAll`) | the same, over suites | case-weighted (**no callers at all**) |
 * | `run-local-bench.ts` | the same, over fault types | **published, duplicated** |
 *
 * The two conventions coincide **iff every cell holds the same number of cases**, which is RE1 (25 per cell)
 * and is not RE2 or RE3. So the study's RE3 baseline read 53.33% against the golden's 58.70% — and that gap
 * was investigated for three runs as an *input* defect, most recently as a suspected difference in attached
 * trace spans. It was never an input defect. **The per-fault-type accuracies are identical between the two
 * paths in 13 of the 14 comparable cells** (verified against the frozen artifacts of run `37764638225`:
 * RE1 15/15, RE2 12/12 for OB and SS, RE3 13/13); only the fold differed.
 *
 * ## What the guard holds
 *
 * `packages/kinetic/src/benchmarks/runners/suite-accuracy.ts` owns both conventions and returns them
 * together, so a caller cannot take the published statistic without the case-weighted one in the same
 * object. These fences hold the two properties a source-shape check can hold for files that call `main()`
 * at import time: **every fold site goes through the owner**, and **each site's headline is the published
 * convention** while the study's is reported beside it.
 *
 * ## The residual this census found LATER, and it was its own
 *
 * Routing the published fold to the owner left the ablation's **case-weighted** fold hand-rolled: four
 * accumulators (`allA1` … `allTA`), each `sum(value × cases) / cases`, in the runner every ledger number comes
 * from — while this file's own table names the ablation as a case-weighted site and the owner's docblock names
 * "an ablation row" as the first re-implementation it removed. The guard below covered the runner and the
 * local bench and its title said "the two remaining sites": **an enumeration standing in for a rule.**
 *
 * The repair is a call to `caseWeightedMean`, provably value-preserving to the last bit (same cells, same
 * order, same accumulation), and the fence for it is an ABSENCE over the whole file rather than a count of
 * known sites — because the count is what went stale.
 *
 * @module benchmarks/__tests__/accuracy-aggregation
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from './helpers/source-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, '..', rel), 'utf8');

const RCAEVAL = read('src/run-rcaeval.ts');
const ABLATION = read('src/run-ablation.ts');
const LOCAL_BENCH = read('src/run-local-bench.ts');

const OWNER = read('../packages/kinetic/src/benchmarks/runners/suite-accuracy.ts');
const SWEEP = read('../packages/kinetic/src/benchmarks/leaderboard/prism-sweep.ts');
const RUNNER = read('../packages/kinetic/src/benchmarks/runners/benchmark-runner.ts');

describe('the fold has one owner, and 5 sites used to have their own', () => {
  it('declares exactly the two conventions, under the names the artifacts would quote', () => {
    // Both functions exist and are named for what they are. `meanOverFaultTypes` is the published one;
    // a rename that dropped "FaultTypes" would let a caller pass system values and mean it.
    expect(OWNER).toContain('export function meanOverFaultTypes');
    expect(OWNER).toContain('export function caseWeightedMean');
    expect(OWNER).toContain('export function rollupSuiteAccuracy');
    // And the pair is returned together, which is the refusal: a caller asking for the published
    // statistic receives the case-weighted one in the same object and cannot silently drop it.
    expect(OWNER).toMatch(/faultTypeMean:[\s\S]{0,200}caseWeighted:/);
  });

  it('is the fold the golden table uses, and the inline expression it replaced is gone', () => {
    // The regression this fence exists for: the four copies drifted apart because each was written at
    // its own call site. A new `reduce((s, v) => s + v, 0) / averages.length` here is the fifth.
    expect(RCAEVAL).toContain('meanOverFaultTypes');
    expect(RCAEVAL).toContain(
      "from '../../packages/kinetic/src/benchmarks/runners/suite-accuracy.js'",
    );
    expect(RCAEVAL).not.toContain('averages.reduce(');
    expect(RCAEVAL).toMatch(/const avg = meanOverFaultTypes\(averages\)/);
  });

  it('makes the ablation report the PUBLISHED convention as its headline, with the study one beside it', () => {
    // The substance of the repair on the study's side. `publishedA1` is the headline in the results
    // table; `aTop1` is the case-weighted number and is printed in its own column, so a reader of the
    // artifact is never left to guess which convention a cell is in.
    expect(ABLATION).toContain('meanOverFaultTypes');
    expect(ABLATION).toMatch(/const publishedA1 = meanOverFaultTypes\(ftSamples\)/);
    expect(ABLATION).toContain('publishedA1: number;');
    expect(ABLATION).toContain('aTop1: number;');
    // The table reads the published one…
    expect(ABLATION).toMatch(/r\.publishedA1 \* 100/);
    // …and names both folds on the artifact itself, because the artifact is what a reader has.
    expect(ABLATION).toContain('AVG = per-system mean over FAULT TYPES');
    expect(ABLATION).toContain('CW = per-system mean over CASES');
  });

  it('makes the sweep pick its best column in the published convention, and ship both curves', () => {
    // A "best zero-regression weight" chosen by a statistic the published cells are not in names a
    // configuration that cannot be compared to them. Both curves go into the artifact so the
    // difference is auditable rather than argued.
    expect(SWEEP).toContain("from '../runners/suite-accuracy.js'");
    expect(SWEEP).toMatch(/overall\[i\] = meanOverFaultTypes\(/);
    expect(SWEEP).toContain('caseWeightedOverall');
    expect(SWEEP).toContain('readonly caseWeighted: number;');
    expect(ABLATION).toContain('caseWeightedOverall: analysis.caseWeightedOverall');
  });

  it('leaves no hand-rolled fold in the runner or the local bench', () => {
    // `runAll` had NO callers and its four aggregates were case-weighted; it now calls the owner's
    // function for that convention, so its convention is a call rather than a re-derivation.
    expect(RUNNER).toContain("from './suite-accuracy.js'");
    expect(RUNNER).toContain('caseWeightedMean(');
    expect(RUNNER).not.toMatch(/r\.avgTop1 \* r\.totalCases/);
    // `run-local-bench.ts` had the published convention written out a second time.
    expect(LOCAL_BENCH).toContain('meanOverFaultTypes');
    expect(LOCAL_BENCH).not.toContain('avgs.reduce(');
  });

  it('leaves no hand-rolled fold in the THIRD site this census names — the one the guard above missed', () => {
    // That test's title used to read "the two remaining sites" and enumerated the runner and the local bench,
    // while the table at the top of THIS file names three sites that folded in the case-weighted convention.
    // The third is the ablation, and it held FOUR hand-rolled accumulators — `allA1` … `allTA`, each
    // `sum(value x cases) / cases` written out by hand — in the one runner every ledger number comes from.
    // The owner's own docblock already named "an ablation row" as the first re-implementation it removed, so
    // the claim was on the record and the guard did not reach it.
    //
    // Found by an audit of the @k family rather than by a failing test, which is the point: **a fence that
    // ENUMERATES its population goes stale the moment the population is larger than the enumeration.** The
    // assertion below is therefore an ABSENCE over the whole file rather than a count of known sites, and it
    // reads comments-stripped source so the comment explaining the removal cannot defeat it.
    const code = stripComments(ABLATION);
    expect(code, 'the owner is imported').toContain('caseWeightedMean');
    for (const gone of ['allA1', 'allA5', 'allLA', 'allTA']) {
      expect(code, `no hand-rolled accumulator named ${gone}`).not.toContain(gone);
    }
    expect(code, 'and no inline fold expression survived').not.toMatch(
      /\?\s*allA\d\s*\/\s*totalCases/,
    );
    // Both conventions now arrive from the owner — the published headline from one function, the four
    // numbers printed beside it from the other — so neither can be taken without the other.
    expect(code).toContain('meanOverFaultTypes');
    expect(code).toMatch(/const avgA1 = caseWeightedMean\(a1Cells\)/);
    expect(code).toMatch(/const avgA5 = caseWeightedMean\(a5Cells\)/);
    expect(code).toMatch(/const avgLA = caseWeightedMean\(laCells\)/);
    expect(code).toMatch(/const avgTA = caseWeightedMean\(taCells\)/);
  });
});
