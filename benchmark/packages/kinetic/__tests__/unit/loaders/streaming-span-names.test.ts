/**
 * The two streaming passes key their rows on whatever the service column holds, so a caller that needs those
 * keys in its own id space has to be able to say so — and a name the caller refuses has to leave the
 * accumulation entirely, including out of the traffic denominator.
 *
 * The join itself is `traceServiceResolver`'s job (`benchmarks/src/rcaeval-corpus.ts`); what this file pins is
 * that the two passes honour it, and that they are unchanged when nobody asks.
 *
 * @module packages/kinetic/__tests__/unit/loaders/streaming-span-names
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  countDirectionalInputs,
  countTraceActivityByService,
} from '../../../src/benchmarks/loaders/rcaeval-loader.js';

const ANCHOR_S = 1_700_000_000;
const us = (secondsFromAnchor: number): string => `${(ANCHOR_S + secondsFromAnchor) * 1_000_000}`;

/** `frontendservice` names a measured service; `adservice` names nothing in this case. */
const TRACES = [
  'traceId,spanId,parentSpanId,serviceName,operationName,startTime,duration,response_code',
  `t1,p1,,frontendservice,root,${us(-3)},1,200`,
  `t1,c1,p1,cartservice,work,${us(-1)},10,200`,
  `t1,c2,p1,cartservice,work,${us(1)},500,500`,
  `t2,p2,,cartservice,root,${us(-2)},1,200`,
  `t2,c3,p2,adservice,serve,${us(1)},5,200`,
  '',
].join('\n');

/** The caller's rule, stated here rather than imported: this file tests the passes, not the join. */
const rename = (name: string): string | undefined => {
  const resolved = name === 'frontendservice' ? 'frontend' : name;
  return resolved === 'adservice' ? undefined : resolved;
};

const dirs: string[] = [];

function writeTraces(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcaeval-stream-'));
  dirs.push(dir);
  const tracesPath = path.join(dir, 'traces.csv');
  fs.writeFileSync(tracesPath, TRACES);
  return tracesPath;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('countDirectionalInputs with a service-name resolver', () => {
  it('puts the direction edge on the resolved caller', async () => {
    const resolved = await countDirectionalInputs(writeTraces(), ANCHOR_S * 1000, rename);
    // The rename is what puts the failing call on `frontend -> cartservice`; without it the caller is a
    // service the ranking cannot name and the edge is dropped.
    expect(resolved.failedTraceEdges).toEqual([
      { caller: 'frontend', callee: 'cartservice', failed: 1, baseline: 0 },
    ]);
    expect(resolved.edgeLatency.map((e) => `${e.caller}>${e.callee}`)).toEqual([
      'frontend>cartservice',
    ]);
    // One call reached the callee after the anchor; the refused service's calls are not a denominator for
    // anything measured, so they are gone from it.
    expect([...resolved.calleeCalls.entries()]).toEqual([['cartservice', 1]]);
  });

  it('is opt-in: without a resolver the raw column is what the rows carry', async () => {
    const raw = await countDirectionalInputs(writeTraces(), ANCHOR_S * 1000);
    expect(raw.failedTraceEdges.map((e) => e.caller)).toEqual(['frontendservice']);
    // And the service nothing measures is still counted, because nobody asked it not to be.
    expect(raw.calleeCalls.get('adservice')).toBe(1);
  });
});

describe('countTraceActivityByService with a service-name resolver', () => {
  it('counts span activity under the resolved id and drops the rest', async () => {
    const counts = await countTraceActivityByService(writeTraces(), ANCHOR_S * 1000, rename);
    expect([...counts.keys()].sort()).toEqual(['cartservice', 'frontend']);
    expect(counts.get('frontend')).toEqual({ pre: 1, post: 0 });
    expect(counts.get('cartservice')).toEqual({ pre: 2, post: 1 });
  });

  it('keeps every raw name when no resolver is given', async () => {
    const counts = await countTraceActivityByService(writeTraces(), ANCHOR_S * 1000);
    expect([...counts.keys()].sort()).toEqual(['adservice', 'cartservice', 'frontendservice']);
  });
});
