/**
 * The corpus traversal's ORDER: one owner, and a property that is a function of the SET.
 *
 * ## The defect this file exists for
 *
 * Two of the repository's eleven corpus traversals returned `readdirSync` order — `discoverAllCases` in
 * `run-rcaeval.ts` and again in `run-ablation.ts` — while every sibling (`run-fse26.ts`, `run-optimize.ts`,
 * `scripts/run-prism.ts`, all four dump scripts) canonicalised. **The two that did not are the two whose
 * `slice(0, maxCases)` decides a PUBLISHED case set**, so a capped run's population was a property of the
 * filesystem rather than of the corpus: the same command on the same data could rank a different 50 of RE2's
 * 90 cases on another machine. `docs/benchmark-corpus-completeness.md` and `ABLATION_FINDINGS.md` v8 both
 * register the symptom; this module is the owner that makes it unrepresentable.
 *
 * ## Why the property is tested with an INJECTED traversal
 *
 * The claim is not "the output happens to be sorted on this filesystem" — that would be a fact about APFS.
 * The claim is **the order is a function of the SET, not of the traversal**, and the only way to assert that
 * is to hand the walk two different permutations of one directory and require the same answer. The default
 * reader is `readdirSync`, whose order is deliberately unspecified, so the test supplies the scrambles rather
 * than hoping the filesystem produces one.
 *
 * The runners themselves call `main()` at import time (recorded in `run-rcaeval.ts`'s own note), so they cannot
 * be imported to compare against — the walk is exported and proven here, and
 * `case-traversal-census.test.ts` ties every runner's traversal to it by source.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// `compareCasePaths` comes from its OWNER, not re-exported through the walk: a second name for one value is
// the alias defect iteration 98 closed, and an alias is not an owner a census can resolve.
import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import {
  discoverCaseMetas,
  walkCaseDirectories,
  type WalkDirent,
} from '../src/case-corpus-walk.js';

/** A `Dirent` stand-in, so a traversal can be supplied rather than read. */
function dirent(name: string, kind: 'dir' | 'file'): WalkDirent {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  };
}

/**
 * A corpus as a directory → entries map, walked by an injected reader.
 *
 * The reader is what a filesystem is here: an arbitrary order with no obligation to be sorted, which is the
 * whole reason the walk must not depend on it.
 */
function readerOf(tree: Readonly<Record<string, readonly WalkDirent[]>>) {
  return (dir: string): readonly WalkDirent[] => {
    const entries = tree[dir];
    if (entries === undefined) throw new Error(`ENOENT: ${dir}`);
    return entries;
  };
}

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the canonical order', () => {
  it('is code-unit order, and is NOT `localeCompare`', () => {
    // Two facts, and the second is the one that matters: `localeCompare` answers from ICU and the active
    // locale, which are MACHINE STATE rather than properties of the two strings. `'é'` against `'z'` is the
    // smallest pair where the two disagree — code units put `z` (U+007A) first, collation puts `é` first.
    expect(compareCasePaths('a', 'b')).toBeLessThan(0);
    expect(compareCasePaths('b', 'a')).toBeGreaterThan(0);
    expect(compareCasePaths('same', 'same')).toBe(0);
    expect(compareCasePaths('é', 'z')).toBeGreaterThan(0);
    expect(
      'é'.localeCompare('z'),
      'the pair must actually distinguish the two orders',
    ).toBeLessThan(0);
  });

  it('puts every upper-case letter before every lower-case one, and a digit before a letter', () => {
    // The reason this matters on a real corpus: RCAEval case directories are `re1ob_*`-shaped, and a reader
    // that compares case-insensitively interleaves them differently than the raw bytes do. The canonical
    // order is the byte one, so it is stable no matter which collation a machine ships.
    expect(compareCasePaths('re2ob_A', 're2ob_a')).toBeLessThan(0);
    expect(compareCasePaths('re2ob_0', 're2ob_A')).toBeLessThan(0);
    expect(compareCasePaths('re2ob_10', 're2ob_9')).toBeLessThan(0);
  });
});

