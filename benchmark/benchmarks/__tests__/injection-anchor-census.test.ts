/**
 * The injection-boundary census: what the report says about where a case's split came from.
 *
 * ## Why the census is a gate and not a print
 *
 * `latency-routes` has counted `no anchor` since iteration 89, and that count was exact while an unusable
 * boundary and a ZERO boundary were the same fact. They are not the same fact any more: the loader repairs a
 * boundary the corpus failed to write, so a case that used to print `no anchor` now prints a positive anchor it
 * INFERRED — and a census that reported only the total would read exactly like a corpus that never had the
 * defect. The corpus's own numbers are the argument: **16 of 735 cases** carry an unusable `inject_time.txt`
 * (14 zero, one truncated by two digits, one naming a boundary 1 456 s after its telemetry ends), and the repair
 * derives a boundary for 15 of them from the span midpoint.
 *
 * The tests below pin three things: the four classes are counted separately, the derived total is the one a
 * reader has to be able to see, and the line is printed on EVERY run — a census that appears only when something
 * is wrong is a census nobody reads on the run that is wrong.
 *
 * @module __tests__/injection-anchor-census.test
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatInjectionAnchors, summarizeInjectionAnchors } from '../src/rcaeval-corpus.js';

describe('summarizeInjectionAnchors', () => {
  it('counts each provenance separately, because they are different claims about the split', () => {
    expect(
      summarizeInjectionAnchors(['declared', 'declared', 'rescaled', 'centred', 'unusable']),
    ).toEqual({ cases: 5, declared: 2, rescaled: 1, centred: 1, unusable: 1 });
  });

  it('reports an empty population as five zeros rather than as an absent line', () => {
    expect(summarizeInjectionAnchors([])).toEqual({
      cases: 0,
      declared: 0,
      rescaled: 0,
      centred: 0,
      unusable: 0,
    });
  });

  it('takes its population size from the entries, never from a second count', () => {
    // The defect this pins: a `cases` field threaded from somewhere else could disagree with the entries, and
    // the disagreement would be invisible in a report whose only job is to say how many of the cases are which.
    const c = summarizeInjectionAnchors(['declared', 'centred', 'centred']);
    expect(c.cases).toBe(c.declared + c.rescaled + c.centred + c.unusable);
  });
});

describe('formatInjectionAnchors', () => {
  it('names the cell, the four classes, and the derived total', () => {
    const line = formatInjectionAnchors(
      summarizeInjectionAnchors(['declared', 'declared', 'declared', 'rescaled', 'centred']),
      'RE1:OnlineBoutique',
    );
    expect(line).toContain('anchor[RE1:OnlineBoutique]');
    expect(line).toContain('5 cases');
    expect(line).toContain('declared 3');
    expect(line).toContain('derived 2');
    expect(line).toContain('rescaled 1');
    expect(line).toContain('centred 1');
    expect(line).toContain('unusable 0');
  });

  it('renders a fully declared cell without inventing a defect', () => {
    const line = formatInjectionAnchors(
      summarizeInjectionAnchors(['declared', 'declared']),
      'RE1:SockShop',
    );
    expect(line).toBe(
      'anchor[RE1:SockShop]: 2 cases | declared 2 | derived 0 (rescaled 0, centred 0) | unusable 0',
    );
  });

  it('keeps the unusable count visible, because those cases split at zero', () => {
    const line = formatInjectionAnchors(summarizeInjectionAnchors(['unusable']), 'RE3:TrainTicket');
    expect(line).toContain('unusable 1');
    expect(line).not.toContain('declared 1');
  });
});

describe('the runner prints the census on every cell', () => {
  const runner = readFileSync(join(import.meta.dirname, '..', 'src', 'run-rcaeval.ts'), 'utf8');

  it('prints it from the same function that prints the channel census it explains', () => {
    const report = runner.slice(runner.indexOf('function reportLatencyRoutes'));
    const body = report.slice(0, report.indexOf('\n}\n'));
    expect(body).toContain('formatInjectionAnchors(stats.anchors');
  });

  it('does not gate the print on a condition, which would hide it on the run that needed it', () => {
    const report = runner.slice(runner.indexOf('function reportLatencyRoutes'));
    const body = report.slice(0, report.indexOf('\n}\n'));
    const anchorLine = body.slice(body.indexOf('formatInjectionAnchors'));
    const before = body.slice(0, body.indexOf('formatInjectionAnchors'));
    // The nearest preceding `if (` must not sit between the last unconditional statement and this line.
    expect(before.slice(before.lastIndexOf('if (')).includes('console.log')).toBe(false);
    expect(anchorLine.length).toBeGreaterThan(0);
  });

  it('carries the provenance out of the loader, so the census is a reading rather than a default', () => {
    expect(runner).toContain("anchorProvenance: rawCase.injectTimeProvenance ?? 'declared'");
  });
});
