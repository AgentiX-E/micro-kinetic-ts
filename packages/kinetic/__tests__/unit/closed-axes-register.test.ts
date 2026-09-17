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

/**
 * Every `.ts` file in the two source trees, excluding build output and dependencies.
 *
 * The walk is over DIRECTORIES rather than a glob because the repo has no glob helper in this
 * package, and the skip list is the three directories that hold copies of the sources.
 *
 * @param except - A path to leave out. The ratchet below passes its OWN file, because the names it
 *   forbids appear in its list by construction and the check would otherwise be its own
 *   counterexample — measured: it fired on all seven names, all of them here.
 * @returns Every `.ts` file, sorted.
 */
function sourceFiles(except: string): string[] {
  const SKIP = new Set(['node_modules', 'dist', 'coverage', '.nx', 'tmp', '.turbo']);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(resolve(dir, entry.name));
      } else if (entry.name.endsWith('.ts')) {
        const path = resolve(dir, entry.name);
        if (path !== except) found.push(path);
      }
    }
  };
  for (const root of ['packages', 'benchmarks']) walk(resolve(repoRoot, root));
  return found.sort();
}

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

  it('registers every verdict as a ROW, not as a passing mention', () => {
    // The check above is satisfied by the name appearing ANYWHERE in the file, and
    // one document hid behind that: `fse26-httpnet-miss-verdict.md`, 346 lines that
    // closed the whole input-ablation family — five families by bound, the pool by
    // family, the pool by label — carried no row, so an axis it had already
    // measured was re-derived and re-proposed a session later. A row is what a
    // reader scans for an axis; a mention in prose is not, and a doc referenced
    // only in prose cannot be found by anyone looking for the axis.
    const rowText = tableRows().flat().join(' ');
    const orphaned = verdictDocs().filter((name) => !rowText.includes(name));
    expect(orphaned).toEqual([]);
  });

  it('closes every axis with a measurement, never with an argument', () => {
    // The third column is "the number that closed it". An empty one means the
    // axis was closed by reasoning, and reasoning is what this register replaces.
    const rows = tableRows();
    expect(rows.length).toBeGreaterThanOrEqual(verdictDocs().length);
    const unmeasured = rows.filter((cells) => cells[2]!.length === 0).map((cells) => cells[0]);
    expect(unmeasured).toEqual([]);
  });

  it('keeps a RETIRED axis retired, in code as well as in prose', () => {
    // The register's rows are prose, and one of them closed its axis by REMOVING code: the two
    // LLM-coupled ranking slices and the two ablation flags behind them. A row cannot stop a layer
    // from coming back, and this layer is exactly the kind a later session re-proposes — it WAS
    // re-proposed, from a record that lived outside this repo.
    //
    // The check is a RATCHET, not a prohibition on LLM code: `packages/optimize`'s advisor, the
    // embedding providers and the semantic-alignment CONTRACT are retained and legal, so only the
    // retired RANKING slice's own symbols are forbidden. Measured before writing it: every name
    // below returns zero matches OUTSIDE this file, and all seven returned exactly one match inside
    // it — which is why the walk excludes it.
    const RETIRED = [
      'RerankingEngine',
      'InvestigatorEngine',
      'InvestigatorToolkit',
      'EvidenceGroundedReranker',
      'IRootCauseReranker',
      'llmReranker',
      'agenticInvestigation',
    ];
    const offenders = sourceFiles(fileURLToPath(import.meta.url)).flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return RETIRED.filter((name) => text.includes(name)).map((name) => `${name} in ${path}`);
    });
    // The failure message names the register's row, so a developer who trips this reads the
    // measurement that closed the axis before re-adding it.
    expect(offenders, 'retired LLM ranking layer — see the register row on it').toEqual([]);
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
