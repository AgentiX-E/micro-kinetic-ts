import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CUTTING_OPTIONS,
} from '@agentix-e/micro-kinetic-core';
import type {
  TimeSeries,
  MetricSnapshot,
  CuttingWindow,
  CuttingOptions,
  CuttingQualityMetrics,
  CuttingSchedule,
} from '@agentix-e/micro-kinetic-core';

describe('TimeSeries types - TimeSeries', () => {
  it('should accept a valid TimeSeries', () => {
    const ts: TimeSeries = {
      label: 'cpu_usage',
      timestamps: [1000, 2000, 3000],
      values: new Float64Array([50, 55, 60]),
      unit: 'percent',
    };
    expect(ts.label).toBe('cpu_usage');
    expect(ts.timestamps.length).toBe(3);
    expect(ts.values.length).toBe(3);
  });

  it('should handle single data point', () => {
    const ts: TimeSeries = {
      label: 'mem_rss',
      timestamps: [1000],
      values: new Float64Array([1024]),
      unit: 'MB',
    };
    expect(ts.values[0]).toBe(1024);
  });
});

describe('TimeSeries types - MetricSnapshot', () => {
  it('should accept a valid MetricSnapshot', () => {
    const snapshot: MetricSnapshot = {
      serviceId: 'svc-a',
      timestamp: 1000000,
      metrics: { cpu: 50, mem: 1024 },
    };
    expect(snapshot.serviceId).toBe('svc-a');
    expect(snapshot.metrics.cpu).toBe(50);
  });

  it('should handle empty metrics', () => {
    const snapshot: MetricSnapshot = {
      serviceId: 'svc-b',
      timestamp: 2000000,
      metrics: {},
    };
    expect(Object.keys(snapshot.metrics).length).toBe(0);
  });
});

describe('TimeSeries types - CuttingWindow', () => {
  it('should accept a valid CuttingWindow', () => {
    const ts: TimeSeries = {
      label: 'cpu',
      timestamps: [1000, 2000],
      values: new Float64Array([50, 55]),
      unit: 'percent',
    };
    const window: CuttingWindow = {
      index: 0,
      startTime: 1000,
      endTime: 2000,
      duration: 1000,
      slice: ts,
      degradationRate: 0.005,
      localErrorBound: 0.0001,
    };
    expect(window.index).toBe(0);
    expect(window.duration).toBe(1000);
  });
});

describe('TimeSeries types - CuttingOptions', () => {
  it('should accept valid CuttingOptions', () => {
    const opts: CuttingOptions = {
      maxWindows: 100,
      minWindowDurationMs: 1000,
      adaptive: true,
    };
    expect(opts.maxWindows).toBe(100);
    expect(opts.adaptive).toBe(true);
  });

  it('should accept non-adaptive options', () => {
    const opts: CuttingOptions = {
      maxWindows: 50,
      minWindowDurationMs: 5000,
      adaptive: false,
    };
    expect(opts.adaptive).toBe(false);
  });
});

describe('TimeSeries types - DEFAULT_CUTTING_OPTIONS', () => {
  it('should export DEFAULT_CUTTING_OPTIONS', () => {
    expect(DEFAULT_CUTTING_OPTIONS).toBeDefined();
  });

  it('should have correct default values', () => {
    expect(DEFAULT_CUTTING_OPTIONS.maxWindows).toBeGreaterThan(0);
    expect(DEFAULT_CUTTING_OPTIONS.minWindowDurationMs).toBeGreaterThan(0);
  });

  it('should match the expected default shape', () => {
    expect(DEFAULT_CUTTING_OPTIONS).toHaveProperty('maxWindows');
    expect(DEFAULT_CUTTING_OPTIONS).toHaveProperty('minWindowDurationMs');
    expect(DEFAULT_CUTTING_OPTIONS).toHaveProperty('adaptive');
  });
});

describe('TimeSeries types - CuttingQualityMetrics', () => {
  it('should accept valid CuttingQualityMetrics', () => {
    const metrics: CuttingQualityMetrics = {
      totalWindows: 10,
      adaptiveRefinements: 3,
      entropy: 1.5,
      maxLocalError: 0.001,
      convergenceRate: 0.1,
    };
    expect(metrics.totalWindows).toBe(10);
    expect(metrics.entropy).toBe(1.5);
  });
});

describe('TimeSeries types - CuttingSchedule', () => {
  it('should accept a converged CuttingSchedule', () => {
    const ts: TimeSeries = {
      label: 'test', timestamps: [0, 1000], values: new Float64Array([1, 2]), unit: 'count',
    };
    const window: CuttingWindow = {
      index: 0, startTime: 0, endTime: 1000, duration: 1000,
      slice: ts, degradationRate: 0, localErrorBound: 0,
    };
    const schedule: CuttingSchedule = {
      totalDuration: 1000,
      windows: [window],
      converged: true,
      convergenceTimeUpperBound: 500,
      quality: { totalWindows: 1, adaptiveRefinements: 0, entropy: 0, maxLocalError: 0, convergenceRate: 0 },
    };
    expect(schedule.converged).toBe(true);
    expect(schedule.convergenceTimeUpperBound).toBe(500);
  });

  it('should accept a non-converged CuttingSchedule', () => {
    const schedule: CuttingSchedule = {
      totalDuration: 1000,
      windows: [],
      converged: false,
      quality: { totalWindows: 0, adaptiveRefinements: 0, entropy: 0, maxLocalError: 0, convergenceRate: 0 },
    };
    expect(schedule.converged).toBe(false);
    expect(schedule.convergenceTimeUpperBound).toBeUndefined();
  });
});
