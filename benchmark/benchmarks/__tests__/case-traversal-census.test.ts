/**
 * Every corpus traversal in this repository is CANONICAL, and no ordering here answers from the machine.
 *
 * ## The class
 *
 * The repository traverses a case corpus in fifteen places and orders sequences in fourteen more, and until
 * this iteration two conventions lived among them:
 *
 * 1. **Two traversals returned `readdirSync` order** — `discoverAllCases` in `run-rcaeval.ts` and again in
 *    `run-ablation.ts` — while every sibling canonicalised. `readdirSync`'s order is unspecified, and those two
 *    are exactly the ones whose `slice(0, maxCases)` decides a **published case set**: a capped run's population
 *    was a property of the filesystem, so `benchmark-prism-sweep.yml`'s RE2 `--max-cases 50` window (the
 *    frontier document's largest number) rested on a subset two machines could choose differently.
 * 2. **Fourteen sites ordered by `localeCompare`**, which answers from ICU and the active locale — machine
 *    state, not properties of the data — including three LOADERS' suite case orders. `rcaeval-loader.ts` held
 *    both conventions in one file: `localeCompare` on its case list and a hand-rolled `<` comparator on its edge
 *    list, with the reason for `<` written beside it.
 *
 * Both are now one convention, from one owner (`packages/kinetic/src/benchmarks/case-order.ts`), and this file
 * is what keeps it that way. **The census has no exception list**, because a per-site exception is where the
 * class survived the last time: `run-fse26.ts`'s traversal sorted, which made the two that did not look like a
 * convention rather than a defect.
 *
 * ## Why the enclosing function is found by BRACE MATCHING rather than by a line window
 *
 * The first version of this census looked N lines forward from the traversal. That rule cannot see the
 * difference between "this function sorts its output" and "the next function down sorts its output" — and it
 * reported a clean bill of health for a file in which exactly that confusion held. The version here walks
 * backwards to the innermost enclosing `function`/`() {` opener and forwards to its matching brace, so the
 * subject is the function that OWNS the traversal.
 */

import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

/**
 * The roots whose ordering this census is responsible for.
 *
 * Tests are excluded, and the exclusion is a property of the SUBJECT rather than a convenience: a test asserts
 * an order, it does not decide a published population. `benchmarks/__tests__/case-corpus-walk.test.ts` names
 * `localeCompare` in order to assert that the convention DIFFERS from it, which is the opposite of the defect.
 */
const SOURCE_ROOTS = [
  'benchmarks/src',
  'scripts',
  'packages/kinetic/src',
  'packages/tree/src',
  'packages/core/src',
] as const;

/**
 * A source file's text with COMMENT text blanked, and its string literals kept.
 *
 * Comments, because these files explain the convention in prose that names `localeCompare` — a census reading
 * raw text would report the explanation as the offence. Strings kept, because a claim this census asserts is a
 * LITERAL — `marker: 'metrics.json'` — and blanking it would make the assertion unsatisfiable, which is how the
 * first version of this file failed against the very delegation it was written to prove.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (line) => ' '.repeat(line.length));
}

/**
 * The same, with string and template CONTENTS blanked too.
 *
 * Needed wherever a brace is COUNTED, because a brace inside a literal is not a brace: `\`${x}\`` and a `'{'`
 * in a message both moved the count, and the first version of this census therefore chose a `while` loop as
 * "the function that owns the traversal" — a block that never sorts anything, so every site inside one read as
 * uncanonical however the function around it was written.
 */
function withoutCommentsOrStrings(source: string): string {
  // NEWLINES ARE PRESERVED by every arm, which is not tidiness: a multi-line template literal blanked to a
  // single line shifts every line number after it, and the first version of this file reported a site at a line
  // that holds a different statement — a census answering about the wrong row.
  const blankKeepLines = (text: string): string =>
    text
      .split('\n')
      .map((line) => ' '.repeat(line.length))
      .join('\n');
  return withoutComments(source)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (s) => `'${blankKeepLines(s.slice(1, -1))}'`)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (s) => `"${blankKeepLines(s.slice(1, -1))}"`)
    .replace(/`(?:[^`\\]|\\.)*`/gs, (s) => `\`${blankKeepLines(s.slice(1, -1))}\``);
}

/** Blocks that open with a brace but do not OWN a value: the traversal's owner is the enclosing FUNCTION. */
const CONTROL_FLOW = /^\s*\}?\s*(if|else|for|while|do|switch|try|catch|finally)\b/;

/**
 * The innermost enclosing FUNCTION block of `lineIndex`.
 *
 * Walks outward through the enclosing braces — a `readdirSync` inside a `while` is owned by the function holding
 * the `while`, not by the `while` — and stops at the first opener that is not control flow. That distinction is
 * the whole census: a rule that accepts any `) {` line reports the loop, and a loop never sorts anything, so a
 * site inside one reads as uncanonical however the function is written.
 *
 * @param lines - The file, comment- and string-blanked.
 * @param lineIndex - The site's zero-based line.
 * @returns The owning block's first and last line indices, inclusive.
 */
