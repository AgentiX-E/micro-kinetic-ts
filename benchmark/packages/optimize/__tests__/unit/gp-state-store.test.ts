import { describe, expect, it, beforeEach } from 'vitest';
import { GPStateStore, extractGPState } from '../../src/gp-state-store.js';
import type { GPState } from '../../src/gp-state-store.js';
import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';

function makeMemoryStore(): IKeyValueStore {
  const map = new Map<string, string>();
  return {
    get: async <T>(k: string) => {
      const v = map.get(k);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    set: async <T>(k: string, v: T) => {
      map.set(k, JSON.stringify(v));
    },
    delete: async (k: string) => {
      map.delete(k);
    },
    has: async (k: string) => map.has(k),
    keys: async (p?: string) => {
      const all = [...map.keys()];
      return p ? all.filter((k) => k.startsWith(p)) : all;
    },
    clear: async () => map.clear(),
    close: async () => map.clear(),
  };
}

function makeState(overrides?: Partial<GPState>): GPState {
  return {
    X: [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ],
    y: [0.8, 0.9],
    options: {
      lengthScale: 1.0,
      signalVariance: 0.5,
      noiseVariance: 0.01,
    },
    ...overrides,
  };
}

describe('GPStateStore', () => {
  let store: GPStateStore;

  beforeEach(() => {
    store = new GPStateStore(makeMemoryStore());
  });

  it('should save and load GP state', async () => {
    const state = makeState();
    await store.save('session-1', state);

    const loaded = await store.load('session-1');
    expect(loaded).toEqual(state);
  });

  it('should return null for non-existent session', async () => {
    expect(await store.load('non-existent')).toBeNull();
  });

  it('should delete saved state', async () => {
    await store.save('s1', makeState());
    await store.delete('s1');
    expect(await store.load('s1')).toBeNull();
  });

  it('should list saved sessions', async () => {
    await store.save('a', makeState());
    await store.save('b', makeState());

    const sessions = await store.listSessions();
    expect(sessions.sort()).toEqual(['a', 'b']);
  });

  it('should handle overwrite (same session, new state)', async () => {
    const s1 = makeState();
    const s2 = makeState({ y: [0.5, 0.6] });

    await store.save('session', s1);
    await store.save('session', s2);

    const loaded = await store.load('session');
    expect(loaded!.y).toEqual([0.5, 0.6]);
  });

  it('should preserve Float64Array-compatible arrays', async () => {
    const state = makeState({
      X: [
        [1.23456789, 9.87654321],
      ],
    });
    await store.save('precision', state);

    const loaded = await store.load('precision');
    expect(loaded!.X[0]![0]).toBeCloseTo(1.23456789, 8);
    expect(loaded!.X[0]![1]).toBeCloseTo(9.87654321, 8);
  });

  it('should not list deleted in sessions', async () => {
    await store.save('keep', makeState());
    await store.save('remove', makeState());
    await store.delete('remove');

    const sessions = await store.listSessions();
    expect(sessions).toEqual(['keep']);
  });

  it('should handle empty state (no observations)', async () => {
    const empty: GPState = {
      X: [],
      y: [],
      options: { lengthScale: 1, signalVariance: 0.5, noiseVariance: 0.01 },
    };
    await store.save('empty', empty);
    const loaded = await store.load('empty');
    expect(loaded?.X).toEqual([]);
    expect(loaded?.y).toEqual([]);
  });
});
