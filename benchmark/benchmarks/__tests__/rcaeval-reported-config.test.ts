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
/**
 * The RCAEval PARSER, which is now its own module.
 *
 * It was inline in the runner, and the runner calls `main()` at import time, so the chain
 * that decides what a bare dispatch measures could not be driven by a test — the same
 * defect the FSE'26 parser was extracted for. The ownership assertions below read BOTH
 * files rather than one: a default is declared in the parser and forwarded in the runner,
 * and a swap to either alone would stop checking half of that.
 */
const CLI_PATH = resolve(REPO_ROOT, 'benchmarks/src/rcaeval-cli.ts');
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
  const source = code(readFileSync(RUNNER_PATH, 'utf8')) + code(readFileSync(CLI_PATH, 'utf8'));
  const pruner = code(readFileSync(PRUNER_PATH, 'utf8'));

  it('declares the decisive-stability default as the engine constant, and forwards it', () => {
    // The term is inert at the engine's default, which is why the golden 9-cell was bit-identical
    // while it was enrolled — and why measuring it on THIS benchmark needs the flag. That makes the
    // runner's default the only thing standing between a bare push and an unmeasured signal, so it
    // is read from the engine rather than restated, exactly like the temporal pair.
    expect(source).toMatch(/stabilityWeight:\s*DEFAULT_STABILITY_WEIGHT\b/);
    expect(source).not.toMatch(/stabilityWeight:\s*[-\d]/);
    // The flag falls back to the SHIPPED value on a malformed one, so a typo reproduces a published
    // configuration instead of measuring a term nobody asked for.
    expect(source).toMatch(/parseWeight\(args\[\+\+i\]!,\s*DEFAULT_STABILITY_WEIGHT\)/);
    // Forwarded into the container, printed, and carried by the container's parameter type: three
    // separate ways for the flag to be accepted and then ignored.
    expect(source).toMatch(
      /createContainer\(\{[\s\S]{0,240}?stabilityWeight:\s*opts\.stabilityWeight/,
    );
    expect(source).toMatch(
      /function createContainer\(weights:\s*\{[\s\S]{0,240}?stabilityWeight:\s*number/,
    );
    expect(source).toMatch(/stabilityWeight=\$\{opts\.stabilityWeight\}/);
  });

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
    // EVERY import group from that module, not the first one: with the parser in its own file there
    // are two, and each names what its own module needs. Reading only the first would have asserted
    // about whichever file came first in the concatenation, which is a page order, not an owner.
    const groups = [
      ...source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/packages\/tree\/src\/pruning\/pruner\.js'/g,
      ),
    ];
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const names = groups.map(([, list]) => list).join(',');
    expect(names).toContain('DEFAULT_TEMPORAL_WEIGHT');
    expect(names).toContain('DEFAULT_ONSET_SHAPE');
    expect(names).toContain('DEFAULT_STABILITY_WEIGHT');
    // No redeclaration anywhere in either file.
    expect(source).not.toMatch(/const\s+DEFAULT_TEMPORAL_WEIGHT\b/);
    expect(source).not.toMatch(/const\s+DEFAULT_ONSET_SHAPE\b/);
    expect(source).not.toMatch(/const\s+DEFAULT_STABILITY_WEIGHT\b/);
    expect(pruner).toMatch(/export const DEFAULT_TEMPORAL_WEIGHT\b/);
    expect(pruner).toMatch(/export const DEFAULT_ONSET_SHAPE\b/);
    expect(pruner).toMatch(/export const DEFAULT_STABILITY_WEIGHT\b/);
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
