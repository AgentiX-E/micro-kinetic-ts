import { describe, it, expect } from 'vitest';
import { registerScalingFactories } from '../../../src/di/factories.js';
import { DI_TOKENS, Container } from '@agentix-e/micro-kinetic-core';

describe('registerScalingFactories', () => {
  // ── Token registration ───────────────────────────────
  it('should register HierarchyBuilder token', () => {
    const container = new Container();
    registerScalingFactories(container);
    expect(container.has(Symbol.for('micro-kinetic:HierarchyBuilder'))).toBe(true);
  });

  it('should register HIERARCHY_TRUNCATOR token', () => {
    const container = new Container();
    registerScalingFactories(container);
    expect(container.has(DI_TOKENS.HIERARCHY_TRUNCATOR)).toBe(true);
  });

  it('should register SCALING_ANALYZER token', () => {
    const container = new Container();
    registerScalingFactories(container);
    expect(container.has(DI_TOKENS.SCALING_ANALYZER)).toBe(true);
  });

  it('should register FaultProbabilityAsymptotics token', () => {
    const container = new Container();
    registerScalingFactories(container);
    expect(container.has(Symbol.for('micro-kinetic:FaultProbabilityAsymptotics'))).toBe(true);
  });

  // ── Instance resolution ──────────────────────────────
  it('should resolve HierarchyBuilder instance', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(Symbol.for('micro-kinetic:HierarchyBuilder'));
    expect(instance).toBeDefined();
  });

  it('should resolve HierarchyBuilder with computeBBGKYHierarchy method', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(Symbol.for('micro-kinetic:HierarchyBuilder'));
    expect(typeof instance.computeBBGKYHierarchy).toBe('function');
  });

  it('should resolve HIERARCHY_TRUNCATOR instance', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(DI_TOKENS.HIERARCHY_TRUNCATOR);
    expect(instance).toBeDefined();
  });

  it('should resolve HIERARCHY_TRUNCATOR with findTruncationOrder method', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(DI_TOKENS.HIERARCHY_TRUNCATOR);
    expect(typeof instance.findTruncationOrder).toBe('function');
  });

  it('should resolve SCALING_ANALYZER instance', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(DI_TOKENS.SCALING_ANALYZER);
    expect(instance).toBeDefined();
  });

  it('should resolve SCALING_ANALYZER with estimateFaultProbability method', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(DI_TOKENS.SCALING_ANALYZER);
    expect(typeof instance.estimateFaultProbability).toBe('function');
  });

  it('should resolve FaultProbabilityAsymptotics instance', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(Symbol.for('micro-kinetic:FaultProbabilityAsymptotics'));
    expect(instance).toBeDefined();
  });

  it('should resolve FaultProbabilityAsymptotics with firstOrder method', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(Symbol.for('micro-kinetic:FaultProbabilityAsymptotics'));
    expect(typeof instance.firstOrder).toBe('function');
  });

  it('should resolve FaultProbabilityAsymptotics with secondOrder method', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(Symbol.for('micro-kinetic:FaultProbabilityAsymptotics'));
    expect(typeof instance.secondOrder).toBe('function');
  });

  // ── SCALING_ANALYZER depends on HierarchyBuilder and HIERARCHY_TRUNCATOR ──
  it('should resolve SCALING_ANALYZER with computeBBGKYHierarchy method', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(DI_TOKENS.SCALING_ANALYZER);
    expect(typeof instance.computeBBGKYHierarchy).toBe('function');
  });

  it('should resolve SCALING_ANALYZER with truncateHierarchy method', () => {
    const container = new Container();
    registerScalingFactories(container);
    const instance = container.resolve(DI_TOKENS.SCALING_ANALYZER);
    expect(typeof instance.truncateHierarchy).toBe('function');
  });

  // ── Double registration error ────────────────────────
  it('should throw when registering same token twice', () => {
    const container = new Container();
    registerScalingFactories(container);
    expect(() => registerScalingFactories(container)).toThrow();
  });

  // ── Resolution of unregistered token ──────────────────
  it('should throw for unregistered token', () => {
    const container = new Container();
    expect(() => container.resolve(Symbol.for('unknown-token'))).toThrow();
  });

  // ── Container size after registration ─────────────────
  it('should register exactly 4 tokens', () => {
    const container = new Container();
    registerScalingFactories(container);
    expect(container.size).toBe(4);
  });

  // ── Tokens not registered before calling ─────────────
  it('should not have tokens before registration', () => {
    const container = new Container();
    expect(container.has(Symbol.for('micro-kinetic:HierarchyBuilder'))).toBe(false);
  });

  it('should not have SCALING_ANALYZER before registration', () => {
    const container = new Container();
    expect(container.has(DI_TOKENS.SCALING_ANALYZER)).toBe(false);
  });
});
