/**
 * The failure block prints six per-case comparisons and, on the published configuration, four of them read a
 * weight of zero — so they cannot move the ranking those comparisons appear to explain.
 *
 * These tests exist because that reading was made wrong twice, by the author of them: a case whose winner sat
 * at `topoSource=1.000` against the truth's `0.640` became a re-registered arm on "the source credit is what
 * separates them", for a term at weight zero. The arm was then measured and moves the blocking cell DOWN
 * (`63.3 → 60.0 → 46.7` at `topoWeight` 0.1 and 0.3). The defect is not the arm; it is that the artifact
 * printed a mechanism's value and not the weight that reads it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';
import {
  PRINTED_SIGNALS,
  formatInertSignalsNotice,
  formatInertSuffix,
  inertPrintedSignals,
  printedSignalEvidence,
  type PrintedSignalWeights,
} from '../src/signal-evidence.js';

const REPO = join(import.meta.dirname, '..', '..');

/** The runner's shipped defaults, as a dispatch that says nothing would build them. */
const shipped = (): PrintedSignalWeights => parseRCAEvalArgs([]);

/**
 * The SAME configuration stated as an explicit argument instead of inherited. It exists to prove the notice is
 * computed from the dispatch and not from the project: an arm that says `--trace-weight 1` and the shipped
 * defaults must produce the same evidence rows, because the default IS 1. The two were different numbers
 * until the pin moved out of the workflow and into `DEFAULT_TRACE_WEIGHT`; keeping the assertion means the
 * next change to that constant fails here rather than silently re-labelling the failure block.
 */
const re3Pinned = (): PrintedSignalWeights => parseRCAEvalArgs(['--trace-weight', '1']);

describe('the shipped dispatch, read for what the failure block can and cannot explain', () => {
  it('leaves FOUR of the six printed comparisons at zero weight on a dispatch that says nothing', () => {
    // Named, not counted: a count would pass if the wrong four were inert. `logScore` and `traceActivity` are
    // the two comparisons the shipped defaults weight, and the two terms they name are the two the nine cells
    // were measured with — the trace term was a workflow pin until it became the engine's default.
    expect(inertPrintedSignals(shipped())).toEqual([
      'onset',
      'injectDelay',
      'ratioContrib',
      'topoSource',
    ]);
    expect(
      printedSignalEvidence(shipped())
        .filter((e) => !e.inert)
        .map((e) => e.signal),
    ).toEqual(['logScore', 'traceActivity']);
  });

  it('states the shipped configuration the same way whether it is inherited or spelled out', () => {
    // The notice is computed from the DISPATCH, so this is a property of the run and not of the project: an
    // arm that states the weight it wants and an arm that inherits the same weight must agree, and an arm that
    // sets it back to zero must print the fifth inert row. Both directions are asserted below.
    expect(inertPrintedSignals(re3Pinned())).toEqual(inertPrintedSignals(shipped()));
    expect(inertPrintedSignals(re3Pinned())).not.toContain('traceActivity');
    expect(inertPrintedSignals(parseRCAEvalArgs(['--trace-weight', '0']))).toContain(
      'traceActivity',
    );
  });

  it('reads the weight from the option field it names, so a reader can find the number', () => {
    // The mapping is the claim: `topoSource` is read by `topoWeight`, and the arm this project measured was
    // built by setting exactly that field. If the two ever came apart, the notice would name a field that
    // does not move the signal it is printed beside.
    const byName = new Map(printedSignalEvidence(shipped()).map((e) => [e.signal, e.weightName]));
    expect(byName.get('topoSource')).toBe('topoWeight');
    expect(byName.get('ratioContrib')).toBe('collisionWeight');
    expect(byName.get('onset')).toBe('temporalWeight');
    expect(byName.get('injectDelay')).toBe('temporalWeight');
    expect(byName.get('logScore')).toBe('logWeight');
    expect(byName.get('traceActivity')).toBe('traceWeight');
  });
});