describe('the walk', () => {
  const ROOT = '/corpus';
  const tree = {
    [ROOT]: [dirent('re2tt', 'dir'), dirent('re1ob', 'dir'), dirent('.hidden', 'dir')],
    [`${ROOT}/re1ob`]: [
      dirent('case-b', 'dir'),
      dirent('metrics.json', 'file'),
      dirent('case-a', 'dir'),
    ],
    [`${ROOT}/re2tt`]: [dirent('metrics.json', 'file')],
  } as Record<string, readonly WalkDirent[]>;

  it('is a function of the SET, not of the traversal', () => {
    // The property, in one assertion pair: two DIFFERENT traversal orders over one directory yield the SAME
    // result array. Everything else in this file is a corollary.
    const forwards = walkCaseDirectories({
      root: ROOT,
      marker: 'metrics.json',
      readdir: readerOf(tree),
    });
    const backwards = walkCaseDirectories({
      root: ROOT,
      marker: 'metrics.json',
      readdir: readerOf({
        ...tree,
        [ROOT]: [...tree[ROOT]!].reverse(),
        [`${ROOT}/re1ob`]: [...tree[`${ROOT}/re1ob`]!].reverse(),
      }),
    });
    expect(backwards).toEqual(forwards);
    expect(forwards).toEqual([`${ROOT}/re1ob`, `${ROOT}/re2tt`]);
  });

  it('is canonical by construction, so the ORDER is checkable without knowing the traversal', () => {
    const found = walkCaseDirectories({
      root: ROOT,
      marker: 'metrics.json',
      readdir: readerOf(tree),
    });
    expect(found).toEqual([...found].sort(compareCasePaths));
  });

  it('treats a marked directory as TERMINAL — a case is not descended into', () => {
    // A suite directory can itself carry the marker in a mis-assembled corpus, and descending would report
    // both the parent and its children as cases. The terminal rule is what makes the population a partition.
    const nested = {
      [ROOT]: [dirent('metrics.json', 'file'), dirent('inner', 'dir')],
      [`${ROOT}/inner`]: [dirent('metrics.json', 'file')],
    } as Record<string, readonly WalkDirent[]>;
    expect(
      walkCaseDirectories({ root: ROOT, marker: 'metrics.json', readdir: readerOf(nested) }),
    ).toEqual([ROOT]);
  });

  it('prunes dot-directories, so a stray `.git` cannot contribute a case', () => {
    const dotted = {
      [ROOT]: [dirent('.git', 'dir'), dirent('real', 'dir')],
      [`${ROOT}/.git`]: [dirent('metrics.json', 'file')],
      [`${ROOT}/real`]: [dirent('metrics.json', 'file')],
    } as Record<string, readonly WalkDirent[]>;
    expect(
      walkCaseDirectories({ root: ROOT, marker: 'metrics.json', readdir: readerOf(dotted) }),
    ).toEqual([`${ROOT}/real`]);
  });

  it('returns EMPTY rather than throwing when the root cannot be read', () => {
    // A missing corpus is a caller's error to report — `run-rcaeval.ts` prints one — and a walk that threw
    // would make the diagnostic unreachable, which is the failure identical to reading nothing.
    expect(
      walkCaseDirectories({ root: '/nope', marker: 'metrics.json', readdir: readerOf(tree) }),
    ).toEqual([]);
  });

  it('reads a real directory tree through the default reader', () => {
    // The injected arms above prove the property; this one proves the DEFAULT reader is wired to the walk,
    // so the two are not tested separately and shipped together untested.
    const root = mkdtempSync(join(tmpdir(), 'case-walk-'));
    created.push(root);
    mkdirSync(join(root, 're3tt'));
    mkdirSync(join(root, 're1ob'));
    writeFileSync(join(root, 're3tt', 'metrics.json'), '{}');
    writeFileSync(join(root, 're1ob', 'metrics.json'), '{}');
    mkdirSync(join(root, 'not-a-case'));
    const found = walkCaseDirectories({ root, marker: 'metrics.json' });
    expect(found).toEqual([join(root, 're1ob'), join(root, 're3tt')]);
  });
});

describe('case discovery over the walk', () => {
  const ROOT = '/corpus';
  const tree = {
    [ROOT]: [dirent('b', 'dir'), dirent('a', 'dir'), dirent('c', 'dir')],
    [`${ROOT}/a`]: [dirent('metrics.json', 'file')],
    [`${ROOT}/b`]: [dirent('metrics.json', 'file')],
    [`${ROOT}/c`]: [dirent('metrics.json', 'file')],
  } as Record<string, readonly WalkDirent[]>;

  it('keeps the canonical order of the directories it parsed', () => {
    // The shape a runner uses: walk, then parse each. The ORDER of the metas is the walk's, so a `slice(0, n)`
    // selects a set that is a property of the corpus.
    const metas = discoverCaseMetas({
      root: ROOT,
      marker: 'metrics.json',
      parse: (dir) => ({ dirPath: dir, id: dir.slice(-1) }),
      readdir: readerOf(tree),
    });
    expect(metas.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(metas.map((m) => m.dirPath)).toEqual([`${ROOT}/a`, `${ROOT}/b`, `${ROOT}/c`]);
  });

  it('DROPS an unparseable directory without disturbing the order of the rest', () => {
    // `parseCaseDir` returns `null` for a directory whose name it cannot read (that is how RE1/RE2/RE3 are
    // told apart). Dropping in place is the behaviour the runners had, and the survivors stay canonical.
    const metas = discoverCaseMetas({
      root: ROOT,
      marker: 'metrics.json',
      parse: (dir) => (dir.endsWith('/b') ? null : { dirPath: dir }),
      readdir: readerOf(tree),
    });
    expect(metas.map((m) => m.dirPath)).toEqual([`${ROOT}/a`, `${ROOT}/c`]);
  });

  it('returns an EMPTY list for a corpus with no marked directory', () => {
    const bare = { [ROOT]: [dirent('x', 'dir')] } as Record<string, readonly WalkDirent[]>;
    const metas = discoverCaseMetas({
      root: ROOT,
      marker: 'metrics.json',
      parse: (dir) => ({ dirPath: dir }),
      readdir: readerOf(bare),
    });
    expect(metas).toEqual([]);
  });
});
