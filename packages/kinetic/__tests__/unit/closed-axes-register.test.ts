/**
 * Guards on the closed-axes register.
 *
 * The register exists because an axis was re-proposed after it had been measured
 * and closed — three times. A hand-maintained list would rot the same way, so the
 * checks here are structural: a verdict document that is not registered fails, a
 * reference to a document that does not exist fails, and a row whose "the number
 * that closed it" cell is empty fails.
 *
 * That last one is the point of the whole file. An axis closed by argument rather
 * than by measurement does not belong in this register, and this test is the only
 * thing that can tell the two apart.
 *
 * @module __tests__/unit/closed-axes-register
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const DOCS = resolve(repoRoot, 'docs');
const REGISTER_PATH = resolve(DOCS, 'closed-axes-register.md');

const register = readFileSync(REGISTER_PATH, 'utf8');

/** The verdict documents that exist on disk. */
function verdictDocs(): string[] {
  return readdirSync(DOCS)
    .filter((name) => name.endsWith('-verdict.md'))
    .sort();
}

/** Every `docs/<name>.md` the register refers to by name. */
function referencedDocs(): string[] {
  return [...new Set([...register.matchAll(/([a-z0-9-]+\.md)/g)].map((m) => m[1]!))]
    .filter((name) => name !== 'closed-axes-register.md')
    .sort();
}

/** The register's table rows, as cells with the leading/trailing pipes removed. */
function tableRows(): string[][] {
  return register
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length === 4 && !cells[1]!.startsWith('---'))
    .filter((cells) => cells[0] !== 'axis');
}

describe('closed-axes register', () => {
  it('registers every verdict document that exists', () => {
    // A new verdict that is not registered is an axis nobody will read before
    // re-proposing it, which is the exact failure this file was written for.
    const missing = verdictDocs().filter((name) => !register.includes(name));
    expect(missing).toEqual([]);
  });

  it('names only documents that exist', () => {
    // A dangling reference sends a reader to a file that is not there, which is
    // worse than no reference.
    const existing = new Set(readdirSync(DOCS));
    const dangling = referencedDocs().filter((name) => !existing.has(name));
    expect(dangling).toEqual([]);
  });

  it('closes every axis with a measurement, never with an argument', () => {
    // The third column is "the number that closed it". An empty one means the
    // axis was closed by reasoning, and reasoning is what this register replaces.
    const rows = tableRows();
    expect(rows.length).toBeGreaterThanOrEqual(verdictDocs().length);
    const unmeasured = rows.filter((cells) => cells[2]!.length === 0).map((cells) => cells[0]);
    expect(unmeasured).toEqual([]);
  });

  it('states the kill criterion in full, both halves', () => {
    // A register that loses half the criterion is worse than none: it would let a
    // candidate optimise the headline and ignore the regressions.
    expect(register).toContain('RCAEval golden 9-cell byte-identical');
    expect(register).toContain('zero regressed fault types');
  });

  it('points a reader at the two invariants that make a measurement readable', () => {
    // Both were found the hard way: a signal with no input reports the same
    // headline as a signal with no effect, and a dump whose order disagrees with
    // its own terms reports `unexplained`.
    expect(register).toContain('Data: failed edges in');
    expect(register).toContain('unexplained');
  });
});
