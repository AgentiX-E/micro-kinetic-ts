import { describe, expect, it } from 'vitest';

import type { CandidateFingerprint } from '../../packages/ai/src/agent/index.js';
import type { HeadroomCase } from '../src/agentic-headroom.js';
import {
  formatGateCeiling,
  formatRecallCurve,
  gateCeilingOf,
  recallCurveOf,
} from '../src/agentic-protocol-ceiling.js';

function candidate(service: string, rank: number): CandidateFingerprint {
  return { service, rank, score: 1 - rank * 0.1, channels: [] };
}

function oneCase(
  datapack: string,
  accepted: readonly string[],
  services: readonly string[],
): HeadroomCase {
  return {
    datapack,
    faultType: 'PodKill',
    accepted,
    candidates: services.map((service, index) => candidate(service, index)),
  };
}

const population: readonly HeadroomCase[] = [
  oneCase('a', ['x'], ['x', 'y', 'z']), // engine right
  oneCase('b', ['z'], ['x', 'y', 'z']), // engine wrong, arm may fix
  oneCase('c', ['absent'], ['x', 'y', 'z']), // unreachable
];

describe('gateCeilingOf', () => {
  it('is the engine when the arm is the engine', () => {
    const ceiling = gateCeilingOf(population, (one) => one.candidates.map((c) => c.service));
    expect(ceiling.engine).toBe(1);
    expect(ceiling.arm).toBe(1);
    expect(ceiling.union).toBe(1);
    expect(ceiling.armOnly).toBe(0);
    expect(ceiling.engineOnly).toBe(0);
  });

  it('credits the arm only where it beats the engine, which is the whole of its contribution', () => {
    const ceiling = gateCeilingOf(population, (one) =>
      one.datapack === 'b' ? ['z', 'x', 'y'] : one.candidates.map((c) => c.service),
    );
    expect(ceiling.engine).toBe(1);
    expect(ceiling.arm).toBe(2);
    expect(ceiling.union).toBe(2);
    expect(ceiling.armOnly).toBe(1);
    expect(ceiling.engineOnly).toBe(0);
  });

  it('counts a loss as a loss, so a union cannot hide a harmful move', () => {
    const ceiling = gateCeilingOf(population, (one) =>
      one.datapack === 'a' ? ['y', 'x', 'z'] : one.candidates.map((c) => c.service),
    );
    expect(ceiling.arm).toBe(0);
    expect(ceiling.union).toBe(1);
    expect(ceiling.engineOnly).toBe(1);
    expect(ceiling.armOnly).toBe(0);
  });

  it('separates the reader bound from the protocol bound', () => {
    const ceiling = gateCeilingOf(population, () => []);
    expect(ceiling.reader).toBe(2);
    expect(ceiling.unreachable).toBe(1);
    expect(ceiling.cases).toBe(3);
  });

  it('reads an empty order as the engine rather than as an abstention from scoring', () => {
    const ceiling = gateCeilingOf([population[0]!], () => []);
    expect(ceiling.arm).toBe(1);
    expect(ceiling.engineOnly).toBe(0);
  });

  it('counts an empty posterior as neither reachable nor answered', () => {
    const empty: HeadroomCase = {
      datapack: 'e',
      faultType: 'PodKill',
      accepted: ['x'],
      candidates: [],
    };
    const ceiling = gateCeilingOf([empty], () => []);
    expect(ceiling.engine).toBe(0);
    expect(ceiling.arm).toBe(0);
    expect(ceiling.unreachable).toBe(1);
  });
});

describe('recallCurveOf', () => {
  const orders = [
    { accepted: ['x'], order: ['x', 'y', 'z'] },
    { accepted: ['z'], order: ['x', 'y', 'z'] },
    { accepted: ['absent'], order: ['x', 'y', 'z'] },
  ];

  it('is monotone in depth and never exceeds the population', () => {
    const curve = recallCurveOf(orders, [1, 2, 3, 10]);
    const shares = curve.map((point) => point.reached);
    expect(shares).toEqual([1, 1, 2, 2]);
    expect(curve[0]!.k).toBe(1);
    expect(curve[3]!.k).toBe(10);
  });

  it('sorts the depths it was asked for', () => {
    expect(recallCurveOf(orders, [3, 1]).map((point) => point.k)).toEqual([1, 3]);
  });

  it('is zero on an empty population rather than NaN', () => {
    expect(recallCurveOf([], [1, 5]).map((point) => point.share)).toEqual([0, 0]);
  });

  it('treats a negative or fractional depth as a clamp, not as a crash', () => {
    expect(recallCurveOf(orders, [-2]).map((point) => point.reached)).toEqual([0]);
    expect(recallCurveOf(orders, [1.9]).map((point) => point.reached)).toEqual([1]);
  });
});

describe('formatGateCeiling', () => {
  it('prints one row per protocol with every column', () => {
    const ceiling = gateCeilingOf(population, () => []);
    const text = formatGateCeiling([
      { label: 'elimination', ceiling },
      { label: 'nomination', ceiling },
    ]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('reader');
    expect(lines[1]).toContain('elimination');
    expect(lines[2]).toContain('nomination');
    expect(lines[1]).toContain('66.7%');
  });

  it('does not divide by zero on an empty population', () => {
    const ceiling = gateCeilingOf([], () => []);
    expect(formatGateCeiling([{ label: 'x', ceiling }])).toContain('0.0%');
  });
});

describe('formatRecallCurve', () => {
  it('prints every rung and the population', () => {
    const text = formatRecallCurve(recallCurveOf([{ accepted: ['x'], order: ['x'] }], [1]), 1);
    expect(text).toContain('depth');
    expect(text).toContain('100.0%');
    expect(text).toContain('population: 1 cases');
  });
});
