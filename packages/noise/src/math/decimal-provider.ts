/**
 * Decimal.js-based arbitrary precision provider.
 *
 * Implements the IArbitraryPrecision interface using decimal.js
 * for high-precision computations that exceed IEEE 754 double limits.
 *
 * @module noise/math/decimal-provider
 */

import { Decimal } from 'decimal.js';
import type { IArbitraryPrecision } from '@agentix-e/micro-kinetic-core';

/** Default precision: 50 significant digits. */
const DEFAULT_PRECISION = 50;

/**
 * Decimal.js-based arbitrary precision provider.
 *
 * Wraps decimal.js to provide IArbitraryPrecision operations
 * with configurable precision.
 */
export class DecimalProvider implements IArbitraryPrecision {
  private _precision: number;

  constructor(precision = DEFAULT_PRECISION) {
    this._precision = precision;
    Decimal.set({ precision });
  }

  multiply(a: string, b: string): string {
    return new Decimal(a).times(b).toString();
  }

  ln(value: string): string {
    return new Decimal(value).ln().toString();
  }

  exp(value: string): string {
    return new Decimal(value).exp().toString();
  }

  pow(base: string, exponent: string): string {
    return new Decimal(base).pow(exponent).toString();
  }

  setPrecision(digits: number): void {
    this._precision = digits;
    Decimal.set({ precision: digits });
  }

  get precision(): number {
    return this._precision;
  }
}
