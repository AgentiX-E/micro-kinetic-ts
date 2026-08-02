/**
 * FixedWindowCutter — simple N-equal-partition cutting strategy.
 *
 * ## Theoretical Mapping (邓煜切割算法)
 *
 * In Deng Yu's cutting algorithm, the simplest strategy is to partition
 * the long-time interval [0,T] into N equal segments. While not adaptive,
 * this provides a baseline convergence check:
 *
 *   - When the degradation is truly uniform (linear memory leak),
 *     fixed windows are sufficient to detect convergence.
 *   - When the degradation rate varies (exponential or power-law),
 *     fixed windows may miss the convergence window — adaptive
 *     refinement is required.
 *
 * This implementation serves as both a production cutter for simple
 * degradation patterns and as a baseline for benchmarking the
 * adaptive cutter.
 *
 * @module segmentation/fixed-cutter
 */

import * as np from 'numpy-ts';

import type {
  ChronicFaultIndicator,
  ConvergenceResult,
  CuttingOptions,
  CuttingWindow,
  IContainer,
  ICuttingEngine,
  LocalErrorBound,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_CUTTING_OPTIONS,
  invariant,
  invariantFinite,
  invariantNonEmpty,
  invariantPositiveInt,
} from '@agentix-e/micro-kinetic-core';

import { InductionProver } from '../convergence/induction-prover.js';
import { computeKineticEnergyBound } from './adaptive-cutter.js';

/** Minimum valid window duration (10 seconds). */
const MIN_WINDOW_MS = 10_000;

/**
 * Fixed-window cutting engine: partitions the time series into N equal
 * non-overlapping windows. No adaptive refinement.
 */
export class FixedWindowCutter implements ICuttingEngine {
  private readonly inductionProver: InductionProver;

  constructor(_container?: IContainer) {
    this.inductionProver = new InductionProver();
  }

  /**
   * Segment the time series into N equal cutting windows.
   *
   * @param ts - Full time series
   * @param options - Cutting parameters; adaptive flag is ignored
   * @returns N equal-sized CuttingWindow instances
   */
  segment(ts: TimeSeries, options?: CuttingOptions): CuttingWindow[] {
    const opts = options ?? DEFAULT_CUTTING_OPTIONS;
    this.validateInputs(ts, opts);

    const T = this.computeDuration(ts);
    const delta = T / opts.maxWindows;
    const windows: CuttingWindow[] = [];

    for (let j = 0; j < opts.maxWindows; j++) {
      const startTime = ts.timestamps[0]! + j * delta;
      const endTime =
        j === opts.maxWindows - 1
          ? ts.timestamps[ts.timestamps.length - 1]!
          : ts.timestamps[0]! + (j + 1) * delta;

      const slice = this.extractSlice(ts, startTime, endTime);
      const degradationRate = this.computeDegradationRate(slice);
      const durationMs = endTime - startTime;
      const durationHours = durationMs / 3_600_000;
      const localErrorBound = computeKineticEnergyBound(degradationRate, durationHours);

      windows.push({
        index: j,
        startTime,
        endTime,
        duration: durationMs,
        slice,
        degradationRate,
        localErrorBound,
      });
    }

    return windows;
  }

  /**
   * Estimate local error bounds for fixed windows.
   */
  estimateLocalBounds(windows: readonly CuttingWindow[], metric: string): LocalErrorBound[] {
    invariant(windows.length > 0, 'Windows must not be empty');

    return windows.map((window, idx) => ({
      windowIndex: idx,
      startTime: window.startTime,
      endTime: window.endTime,
      degradationRate: window.degradationRate,
      errorBound: window.localErrorBound,
      indicators: this.detectIndicators(window, metric),
    }));
  }

  /**
   * Prove convergence using the induction prover over fixed windows.
   */
  proveConvergence(
    localBounds: readonly LocalErrorBound[],
    globalTolerance: number,
  ): ConvergenceResult {
    invariant(localBounds.length > 0, 'Local bounds must not be empty');
    invariantFinite(globalTolerance, 'globalTolerance');

    const errorSequence = localBounds.map((b) => b.errorBound);
    return this.inductionProver.prove(errorSequence, globalTolerance);
  }

  // ── Private helpers ────────────────────────────────────

  private validateInputs(ts: TimeSeries, opts: CuttingOptions): void {
    invariantNonEmpty(ts.timestamps, 'TimeSeries.timestamps');
    invariantPositiveInt(opts.maxWindows, 'maxWindows');
    invariant(ts.timestamps.length >= 2, 'Time series must have at least 2 data points');
    invariant(ts.timestamps.length === ts.values.length, 'Timestamps and values must match');
  }

  private computeDuration(ts: TimeSeries): number {
    return ts.timestamps[ts.timestamps.length - 1]! - ts.timestamps[0]!;
  }

  private extractSlice(ts: TimeSeries, startTime: number, endTime: number): TimeSeries {
    const timestamps: number[] = [];
    const values: number[] = [];

    for (let i = 0; i < ts.timestamps.length; i++) {
      const t = ts.timestamps[i]!;
      if (t >= startTime && t <= endTime) {
        timestamps.push(t);
        values.push(ts.values[i]!);
      }
    }

    // Fallback: if no points in range, use nearest point
    if (timestamps.length === 0) {
      const middle = (startTime + endTime) / 2;
      let nearestIdx = 0;
      let nearestDist = Math.abs(ts.timestamps[0]! - middle);

      for (let i = 1; i < ts.timestamps.length; i++) {
        const dist = Math.abs(ts.timestamps[i]! - middle);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      timestamps.push(ts.timestamps[nearestIdx]!);
      values.push(ts.values[nearestIdx]!);
    }

    return {
      label: ts.label,
      timestamps,
      values: new Float64Array(values),
      unit: ts.unit,
    };
  }

  /**
   * Compute degradation rate using numpy-ts linear regression.
   * r_j = slope of linear fit over the window.
   */
  private computeDegradationRate(slice: TimeSeries): number {
    const n = slice.timestamps.length;
    if (n < 2) return 0;

    const tArr = np.array(slice.timestamps.map((t) => (t - slice.timestamps[0]!) / 3_600_000));
    const vArr = np.array([...slice.values]);

    const coeffs = np.polyfit(tArr, vArr, 1);
    const slope = (coeffs.tolist() as number[])[0]!;

    return Math.abs(slope);
  }

  private detectIndicators(window: CuttingWindow, metric: string): ChronicFaultIndicator[] {
    if (window.degradationRate <= 0) return [];

    const values = [...window.slice.values];
    const absoluteTimestamps = [...window.slice.timestamps];
    const t0 = absoluteTimestamps[0]!;
    const relativeTimes = absoluteTimestamps.map((t) => t - t0);

    const temporalCorrelation = computeCorrelation(relativeTimes, values);
    const isMonotonic = values.every((v, i) => i === 0 || v >= values[i - 1]!);

    return [
      {
        metric,
        degradationRate: window.degradationRate,
        temporalCorrelation,
        isMonotonic,
      },
    ];
  }
}

function computeCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;

  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let xVar = 0;
  let yVar = 0;

  for (let i = 0; i < n; i++) {
    const xd = xs[i]! - xMean;
    const yd = ys[i]! - yMean;
    cov += xd * yd;
    xVar += xd * xd;
    yVar += yd * yd;
  }

  if (xVar === 0 || yVar === 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(cov / Math.sqrt(xVar * yVar))));
}
