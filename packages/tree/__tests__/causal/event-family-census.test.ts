/**
 * Every ERROR family a producer writes must be DECLARED as an event channel.
 *
 * The idle guard measures an event channel over the window its evidence is claimed in, and a level channel
 * over the whole recording. Which side of that rule a channel falls on is not a property of its values — it is
 * a membership question, answered by {@link EVENT_METRIC_LABELS}, and that list is an EXACT list of literal
 * labels on the documented rule "a channel is not in the family until somebody says it is".
 *
 * The rule is right and the membership had already drifted, which is what this census exists for. The window
 * repair was written for the RCAEval corpus, whose converter names its error family `error`; the FSE'26
 * converter names the same quantity `http.response.error_rate`, so on that corpus the repair never applied and
 * the guard went on measuring the duty cycle over the WHOLE recording — where the pre-injection half is quiet
 * by construction. The truth's own error channel was dropped as `duty-cycled-idle` on a series that steps from
 * `0.00` to `16.7`, which is the single strongest shape this engine can be handed.
 *
 * A list of names cannot be checked against the producers that write names. This file is that check: it reads
 * every producer, takes the families each one emits, and holds the two rules that membership has to obey —
 * an error family is in the family, and a LEVEL family is not.
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

  it('declares every ERROR family as an event channel, because its zero is a measurement', () => {
    const undeclared = fse26Families().filter((f) => /error/i.test(f) && !isEventMetric(f));
    expect(undeclared).toEqual([]);
  });

  it('declares no LEVEL family as an event channel, because then its window would move', () => {
    const levelDeclared = fse26Families().filter(
      (f) => /duration|latency|_total$|_bytes$|_rss$|_usage$/.test(f) && isEventMetric(f),
    );
    expect(levelDeclared).toEqual([]);
  });
});

describe('the event family itself', () => {
  it('is matched case-insensitively, so a producer that shouts is still understood', () => {
    expect(isEventMetric('ERROR')).toBe(true);
    expect(isEventMetric('http.response.ERROR_rate')).toBe(true);
  });

  it('does not admit a name it merely CONTAINS, because the list is exact', () => {
    // `http.server.request.duration` is a level; `error_rate_sum` is a counter of the same events but not the
    // rate the guard was written for. Admitting by substring would move the window of every one of them.
    expect(isEventMetric('http.server.request.duration')).toBe(false);
    expect(isEventMetric('errors_total')).toBe(false);
  });

  it("carries the RCAEval spelling and the FSE'26 spelling, which are the same quantity", () => {
    expect(isEventMetric('error')).toBe(true);
    expect(isEventMetric('http.response.error_rate')).toBe(true);
    expect(EVENT_METRIC_LABELS.length).toBeGreaterThanOrEqual(2);
  });
});
