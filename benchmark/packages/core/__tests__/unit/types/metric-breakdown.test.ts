/**
 * Guards on the public declaration of the metric score breakdown.
 *
 * The breakdown is the shape three separate readers consume — the FSE'26 formatter, the dump
 * parser and the separator screen — and THREE of its seven fields hold BONUSES rather than the
 * statistics their names claim: `trend` is `trendStrength × 0.15`, `cv` is `min(cv, 1.5) × 0.05`
 * and `burst` is `deviation × 0.1`. The tree package documents that; the public declaration in
 * `core` described the object as a "Raw feature-score decomposition" next to seven undecorated
 * field names, and a reader took the names at face value — which is how a screen came to treat a
 * clamped, bimodal bonus as a coefficient of variation.
 *
 * The checks below are STRUCTURAL rather than textual: a bare field is a failure whatever it is
 * named, so the guard cannot be satisfied by rewording a comment.
 *
 * @module __tests__/unit/types/graph
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../../../src/types/graph.ts', import.meta.url)),
  'utf8',
);

/** The declared interface's body, or a failure naming what is missing. */
function breakdownBody(): string {
  const start = SOURCE.indexOf('export interface MetricScoreBreakdown');
  expect(start).toBeGreaterThan(-1);
  const open = SOURCE.indexOf('{', start);
  const close = SOURCE.indexOf('\n}', open);
  expect(close).toBeGreaterThan(open);
  return SOURCE.slice(open + 1, close);
}

/** The fields the interface declares, in declaration order. */
function fieldNames(): string[] {
  return [...breakdownBody().matchAll(/^\s+readonly (\w+):/gm)].map((m) => m[1]!);
}

describe('MetricScoreBreakdown — the public declaration', () => {
  it('declares every field the producers actually write', () => {
    // Seven of the eight: `collapseDiscount` is the tree package's addition, and the two
    // declarations are kept compatible by inheritance rather than by hand.
    expect(fieldNames()).toEqual([
      'deviation',
      'trend',
      'cv',
      'burst',
      'riseRatio',
      'dropRatio',
      'baselineMean',
    ]);
  });

  it('documents every field, because three of them are BONUSES', () => {
    // The defect this exists for: `cv` is `min(cv, 1.5) × 0.05`, so it is confined to
    // `{0} ∪ [0.025, 0.075]` — measured on the first 409 cases of run 35107871516, 20.36% of
    // services sit at exactly 0 and 23.24% at exactly the 0.075 ceiling. A reader who takes the
    // name for the statistic concludes "bimodal dispersion" from a clamped bonus.
    const lines = breakdownBody().split('\n');
    const undocumented: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s+readonly \w+:/.test(lines[i]!)) continue;
      const previous =
        lines
          .slice(0, i)
          .reverse()
          .find((l) => l.trim().length > 0) ?? '';
      if (!previous.trim().endsWith('*/')) undocumented.push(lines[i]!.trim());
    }
    expect(undocumented).toEqual([]);
  });

  it('names the formula of each bonus, not just its name', () => {
    // A doc that repeats the field's name is not a doc. The three bonuses are the fields whose
    // names are the statistics, so the formula is the only thing that says what they hold.
    const body = breakdownBody();
    expect(body).toContain('min(cv, 1.5) × 0.05');
    expect(body).toContain('trendStrength × 0.15');
    expect(body).toContain('deviation × 0.1');
  });
});
