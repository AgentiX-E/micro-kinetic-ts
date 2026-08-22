import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  Container,
  ContainerResolutionError,
  CircularDependencyError,
  DI_TOKENS,
} from '@agentix-e/micro-kinetic-core';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('register', () => {
    it('should register and resolve a singleton by default', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => ({ name: 'matrix' }));
      const resolved = container.resolve(DI_TOKENS.MATRIX_OPS);
      expect(resolved).toEqual({ name: 'matrix' });
    });

    it('should return same instance for singleton', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => ({ name: 'matrix' }));
      const a = container.resolve(DI_TOKENS.MATRIX_OPS);
      const b = container.resolve(DI_TOKENS.MATRIX_OPS);
      expect(a).toBe(b);
    });

    it('should create new instance each time for transient', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => ({ name: 'matrix' }), false);
      const a = container.resolve(DI_TOKENS.MATRIX_OPS);
      const b = container.resolve(DI_TOKENS.MATRIX_OPS);
      expect(a).not.toBe(b);
      expect(a).toEqual({ name: 'matrix' });
      expect(b).toEqual({ name: 'matrix' });
    });

    it('should throw ContainerResolutionError on duplicate registration', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'first');
      expect(() => {
        container.register(DI_TOKENS.MATRIX_OPS, () => 'second');
      }).toThrow(ContainerResolutionError);
    });

    it('should include token info in duplicate error', () => {
      container.register(DI_TOKENS.STATISTICS, () => 'first');
      try {
        container.register(DI_TOKENS.STATISTICS, () => 'second');
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as ContainerResolutionError;
        expect(err.message).toContain('token already registered');
      }
    });
  });

  describe('resolve', () => {
    it('should throw ContainerResolutionError for unregistered token', () => {
      expect(() => {
        container.resolve(Symbol('unknown'));
      }).toThrow(ContainerResolutionError);
    });

    it('should include "token not registered" in error for unregistered token', () => {
      try {
        container.resolve(DI_TOKENS.RCA_ENGINE);
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as ContainerResolutionError;
        expect(err.message).toContain('token not registered');
      }
    });

    it('should pass container to factory function', () => {
      let capturedContainer: unknown;
      container.register(DI_TOKENS.MATRIX_OPS, (c) => {
        capturedContainer = c;
        return { name: 'matrix' };
      });
      container.resolve(DI_TOKENS.MATRIX_OPS);
      expect(capturedContainer).toBe(container);
    });

    it('should resolve dependencies through factory', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'matrix');
      container.register(DI_TOKENS.RCA_ENGINE, (c) => `engine-with-${c.resolve(DI_TOKENS.MATRIX_OPS)}`);
      const engine = container.resolve<string>(DI_TOKENS.RCA_ENGINE);
      expect(engine).toBe('engine-with-matrix');
    });

    it('should detect circular dependency', () => {
      container.register(Symbol.for('A'), (c) => c.resolve(Symbol.for('B')), false);
      container.register(Symbol.for('B'), (c) => c.resolve(Symbol.for('A')), false);

      expect(() => {
        container.resolve(Symbol.for('A'));
      }).toThrow(CircularDependencyError);
    });

    it('should detect self-referencing circular dependency', () => {
      const token = Symbol.for('SELF');
      container.register(token, (c) => c.resolve(token), false);

      expect(() => {
        container.resolve(token);
      }).toThrow(CircularDependencyError);
    });

    it('should detect three-way circular dependency', () => {
      const a = Symbol.for('A3');
      const b = Symbol.for('B3');
      const c = Symbol.for('C3');

      container.register(a, (cnt) => cnt.resolve(b), false);
      container.register(b, (cnt) => cnt.resolve(c), false);
      container.register(c, (cnt) => cnt.resolve(a), false);

      expect(() => container.resolve(a)).toThrow(CircularDependencyError);
    });
  });

  describe('has', () => {
    it('should return true for registered token', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'value');
      expect(container.has(DI_TOKENS.MATRIX_OPS)).toBe(true);
    });

    it('should return false for unregistered token', () => {
      expect(container.has(Symbol('unknown'))).toBe(false);
    });

    it('should return false after remove', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'value');
      container.remove(DI_TOKENS.MATRIX_OPS);
      expect(container.has(DI_TOKENS.MATRIX_OPS)).toBe(false);
    });

    it('should return false for empty container', () => {
      expect(container.has(DI_TOKENS.RCA_ENGINE)).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove a registered token', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'value');
      container.remove(DI_TOKENS.MATRIX_OPS);
      expect(() => {
        container.resolve(DI_TOKENS.MATRIX_OPS);
      }).toThrow(ContainerResolutionError);
    });

    it('should not throw when removing non-existent token', () => {
      expect(() => {
        container.remove(Symbol('nonexistent'));
      }).not.toThrow();
    });

    it('should remove without affecting other tokens', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'a');
      container.register(DI_TOKENS.STATISTICS, () => 'b');
      container.remove(DI_TOKENS.MATRIX_OPS);
      expect(container.has(DI_TOKENS.MATRIX_OPS)).toBe(false);
      expect(container.has(DI_TOKENS.STATISTICS)).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all registrations', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'a');
      container.register(DI_TOKENS.STATISTICS, () => 'b');
      container.clear();
      expect(container.has(DI_TOKENS.MATRIX_OPS)).toBe(false);
      expect(container.has(DI_TOKENS.STATISTICS)).toBe(false);
    });

    it('should not throw on empty container', () => {
      expect(() => container.clear()).not.toThrow();
    });

    it('should clear resolving set as well', () => {
      const a = Symbol.for('CLR_A');
      const b = Symbol.for('CLR_B');
      container.register(a, (c) => c.resolve(b), false);
      container.register(b, () => 'b', false);

      // This should work fine
      container.resolve(a);

      // After clear, old circular checks should not interfere
      container.clear();
      container.register(a, () => 'cleared');
      expect(container.resolve(a)).toBe('cleared');
    });
  });

  describe('size', () => {
    it('should return 0 for empty container', () => {
      expect(container.size).toBe(0);
    });

    it('should return correct count after registrations', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'a');
      expect(container.size).toBe(1);
      container.register(DI_TOKENS.STATISTICS, () => 'b');
      expect(container.size).toBe(2);
    });

    it('should decrease after remove', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'a');
      container.register(DI_TOKENS.STATISTICS, () => 'b');
      container.remove(DI_TOKENS.MATRIX_OPS);
      expect(container.size).toBe(1);
    });

    it('should return 0 after clear', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => 'a');
      container.clear();
      expect(container.size).toBe(0);
    });
  });

  describe('singleton vs transient lifecycle', () => {
    it('should default to singleton', () => {
      container.register(DI_TOKENS.MATRIX_OPS, () => ({}));
      const a = container.resolve(DI_TOKENS.MATRIX_OPS);
      const b = container.resolve(DI_TOKENS.MATRIX_OPS);
      expect(a).toBe(b);
    });

    it('should create new instances for transient', () => {
      let calls = 0;
      container.register(DI_TOKENS.MATRIX_OPS, () => {
        calls++;
        return {};
      }, false);
      container.resolve(DI_TOKENS.MATRIX_OPS);
      container.resolve(DI_TOKENS.MATRIX_OPS);
      expect(calls).toBe(2);
    });

    it('should only call factory once for singleton', () => {
      let calls = 0;
      container.register(DI_TOKENS.MATRIX_OPS, () => {
        calls++;
        return {};
      }, true);
      container.resolve(DI_TOKENS.MATRIX_OPS);
      container.resolve(DI_TOKENS.MATRIX_OPS);
      expect(calls).toBe(1);
    });
  });

  describe('error classes', () => {
    it('ContainerResolutionError should set name and message', () => {
      const err = new ContainerResolutionError(DI_TOKENS.MATRIX_OPS, 'test cause');
      expect(err.name).toBe('ContainerResolutionError');
      expect(err.message).toContain('micro-kinetic:MatrixOps');
      expect(err.message).toContain('test cause');
    });

    it('ContainerResolutionError should work without cause', () => {
      const err = new ContainerResolutionError(DI_TOKENS.STATISTICS);
      expect(err.message).not.toContain(' — ');
    });

    it('CircularDependencyError should format chain', () => {
      const a = Symbol.for('A');
      const b = Symbol.for('B');
      const c = Symbol.for('C');
      const err = new CircularDependencyError([a, b, c]);
      expect(err.name).toBe('CircularDependencyError');
      expect(err.message).toContain('A');
      expect(err.message).toContain('B');
      expect(err.message).toContain('C');
      expect(err.message).toContain(' → ');
    });
  });
});

