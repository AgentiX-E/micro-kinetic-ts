import { describe, it, expect } from 'vitest';
import { BoltzmannGradAnalyzer } from '../../../src/boltzmann-grad/scaling-analyzer.js';

describe('BoltzmannGradAnalyzer', () => {
  describe('estimateFaultProbability', () => {
    // ── N=10, d=0.01 → dilute regime ────────────────────
    it('should set serviceCount to N=10 for N=10, d=0.01', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(10, 0.01);
      expect(result.serviceCount).toBe(10);
    });

    it('should set impactRadius to 0.01', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(10, 0.01);
      expect(result.impactRadius).toBe(0.01);
    });

    it('should compute impactDensity = N*d*d', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(10, 0.01);
      expect(result.impactDensity).toBeCloseTo(10 * 0.01 * 0.01, 10);
    });

    it('should classify N=10 d=0.01 as dilute', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(10, 0.01);
      expect(result.regime).toBe('dilute');
    });

    it('should have fault probability in [0,1] for dilute', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(10, 0.01);
      expect(result.faultProbabilityFirstOrder).toBeGreaterThanOrEqual(0);
    });

    // ── N=100, d=0.05 → transition regime ───────────────
    it('should set serviceCount to N=100', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(100, 0.05);
      expect(result.serviceCount).toBe(100);
    });

    it('should classify N=100 d=0.05 as transition', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      // Nd² = 100 * 0.0025 = 0.25 → transition
      const result = analyzer.estimateFaultProbability(100, 0.05);
      expect(result.regime).toBe('transition');
    });

    it('should compute impactDensity for transition case', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(100, 0.05);
      expect(result.impactDensity).toBeCloseTo(0.25, 10);
    });

    // ── N=100, d=0.1 → dense regime (Nd²=1.0 > 0.5) ────
    it('should classify N=100 d=0.1 as dense', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      // Nd² = 100 * 0.01 = 1.0 → dense
      const result = analyzer.estimateFaultProbability(100, 0.1);
      expect(result.regime).toBe('dense');
    });

    it('should set impactDensity=1.0 for N=100 d=0.1', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(100, 0.1);
      expect(result.impactDensity).toBeCloseTo(1.0, 10);
    });

    // ── N=1000, d=0.1 → dense regime (Nd²=10 > 0.5) ────
    it('should set serviceCount to N=1000', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(1000, 0.1);
      expect(result.serviceCount).toBe(1000);
    });

    it('should classify N=1000 d=0.1 as dense', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      // Nd² = 1000 * 0.01 = 10 → dense
      const result = analyzer.estimateFaultProbability(1000, 0.1);
      expect(result.regime).toBe('dense');
    });

    it('should compute impactDensity=10 for N=1000 d=0.1', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(1000, 0.1);
      expect(result.impactDensity).toBeCloseTo(10, 10);
    });

    // ── Regime classification ───────────────────────────
    it('should classify Nd² < 0.1 as dilute', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(5, 0.01);
      expect(result.regime).toBe('dilute');
    });

    it('should classify 0.1 <= Nd² <= 0.5 as transition', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      // Nd² = 10 * 0.0144 = 0.144 → transition
      const result = analyzer.estimateFaultProbability(10, 0.12);
      expect(result.regime).toBe('transition');
    });

    it('should classify Nd² > 0.5 as dense', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      // Nd² = 5 * 0.16 = 0.8 > 0.5 → dense
      const result = analyzer.estimateFaultProbability(5, 0.4);
      expect(result.regime).toBe('dense');
    });

    // ── Fault probability bounds ────────────────────────
    it('should have faultProbabilityFirstOrder within [0,1]', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(50, 0.1);
      expect(result.faultProbabilityFirstOrder).toBeGreaterThanOrEqual(0);
    });

    it('should have faultProbabilityFirstOrder <= 1', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(50, 0.1);
      expect(result.faultProbabilityFirstOrder).toBeLessThanOrEqual(1);
    });

    it('should have faultProbabilitySecondOrder within [0,1]', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(50, 0.1);
      expect(result.faultProbabilitySecondOrder).toBeGreaterThanOrEqual(0);
    });

    it('should have faultProbabilitySecondOrder <= 1', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(50, 0.1);
      expect(result.faultProbabilitySecondOrder).toBeLessThanOrEqual(1);
    });

    it('should have faultProbabilityAsymptotic within [0,1]', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(50, 0.1);
      expect(result.faultProbabilityAsymptotic).toBeGreaterThanOrEqual(0);
    });

    it('should have faultProbabilityAsymptotic <= 1', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(50, 0.1);
      expect(result.faultProbabilityAsymptotic).toBeLessThanOrEqual(1);
    });

    // ── Boltzmann-Grad regime flag ──────────────────────
    it('should have boolean inBoltzmannGradRegime', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(50, 0.1);
      expect(typeof result.inBoltzmannGradRegime).toBe('boolean');
    });

    it('should be in Boltzmann-Grad regime for Nd²=1.0', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      // Nd² = 100 * 0.01 = 1.0 → in [0.05, 2.0]
      const result = analyzer.estimateFaultProbability(100, 0.1);
      expect(result.inBoltzmannGradRegime).toBe(true);
    });

    it('should be outside Boltzmann-Grad regime for very low Nd²', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      // Nd² = 2 * 0.0001 = 0.0002 → not in [0.05, 2.0]
      const result = analyzer.estimateFaultProbability(2, 0.01);
      expect(result.inBoltzmannGradRegime).toBe(false);
    });

    it('should be outside Boltzmann-Grad regime for very high Nd²', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      // Nd² = 500 * 0.25 = 125 > 2.0
      const result = analyzer.estimateFaultProbability(500, 0.5);
      expect(result.inBoltzmannGradRegime).toBe(false);
    });

    // ── ImpactDensity computation ───────────────────────
    it('should compute impactDensity = N*d*d correctly', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(20, 0.05);
      expect(result.impactDensity).toBeCloseTo(0.05, 10);
    });

    // ── Boundary: d = 0 ─────────────────────────────────
    it('should accept impactRadius=0', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(10, 0);
      expect(result.regime).toBe('dilute');
    });

    it('should have zero impactDensity when d=0', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(10, 0);
      expect(result.impactDensity).toBe(0);
    });

    // ── Boundary: d = 1 ─────────────────────────────────
    it('should accept impactRadius=1', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(10, 1);
      expect(result.impactRadius).toBe(1);
    });

    // ── High Nd² > 10 ───────────────────────────────────
    it('should handle N=1000 d=0.5 (Nd²=250) as dense', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(1000, 0.5);
      expect(result.regime).toBe('dense');
    });

    it('should compute large impactDensity for N=1000 d=0.5', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(1000, 0.5);
      expect(result.impactDensity).toBe(250);
    });

    it('should have high asymptotic fault probability for large Nd²', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(1000, 0.5);
      expect(result.faultProbabilityAsymptotic).toBeCloseTo(1, 0);
    });

    // ── Error boundaries ────────────────────────────────
    it('should throw for N < 2', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      expect(() => analyzer.estimateFaultProbability(1, 0.1)).toThrow();
    });

    it('should throw for negative impactRadius', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      expect(() => analyzer.estimateFaultProbability(10, -0.1)).toThrow();
    });

    it('should throw for impactRadius > 1', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      expect(() => analyzer.estimateFaultProbability(10, 1.5)).toThrow();
    });

    // ── Second order vs first order ─────────────────────
    it('should have secondOrder term after firstOrder', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const result = analyzer.estimateFaultProbability(50, 0.1);
      // Second order includes B/N², so it may differ from first order
      expect(typeof result.faultProbabilitySecondOrder).toBe('number');
    });
  });

  describe('truncateHierarchy', () => {
    it('should delegate to HierarchyTruncator and return a number', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const hierarchy = {
        systemSize: 2,
        states: [
          {
            order: 1,
            serviceIds: ['a', 'b'],
            correlationEnergy: 1.0,
            tensor: new Float64Array(2),
            isSignificant: true,
          },
          {
            order: 2,
            serviceIds: ['a', 'b'],
            correlationEnergy: 0.005,
            tensor: new Float64Array(4),
            isSignificant: false,
          },
        ],
        truncationOrder: 2,
        energyRatios: [0.005],
        truncationError: 0,
      };
      const order = analyzer.truncateHierarchy(hierarchy, 0.01);
      expect(order).toBeGreaterThanOrEqual(1);
    });

    it('should use default eta of 0.01 when no eta is provided', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const hierarchy = {
        systemSize: 2,
        states: [
          {
            order: 1,
            serviceIds: ['a', 'b'],
            correlationEnergy: 1.0,
            tensor: new Float64Array(2),
            isSignificant: true,
          },
          {
            order: 2,
            serviceIds: ['a', 'b'],
            correlationEnergy: 0.0001,
            tensor: new Float64Array(4),
            isSignificant: false,
          },
        ],
        truncationOrder: 2,
        energyRatios: [0.0001],
        truncationError: 0,
      };
      const order = analyzer.truncateHierarchy(hierarchy);
      expect(order).toBeGreaterThanOrEqual(1);
    });

    it('should return 1 when first ratio is below eta', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const hierarchy = {
        systemSize: 2,
        states: [
          {
            order: 1,
            serviceIds: ['a'],
            correlationEnergy: 1.0,
            tensor: new Float64Array(1),
            isSignificant: true,
          },
          {
            order: 2,
            serviceIds: ['a'],
            correlationEnergy: 0.001,
            tensor: new Float64Array(1),
            isSignificant: false,
          },
        ],
        truncationOrder: 2,
        energyRatios: [0.001],
        truncationError: 0,
      };
      const order = analyzer.truncateHierarchy(hierarchy, 0.01);
      expect(order).toBe(1);
    });
  });

  describe('computeBBGKYHierarchy', () => {
    it('should delegate to HierarchyBuilder', () => {
      const analyzer = new BoltzmannGradAnalyzer();
      const graph = {
        nodes: new Map([['a', { id: 'a', name: 'A', namespace: 'ns', labels: {} }]]),
        edges: [],
        systemLoad: 0.5,
      };
      const states = [
        { serviceId: 'a', timestamp: 1000, faultProbability: 0.1, anomalyScore: 0.5, trafficRps: 100 },
      ];

      const result = analyzer.computeBBGKYHierarchy(states, graph, { maxOrder: 1, truncationEta: 0.01 });
      expect(result.systemSize).toBe(1);
    });
  });
});
