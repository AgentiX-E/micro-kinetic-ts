/**
 * Graph-related exceptions.
 *
 * @module exceptions/graph
 */

import { KineticError } from './base.js';

/** Thrown when a cycle is detected that exceeds the prune threshold. */
export class GraphCycleError extends KineticError {
  /** Number of cycles exceeding threshold */
  readonly cycleCount: number;
  /** Maximum cycle contribution found */
  readonly maxContribution: number;

  constructor(cycleCount: number, maxContribution: number) {
    super(
      `${cycleCount} cycles exceed prune threshold (max contribution: ${maxContribution})`,
      'GRAPH_CYCLE_ERROR',
    );
    this.name = 'GraphCycleError';
    this.cycleCount = cycleCount;
    this.maxContribution = maxContribution;
  }
}

/** Thrown when pruning fails to produce a tree. */
export class PruningFailureError extends KineticError {
  /** Remaining cycles after pruning */
  readonly remainingCycles: number;

  constructor(remainingCycles: number) {
    super(`Pruning failed: ${remainingCycles} cycles remain in graph`, 'PRUNING_FAILURE');
    this.name = 'PruningFailureError';
    this.remainingCycles = remainingCycles;
  }
}

/** Thrown when a graph is disconnected. */
export class DisconnectedGraphError extends KineticError {
  constructor() {
    super('Service call graph is disconnected', 'DISCONNECTED_GRAPH');
    this.name = 'DisconnectedGraphError';
  }
}

/** Thrown when the graph is empty (no nodes or no edges). */
export class EmptyGraphError extends KineticError {
  constructor() {
    super('Service call graph is empty', 'EMPTY_GRAPH');
    this.name = 'EmptyGraphError';
  }
}