describe('the notice, and the suffix that survives a reader who skips it', () => {
  it('names every inert comparison with the field and the value that made it inert', () => {
    const notice = formatInertSignalsNotice(re3Pinned());
    expect(notice).toBeDefined();
    expect(notice).toContain('INERT AT THESE WEIGHTS');
    expect(notice).toContain('onset (temporalWeight=0)');
    expect(notice).toContain('injectDelay (temporalWeight=0)');
    expect(notice).toContain('ratioContrib (collisionWeight=0)');
    expect(notice).toContain('topoSource (topoWeight=0)');
    // The weighted ones are absent: the notice is about what the run did not use.
    expect(notice).not.toContain('logScore (');
  });

  it('does not name a comparison whose weight is non-zero', () => {
    const notice = formatInertSignalsNotice({ ...re3Pinned(), topoWeight: 0.1 });
    expect(notice).toBeDefined();
    expect(notice).not.toContain('topoSource');
    expect(notice).toContain('ratioContrib');
  });

  it('is undefined when every printed comparison is weighted, rather than an empty header', () => {
    const allWeighted: PrintedSignalWeights = {
      temporalWeight: 1,
      collisionWeight: 1,
      topoWeight: 1,
      logWeight: 1,
      traceWeight: 1,
    };
    expect(formatInertSignalsNotice(allWeighted)).toBeUndefined();
    expect(inertPrintedSignals(allWeighted)).toEqual([]);
  });

  it('marks the line itself, because a reader of one case does not re-read the header', () => {
    const inert = inertPrintedSignals(re3Pinned());
    expect(formatInertSuffix(inert, 'topoSource')).toBe('  [INERT: weight 0]');
    expect(formatInertSuffix(inert, 'logScore')).toBe('');
  });
});

describe('the quarantine fence: a printed comparison cannot skip its own label', () => {
  it('quotes the engine formula verbatim, so a changed formula breaks the quotation', () => {
    // A paraphrase would be free to rot. Each `term` is a line of `pruner.ts`, and this asserts the file still
    // contains every one of them — the notice is a description of the engine, and a description that no longer
    // appears in the engine is the stale-number defect `docs/accuracy-aggregation.md` §8 records, one surface
    // over.
    const pruner = readFileSync(join(REPO, 'packages/tree/src/pruning/pruner.ts'), 'utf8');
    for (const entry of printedSignalEvidence(re3Pinned())) {
      expect(pruner, `${entry.signal}'s term is no longer in pruner.ts`).toContain(entry.term);
    }
  });

  it('annotates every member of the union in the printer, and every annotation is a member', () => {
    // The fence has two directions and both matter: a comparison added to the union without a printed line
    // would be a signal nothing surfaces, and a printed comparison added without an annotation would be a
    // number a reader can mistake for evidence. This is the same shape as the census that reads a source file
    // to check its own inventory.
    const runner = readFileSync(join(REPO, 'benchmarks/src/run-rcaeval.ts'), 'utf8');
    for (const signal of PRINTED_SIGNALS) {
      expect(runner, `${signal} is printed without its weight`).toContain(
        `formatInertSuffix(inert, '${signal}')`,
      );
    }
    const annotated = [...runner.matchAll(/formatInertSuffix\(inert, '([a-zA-Z]+)'\)/g)].map(
      (m) => m[1]!,
    );
    expect([...new Set(annotated)].sort()).toEqual([...PRINTED_SIGNALS].sort());
  });

  it('prints the notice once per cell, before the first case of that cell', () => {
    const runner = readFileSync(join(REPO, 'benchmarks/src/run-rcaeval.ts'), 'utf8');
    expect(runner).toContain('const inertNotice = formatInertSignalsNotice(weights);');
    expect(runner).toContain('if (inertNotice !== undefined) console.log(inertNotice);');
  });
});
