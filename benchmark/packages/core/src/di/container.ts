/**
 * Minimal Dependency Injection container.
 *
 * This implements a lightweight DI container following the AgentiX-E pattern:
 * - Symbol-based token registration
 * - Factory functions for lazy instantiation
 * - Singleton and transient lifetime support
 * - Circular dependency detection
 *
 * Design principles:
 * - Zero external dependencies
 * - Type-safe resolution
 * - Avoids magic strings — everything is Symbol-keyed
 * - The container itself is a contract in core; real assembly happens in kinetic umbrella
 *
 * @module di/container
 */

import type { DIToken } from './tokens.js';

/** Factory function type: creates an instance given the container. */
export type Factory<T> = (container: IContainer) => T;

/** Registration entry in the container. */
interface Registration<T> {
  factory: Factory<T>;
  instance?: T;
  singleton: boolean;
}

/** Minimal DI container interface. */
export interface IContainer {
  /** Register a factory for a token. */
  register<T>(token: symbol, factory: Factory<T>, singleton?: boolean): void;

  /** Resolve a token to its instance. */
  resolve<T>(token: symbol): T;

  /** Check if a token is registered. */
  has(token: symbol): boolean;

  /** Remove a registration. */
  remove(token: symbol): void;

  /** Clear all registrations. */
  clear(): void;
}

/** Error thrown on DI resolution failure. */
export class ContainerResolutionError extends Error {
  constructor(token: DIToken, cause?: string) {
    const tokenStr = Symbol.keyFor(token as symbol) ?? token.toString();
    super(`Failed to resolve DI token: ${tokenStr}${cause ? ` — ${cause}` : ''}`);
    this.name = 'ContainerResolutionError';
  }
}

/** Error thrown on circular dependency detection. */
export class CircularDependencyError extends Error {
  constructor(chain: readonly symbol[]) {
    const chainStr = chain.map((s) => Symbol.keyFor(s) ?? s.toString()).join(' → ');
    super(`Circular dependency detected: ${chainStr}`);
    this.name = 'CircularDependencyError';
  }
}

/**
 * Minimal DI container implementation.
 *
 * Usage:
 * ```typescript
 * const container = new Container();
 * container.register(DI_TOKENS.RCA_ENGINE, (c) => new CollisionTreeRCAEngine(c));
 * const engine = container.resolve(DI_TOKENS.RCA_ENGINE);
 * ```
 */
export class Container implements IContainer {
  private readonly _registrations = new Map<symbol, Registration<unknown>>();
  private readonly _resolving = new Set<symbol>();

  register<T>(token: symbol, factory: Factory<T>, singleton = true): void {
    if (this._registrations.has(token)) {
      throw new ContainerResolutionError(token as DIToken, 'token already registered');
    }
    this._registrations.set(token, { factory: factory as Factory<unknown>, singleton });
  }

  resolve<T>(token: symbol): T {
    const reg = this._registrations.get(token);
    if (!reg) {
      throw new ContainerResolutionError(token as DIToken, 'token not registered');
    }

    // Return cached singleton instance
    if (reg.singleton && reg.instance !== undefined) {
      return reg.instance as T;
    }

    // Detect circular dependencies
    if (this._resolving.has(token)) {
      throw new CircularDependencyError([...this._resolving, token]);
    }

    this._resolving.add(token);
    try {
      const instance = reg.factory(this);
      if (reg.singleton) {
        reg.instance = instance;
      }
      return instance as T;
    } finally {
      this._resolving.delete(token);
    }
  }

  has(token: symbol): boolean {
    return this._registrations.has(token);
  }

  remove(token: symbol): void {
    this._registrations.delete(token);
  }

  clear(): void {
    this._registrations.clear();
    this._resolving.clear();
  }

  /** Get the number of registered tokens. */
  get size(): number {
    return this._registrations.size;
  }
}
