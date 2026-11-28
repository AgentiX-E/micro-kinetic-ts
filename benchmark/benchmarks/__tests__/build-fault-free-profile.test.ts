/**
 * Unit tests for the corpus walk and the profile builder.
 *
 * Both are thin, and both are the kind of thin that fails silently: a walk that descends into a case
 * directory evaluates its `case.json` as a corpus root, and a builder that took the wrong cases produces
 * a band that is wrong for every arm reading it. Neither failure throws, which is why they are tested
 * against a real temporary tree rather than argued about.
 *
 * @module benchmarks/__tests__/build-fault-free-profile.test
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { MetricMap, TimeSeries } from '../../packages/core/src/index.js';

import { discoverCaseDirs } from '../src/case-discovery.js';
import {
  main,
  observationsOf,
  parseBuildProfileArgs,
  runBuildProfile,
} from '../src/fault-free-profile-build.js';
import { readFaultFreeProfileFile } from '../src/fault-free-profile-file.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ffb-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function series(label: string, values: readonly number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 1_000),
    values: new Float64Array(values),
    unit: 'u',
  };
}

/** A loader that answers from a table, so the builder's own logic is what the test measures. */
function fakeLoader(table: Record<string, { metrics: MetricMap; injectTime: number }>): never {
  return {
    loadCase: (dir: string) => {
      const entry = table[dir];
      if (entry === undefined) throw new Error(`no such case: ${dir}`);
      return { dir, entry };
    },
    toBenchmarkCase: (raw: { dir: string }) => table[raw.dir]!,
  } as unknown as never;
}

describe('discoverCaseDirs', () => {
  it('finds a flat layout and returns it in canonical order', () => {
    const root = tempDir();
    for (const name of ['c', 'a', 'b']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'case.json'), '{}');
    }
    expect(discoverCaseDirs(root).map((dir) => dir.slice(root.length + 1))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('does not descend into a case directory', () => {
    const root = tempDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'case.json'), '{}');
    mkdirSync(join(root, 'a', 'nested'));
    writeFileSync(join(root, 'a', 'nested', 'case.json'), '{}');
    expect(discoverCaseDirs(root)).toEqual([join(root, 'a')]);
  });

  it('skips dot-directories', () => {
    const root = tempDir();
    mkdirSync(join(root, '.cache'));
    writeFileSync(join(root, '.cache', 'case.json'), '{}');
    expect(discoverCaseDirs(root)).toEqual([]);
  });

  it('answers from the marker it was given, so the two corpora share one walk', () => {
    const root = tempDir();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'case.json'), '{}');
    mkdirSync(join(root, 'b'));
    writeFileSync(join(root, 'b', 'metrics.json'), '{}');
    expect(discoverCaseDirs(root)).toEqual([join(root, 'a')]);
    expect(discoverCaseDirs(root, 'metrics.json')).toEqual([join(root, 'b')]);
  });

  it('is empty for a directory that does not exist, rather than throwing', () => {
    expect(discoverCaseDirs(join(tempDir(), 'missing'))).toEqual([]);
  });
});

describe('observationsOf', () => {
  it('yields one observation per case, capped when asked', () => {
    const root = tempDir();
    for (const name of ['a', 'b', 'c']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'case.json'), '{}');
    }
    const table: Record<string, { metrics: MetricMap; injectTime: number }> = {};
    for (const name of ['a', 'b', 'c']) {
      const dir = join(root, name);
      table[dir] = {
        metrics: new Map([['svc', [series('cpu', [1, 1, 1, 1, 1, 2])]]]),
        injectTime: 5_000,
      };
    }
    const loader = fakeLoader(table);
    const all = [...observationsOf(discoverCaseDirs(root), loader, 0)];
    const one = [...observationsOf(discoverCaseDirs(root), loader, 1)];
    expect(all.length).toBe(3);
    expect(one.length).toBe(1);
    expect(all[0]!.injectTimeMs).toBe(5_000);
  });
});

describe('main', () => {
  it('reads the command line, writes the file, and reports what the file carries', () => {
    const root = tempDir();
    const table: Record<string, { metrics: MetricMap; injectTime: number }> = {};
    for (const name of ['a', 'b', 'c']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'case.json'), '{}');
      table[join(root, name)] = {
        metrics: new Map([['svc', [series('cpu', [1, 2, 3, 4, 5, 6])]]]),
        injectTime: 5_000,
      };
    }
    const out = join(root, 'profile.json');
    const summary = main(['--data-dir', root, '--out', out], fakeLoader(table));
    // The summary and the artifact are two renderings of one build, so they must agree — a report that
    // counted channels the file does not carry is the defect a printed summary exists to prevent.
    expect(summary.channels).toBe(readFaultFreeProfileFile(out).stored.channels.length);
    expect(summary.services).toBe(1);
    expect(summary.cases).toBe(3);
  });

  it('refuses a command line with no output path', () => {
    expect(() => main(['--data-dir', '/tmp/c'])).toThrow(/--out/);
  });
});

