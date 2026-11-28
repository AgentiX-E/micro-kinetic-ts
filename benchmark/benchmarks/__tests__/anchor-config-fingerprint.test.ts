/**
 * The standing document names the CONFIGURATION it was measured on, and this fence holds it to the one that ships.
 *
 * ## The defect that produced this file
 *
 * `docs/sota-comparison.md` is anchored to one battery: one fenced block of nine cells and a total, quoted by four
 * tables. `standing-anchor.test.ts` holds those tables to that block, and it is thorough about it — the cells sum to
 * their suites, the suites to the total, no table prints a retired reading, and the correction section names every
 * one it retired.
 *
 * Every one of those assertions is a statement about **the document**. Not one of them can see that the document and
 * the ENGINE have parted: iteration 240 moved `DEFAULT_TRANSIENT_GUARD_TEST` from `'evidence-trimmed'` to `'hump'`,
 * which re-ranks every cell of both benchmarks, and the anchor kept reading the previous enrolment for the whole
 * iteration. The flip was recorded — in an evidence document, in a register, in a progress note — and the four
 * tables a reader meets first were one enrolment behind for a day. That is the same class as the correction the
 * anchor was built for (§0p's four claims), and the fence built for it could not see the recurrence because the
 * fence compares the document against itself.
 *
 * ## Why a FINGERPRINT rather than a second dispatch
 *
 * What a test can reach is the code; what it cannot reach is a run. So the marker carries the one thing both sides
 * can compute: a digest of the run's own `signals:` line — the string the artifact's banner prints and its
 * diagnostic dump stores, built by `formatSignalLine` from the options `parseRCAEvalArgs([])` returns, i.e. from
 * EXACTLY what a bare dispatch measures. Any change to a shipped default changes that string, and the digest with
 * it, so an enrolment turns the anchor RED before a number is published under the old one.
 *
 * ## What it deliberately does not claim
 *
 * A fingerprint identifies a CONFIGURATION, not a reading. The one-case drift `§0p-ii` found — a fix at a fixed
 * configuration, byte-identical `signals:` line before and after — is invisible here by construction, and pretending
 * otherwise would be the same over-claim as an anchor that reads as a proof. That class needs the artifact, not the
 * code: a committed per-cell baseline compared against each push battery. The document names it as owed; this file
 * says so too, so a later reader does not mistake one fence for the other.
 *
 * @module benchmarks/__tests__/anchor-config-fingerprint.test
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TRANSIENT_GUARD_TEST } from '@agentix-e/micro-kinetic-tree';

import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';
import { formatSignalLine } from '../src/rcaeval-engine-options.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = readFileSync(resolve(REPO_ROOT, 'docs/sota-comparison.md'), 'utf8');

/** The marker's own grammar: `battery <id> on <sha>, read <date>, config <12 hex>`. */
const MARKER =
  /<!-- standing-anchor: battery (\d+) on ([0-9a-f]{8,40}), read (\d{4}-\d{2}-\d{2}), config ([0-9a-f]{12}) -->/;

const DIGEST = createHash('sha256')
  .update(formatSignalLine(parseRCAEvalArgs([])))
  .digest('hex')
  .slice(0, 12);