function enclosingBlock(
  lines: readonly string[],
  lineIndex: number,
): { start: number; end: number } | null {
  // The opener is the FIRST `{` on the line the walk settles on, and counting starts AFTER it. Counting from
  // the line's first character is the bug this helper shipped with: a multi-line signature ends in `} {`, so
  // the line opened with a `}` that took the depth to −1 before the body brace brought it back to 0 — and the
  // very next `}` closed the block. It reported a six-line "owner" that stopped before the function's own
  // return statement, i.e. it read a function's canonicalised output as uncanonical.
  let start = -1;
  let depth = 0;
  outer: for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lines[i]!;
    for (let c = line.length - 1; c >= 0; c--) {
      const ch = line[c]!;
      if (ch === '}') depth++;
      else if (ch === '{') {
        if (depth === 0) {
          if (!CONTROL_FLOW.test(line)) {
            start = i;
            break outer;
          }
          depth = 0;
        } else depth--;
      }
    }
  }
  // `-1` means no brace opened before the site: a CONCISE arrow body has no block at all, and returning the
  // whole file instead would hand the rule a window that contains every sort in the module — the weak reading
  // this census exists to avoid.
  if (start < 0) return null;
  let opened = false;
  depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (!opened) {
        if (ch === '{') {
          opened = true;
          depth = 1;
        }
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return { start, end: i };
      }
    }
  }
  return { start, end: lines.length - 1 };
}

/** Every `*.ts` under the census's roots, repo-relative and canonically ordered. */
function sourceFiles(): string[] {
  const found: string[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const path of globSync(`${root}/**/*.ts`, { cwd: repoRoot })) {
      if (path.includes('node_modules') || path.includes('/dist/')) continue;
      found.push(path);
    }
  }
  return found.sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
}

/** A traversal site: the file, the line, and the block that owns it. */
interface TraversalSite {
  readonly file: string;
  readonly line: number;
  /** The owning block's text, or `null` when the traversal is a concise arrow body with no block. */
  readonly block: string | null;
}

/** Every `readdirSync(` call site in the census's roots, with the text of the function that owns it. */
function traversalSites(): TraversalSite[] {
  const sites: TraversalSite[] = [];
  for (const file of sourceFiles()) {
    const lines = withoutCommentsOrStrings(readFileSync(resolve(repoRoot, file), 'utf8')).split(
      '\n',
    );
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes('readdirSync(')) continue;
      const block = enclosingBlock(lines, i);
      sites.push({
        file,
        line: i + 1,
        block: block === null ? null : lines.slice(block.start, block.end + 1).join('\n'),
      });
    }
  }
  return sites;
}

/**
 * The ONE site not expected to canonicalise in place: the default reader in the convention's own module.
 *
 * `case-corpus-walk.ts`'s reader *is* the traversal primitive, and it is a CONCISE arrow — `(dir) =>
 * readdirSync(dir, { withFileTypes: true })` — so it has no block for this rule to read, which is why the rule
 * reports it as the one site it cannot judge. The ORDER is imposed one level up, by `walkCaseDirectories`, and
 * that is proven behaviourally rather than textually: `case-corpus-walk.test.ts` hands the walk two DIFFERENT
 * scrambles of one directory and requires the same array.
 *
 * Naming the FILE (not the line) keeps the exemption from following a line number around, and the census
 * asserts the exempt set is exactly this one entry — so the exemption cannot grow into the per-site allowance
 * that let this class survive the first time. The module is also asserted to contain the canonicalising call, or
 * the exemption would excuse a traversal with nothing above it.
 */
const THE_PRIMITIVE = 'benchmarks/src/case-corpus-walk.ts';

