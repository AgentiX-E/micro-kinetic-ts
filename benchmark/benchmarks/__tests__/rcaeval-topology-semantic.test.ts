/**
 * The semantic branch of `enhanceRCAEvalCallGraph()`.
 *
 * The registry freezes on first init, so the semantic path needs a module
 * instance that was initialized *with* an embedding provider. This file takes
 * one with `vi.resetModules()` + dynamic import, then drives the real enhancer
 * against the real `configs/topology` YAML.
 *
 * What the existing suites cannot reach, and what each case below pins:
 * - every case service already known to the topology (the early return)
 * - an unknown service the enhancer cannot align (statistics annotation only)
 * - an unknown service it *can* align: ring-connect edges for it must be
 *   replaced, semantic neighbours that are absent from this case must be
 *   dropped, and a service that stays unknown must keep its ring-connect edge
 * - a case whose system cannot be identified at all
 *
 * @module benchmarks/__tests__/rcaeval-topology-semantic.test
 */

import { describe, expect, it, vi } from 'vitest';
import { edgeProvenance, RING_CONNECT } from '../src/rcaeval-semantic.js';
import {
  createMatchEmbedding,
  DeterministicEmbeddingProvider,
} from './helpers/embedding-fixtures.js';

type TopologyModule = typeof import('../src/rcaeval-topology.js');

async function initializedWithSemantics(
  embeddingProvider: Parameters<TopologyModule['initRCAEvalTopology']>[1],
): Promise<TopologyModule> {
  vi.resetModules();
  const mod = await import('../src/rcaeval-topology.js');
  await mod.initRCAEvalTopology(undefined, embeddingProvider);
  return mod;
}

function provenanceOf(edges: readonly { from: string; to: string }[], from: string, to: string) {
  return edges
    .filter((e) => e.from === from && e.to === to)
    .map((e) => edgeProvenance(e as Parameters<typeof edgeProvenance>[0]));
}

