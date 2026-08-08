import { describe, it, expect } from 'vitest';
import type {
  ServiceId,
  EdgeType,
  ServiceNode,
  CallEdge,
  ServiceCallGraph,
  DetectedCycle,
  FaultPropagationGraph,
  PrunedEdgeRecord,
  TreeNodeScore,
  PrunedTree,
} from '@agentix-e/micro-kinetic-core';

describe('Graph types - ServiceNode', () => {
  it('should accept a valid ServiceNode object', () => {
    const node: ServiceNode = {
      id: 'checkoutservice',
      name: 'Checkout Service',
      namespace: 'prod',
      labels: { tier: 'backend', version: 'v2' },
    };
    expect(node.id).toBe('checkoutservice');
    expect(node.name).toBe('Checkout Service');
    expect(node.namespace).toBe('prod');
    expect(node.labels.tier).toBe('backend');
  });

  it('should allow empty labels', () => {
    const node: ServiceNode = {
      id: 'svc-a',
      name: 'Service A',
      namespace: 'default',
      labels: {},
    };
    expect(node.labels).toEqual({});
  });
});

describe('Graph types - CallEdge', () => {
  it('should accept a valid CallEdge', () => {
    const edge: CallEdge = {
      from: 'svc-a',
      to: 'svc-b',
      type: 'gRPC',
      callRate: 100,
      p99Latency: 50,
      errorRate: 0.01,
    };
    expect(edge.from).toBe('svc-a');
    expect(edge.type).toBe('gRPC');
    expect(edge.callRate).toBe(100);
  });

  it('should support all edge types', () => {
    const types: EdgeType[] = ['REST', 'gRPC', 'MQ', 'CALLBACK', 'ASYNC'];
    for (const t of types) {
      const edge: CallEdge = {
        from: 'a', to: 'b', type: t,
        callRate: 1, p99Latency: 1, errorRate: 0,
      };
      expect(edge.type).toBe(t);
    }
  });
});

describe('Graph types - ServiceCallGraph', () => {
  it('should accept a valid ServiceCallGraph', () => {
    const nodes = new Map<ServiceId, ServiceNode>();
    nodes.set('svc-a', { id: 'svc-a', name: 'A', namespace: 'ns', labels: {} });
    const graph: ServiceCallGraph = {
      nodes,
      edges: [],
      systemLoad: 0.5,
    };
    expect(graph.nodes.size).toBe(1);
    expect(graph.systemLoad).toBe(0.5);
  });

  it('should handle multiple nodes and edges', () => {
    const nodes = new Map<ServiceId, ServiceNode>();
    nodes.set('a', { id: 'a', name: 'A', namespace: 'ns', labels: {} });
    nodes.set('b', { id: 'b', name: 'B', namespace: 'ns', labels: {} });
    const edges: CallEdge[] = [
      { from: 'a', to: 'b', type: 'REST', callRate: 10, p99Latency: 5, errorRate: 0 },
    ];
    const graph: ServiceCallGraph = { nodes, edges, systemLoad: 0.2 };
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.length).toBe(1);
  });
});

describe('Graph types - DetectedCycle', () => {
  it('should accept a significant cycle', () => {
    const cycle: DetectedCycle = {
      nodePath: ['a', 'b', 'c', 'a'],
      contribution: 0.01,
      significant: true,
    };
    expect(cycle.nodePath.length).toBe(4);
    expect(cycle.significant).toBe(true);
  });

  it('should accept an insignificant cycle', () => {
    const cycle: DetectedCycle = {
      nodePath: ['x', 'y'],
      contribution: 0.0001,
      significant: false,
    };
    expect(cycle.contribution).toBe(0.0001);
    expect(cycle.significant).toBe(false);
  });
});

describe('Graph types - FaultPropagationGraph', () => {
  it('should accept a valid FaultPropagationGraph', () => {
    const nodes = new Map<ServiceId, ServiceNode>();
    nodes.set('a', { id: 'a', name: 'A', namespace: 'ns', labels: {} });
    const callGraph: ServiceCallGraph = { nodes, edges: [], systemLoad: 0.3 };
    const anomalyScores = new Map<ServiceId, number>();
    anomalyScores.set('a', 0.8);

    const graph: FaultPropagationGraph = {
      callGraph,
      propagationWeights: new Float64Array([0.5, 0.3]),
      anomalyScores,
      detectedCycles: [],
      totalCycleContribution: 0,
      pruneThreshold: 0.001,
    };
    expect(graph.callGraph).toBe(callGraph);
    expect(graph.propagationWeights.length).toBe(2);
    expect(graph.pruneThreshold).toBe(0.001);
  });
});

describe('Graph types - PrunedEdgeRecord', () => {
  it('should accept a valid PrunedEdgeRecord', () => {
    const record: PrunedEdgeRecord = {
      from: 'svc-a',
      to: 'svc-b',
      cycleId: 'cycle-1',
      cycleContribution: 0.0005,
      marginBelowThreshold: 0.0005,
    };
    expect(record.cycleId).toBe('cycle-1');
    expect(record.marginBelowThreshold).toBe(0.0005);
  });
});

describe('Graph types - TreeNodeScore', () => {
  it('should accept a valid TreeNodeScore', () => {
    const score: TreeNodeScore = {
      nodeId: 'svc-x',
      anomalyScore: 0.9,
      childPropagationScore: 0.3,
      totalScore: 1.2,
      depth: 2,
    };
    expect(score.totalScore).toBeCloseTo(1.2);
    expect(score.depth).toBe(2);
  });
});

describe('Graph types - PrunedTree', () => {
  it('should accept a valid PrunedTree with full data', () => {
    const nodes = new Map<ServiceId, TreeNodeScore>();
    nodes.set('a', { nodeId: 'a', anomalyScore: 0.5, childPropagationScore: 0.1, totalScore: 0.6, depth: 0 });
    const rootCauseScores = new Map<ServiceId, number>();
    rootCauseScores.set('a', 0.6);

    const tree: PrunedTree = {
      nodes,
      edges: [],
      rootCauseScores,
      prunedEdges: [],
      cyclesPruned: 0,
      contributionRemoved: 0,
    };
    expect(tree.nodes.size).toBe(1);
    expect(tree.cyclesPruned).toBe(0);
  });
});