describe('a flag left without its value', () => {
  // The parser reads `argv[++i] ?? ''` at every branch, so a flag at the end of the line yields an empty
  // string rather than `undefined` — and the two floors then refuse it by name instead of the run starting
  // from a corpus directory nobody typed.
  it('refuses a trailing --data-dir', () => {
    expect(() => parseBuildProfileArgs(['--data-dir'])).toThrow(/--data-dir/);
  });

  it('refuses a trailing --out', () => {
    expect(() => parseBuildProfileArgs(['--data-dir', '/x', '--out'])).toThrow(/--out/);
  });

  it('parses a trailing numeric flag as absent rather than as a value', () => {
    // `Number.parseFloat('')` is `NaN`, which is not a threshold — the builder falls back to the default
    // when the value is `undefined`, so the parser has to leave it undefined rather than hand over a NaN.
    const args = parseBuildProfileArgs(['--data-dir', '/x', '--out', 'y', '--sigma']);
    expect(Number.isNaN(args.sigma ?? 0)).toBe(true);
    expect(args.sigma).toBeNaN();
  });

  it('leaves each trailing threshold flag NaN rather than defaulting it', () => {
    // All three numeric thresholds read `argv[++i] ?? ''`, and `parseInt('')` is `NaN`. The builder's own
    // `undefined` check is what selects the default, so a parser that fabricated a number here would ship a
    // corpus profiled at a band nobody chose.
    expect(
      parseBuildProfileArgs(['--data-dir', '/x', '--out', 'y', '--min-samples']).minSamples,
    ).toBeNaN();
    expect(
      parseBuildProfileArgs(['--data-dir', '/x', '--out', 'y', '--min-windows']).minWindows,
    ).toBeNaN();
  });

  it('reads --max-cases and caps the corpus it walks', () => {
    expect(
      parseBuildProfileArgs(['--data-dir', '/x', '--out', 'y', '--max-cases', '2']).maxCases,
    ).toBe(2);
  });

  it('parses every flag it accepts, so no arm of the chain is reachable only by omission', () => {
    // The trailing-value tests above each take ONE arm of ONE `??`; this one takes the other arm of all six,
    // which is the case a real dispatch always is. Written as an exact object rather than six assertions
    // because a flag that starts landing in the wrong field is the failure a per-flag check cannot see.
    expect(
      parseBuildProfileArgs([
        '--data-dir',
        '/corpus',
        '--out',
        '/tmp/profile.json',
        '--max-cases',
        '7',
        '--sigma',
        '2.5',
        '--min-samples',
        '4',
        '--min-windows',
        '6',
      ]),
    ).toEqual({
      dataDir: '/corpus',
      out: '/tmp/profile.json',
      maxCases: 7,
      sigma: 2.5,
      minSamples: 4,
      minWindows: 6,
    });
  });

  it('reads an unparseable --max-cases as no cap rather than as NaN', () => {
    // `--max-cases` is the one flag whose parse ends in `|| 0`, and the difference is not cosmetic: `NaN > 0`
    // is false, so a NaN cap happens to behave like 0 here — but it would be a NaN the summary PRINTS, and a
    // report of "NaN cases" is a reading nobody can check against the corpus.
    expect(
      parseBuildProfileArgs(['--data-dir', '/x', '--out', 'y', '--max-cases', 'all']).maxCases,
    ).toBe(0);
  });

  it('reads a trailing --max-cases as no cap, through the other arm of its fallback', () => {
    // The one numeric flag whose absent-value arm is spelled `?? '0'` rather than `?? ''`, so it is the one
    // whose two arms a reader could believe are interchangeable. They are not: `'0'` parses to zero and `''`
    // parses to NaN, and only the first leaves the summary printing a count.
    expect(parseBuildProfileArgs(['--data-dir', '/x', '--out', 'y', '--max-cases']).maxCases).toBe(
      0,
    );
  });

  it('refuses a token no branch tests, and names it', () => {
    // The chain used to end in silence, which is the defect both other parsers in this repository paid for.
    // The concrete cost here: `--min-sample 8` (one character short) matched nothing, the floor stayed at its
    // default of three, and the artifact was a band fitted at the default — indistinguishable, to every arm
    // that reads it, from a run that had asked for three on purpose.
    expect(() =>
      parseBuildProfileArgs(['--data-dir', '/x', '--out', 'y', '--min-sample', '8']),
    ).toThrow(/--min-sample/);
    // A bare positional too, which is where a copied corpus path lands when the flag is forgotten.
    expect(() => parseBuildProfileArgs(['/corpus'])).toThrow(/\/corpus/);
  });
});

