import { describe, it, expect } from 'vitest';
import {
  GraphCycleError,
  PruningFailureError,
  DisconnectedGraphError,
  EmptyGraphError,
  KineticError,
} from '@agentix-e/micro-kinetic-core';

describe('GraphCycleError', () => {
  it('should create with cycleCount and maxContribution', () => {
    const err = new GraphCycleError(3, 0.005);
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('GraphCycleError');
    expect(err.errorCode).toBe('GRAPH_CYCLE_ERROR');
    expect(err.cycleCount).toBe(3);
    expect(err.maxContribution).toBe(0.005);
  });

  it('should include count and contribution in message', () => {
    const err = new GraphCycleError(5, 0.01);
    expect(err.message).toContain('5');
    expect(err.message).toContain('0.01');
  });

  it('should handle single cycle', () => {
    const err = new GraphCycleError(1, 0.002);
    expect(err.cycleCount).toBe(1);
  });

  it('should handle zero max contribution', () => {
    const err = new GraphCycleError(0, 0);
    expect(err.maxContribution).toBe(0);
  });
});

describe('PruningFailureError', () => {
  it('should create with remainingCycles', () => {
    const err = new PruningFailureError(2);
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('PruningFailureError');
    expect(err.errorCode).toBe('PRUNING_FAILURE');
    expect(err.remainingCycles).toBe(2);
  });

  it('should include remaining cycles in message', () => {
    const err = new PruningFailureError(5);
    expect(err.message).toContain('5');
    expect(err.message).toContain('cycles');
  });

  it('should handle zero remaining cycles', () => {
    const err = new PruningFailureError(0);
    expect(err.remainingCycles).toBe(0);
  });

  it('should chain to KineticError', () => {
    const err = new PruningFailureError(3);
    expect(err instanceof KineticError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('DisconnectedGraphError', () => {
  it('should create with default message', () => {
    const err = new DisconnectedGraphError();
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('DisconnectedGraphError');
    expect(err.message).toBe('Service call graph is disconnected');
    expect(err.errorCode).toBe('DISCONNECTED_GRAPH');
  });

  it('should chain correctly', () => {
    const err = new DisconnectedGraphError();
    expect(err instanceof KineticError).toBe(true);
  });
});

describe('EmptyGraphError', () => {
  it('should create with default message', () => {
    const err = new EmptyGraphError();
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('EmptyGraphError');
    expect(err.message).toBe('Service call graph is empty');
    expect(err.errorCode).toBe('EMPTY_GRAPH');
  });

  it('should chain correctly', () => {
    const err = new EmptyGraphError();
    expect(err instanceof KineticError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
