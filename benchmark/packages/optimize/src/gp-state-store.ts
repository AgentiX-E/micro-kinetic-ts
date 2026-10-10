/**
 * GPStateStore — save/load Gaussian Process state via IKeyValueStore.
 *
 * Persists observation vectors (X, y) and Cholesky factors (L, alpha)
 * so that optimization can resume across process restarts.
 *
 * @packageDocumentation
 */

import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';
import type { GaussianProcess } from './gaussian-process.js';

export interface GPState {
  /** Observation vectors, each length = D (parameter dimensions) */
  readonly X: readonly (readonly number[])[];
  /** Observed accuracy values */
  readonly y: readonly number[];
  /** GP hyper-parameters */
  readonly options: {
    readonly lengthScale: number | readonly number[];
    readonly signalVariance: number;
    readonly noiseVariance: number;
  };
}

export class GPStateStore {
  private readonly store: IKeyValueStore;

  constructor(store: IKeyValueStore) {
    this.store = store;
  }

  /** Save GP state for a given session */
  async save(sessionId: string, state: GPState): Promise<void> {
    await this.store.set(`gp:${sessionId}:state`, state);
  }

  /** Load GP state for a given session. Returns null if not found. */
  async load(sessionId: string): Promise<GPState | null> {
    return this.store.get<GPState>(`gp:${sessionId}:state`);
  }

  /** Remove GP state for a session */
  async delete(sessionId: string): Promise<void> {
    await this.store.delete(`gp:${sessionId}:state`);
  }

  /** List all saved GP session IDs */
  async listSessions(): Promise<string[]> {
    const raw = await this.store.keys('gp:');
    const ids = new Set<string>();
    for (const k of raw) {
      const m = k.match(/^gp:(.+):state$/);
      if (m) ids.add(m[1]!);
    }
    return [...ids];
  }
}

/** Extract GP state from a GaussianProcess instance (snapshot). */
export function extractGPState(gp: GaussianProcess): GPState {
  // Read the true hyperparameters and observations through the public
  // accessors (GaussianProcess exposes lengthScale / signalVariance /
  // noiseVariance / observationXs / observationYs for persistence).
  return {
    X: gp.observationXs.map((x) => Array.from(x)),
    y: Array.from(gp.observationYs),
    options: {
      lengthScale: gp.lengthScale,
      signalVariance: gp.signalVariance,
      noiseVariance: gp.noiseVariance,
    },
  };
}
