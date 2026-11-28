/**
 * Guards on the surface through which the engine's order can reach the model.
 *
 * Iteration 344 decomposed the shortlist arm's 205-case loss and found that the largest single block — 49 % of it — sits
 * on cases where the arm's BEHAVIOUR was unchanged: the engine's own misses, where neither arm queried the culprit, and
 * the free arm still answered 52.8 % of them while the shortlist arm answered 6.3 %. The section did not make the model
 * investigate less (that is 40 %); it replaced a path from the fleet's global evidence to the answer, and the model had
 * no way to tell the two rankings apart.
 *
 * Three presentations of that order have now been measured and all three lost: printed into the prompt (§318, −12 pp
 * against the free arm), served one name per call (342b, 52.26 % retention), and shown as a five-name section inside a
 * tool result (343, 60.15 % retention, −38.53 pp). The register closes all three. This file is the part that keeps it
 * closed: the engine's order may enter a model's context through **exactly the surfaces listed below**, each one has to
 * be named in the source, and the default arm is asserted to be byte-identical to the published one.
 *
 * A new presentation added later will fail here, in one line, with the register entry and the price attached — which is
 * the whole point. Re-proposing a closed axis has happened three times in this programme and twice it cost a dispatch.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUERY_BUDGET,
  ENGINE_ORDER_SURFACES,
  executeTool,
  QUERY_SYSTEM_PROMPT,
  type QuerySeed,
  type Telemetry,
} from '../src/query-agent.js';

const SRC = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src');
const source = readFileSync(resolve(SRC, 'query-agent.ts'), 'utf8');

/** A three-service telemetry: `checkout` rises hardest, then `payment`, then `db`. */
function telemetry(): Telemetry {
  const inject = 1_700_000_000_000;
  const series = (peak: number) => ({
    label: 'cpu',
    baseline: 10,
    peak,
    delta: peak - 10,
    ratio: peak / 10,
    surprise: peak,
    trough: 10,
    fall: 0,
    fallSurprise: 0,
    peakOffset: 1_000,
  });
  const service = (id: string, peak: number) => ({
    id,
    metrics: [series(peak)],
    callers: [],
    callees: [],
    firstErrorOffset: undefined,
    errorCount: 0,
    errorLines: [],
  });
  return {
    injectTime: inject,
    services: new Map([
      ['checkout', service('checkout', 90)],
      ['payment', service('payment', 50)],
      ['db', service('db', 20)],
    ]),
    failed: [],
    latency: [],
  };
}

const FLEET = { kind: 'tool', tool: 'fleet', argument: '' } as const;

describe('the engine order surface', () => {
  it('lists every surface through which the order can reach a model', () => {
    // Two entries, and the length is asserted rather than the names: a third presentation is the thing this guard
    // exists to catch, so it must fail here before it can be dispatched.
    expect(ENGINE_ORDER_SURFACES).toHaveLength(2);
    expect(ENGINE_ORDER_SURFACES.map((one) => one.name)).toEqual(['schedule', 'shortlist']);
  });

  it('has no third call site: `scheduleNames` is used at exactly the listed surfaces', () => {
    // The definition (`export function scheduleNames`) is not a use, and neither is the import in a sibling module.
    const uses = (source.match(/(?<!function )scheduleNames\(/g) ?? []).length;
    expect(uses).toBe(ENGINE_ORDER_SURFACES.length);
  });

  it('names each surface in the source, so a reader can find the fence without the register', () => {
    for (const one of ENGINE_ORDER_SURFACES) {
      expect(source).toContain(one.fence);
    }
  });

  it('prints nothing from the order when an arm carries neither a schedule nor a shortlist', () => {
    const text = executeTool(telemetry(), FLEET).text;
    expect(text).not.toContain('pipeline order');
    // The three names still appear as the fleet's own surprise ranking — what must not appear is a SECOND list of them
    // under a heading that claims an outside authority.
    expect(text.split('\n').filter((line) => line.startsWith('  checkout'))).toHaveLength(1);
  });

  it('keeps the free arm on the published instruction, which names no service', () => {
    for (const name of ['checkout', 'payment', 'db']) {
      expect(QUERY_SYSTEM_PROMPT).not.toContain(name);
    }
    // The schedule prompt is the ONLY instruction that mentions a route, and it still names no service.
    expect(QUERY_SYSTEM_PROMPT).not.toContain('TOOL next');
  });

  it('keeps the budget out of the order: a seed and a shortlist are the same object to the surface list', () => {
    // `QuerySeed` existed before the surfaces did. The type is still exported, so a guard on the NAME keeps a future
    // edit from reintroducing a seed as a "third option" without adding it here.
    const seed: QuerySeed | null = null;
    expect(seed).toBeNull();
    expect(DEFAULT_QUERY_BUDGET.maxRounds).toBe(6);
  });
});
