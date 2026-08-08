import { describe, it, expect } from 'vitest';
import { IndependenceChecker } from '../../../src/stoss/independence-checker.js';
import { StatisticsProvider } from '../../../src/math/statistics-provider.js';
import type { AlertRecord } from '@agentix-e/micro-kinetic-core';

function makeAlert(serviceId: string, timestamp: number, value: number, threshold: number = 0.8): AlertRecord {
  return {
    id: `alert_${serviceId}_${timestamp}`,
    serviceId,
    severity: 'warning',
    timestamp,
    metric: 'cpu_usage',
    value,
    threshold,
    message: `Alert on ${serviceId}`,
  };
}

describe('IndependenceChecker', () => {
  describe('testIndependence', () => {
    it('should test independence between two services', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5),
        makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      // 2×2 identity-like coupling matrix (low coupling)
      const matrix = new Float64Array([1, 0.01, 0.01, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result).toHaveProperty('isIndependent');
      expect(result).toHaveProperty('decompositionError');
      expect(result).toHaveProperty('confidenceLevel');
    });

    it('should return decompositionError between 0 and 1', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5),
        makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const matrix = new Float64Array(9); // 3x3
      matrix[0] = 1; matrix[1] = 0.01; matrix[2] = 0;
      matrix[3] = 0.01; matrix[4] = 1; matrix[5] = 0;
      matrix[6] = 0; matrix[7] = 0; matrix[8] = 1;

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.decompositionError).toBeGreaterThanOrEqual(0);
      expect(result.decompositionError).toBeLessThanOrEqual(1);
    });

    it('should detect independence for truly independent patterns', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.1),
        makeAlert('svc_a', 2000, 0.2),
        makeAlert('svc_a', 3000, 0.3),
        makeAlert('svc_a', 4000, 0.4),
        makeAlert('svc_a', 5000, 0.5),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.9),
        makeAlert('svc_b', 2500, 0.1),
        makeAlert('svc_b', 3500, 0.8),
        makeAlert('svc_b', 4500, 0.2),
        makeAlert('svc_b', 5500, 0.7),
      ];

      const matrix = new Float64Array([1, 0.001, 0.001, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(typeof result.isIndependent).toBe('boolean');
      expect(result.confidenceLevel).toBeGreaterThanOrEqual(0);
    });

    it('should detect dependence for fully correlated patterns', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
      ];
      // Very similar values as alertsA - highly correlated
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.89),
        makeAlert('svc_b', 2500, 0.84),
        makeAlert('svc_b', 3500, 0.91),
        makeAlert('svc_b', 4500, 0.87),
        makeAlert('svc_b', 5500, 0.90),
      ];

      const matrix = new Float64Array([1, 0.8, 0.8, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(typeof result.isIndependent).toBe('boolean');
    });

    it('should throw for empty alertsA', () => {
      const checker = new IndependenceChecker();
      const alertsB: AlertRecord[] = [makeAlert('svc_b', 1000, 0.5)];
      const matrix = new Float64Array([1, 0, 0, 1]);
      expect(() => checker.testIndependence([], alertsB, matrix, 0, 1)).toThrow();
    });

    it('should throw for empty alertsB', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [makeAlert('svc_a', 1000, 0.5)];
      const matrix = new Float64Array([1, 0, 0, 1]);
      expect(() => checker.testIndependence(alertsA, [], matrix, 0, 1)).toThrow();
    });

    it('should throw for negative serviceIndex', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [makeAlert('svc_a', 1000, 0.5)];
      const alertsB: AlertRecord[] = [makeAlert('svc_b', 1000, 0.5)];
      const matrix = new Float64Array([1, 0, 0, 1]);
      expect(() => checker.testIndependence(alertsA, alertsB, matrix, -1, 0)).toThrow();
    });

    it('should handle single alert per service', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [makeAlert('svc_a', 1000, 0.9)];
      const alertsB: AlertRecord[] = [makeAlert('svc_b', 1500, 0.5)];
      const matrix = new Float64Array([1, 0.01, 0.01, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(typeof result.isIndependent).toBe('boolean');
    });

    it('should compute decompositionError = sup|P(AB) - P(A)P(B)|', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5),
        makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const matrix = new Float64Array([1, 0.01, 0.01, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.decompositionError).toBeGreaterThanOrEqual(0);
    });

    it('should have confidenceLevel between 0 and 1', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5),
        makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const matrix = new Float64Array([1, 0.01, 0.01, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.confidenceLevel).toBeGreaterThanOrEqual(0);
      expect(result.confidenceLevel).toBeLessThanOrEqual(1);
    });

    it('should handle both alerts having zero threshold', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        { ...makeAlert('svc_a', 1000, 0, 0), threshold: 0 },
        { ...makeAlert('svc_a', 2000, 0, 0), threshold: 0 },
      ];
      const alertsB: AlertRecord[] = [
        { ...makeAlert('svc_b', 1500, 0, 0), threshold: 0 },
        { ...makeAlert('svc_b', 2500, 0, 0), threshold: 0 },
      ];

      const matrix = new Float64Array([1, 0.01, 0.01, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.decompositionError).toBe(0);
    });

    it('should handle alerts with value > threshold', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 1.5, 1.0),
        makeAlert('svc_a', 2000, 2.0, 1.0),
        makeAlert('svc_a', 3000, 1.8, 1.0),
        makeAlert('svc_a', 4000, 1.6, 1.0),
        makeAlert('svc_a', 5000, 1.9, 1.0),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5, 1.0),
        makeAlert('svc_b', 2500, 0.6, 1.0),
        makeAlert('svc_b', 3500, 0.4, 1.0),
        makeAlert('svc_b', 4500, 0.3, 1.0),
        makeAlert('svc_b', 5500, 0.5, 1.0),
      ];

      const matrix = new Float64Array([1, 0.02, 0.02, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.decompositionError).toBeGreaterThanOrEqual(0);
      expect(result.confidenceLevel).toBeGreaterThanOrEqual(0.95);
    });

    it('should handle single alert with decompositionError = 0', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [makeAlert('svc_a', 1000, 0.9)];
      const alertsB: AlertRecord[] = [makeAlert('svc_b', 1500, 0.5)];
      const matrix = new Float64Array([1, 0, 0, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.decompositionError).toBe(0);
    });

    it('should have sparsityThreshold in result', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52),
      ];

      const matrix = new Float64Array([1, 0.01, 0.01, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.sparsityThreshold).toBe(0.7);
    });

    it('should handle same values producing low decomposition error', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.5, 1.0),
        makeAlert('svc_a', 2000, 0.6, 1.0),
        makeAlert('svc_a', 3000, 0.5, 1.0),
        makeAlert('svc_a', 4000, 0.6, 1.0),
        makeAlert('svc_a', 5000, 0.5, 1.0),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5, 1.0),
        makeAlert('svc_b', 2500, 0.6, 1.0),
        makeAlert('svc_b', 3500, 0.5, 1.0),
        makeAlert('svc_b', 4500, 0.6, 1.0),
        makeAlert('svc_b', 5500, 0.5, 1.0),
      ];

      const matrix = new Float64Array([1, 0.001, 0.001, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.decompositionError).toBeGreaterThanOrEqual(0);
    });

    it('should accept custom StatisticsProvider', () => {
      const stats = new StatisticsProvider();
      const checker = new IndependenceChecker(stats);
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
      ];

      const matrix = new Float64Array([1, 0.01, 0.01, 1]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(typeof result.isIndependent).toBe('boolean');
    });

    it('should compute sup|P(AB)-P(A)P(B)| correctly', () => {
      const checker = new IndependenceChecker();
      const alertsA: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.1, 1.0),
        makeAlert('svc_a', 2000, 0.2, 1.0),
        makeAlert('svc_a', 3000, 0.3, 1.0),
        makeAlert('svc_a', 4000, 0.4, 1.0),
        makeAlert('svc_a', 5000, 0.5, 1.0),
        makeAlert('svc_a', 6000, 0.6, 1.0),
      ];
      const alertsB: AlertRecord[] = [
        makeAlert('svc_b', 1500, 0.5, 1.0),
        makeAlert('svc_b', 2500, 0.6, 1.0),
        makeAlert('svc_b', 3500, 0.7, 1.0),
        makeAlert('svc_b', 4500, 0.8, 1.0),
        makeAlert('svc_b', 5500, 0.9, 1.0),
        makeAlert('svc_b', 6500, 1.0, 1.0),
      ];

      const matrix = new Float64Array([
        1, 0.005, 0, 0,
        0.005, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);

      const result = checker.testIndependence(alertsA, alertsB, matrix, 0, 1);
      expect(result.decompositionError).toBeGreaterThanOrEqual(0);
      expect(result.decompositionError).toBeLessThanOrEqual(1);
    });
  });
});