describe('the anchor names the configuration that ships', () => {
  it('carries exactly one marker, and it is well formed', () => {
    // Non-vacuity first: a document with no marker would satisfy every lookup below with `undefined`.
    const markers = DOC.match(/<!-- standing-anchor:/g) ?? [];
    expect(markers).toHaveLength(1);
    const found = DOC.match(MARKER);
    expect(
      found,
      'the marker carries a battery, a revision, a date and a twelve-hex config digest',
    ).not.toBeNull();
    const [, battery, revision, date, digest] = found!;
    // The four fields are asserted for SHAPE rather than for value — the value is what the next test is for.
    expect(Number(battery), `${battery} is a workflow-run id`).toBeGreaterThan(1_000_000_000);
    expect(revision!.length, `${revision} is a git revision`).toBeGreaterThanOrEqual(8);
    expect(date, `${date} is an ISO date`).toMatch(/^20\d\d-\d\d-\d\d$/);
    expect(digest, `${digest} is the digest this test recomputes`).toHaveLength(12);
  });

  it('is the digest of the shipped configuration, so an enrolment cannot leave it green', () => {
    const found = DOC.match(MARKER);
    expect(found).not.toBeNull();
    const stated = found![4];
    // The failure is written to be actionable rather than merely red: it names both digests, says which side moved,
    // and states the two ways out. A gate whose message is "expected x, received y" on a hash is a gate a reader
    // disables.
    expect(
      stated,
      'the anchor names a configuration the engine no longer ships. Either re-anchor the block to a battery of the ' +
        'shipped configuration (`docs/sota-comparison.md` §0p says how), or roll the marker and record the enrolment ' +
        'and its readings in §0p. A default that moves without one of those two is the defect this fence exists for.',
    ).toBe(DIGEST);
  });

  it('holds the committed cell baseline to the same digest, so the dashboard gate cannot go inert', () => {
    // `benchmarks/baselines/rcaeval-nine-cells.json` is the OTHER half of this mechanism: `cell-baseline.ts` compares
    // each push battery's nine cells against it and fails the job on any movement. But that tool skips a run whose
    // configuration digest is not the baseline's — it must, because a dispatch exists to move cells — so a baseline
    // that falls behind the shipped digest turns the comparison OFF and reports it as an ARM. Run `43215496103` was
    // that state: `1fa9e7bca975` against a baseline at `a0ed4a8a906e`, green job, nine cells unread. This assertion is
    // the join: the baseline's digest must be the one this file already verifies against the shipped configuration,
    // so an enrolment turns the baseline red before the gate that reads it can go quiet.
    const baseline = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'benchmarks/baselines/rcaeval-nine-cells.json'), 'utf8'),
    ) as {
      readonly configuration: string;
      readonly cells: Record<string, number>;
      readonly total: number;
    };
    expect(
      baseline.configuration,
      'the cell baseline names a configuration the engine no longer ships, so cell-baseline.ts would skip every run ' +
        'as an ARM. Re-anchor benchmarks/baselines/rcaeval-nine-cells.json (battery, revision and digest) against a ' +
        'battery of the shipped configuration, in the same commit that declares the movement.',
    ).toBe(DIGEST);
    // And its own arithmetic, because a baseline whose cells do not sum to its total compares against a number no
    // run can produce: every cell would have to move for the total to agree.
    expect(Object.values(baseline.cells).reduce((acc, count) => acc + count, 0)).toBe(
      baseline.total,
    );
  });

  it('recomputes from the same surface the artifact prints, and that surface names the guard policy', () => {
    // The fingerprint's VALUE is only meaningful if it comes from the string the run prints. Two properties make
    // that checkable without a run: the line is the one whose first field is `signals:`, and it names the shipped
    // guard statistic by the engine's own constant — the default iteration 240 moved, and therefore the one whose
    // change this fence is meant to catch.
    const line = formatSignalLine(parseRCAEvalArgs([]));
    expect(line.startsWith('signals: ')).toBe(true);
    expect(line).toContain(`transientGuardTest=${DEFAULT_TRANSIENT_GUARD_TEST}`);
    // And the digest is a function of that line alone, so a field added to the line moves the anchor red too.
    expect(createHash('sha256').update(line).digest('hex').slice(0, 12)).toBe(DIGEST);
    const different = createHash('sha256')
      .update(
        line.replace(
          `transientGuardTest=${DEFAULT_TRANSIENT_GUARD_TEST}`,
          'transientGuardTest=endpoint',
        ),
      )
      .digest('hex')
      .slice(0, 12);
    expect(different, 'a different guard statistic is a different configuration').not.toBe(DIGEST);
  });
});