describe('enhanceRCAEvalCallGraph — semantic path', () => {
  it('delegates to the sync builder when every case service is already known', async () => {
    const embeddingProvider = createMatchEmbedding(new Map(), 'TrainTicket');
    const mod = await initializedWithSemantics({ embeddingProvider });

    const serviceIds = ['ts-ui', 'ts-travel-service'];
    const sync = mod.buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', serviceIds);
    const enhanced = await mod.enhanceRCAEvalCallGraph('re1tt_ts-ui_cpu_1', serviceIds);

    // Nothing is unmatched, so the enhancer is never consulted: same nodes, same
    // edges, byte for byte.
    expect(enhanced.nodes.size).toBe(sync.nodes.size);
    expect(enhanced.edges).toEqual(sync.edges);
  });

  it('annotates statistics when an unknown service cannot be aligned', async () => {
    const embeddingProvider = createMatchEmbedding(new Map(), 'TrainTicket');
    const mod = await initializedWithSemantics({ embeddingProvider });

    const g = await mod.enhanceRCAEvalCallGraph('re1tt_ts-ui_cpu_1', [
      'ts-ui',
      'ts-travel-service',
      'ts-unmatchable-svc',
    ]);

    for (const node of g.nodes.values()) {
      expect(node.labels._diag_source).toBe('yaml-v2+semantic');
      // One unmatched service, none resolved by embedding, none by LLM.
      expect(node.labels._diag_unconnected).toBe('1');
      expect(node.labels._diag_embedding).toBe('0');
      expect(node.labels._diag_llm).toBe('0');
    }
  });

  it('replaces ring-connect edges for an aligned service and drops dangling neighbours', async () => {
    const embeddingProvider = createMatchEmbedding(
      new Map([['ts-alias-order', 'ts-order-service']]),
      'TrainTicket',
    );
    const mod = await initializedWithSemantics({ embeddingProvider });

    // `ts-ui` → `ts-travel-service` is a real YAML edge, so those two are
    // connected before semantics run. `ts-alias-order` aligns to
    // `ts-order-service`, which is NOT in this case: its eight outgoing YAML
    // edges and its incoming edges from services absent here must all be
    // dropped, leaving only the incoming edge whose source *is* present.
    const g = await mod.enhanceRCAEvalCallGraph('re1tt_ts-ui_cpu_1', [
      'ts-ui',
      'ts-travel-service',
      'ts-alias-order',
      'ts-still-unknown-a',
      'ts-still-unknown-b',
    ]);

    // The exact-match edge is untouched: provenance marks it as not synthetic.
    expect(provenanceOf(g.edges, 'ts-ui', 'ts-travel-service')).toEqual([undefined]);

    // Exactly two of `ts-order-service`'s fifteen YAML edges have both
    // endpoints in this case: the outgoing one to `ts-travel-service` and the
    // incoming one from `ts-ui`. Both roles of the enhancer are exercised, and
    // every other neighbour is dropped for having no node.
    const semanticEdges = g.edges.filter(
      (e) => edgeProvenance(e as Parameters<typeof edgeProvenance>[0]) === 'semantic-embedding',
    );
    expect(semanticEdges.map((e) => `${e.from}→${e.to}`).sort()).toEqual([
      'ts-alias-order→ts-travel-service',
      'ts-ui→ts-alias-order',
    ]);

    // Its ring-connect edges are gone: a resolved service no longer needs a
    // synthetic edge, and keeping one would hand it a spurious neighbour. Of the
    // ring's three edges, exactly the one that touches neither endpoint of the
    // resolved service survives, because that pair is still unconnected.
    expect(
      g.edges.some(
        (e) =>
          (e.from === 'ts-alias-order' || e.to === 'ts-alias-order') &&
          edgeProvenance(e) === RING_CONNECT,
      ),
    ).toBe(false);
    const unknownPair = ['ts-still-unknown-a', 'ts-still-unknown-b'];
    const survivingRingEdges = g.edges.filter(
      (e) =>
        edgeProvenance(e) === RING_CONNECT &&
        unknownPair.includes(e.from) &&
        unknownPair.includes(e.to),
    );
    expect(survivingRingEdges).toHaveLength(1);

    // Every edge endpoint has a node -- the graph stays consistent.
    for (const edge of g.edges) {
      expect(g.nodes.has(edge.from)).toBe(true);
      expect(g.nodes.has(edge.to)).toBe(true);
    }

    // Statistics: one service resolved by embedding, two still unmatched.
    const firstNode = [...g.nodes.values()][0]!;
    expect(firstNode.labels._diag_embedding).toBe('1');
    expect(firstNode.labels._diag_unconnected).toBe('2');
  });

  it('delegates to the sync builder when the system cannot be identified', async () => {
    const embeddingProvider = createMatchEmbedding(new Map([['anything', 'ts-ui']]), 'TrainTicket');
    const mod = await initializedWithSemantics({ embeddingProvider });

    const serviceIds = ['svc-a', 'svc-b'];
    const sync = mod.buildRCAEvalCallGraph('mystery_case_1', serviceIds);
    const enhanced = await mod.enhanceRCAEvalCallGraph('mystery_case_1', serviceIds);

    expect(enhanced.edges).toEqual(sync.edges);
  });

  it('leaves a zero-similarity provider with nothing to resolve', async () => {
    // A provider that answers every query with a zero vector: no candidate can
    // clear the threshold, so the enhancer returns an empty edge set and the
    // builder falls through to the base graph plus statistics.
    const mod = await initializedWithSemantics({
      embeddingProvider: new DeterministicEmbeddingProvider(new Map()),
    });

    const g = await mod.enhanceRCAEvalCallGraph('re2ss_orders_delay_1', ['orders', 'unknown-svc']);

    expect(g.edges.some((e) => edgeProvenance(e) === 'semantic-embedding')).toBe(false);
    const firstNode = [...g.nodes.values()][0]!;
    expect(firstNode.labels._diag_unconnected).toBe('1');
  });
});
