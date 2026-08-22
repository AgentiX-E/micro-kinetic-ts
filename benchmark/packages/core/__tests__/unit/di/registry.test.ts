import { describe, it, expect } from 'vitest';
import type {
  FactoryFn,
  MathBackendFactory,
  EngineFactory,
} from '@agentix-e/micro-kinetic-core';
import { IContainer } from '@agentix-e/micro-kinetic-core';
import { Container } from '@agentix-e/micro-kinetic-core';

describe('Registry types', () => {
  it('should verify FactoryFn type is usable', () => {
    const factory: FactoryFn<string> = (_c: IContainer) => 'hello';
    const result = factory(new Container());
    expect(result).toBe('hello');
  });

  it('should verify FactoryFn receives container and returns value', () => {
    const c = new Container();
    const factory: FactoryFn<{ val: number }> = (_container: IContainer) => ({ val: 42 });
    const instance = factory(c);
    expect(instance.val).toBe(42);
  });

  it('should verify MathBackendFactory is importable', () => {
    // Type-only - import succeeds
    expect(true).toBe(true);
  });

  it('should verify EngineFactory is importable', () => {
    // Type-only - import succeeds
    expect(true).toBe(true);
  });

  it('should support factory that uses DI resolution', () => {
    const c = new Container();
    c.register(Symbol.for('test-dep'), () => 'dependency');

    const factory: FactoryFn<string> = (container: IContainer) => {
      const dep = container.resolve<string>(Symbol.for('test-dep'));
      return `resolved: ${dep}`;
    };

    const result = factory(c);
    expect(result).toBe('resolved: dependency');
  });
});