/** Does the block that owns this site canonicalise the sequence it traversed? */
function canonicalises(block: string | null): boolean {
  // A concise arrow body is no block, and it is reported as such rather than read as the whole file.
  if (block === null) return false;
  return (
    block.includes('walkCaseDirectories(') ||
    block.includes('discoverCaseMetas(') ||
    block.includes('inCaseOrder(') ||
    block.includes('compareCasePaths(') ||
    /\.sort\(/.test(block)
  );
}

describe('the corpus traversal population', () => {
  it('is non-empty, and every site canonicalises what it traversed', () => {
    // The population is DERIVED — every `readdirSync` in the source roots — so a sixteenth traversal is covered
    // the day it is written rather than the day someone remembers this file.
    const sites = traversalSites();
    expect(sites.length, 'the traversal population must not be empty').toBeGreaterThan(10);
    const uncanonical = sites.filter((site) => !canonicalises(site.block));
    // The exemption is asserted as an exact set in BOTH directions: exactly one file may be outside the rule,
    // and it must be the primitive.
    const exempt = [...new Set(uncanonical.map((site) => site.file))];
    expect(exempt).toEqual([THE_PRIMITIVE]);
    expect(
      uncanonical.length,
      `${THE_PRIMITIVE} holds exactly one traversal — the primitive itself`,
    ).toBe(1);
    // And the primitive's module must actually impose the order, or the exemption would excuse a non-canonical
    // traversal with nothing above it.
    expect(
      withoutCommentsOrStrings(readFileSync(resolve(repoRoot, THE_PRIMITIVE), 'utf8')),
    ).toContain('inCaseOrder(found,');
  });

  it('covers the two loaders and the diagnostic that were NOT canonical', () => {
    // Non-vacuity in the direction that matters: the sites this iteration repaired must be IN the population,
    // or the census would be asserting over a set the fix removed from it.
    const files = new Set(traversalSites().map((site) => site.file));
    for (const file of [
      'benchmarks/src/run-rcaeval.ts',
      'packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts',
      'packages/kinetic/src/benchmarks/loaders/aiops2025-loader.ts',
      'packages/kinetic/src/benchmarks/loaders/rca100-loader.ts',
      'scripts/run-prism.ts',
      'benchmarks/src/run-fse26.ts',
    ]) {
      expect(files.has(file), `${file} must be in the traversal population`).toBe(true);
    }
    // **`run-ablation.ts` is deliberately NOT in that list, and the reason is this census's own failure mode.**
    // Its traversal now DELEGATES, so it has no `readdirSync` of its own and has LEFT the population — the
    // register's *"routing a read through a clearer failure can move it out of its own census"*, one iteration
    // after that law was written. The delegation is asserted below instead, because a site that leaves a
    // population must arrive in another one or the repair is only a disappearance.
    expect(files.has('benchmarks/src/run-ablation.ts')).toBe(false);
  });
});

describe('the order convention', () => {
  it('has exactly ONE owner, and no call site answers from the machine', () => {
    // Zero exceptions, deliberately. A per-site allow-list is where this class survived: three loaders shared
    // one shape, two of them were converted and one was not, and a list would have recorded that asymmetry as a
    // decision instead of reporting it. `localeCompare` is named in docblocks to explain the convention, so the
    // census reads comment-BLANKED text and the prose is free.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const lines = withoutCommentsOrStrings(readFileSync(resolve(repoRoot, file), 'utf8')).split(
        '\n',
      );
      for (let i = 0; i < lines.length; i++) {
        if (/\.localeCompare\(/.test(lines[i]!)) offenders.push(`${file}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is OWNED in the package the loaders can reach, not restated beside each caller', () => {
    // The layering fact, asserted rather than assumed: the RCAEval loader sorts a SUITE's case directories, so a
    // comparator living in `benchmarks/src` could only be read back from the loader through a dependency
    // inversion — the defect `DEFAULT_FAILED_EDGE_MODE` had in the wrong package with four declaring sites.
    const owner = readFileSync(
      resolve(repoRoot, 'packages/kinetic/src/benchmarks/case-order.ts'),
      'utf8',
    );
    expect(owner).toContain('export function compareCasePaths');
    expect(owner).toContain('export function inCaseOrder');
    // And it is reachable through the package's own barrel, which is how a consumer is meant to get it.
    const barrel = readFileSync(
      resolve(repoRoot, 'packages/kinetic/src/benchmarks/index.ts'),
      'utf8',
    );
    expect(barrel).toContain("export { compareCasePaths, inCaseOrder } from './case-order.js';");
    // No second definition anywhere in the roots: one owner, or the census would be holding two copies to each
    // other and to nothing else.
    const definitions = sourceFiles().filter((file) =>
      /function compareCasePaths|const compareCasePaths/.test(
        withoutCommentsOrStrings(readFileSync(resolve(repoRoot, file), 'utf8')),
      ),
    );
    expect(definitions).toEqual(['packages/kinetic/src/benchmarks/case-order.ts']);
  });

  it('is DELEGATED to by both runners that cap their corpus', () => {
    // The specific repair, asserted so it cannot revert to an in-place `.sort()` that the other runner does not
    // share. Both call `main()` at import time and so cannot be imported and run here — the walk is proven
    // behaviourally in `case-corpus-walk.test.ts`, and this is the tie from each runner to it.
    for (const file of ['benchmarks/src/run-rcaeval.ts', 'benchmarks/src/run-ablation.ts']) {
      const source = withoutComments(readFileSync(resolve(repoRoot, file), 'utf8'));
      // The function's OWN body, so the claim is about this function rather than about the file.
      const body = /function discoverAllCases[\s\S]*?\n}/.exec(source)?.[0] ?? '';
      expect(body, `${file}'s discoverAllCases must exist`).not.toBe('');
      // (a) The walk's result is RETURNED, not post-processed. **This arm exists because the first version of
      // this test was satisfied by a mutant**: assigning the walk to a local, sorting that local by a length
      // comparator the sibling runner does not share, and returning the local still contained the delegation
      // string — so the census passed on exactly the drift it was written to prevent.
      expect(body, `${file} must RETURN the walk's order`).toContain('return discoverCaseMetas(');
      // (b) And it re-orders nothing.
      expect(body, `${file} must not re-order the walk's output`).not.toContain('.sort(');
      // (c) And the walk is the only traversal in it: a `readdirSync` beside it would mean one corpus through
      // the convention and another through the filesystem.
      expect(body).not.toContain('readdirSync(');
    }
  });
});
