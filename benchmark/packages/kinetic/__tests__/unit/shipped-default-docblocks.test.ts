/**
 * A shipped default's docblock is a claim about its VALUE, and this fence is what makes it one.
 *
 * ## The defect that produced this file
 *
 * `DEFAULT_TOPO_DISCOUNT` was documented as *"the shipped topological DISCOUNT — off"* and
 * `DEFAULT_TOPO_DISCOUNT_GATE` as *"no gate … `0` is not a placeholder: it is the ungated operator, which is what
 * the nine published cells were measured with"*. **Both constants are `1`.** The three documents that quote them
 * (`docs/topo-discount-gate.md`, `docs/anomaly-space.md` §6 and the workflow's own `anomaly_knobs` description)
 * agree with the docblocks, so a reader reproducing the published figure from the documentation would run the
 * UNGATED operator — which `docs/anomaly-space.md` itself measures at **635/735**, six cases below the 641 the
 * document is about.
 *
 * ## Why the value is right and the prose was wrong
 *
 * The published `641` is what the defaults produce: the dispatch that anchors it prints
 * `topoDiscount=1 topoDiscountGate=1`, and this suite's own control run reproduces the nine cells from them. At
 * `gate = 1` a node is charged only where its callees account for ALL of its anomaly, so the charge almost never
 * fires and the operator is inert *in practice* while `rho` is `1` *in configuration* — which is exactly the
 * coincidence that let two docblocks say "off" for a year without a number moving. Moving the constants to `0`
 * would not be a documentation fix: it would publish 635.
 *
 * ## What is asserted
 *
 * For each named constant: the docblock immediately above it may not claim the opposite of its value. The rule is
 * stated on the two phrases the two docblocks actually used, because a general "does this prose agree with this
 * number" test is not decidable — but a constant that is `1` may not be called `off`, and a gate that is `1` may
 * not be called `no gate`, and those two sentences were the whole of the defect.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TOPO_DISCOUNT, DEFAULT_TOPO_DISCOUNT_GATE } from '@agentix-e/micro-kinetic-tree';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PRUNER = readFileSync(resolve(REPO_ROOT, 'packages/tree/src/pruning/pruner.ts'), 'utf8');

/**
 * The docblock that immediately precedes a named export.
 *
 * @param name - The exported identifier.
 * @returns Its docblock, or an empty string when the export carries none.
 */
function docblock(name: string): string {
  const at = PRUNER.indexOf(`export const ${name} =`);
  expect(at, `${name} is declared in the pruner`).toBeGreaterThan(0);
  const open = PRUNER.lastIndexOf('/**', at);
  expect(open, `${name} carries a docblock`).toBeGreaterThanOrEqual(0);
  return PRUNER.slice(open, at);
}

describe('a shipped default does not describe itself as its opposite', () => {
  it('reads the two constants at the values the published cells were measured with', () => {
    // Non-vacuity: if a future change moved these, the assertions below would be testing the wrong pair — and
    // moving either one is a MEASURED decision (`docs/topo-discount-gate.md` §7), not a tidy-up.
    expect(DEFAULT_TOPO_DISCOUNT).toBe(1);
    expect(DEFAULT_TOPO_DISCOUNT_GATE).toBe(1);
  });

  it('does not call a discount that is 1 "off"', () => {
    const prose = docblock('DEFAULT_TOPO_DISCOUNT');
    expect(prose.length).toBeGreaterThan(40);
    expect(prose, 'a discount of 1 may not be documented as off').not.toMatch(/—\s*off\b/i);
    expect(prose, 'the docblock states the value it ships').toMatch(/\b1\b/);
  });

  it('does not call a gate that is 1 "no gate", nor cite 0 as what was measured', () => {
    const prose = docblock('DEFAULT_TOPO_DISCOUNT_GATE');
    expect(prose.length).toBeGreaterThan(40);
    expect(prose, 'a gate of 1 may not be documented as no gate').not.toMatch(/\bno gate\b/i);
    expect(prose, 'the docblock states the value it ships').toMatch(/\b1\b/);
    // The sentence that did the damage, asserted as an absence: it named `0` as the measured configuration and
    // the ungated operator as what the nine published cells ran.
    expect(prose).not.toMatch(
      /ungated operator,\s*which is what the nine published cells were measured with/i,
    );
  });
});
