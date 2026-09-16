/**
 * Guards on the RCAEval runner's DEFAULT configuration.
 *
 * `run-rcaeval.ts` is a CLI script that calls `main()` at import time, so it cannot
 * be imported by a test — and the values that decide what a bare dispatch measures
 * are exactly the ones no engine-level assertion can see. They are therefore read
 * as TEXT, the same way `fse26-reported-config.test.ts` reads the FSE'26 runner's:
 * the defect being guarded against is a default that disagrees with the engine's,
 * which is invisible from both sides individually.
 *
 * The specific defect, and why it mattered enough to guard: this runner pinned
 * `temporalWeight` to a literal `0` — which is the term's ABLATION — while carrying
 * the engine's defaults for the latency weight and the pool penalty. The moment the
 * engine's own default became non-zero, that pin would have kept the golden 9-cell
 * byte-identical for a reason that has nothing to do with the signal being
 * harmless, i.e. the gate would have reported "no effect" while never running the
 * configuration it claims to gate.
 *
 * @module benchmarks/__tests__/rcaeval-reported-config.test
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const RUNNER_PATH = resolve(REPO_ROOT, 'benchmarks/src/run-rcaeval.ts');
const PRUNER_PATH = resolve(REPO_ROOT, 'packages/tree/src/pruning/pruner.ts');

/**
 * Drop comments before matching.
 *
 * Required, and the reason is self-referential: an explanation of a defect quotes the
 * defect. A comment saying "an inline `parseFloat(x) || 0` reads an empty flag as
 * zero" is text this file's own pattern matches, so a guard reading the raw source
 * fails on the sentence documenting the fix. A guard that fires on prose is a guard
 * someone deletes; the code is what it is about.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('RCAEval runner configuration ownership', () => {
  const source = code(readFileSync(RUNNER_PATH, 'utf8'));
  const pruner = code(readFileSync(PRUNER_PATH, 'utf8'));

  it('declares both temporal defaults as the engine constants, not as literals', () => {
    // A literal here is a second owner of a value the engine already ships, and the
    // two can only drift silently: this runner prints a confident Top@1 either way.
    expect(source).toMatch(/temporalWeight:\s*DEFAULT_TEMPORAL_WEIGHT\b/);
    expect(source).toMatch(/onsetShape:\s*DEFAULT_ONSET_SHAPE\b/);
    // And no numeric literal, which is how the pin read before this guard existed.
    expect(source).not.toMatch(/temporalWeight:\s*[-\d]/);
    expect(source).not.toMatch(/onsetShape:\s*'/);
  });

  it('imports those constants from the engine rather than redeclaring them', () => {
    // The import is what makes them the SAME value: a local `const
    // DEFAULT_TEMPORAL_WEIGHT = 0` would satisfy the assertion above while being a
    // copy with nothing keeping it equal to the engine's.
    const imports =
      /import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/packages\/tree\/src\/pruning\/pruner\.js'/;
    const names = imports.exec(source)?.[1] ?? '';
    expect(names).toContain('DEFAULT_TEMPORAL_WEIGHT');
    expect(names).toContain('DEFAULT_ONSET_SHAPE');
    // No redeclaration anywhere in either file.
    expect(source).not.toMatch(/const\s+DEFAULT_TEMPORAL_WEIGHT\b/);
    expect(source).not.toMatch(/const\s+DEFAULT_ONSET_SHAPE\b/);
    expect(pruner).toMatch(/export const DEFAULT_TEMPORAL_WEIGHT\b/);
    expect(pruner).toMatch(/export const DEFAULT_ONSET_SHAPE\b/);
  });

  it('falls back to the SHIPPED pair on an unusable flag value', () => {
    // `parseWeight(raw, shipped)`, so a malformed value reproduces a published
    // configuration; and the shape falls back like every other mode flag.
    expect(source).toMatch(/parseWeight\(args\[\+\+i\]!, DEFAULT_TEMPORAL_WEIGHT\)/);
    expect(source).toMatch(/isOnsetShape\(shape\)\s*\?\s*shape\s*:\s*DEFAULT_ONSET_SHAPE/);
  });

  it('leaves no inline weight parse behind, which would fall back to zero', () => {
    // `parseFloat(x) || 0` reads an empty flag as the value zero. For `--log-weight`
    // the runner's own default is 1.0, so that path ran the log-OFF ablation under a
    // dispatch that supplied no value at all.
    expect(source).not.toMatch(/parseFloat\([^)]*\)\s*\|\|\s*0/);
  });

  it('forwards the shape into the pruner, and prints what it used', () => {
    // Two halves of the same claim. Forwarding is what makes the flag real; printing
    // is what makes the artifact evidence of which configuration produced the cells,
    // and this runner's artifact is a published number's provenance.
    expect(source).toMatch(/createContainer\(\{[\s\S]{0,200}?onsetShape:\s*opts\.onsetShape/);
    // The container's parameter type has to carry it too: the object it builds is the
    // engine's option object, so a field missing from the type is a field the caller
    // cannot pass and TypeScript cannot miss.
    expect(source).toMatch(
      /function createContainer\(weights:\s*\{[\s\S]{0,200}?onsetShape:\s*OnsetShape/,
    );
    expect(source).toMatch(/onsetShape: \$\{opts\.onsetShape\}/);
  });
});