describe('Container - property-based tests', () => {
  it('should always succeed resolution after single registration (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (tokenName) => {
        const c = new Container();
        const token = Symbol.for(`test-${tokenName}`);
        c.register(token, () => tokenName);
        expect(c.resolve(token)).toBe(tokenName);
      }),
      { numRuns: 50 },
    );
  });

  it('should maintain correct size after N registrations (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 100 }),
        (names) => {
          const c = new Container();
          const tokens = names.map((n, i) => Symbol.for(`prop-${i}-${n}`));
          for (const t of tokens) {
            c.register(t, () => t.toString());
          }
          expect(c.size).toBe(tokens.length);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('should not have tokens after clear (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 50 }),
        (names) => {
          const c = new Container();
          const tokens = names.map((n, i) => Symbol.for(`clear-${i}-${n}`));
          for (const t of tokens) {
            c.register(t, () => t.toString());
          }
          c.clear();
          expect(c.size).toBe(0);
          for (const t of tokens) {
            expect(c.has(t)).toBe(false);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('should register and resolve 100+ tokens', () => {
    const c = new Container();
    const tokens: symbol[] = [];
    for (let i = 0; i < 150; i++) {
      tokens.push(Symbol.for(`mass-${i}`));
    }
    for (let i = 0; i < tokens.length; i++) {
      c.register(tokens[i], () => i);
    }
    expect(c.size).toBe(150);
    for (let i = 0; i < tokens.length; i++) {
      expect(c.resolve(tokens[i])).toBe(i);
    }
  });
});

describe('ContainerResolutionError', () => {
  it('should handle Symbol without keyFor', () => {
    const localSym = Symbol('local');
    const err = new ContainerResolutionError(localSym as unknown as typeof DI_TOKENS.MATRIX_OPS);
    expect(err.message).toContain('Failed to resolve DI token');
  });
});

describe('CircularDependencyError', () => {
  it('should handle symbols without keyFor', () => {
    const localSym = Symbol('no-key');
    const err = new CircularDependencyError([localSym]);
    expect(err.message).toContain('Circular dependency');
  });
});
