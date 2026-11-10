/**
 * Every ERROR family a producer writes is either DECLARED as an event channel or NAMED as a refused one.
 *
 * The idle guard measures an event channel over the window its evidence is claimed in, and a level channel over
 * the whole recording. Which side of that rule a channel falls on is a property of its MEANING, answered by
 * {@link EVENT_METRIC_LABELS} — an exact list of literal labels on the documented rule "a channel is not in the
 * family until somebody says it is".
 *
 * The list was written against the RCAEval converter, whose error family is `error`. The FSE'26 converter
 * derives the same quantity from the same spans and calls it `http.response.error_rate`, and it was never
 * declared — so on that corpus the guard kept the whole-recording denominator, whose pre-injection half is quiet
 * by construction, and refused the truth's OWN error channel on 1344 of 1347 judgeable datapacks. It was refused
 * on a channel that steps `0.00 → 16.7` while every decoy reads `0.00`.
 *
 * Adding the name is measured and REFUSED, on this project's criterion rather than on the size of the gain:
 * `1073 → 1082` on 1422 cases, with **eight fault types moving, six up and four down** (`NetworkPartition −4`,
 * `NetworkBandwidth −3`, `HTTPRequestReplacePath −1`, `NetworkLoss −1`). The 14 lost cases are the ones where
 * the truth cannot produce the channel at all (`mysql` has no HTTP spans) while its callers can, so evidence
 * that a caller was AFFECTED is priced as evidence that it is the CAUSE.
 *
 * A list of names cannot be checked against the producers that write names, so this file is that check — and a
 * refusal has to be as visible as a declaration, because the failure mode this iteration found was an absence
 * nobody had written down. Hence {@link REFUSED_EVENT_FAMILIES}: every error-named family a producer emits is
 * either in the family or in that record WITH ITS REASON, and the record may only hold families the producers
 * actually emit, so an exemption cannot outlive the family it exempts.
 *
 * @module __tests__/causal/event-family-census
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EVENT_METRIC_LABELS, isEventMetric } from '../../src/causal/topology-fault-graph.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const FSE26_CONVERTER = resolve(repoRoot, 'scripts/fse26_convert.py');

/**
 * The error-named families a producer writes and the event family deliberately does NOT hold.
 *
 * Each entry is a decision with its number, not an oversight: the corpus reading that refused it, the fault
 * types that moved against it, and the acceptance test that would move it into the family. The next session
 * reads a falsifier rather than a preference.
 */
const REFUSED_EVENT_FAMILIES: Readonly<Record<string, string>> = {
  'http.response.error_rate':
    "the FSE'26 spelling of `error`, derived from the same spans. Refused as a DEFAULT and not as a mistake: " +
    'adding it reads 1073 → 1082 on 1422 cases with eight fault types moving, six up and four down ' +
    '(NetworkPartition −4, NetworkBandwidth −3, HTTPRequestReplacePath −1, NetworkLoss −1). The 14 lost cases ' +
    'are those where the truth cannot produce the channel at all (mysql has no HTTP spans) while its callers ' +
    'can, so being AFFECTED is priced as being the CAUSE. It moves into EVENT_METRIC_LABELS when admission is ' +
    'conditioned on that asymmetry (victimWeight ships at 0) and the corpus reads Top@1 >= 1082 with no fault ' +
    'type down. See docs/duty-cycle-window.md §5.',
};

/**
 * Every metric family the FSE'26 converter writes, as the literals it writes them as.
 *
 * The JSON it emits carries each family name in a `"metric": "<name>"` pair, so the producer's own vocabulary
 * is readable without importing it — and reading it as TEXT is the point: the converter is Python, the list is
 * TypeScript, and nothing else in the build compares the two.
 */
function fse26Families(): string[] {
  const source = readFileSync(FSE26_CONVERTER, 'utf8');
  const names = new Set<string>();
  for (const m of source.matchAll(/"metric":\s*"([^"]+)"/g)) names.add(m[1]!);
  return [...names].sort();
}

describe("the FSE'26 converter's families", () => {
  it('are found by this census at all, so a green run means something', () => {
    // A census whose extractor silently stops matching is a census that passes. The converter writes one
    // family per derived channel plus the platform's own pass-through, so the floor is low and the failure is
    // loud rather than a quiet zero.
    const families = fse26Families();
    expect(families.length).toBeGreaterThanOrEqual(3);
    expect(families).toContain('http.response.error_rate');
    expect(families).toContain('http.server.request.duration');
  });

  it('leaves no ERROR family unaccounted for — declared, or refused with a reason and a number', () => {
    const families = fse26Families();
    const unaccounted = families.filter(
      (f) => /error/i.test(f) && !isEventMetric(f) && !(f in REFUSED_EVENT_FAMILIES),
    );
    expect(unaccounted).toEqual([]);
  });

  it('declares no LEVEL family as an event channel, because then its window would move', () => {
    const levelDeclared = fse26Families().filter(
      (f) => /duration|latency|_total$|_bytes$|_rss$|_usage$/.test(f) && isEventMetric(f),
    );
    expect(levelDeclared).toEqual([]);
  });
});

describe('the refusal record', () => {
  it('holds no family the producers have stopped writing, so an exemption cannot outlive its family', () => {
    // The mirror image of a census that passes vacuously: an exemption for a family nobody emits is a sentence
    // about a corpus that no longer exists, and it would go on excusing nothing forever.
    const emitted = new Set(fse26Families());
    const orphans = Object.keys(REFUSED_EVENT_FAMILIES).filter((f) => !emitted.has(f));
    expect(orphans).toEqual([]);
  });

  it('never overlaps the declared family, because a channel cannot be both', () => {
    const both = Object.keys(REFUSED_EVENT_FAMILIES).filter((f) => isEventMetric(f));
    expect(both).toEqual([]);
  });

  it('carries a falsifier in every entry, not just a preference', () => {
    // Each refusal above was bought with a corpus measurement. A reason without a number and without the test
    // that would overturn it is how a decision becomes a habit.
    for (const [family, reason] of Object.entries(REFUSED_EVENT_FAMILIES)) {
      expect(reason, family).toMatch(/Top@1 >= \d+/);
      expect(reason, family).toMatch(/[−+]\d/);
      expect(reason.length, family).toBeGreaterThan(120);
    }
  });
});

describe('the event family itself', () => {
  it('is matched case-insensitively, so a producer that shouts is still understood', () => {
    expect(isEventMetric('ERROR')).toBe(true);
    expect(isEventMetric('Error')).toBe(true);
  });

  it('does not admit a name it merely CONTAINS, because the list is exact', () => {
    // `http.server.request.duration` is a level; `errors_total` is a counter of the same events but not the
    // rate the guard was written for. Admitting by substring would move the window of every one of them.
    expect(isEventMetric('http.server.request.duration')).toBe(false);
    expect(isEventMetric('errors_total')).toBe(false);
  });

  it('carries the RCAEval spelling, which is the one the repair was written for', () => {
    expect(isEventMetric('error')).toBe(true);
    expect(EVENT_METRIC_LABELS).toEqual(['error']);
  });
});
