/**
 * Registry-initialization tests for the RCAEval topology builder.
 *
 * `initRCAEvalTopology()` freezes the registry on its first call and returns
 * early on every later one, so each scenario here needs its own module
 * instance. Instead of adding a test-only reset hook to the production module,
 * these tests take a fresh copy of it with `vi.resetModules()` + dynamic import.
 * The module under test is still the real one; only its instance is new.
 *
 * Covered here, none of which the default-path tests can reach:
 * - the uninitialized → initialized transition
 * - a config directory that does not exist
 * - a config path that is a *file* (the directory scan throws)
 * - a directory whose `.yaml` files belong to no known system (the scan ends
 *   without a match, and the `.yml` extension is accepted too)
 * - a case with exactly one service the topology does not know, which is the
 *   single-unconnected ring-connect branch
 *
 * @module benchmarks/__tests__/rcaeval-topology-init.test
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RING_CONNECT, edgeProvenance } from '../src/rcaeval-semantic.js';

type TopologyModule = typeof import('../src/rcaeval-topology.js');

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/**
 * A fresh instance of the topology module, with an uninitialized registry.
 */
async function freshTopologyModule(): Promise<TopologyModule> {
  vi.resetModules();
  return import('../src/rcaeval-topology.js');
}

const tempDirs: string[] = [];

function makeTempConfigDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rcaeval-topology-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf-8');
  }
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ── Registry state ────────────────────────────────────────

describe('initRCAEvalTopology — registry state', () => {
  it('reports uninitialized before the first call and initialized after it', async () => {
    const mod = await freshTopologyModule();

    expect(mod.isRCAEvalTopologyInitialized()).toBe(false);

    await mod.initRCAEvalTopology(resolve(REPO_ROOT, 'no-such-topology-dir'));

    expect(mod.isRCAEvalTopologyInitialized()).toBe(true);
  });

  it('is idempotent: a second call keeps the first registry', async () => {
    const mod = await freshTopologyModule();
    await mod.initRCAEvalTopology(resolve(REPO_ROOT, 'no-such-topology-dir'));

    // The registry is already populated from the missing directory (all three
    // systems empty). Re-initializing with the real configs must not replace it,
    // because every production caller relies on "first call wins".
    await mod.initRCAEvalTopology();

    const graph = mod.buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', ['ts-ui', 'ts-travel-service']);
    expect(graph.edges.every((e) => edgeProvenance(e) === RING_CONNECT)).toBe(true);
  });
});

// ── Config directory resolution ───────────────────────────

describe('initRCAEvalTopology — config directory resolution', () => {
  it('falls back to an empty topology when the directory does not exist', async () => {
    const mod = await freshTopologyModule();
    await mod.initRCAEvalTopology(resolve(REPO_ROOT, 'no-such-topology-dir'));

    const graph = mod.buildRCAEvalCallGraph('re1ob_adservice_cpu_1', ['adservice', 'frontend']);

    // No YAML edges survive, so every service is ring-connected instead.
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(edgeProvenance(edge)).toBe(RING_CONNECT);
      expect(edge.type).toBe('REST');
    }
  });

  it('survives a config path that is a file rather than a directory', async () => {
    const mod = await freshTopologyModule();

    // `package.json` exists, so the `existsSync` guard passes and `readdirSync`
    // is what throws -- the directory scan is the only thing that can.
    await mod.initRCAEvalTopology(resolve(REPO_ROOT, 'package.json'));

    expect(mod.isRCAEvalTopologyInitialized()).toBe(true);
    const graph = mod.buildRCAEvalCallGraph('re1ss_carts_cpu_1', ['front-end', 'carts']);
    expect(graph.edges.every((e) => edgeProvenance(e) === RING_CONNECT)).toBe(true);
  });

  it('ends the scan without a match when no file belongs to the system', async () => {
    const dir = makeTempConfigDir({
      'unrelated.yaml': [
        'system: SomethingElse',
        'services:',
        '  - id: nope',
        'edges: []',
        '',
      ].join('\n'),
    });
    const mod = await freshTopologyModule();

    await mod.initRCAEvalTopology(dir);

    const graph = mod.buildRCAEvalCallGraph('re1ob_adservice_cpu_1', ['adservice']);
    expect(graph.edges.every((e) => edgeProvenance(e) === RING_CONNECT)).toBe(true);
  });

  it('accepts the .yml extension and reads the service list from it', async () => {
    // Mirrors the real configs' schema exactly: services need a `namespace`,
    // and edges use the inline `- { from: …, to: … }` form the parser supports.
    const dir = makeTempConfigDir({
      'sockshop.yml': [
        'version: "1.0"',
        'system: SockShop',
        'services:',
        '  - id: front-end',
        '    namespace: sock-shop',
        '    labels:',
        '      tier: web',
        '  - id: carts',
        '    namespace: sock-shop',
        '    labels:',
        '      tier: backend',
        'edges:',
        '  - { from: front-end, to: carts, type: REST, callRate: 500, p99Latency: 20, errorRate: 0.01 }',
        '',
      ].join('\n'),
    });
    const mod = await freshTopologyModule();

    await mod.initRCAEvalTopology(dir);

    const graph = mod.buildRCAEvalCallGraph('re1ss_carts_cpu_1', ['front-end', 'carts']);
    const yamlEdge = graph.edges.find((e) => e.from === 'front-end' && e.to === 'carts');
    // A surviving non-ring-connect edge is the observable proof that the .yml
    // file was parsed and its service list collected.
    expect(yamlEdge).toBeDefined();
    // Provenance is how an edge says where it came from; an untagged edge is an
    // exact YAML match, which is precisely what makes this an observable proof.
    expect(edgeProvenance(yamlEdge!)).toBeUndefined();
    expect(yamlEdge?.callRate).toBe(500);
  });
});

// ── Ring-connect branches ─────────────────────────────────

describe('buildRCAEvalCallGraph — ring-connect branches', () => {
  it('attaches a lone unknown service to the first connected one', async () => {
    const mod = await freshTopologyModule();
    await mod.initRCAEvalTopology();

    // ts-ui → ts-travel-service is a real YAML edge, so those two are
    // connected; the third service is not in the topology at all. That is the
    // single-unconnected branch, which attaches it to one connected service
    // instead of forming a ring.
    const graph = mod.buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', [
      'ts-ui',
      'ts-travel-service',
      'ts-not-in-topology',
    ]);

    const ringEdges = graph.edges.filter((e) => edgeProvenance(e) === RING_CONNECT);
    expect(ringEdges).toHaveLength(1);
    expect(ringEdges[0]?.to).toBe('ts-not-in-topology');
    expect(['ts-ui', 'ts-travel-service']).toContain(ringEdges[0]?.from);
  });

  it('rings the unknown services when none of them is connected', async () => {
    const mod = await freshTopologyModule();
    await mod.initRCAEvalTopology();

    const graph = mod.buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', ['unknown-a', 'unknown-b']);

    const ringEdges = graph.edges.filter((e) => edgeProvenance(e) === RING_CONNECT);
    // Two unknown services and nothing connected: a closed ring of two.
    expect(ringEdges).toHaveLength(2);
    expect(new Set(ringEdges.map((e) => e.from))).toEqual(new Set(['unknown-a', 'unknown-b']));
  });
});