describe('runBuildProfile', () => {
  it('takes only the first N cases when a cap is given, and reports that count', () => {
    const root = tempDir();
    const table: Record<string, { metrics: MetricMap; injectTime: number }> = {};
    for (const name of ['a', 'b', 'c']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'case.json'), '{}');
      table[join(root, name)] = {
        metrics: new Map([['svc', [series('cpu', [1, 2, 3, 4, 5, 6])]]]),
        injectTime: 5_000,
      };
    }
    const out = join(root, 'profile.json');
    // `minWindows: 2` because the cap leaves two windows, and the default floor of three is what makes a
    // two-window corpus publish nothing — the floor is asserted in the test below, not worked around here.
    const summary = runBuildProfile(
      { dataDir: root, out, maxCases: 2, minWindows: 2 },
      fakeLoader(table),
    );
    expect(summary.cases).toBe(2);
    expect(readFaultFreeProfileFile(out).stored.channels[0]?.windows).toBe(2);
  });

  it('publishes nothing for a capped corpus narrower than the window floor', () => {
    const root = tempDir();
    const table: Record<string, { metrics: MetricMap; injectTime: number }> = {};
    for (const name of ['a', 'b', 'c']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'case.json'), '{}');
      table[join(root, name)] = {
        metrics: new Map([['svc', [series('cpu', [1, 2, 3, 4, 5, 6])]]]),
        injectTime: 5_000,
      };
    }
    const out = join(root, 'profile.json');
    const summary = runBuildProfile({ dataDir: root, out, maxCases: 2 }, fakeLoader(table));
    expect(summary.cases).toBe(2);
    expect(summary.channels).toBe(0);
  });
  it('writes a profile whose rates are counted over the cases the corpus holds', () => {
    const root = tempDir();
    const table: Record<string, { metrics: MetricMap; injectTime: number }> = {};
    // Three cases of one channel at level 10, and one of them at 400 — which is far outside the band the
    // other two establish, so exactly one window of four fires.
    const levels = [10, 10, 400];
    levels.forEach((level, index) => {
      const name = `c${index}`;
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'case.json'), '{}');
      const dir = join(root, name);
      table[dir] = {
        metrics: new Map([['svc', [series('cpu', [level, level, level, level, level, level])]]]),
        injectTime: 5_000,
      };
    });
    const out = join(root, 'profile.json');
    const summary = runBuildProfile({ dataDir: root, out, maxCases: 0 }, fakeLoader(table));
    expect(summary.cases).toBe(3);
    expect(summary.services).toBe(1);
    expect(summary.channels).toBe(1);
    const stored = readFaultFreeProfileFile(out).stored;
    expect(stored.channels.length).toBe(1);
    expect(stored.channels[0]?.windows).toBe(3);
    // The band is the median of three zero-σ windows, i.e. the spread of their levels: median |10−10|,
    // |10−10|, |400−10| = 0, and a zero band flags every window that left the centre — one of the three.
    expect(stored.channels[0]?.rate).toBeCloseTo(1 / 3, 12);
  });

  it('carries the thresholds it was given into the artifact', () => {
    const root = tempDir();
    const table: Record<string, { metrics: MetricMap; injectTime: number }> = {};
    for (const name of ['a', 'b', 'c']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'case.json'), '{}');
    }
    for (const name of ['a', 'b', 'c']) {
      table[join(root, name)] = {
        metrics: new Map([['svc', [series('cpu', [1, 2, 3, 4, 5, 6])]]]),
        injectTime: 5_000,
      };
    }
    const out = join(root, 'profile.json');
    runBuildProfile(
      { dataDir: root, out, maxCases: 0, sigma: 2, minSamples: 4, minWindows: 3 },
      fakeLoader(table),
    );
    const stored = readFaultFreeProfileFile(out).stored;
    expect(stored.sigma).toBe(2);
    expect(stored.minSamples).toBe(4);
    expect(stored.minWindows).toBe(3);
  });

  it('writes an empty channel list for a corpus whose windows all fall below the floor', () => {
    const root = tempDir();
    mkdirSync(join(root, 'only'));
    writeFileSync(join(root, 'only', 'case.json'), '{}');
    const table: Record<string, { metrics: MetricMap; injectTime: number }> = {
      [join(root, 'only')]: {
        metrics: new Map([['svc', [series('cpu', [1, 1, 1, 1, 1, 1])]]]),
        injectTime: 5_000,
      },
    };
    const out = join(root, 'profile.json');
    const summary = runBuildProfile({ dataDir: root, out, maxCases: 0 }, fakeLoader(table));
    expect(summary.channels).toBe(0);
    expect(readFaultFreeProfileFile(out).stored.channels).toEqual([]);
  });
});
