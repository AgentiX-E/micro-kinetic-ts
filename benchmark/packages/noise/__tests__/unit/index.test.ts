import { describe, it, expect } from 'vitest';
import {
  DecimalProvider,
  StatisticsProvider,
  CouplingSparsityAnalyzer,
  IndependenceChecker,
  StossDenoiser,
  registerNoiseFactories,
} from '../../src/index.js';

describe('Noise barrel exports', () => {
  it('should export DecimalProvider', () => {
    expect(DecimalProvider).toBeDefined();
  });

  it('should export StatisticsProvider', () => {
    expect(StatisticsProvider).toBeDefined();
  });

  it('should export CouplingSparsityAnalyzer', () => {
    expect(CouplingSparsityAnalyzer).toBeDefined();
  });

  it('should export IndependenceChecker', () => {
    expect(IndependenceChecker).toBeDefined();
  });

  it('should export StossDenoiser', () => {
    expect(StossDenoiser).toBeDefined();
  });

  it('should export registerNoiseFactories', () => {
    expect(registerNoiseFactories).toBeDefined();
  });
});
