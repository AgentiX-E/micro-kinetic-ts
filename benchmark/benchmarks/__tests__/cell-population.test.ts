/**
 * A cell is MEASURED or it is NOT, and the difference must be visible before the number is.
 *
 * The defect this file exists for: on run 43901259774 the embedding provider ran out of quota, every
 * one of RE3's thirty cases failed to load on that error, and the runner printed
 *
 *     ║ Micro-Kinetic       | AC@1   |   0.0% ║
 *
 * — a table, in the published format, for a cell in which zero cases reached the scorer. The guard that
 * should have caught it asked `stats.considered === 0`, and `considered` counts the cases the loader was
 * ASKED for, so it was 30. The run then reported a rate over an empty denominator as if it had measured
 * one, exited 0, and the workflow went green carrying a reading that no case supports.
 *
 * Two populations, therefore, and they are never the same number: `requested` is the dispatch's slice and
 * `evaluated` is what the scorer produced a verdict for. A rate exists only over the second.
 *
 * @module benchmarks/__tests__/cell-population.test
 */

import { describe, expect, it } from 'vitest';

import {
  classifyCell,
  formatCellCoverageLine,
  formatUnmeasuredBlock,
  type CellMeasurement,
} from '../src/cell-population.js';

/** The load error RE3 reported on all thirty cases, abbreviated as the runner abbreviates it. */
const QUOTA = 'Embedding API error 429 (retries exhausted): {"error":{"code":"1113"';

