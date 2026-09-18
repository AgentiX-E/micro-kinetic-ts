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
 * The fence used to key on the FILENAME (`*-verdict.md`), and that is the defect
 * this file now also guards against: nine documents that close axes were invisible
 * to it — `re3-fault-ceiling.md` (collision/`ratioContrib`, `topoSource`,
 * trace-activity, drop-symmetrisation), `reverse-propagation-falsified.md` (the
 * last architecture lever), `re3-log-ceiling.md` (the LLM code-level direction) and
 * six more — and a session that began by reading the register re-proposed one of
 * them. A closure claim is read from the DOCUMENT now, because a name is not a
 * claim, and a claim owes a ROW.
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
const REGISTER_NAME = 'closed-axes-register.md';

const register = readFileSync(REGISTER_PATH, 'utf8');

/** Whether a heading DECLARES that a direction is closed. */
function declaresClosure(heading: string): boolean {
  return /falsified|ceiling/i.test(heading);
}

/** A document's first H1, or `''` when it has none. */
function headingOf(text: string): string {
  return text.split('\n').find((line) => line.startsWith('# ')) ?? '';
}

/** Every document in `docs/`, sorted. */
function docNames(): string[] {
  return readdirSync(DOCS)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

/** A document, as the two rules below see it: its name and the claim its heading makes. */
interface DocumentClaim {
  readonly name: string;
  readonly heading: string;
}

/**
 * The documents that DECLARE a closed direction and own no register row.
 *
 * A pure function of the claims rather than a walk of the directory, so that the two ways this rule can go
 * wrong are both testable without a fixture on disk: reading the NAME instead of the claim — which is the
 * defect the rule exists to replace, a naming convention — and declaring nothing an offender, a vacuous
 * filter that would pass on any register.
 *
 * @param docs - Each document's name and heading.
 * @param registered - The register's table text, which is where a row is.
 * @returns The names that declare a closure and are not rowed.
 */
function closureOffenders(docs: readonly DocumentClaim[], registered: string): string[] {
  return docs
    .filter((doc) => declaresClosure(doc.heading))
    .filter((doc) => !registered.includes(doc.name))
    .map((doc) => doc.name);
}

/**
 * The documents whose NAME claims a closure their heading does not.
 *
 * @param docs - Each document's name and heading.
 * @returns The names that claim more than the document does.
 */
function nameOnlyClaims(docs: readonly DocumentClaim[]): string[] {
  return docs
    .filter((doc) => declaresClosure(doc.name))
    .filter((doc) => !declaresClosure(doc.heading))
    .map((doc) => doc.name);
}

/** Every document's name and heading, as the rules consume them. */
function documentClaims(): DocumentClaim[] {
  return docNames().map((name) => ({
    name,
    heading: headingOf(readFileSync(resolve(DOCS, name), 'utf8')),
  }));
}

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
  // The name has to be read WHOLE, capitals included: the extractor used to be `[a-z0-9-]+\.md`, which
  // matched from the first lowercase run of a camelCase name onwards, so `logicHttpJoint-falsified.md` was
  // read as `oint-falsified.md` and reported as a dangling reference the moment a row named it. Every doc
  // name in this repo starts with a letter, so the pattern anchors there and stops at the extension.
  return [...new Set([...register.matchAll(/([A-Za-z0-9][A-Za-z0-9_-]*\.md)/g)].map((m) => m[1]!))]
    .filter((name) => name !== REGISTER_NAME)
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

/** The register's table text, which is what a reader scans for an axis. */
function rowText(): string {
  return tableRows().flat().join(' ');
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

  it('reads a referenced document name WHOLE, capitals included', () => {
    // The extractor this replaces was `[a-z0-9-]+\.md`, so a camelCase name matched
    // from its first lowercase run: `logicHttpJoint-falsified.md` was read as
    // `oint-falsified.md` and reported as a dangling reference — a false positive
    // that stayed invisible only because no row had ever named a camelCase document.
    const read = (text: string): string[] =>
      [...text.matchAll(/([A-Za-z0-9][A-Za-z0-9_-]*\.md)/g)].map((m) => m[1]!);
    expect(read('see `fse26-logicHttpJoint-falsified.md` for the numbers')).toEqual([
      'fse26-logicHttpJoint-falsified.md',
    ]);
    expect(read('see `joint-falsified.md`')).toEqual(['joint-falsified.md']);
    expect(read('see `docs/re3-fault-ceiling.md`')).toEqual(['re3-fault-ceiling.md']);
  });

  it('registers every verdict as a ROW, not as a passing mention', () => {
    // The check above is satisfied by the name appearing ANYWHERE in the file, and
    // one document hid behind that: `fse26-httpnet-miss-verdict.md`, 346 lines that
    // closed the whole input-ablation family — five families by bound, the pool by
    // family, the pool by label — carried no row, so an axis it had already
    // measured was re-derived and re-proposed a session later. A row is what a
    // reader scans for an axis; a mention in prose is not, and a doc referenced
    // only in prose cannot be found by anyone looking for the axis.
    const text = rowText();
    const orphaned = verdictDocs().filter((name) => !text.includes(name));
    expect(orphaned).toEqual([]);
  });

  it('registers every document that DECLARES a closed direction', () => {
    // The defect this test exists for, measured: the fence keyed on the FILENAME
    // (`*-verdict.md`) and NINE documents that close axes were invisible to it, so
    // the register did not contain the word `collision` at all while
    // `re3-fault-ceiling.md` had measured `ratioContrib` reversed on 9 of 10 SS RE3
    // failures. A session that began by reading the register then proposed the
    // closed axis again — the same failure the register was written for, one level
    // up, because the fence was a naming convention rather than a claim.
    //
    // The claim is read from the DOCUMENT now: a heading saying `falsified` or
    // `ceiling` is a declaration that a direction is closed, and it owes a ROW.
    expect(closureOffenders(documentClaims(), rowText())).toEqual([]);
  });

  it('never lets a FILE NAME claim more than the document itself does', () => {
    // The same defect one step removed: a name ending in `falsified` while the
    // document claims nothing is a closure nobody can find by reading, and the
    // fence above would miss it. A name is not a claim — so when a name makes one,
    // the document has to make it too.
    expect(nameOnlyClaims(documentClaims())).toEqual([]);
  });

  it('reads the claim from the heading, and never from the document name', () => {
    // Both rules are pure functions of the names and headings, and these are the
    // synthetic cases that keep them from decaying into the convention they
    // replaced: a name alone is not a claim (row 1), a claim alone is one (row 2),
    // and an offender is only an offender when the register has no row for it.
    const docs = [
      { name: 'named-falsified.md', heading: '# A document that claims nothing at all' },
      { name: 'neutral.md', heading: '# X — falsified by readback' },
      { name: 'rowed.md', heading: '# Silent-Source Fault Ceiling' },
    ];
    // A name that says `falsified` while the heading does not is the NAME-ONLY claim …
    expect(nameOnlyClaims(docs)).toEqual(['named-falsified.md']);
    // … and the closure rule must not be satisfied by it, nor miss the real claim.
    expect(closureOffenders(docs, 'see rowed.md and nothing else')).toEqual(['neutral.md']);
    // And the real population is the one being checked: ten headings declare a closure today, so a
    // `headingOf` that stopped reading would make the rule above pass while checking nothing.
    const declared = documentClaims().filter((doc) => declaresClosure(doc.heading));
    expect(declared.length).toBeGreaterThanOrEqual(9);
  });

  it('names every document it holds, so no record is invisible', () => {
    // The register is the one document a session is told to read first. A record it
    // does not name is a record nobody finds, and thirteen were in that state — the
    // type-check audits, the SOTA calibration, the PRISM head-to-head, the FSE'26
    // converter integrity verdict. Naming them is not a claim about their axes; it
    // is the map that makes them reachable.
    const missing = docNames().filter((name) => name !== REGISTER_NAME && !register.includes(name));
    expect(missing).toEqual([]);
  });

  it('decides a closure from the heading, never from the file name', () => {
    // The fence must not become the filename convention it replaced, so the
    // predicate is a pure function and this pins both directions of it.
    expect(declaresClosure('# X — falsified by readback')).toBe(true);
    expect(declaresClosure('# Silent-Source Fault Ceiling')).toBe(true);
    expect(declaresClosure('# FSE26 `logicHttpJoint` — FALSIFIED (relative gate)')).toBe(true);
    expect(declaresClosure('# PRISM Head-to-Head Readback (P0b)')).toBe(false);
    expect(declaresClosure('# A document whose file name says it closes something')).toBe(false);
    expect(headingOf('no heading here\n')).toBe('');
  });

  it('applies its rules to a population that is actually read', () => {
    // Every rule above is a filter over a list, so a list that came back EMPTY would satisfy all of them
    // while checking nothing — the vacuous-assertion failure this repo has already paid for once. The
    // floors are not targets: they are what the directory holds (measured: 51 documents, 23 of them
    // `*-verdict.md`), asserted so a read that breaks cannot read as a register that is complete.
    expect(docNames().length).toBeGreaterThanOrEqual(40);
    expect(verdictDocs().length).toBeGreaterThanOrEqual(20);
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