describe('cell population', () => {
  it('measures a cell whose cases all reached the scorer', () => {
    const verdict = classifyCell({ requested: 30, evaluated: 30 });
    expect(verdict.kind).toBe('measured');
    expect(verdict.requested).toBe(30);
    expect(verdict.evaluated).toBe(30);
  });

  it('measures a cell that lost some cases, and reports both counts so the rate has a denominator', () => {
    // Partial coverage is not the defect: a rate over 28 of 30 cases is a real rate over a stated
    // population. Folding it into either extreme — unmeasured (hiding a measurement) or 30 (hiding the
    // loss) — would be the same error in opposite directions.
    const verdict = classifyCell({ requested: 30, evaluated: 28 });
    expect(verdict.kind).toBe('measured');
    expect(verdict.evaluated).toBe(28);
  });

  it('refuses to call zero evaluated cases a measurement, and names the load error that emptied the cell', () => {
    // The exact shape of run 43901259774: thirty asked for, none loaded, every one on the same error.
    const verdict = classifyCell({
      requested: 30,
      evaluated: 0,
      loadErrors: new Map([[QUOTA, 30]]),
    });
    expect(verdict.kind).toBe('unmeasured');
    if (verdict.kind !== 'unmeasured') return;
    expect(verdict.reason).toContain('0 of 30');
    expect(verdict.reason).toContain('30×');
    expect(verdict.reason).toContain('429');
  });

  it('names the DOMINANT error when a cell emptied on more than one, rather than the first seen', () => {
    // A map iterated in insertion order would report whichever error came first, which on a cell that
    // lost one case to a parse error and twenty-nine to a quota would blame the parse error.
    const verdict = classifyCell({
      requested: 30,
      evaluated: 0,
      loadErrors: new Map([
        ['Unexpected end of JSON input', 1],
        [QUOTA, 29],
      ]),
    });
    expect(verdict.kind).toBe('unmeasured');
    if (verdict.kind !== 'unmeasured') return;
    expect(verdict.reason).toContain('29×');
    expect(verdict.reason).toContain('429');
  });

  it('does not replace the dominant error with a smaller one seen later', () => {
    // The other direction of the same comparison, and it is the one a `count >= best` typo would break: a
    // twenty-nine-case quota followed by a single parse error must still be reported as the quota.
    const verdict = classifyCell({
      requested: 30,
      evaluated: 0,
      loadErrors: new Map([
        [QUOTA, 29],
        ['Unexpected end of JSON input', 1],
      ]),
    });
    expect(verdict.kind).toBe('unmeasured');
    if (verdict.kind !== 'unmeasured') return;
    expect(verdict.reason).toContain('29×');
    expect(verdict.reason).toContain('429');
  });

  it('distinguishes a cell that selected nothing from a cell whose corpus failed to load', () => {
    // `requested === 0` is a dispatch whose filters matched no case; it is still not a measurement, but
    // it is not a corpus failure either, and a reader deciding whether to re-dispatch or to fix a
    // provider needs the two apart.
    const empty = classifyCell({ requested: 0, evaluated: 0 });
    const failed = classifyCell({
      requested: 30,
      evaluated: 0,
      loadErrors: new Map([[QUOTA, 30]]),
    });
    expect(empty.kind).toBe('unmeasured');
    expect(failed.kind).toBe('unmeasured');
    if (empty.kind !== 'unmeasured' || failed.kind !== 'unmeasured') return;
    expect(empty.reason).not.toBe(failed.reason);
    expect(empty.reason).toContain('selected');
    expect(failed.reason).toContain('reached the scorer');
  });

  it('says so when a cell emptied WITHOUT a load error, because that is a different defect', () => {
    // Cases selected, none loaded, and nothing threw: the loader dropped them silently. Naming the
    // absence of an error is the only thing that separates this from the quota case above, and it is
    // the case the guard must never report as "no cases found".
    const verdict = classifyCell({ requested: 12, evaluated: 0 });
    expect(verdict.kind).toBe('unmeasured');
    if (verdict.kind !== 'unmeasured') return;
    expect(verdict.reason).toContain('12');
    expect(verdict.reason).toContain('no error');
  });

  it('refuses a population where more cases were scored than were asked for', () => {
    // Not a reachable state through the loader, which is why it is asserted rather than handled: a
    // denominator larger than its numerator's population would make the coverage line print a rate above
    // 100 % and there is no reading of the artifact in which that is a measurement.
    expect(() => classifyCell({ requested: 10, evaluated: 11 })).toThrow(/evaluated .*requested/);
  });

  it('prints no coverage line for a cell that lost nothing, and one for a cell that did', () => {
    expect(formatCellCoverageLine(classifyCell({ requested: 30, evaluated: 30 }))).toBeUndefined();
    const line = formatCellCoverageLine(classifyCell({ requested: 30, evaluated: 28 }));
    expect(line).toContain('28/30');
    expect(line).toContain('93.3%');
  });

  it('prints no coverage line for an unmeasured cell, whose block already carries both counts', () => {
    // The coverage line states the denominator of a rate that EXISTS. An unmeasured cell has no rate, and a
    // coverage line over it would be the same absence-as-number defect in a softer font.
    expect(formatCellCoverageLine(classifyCell({ requested: 30, evaluated: 0 }))).toBeUndefined();
  });

  it('renders an unmeasured cell as a block that states the counts, the reason, and NO rate', () => {
    // The format assertion is the point: a reader (or a `grep` over a workflow log) must not be able to
    // see a percentage beside an unmeasured cell, because that is the artifact that misled the run this
    // file exists for.
    const verdict = classifyCell({
      requested: 30,
      evaluated: 0,
      loadErrors: new Map([[QUOTA, 30]]),
    });
    const block = formatUnmeasuredBlock('OnlineBoutique', 'RE3', verdict);
    expect(block).toContain('UNMEASURED');
    expect(block).toContain('OnlineBoutique');
    expect(block).toContain('RE3');
    expect(block).toContain('0 of 30');
    expect(block).not.toMatch(/\d+\.\d%/);
  });

  it('refuses to render a measured cell as an unmeasured block', () => {
    const measured: CellMeasurement = { kind: 'measured', requested: 30, evaluated: 30 };
    expect(() => formatUnmeasuredBlock('SockShop', 'RE1', measured)).toThrow(/measured/);
  });
});
