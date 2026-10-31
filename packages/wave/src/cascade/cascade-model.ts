/**
 * Wave Cascade Model — the kinetic equation integrated on a service call graph.
 *
 * Simulates alert intensity propagation through the service graph with the two parts of Deng Yu's
 * wave kinetic equation (WKE) that a call graph can actually carry:
 *
 *     ∂_t n = Q_lin[n] + c · Q_triad[n] − γ n
 *
 * ## The linear part is the transport, and it is the part that propagates
 *
 * `Q_lin[n]_i = c · v · Σ_j S(i,j) · (n_j − n_i)` — the graph Laplacian of the symmetric coupling
 * `S(i,j) = max(A(i,j), A(j,i))`. It is the discrete symbol of the linearised collision operator:
 * the reversible, mass-transporting part of the kinetics, whose spectral gap sets the decay time of
 * the slowest mode. `graph-spectrum.ts` computes that gap from the same operator this file integrates.
 *
 * ## The three-wave part is a correction, and it only exists on triads
 *
 *     T(i,j,k) = c · S(i,j) · S(i,k) · S(j,k)
 *     Q_triad[n]_i = Σ_{j,k} T(i,j,k) · [n_j n_k − n_i (n_j + n_k)]
 *
 * The vertex is **symmetric under permutation of its three modes**, which is the property the WKE
 * kernel has and the one the previous implementation lacked: it built `T` from the *directed*
 * adjacency and read `A(i,·)` — the calls `i` MAKES — for all three factors, so the tensor was
 * index-asymmetric and, for any node downstream of the injection, collapsed to its self term
 * `c·(n² − 2n²) = −c·n²`, strictly negative. A service could only lose intensity. Direction of
 * transfer is a property of the occupation numbers (`n_j n_k` vs `n_i(n_j + n_k)`), not of the index.
 *
 * A triad needs three mutually coupled services, so on a sparse call graph this term is usually
 * zero — which is exactly why the propagation has to come from `Q_lin`, and why the previous
 * model, which had only the triads, never propagated on any acyclic graph.
 *
 * ## The integration is a theorem, not a clamp
 *
 * The previous update was explicit Euler with `Math.max(0, Math.min(1, …))`, and the clamp was not
 * decoration: at `dt = 600 ms` with degrees up to 15 the linear term moved a node by thousands of
 * units per step, so trajectories saturated at 1 and were then pinned at exactly 0 — measured on the
 * one topology that propagated at all. Splitting the update into a stiff part treated implicitly and
 * a saturating source makes `[0, 1]` an **invariant set** with no clamp anywhere:
 *
 *     n_i' = ( n_i + dt·c·v·u_i + (1 − n_i)·s_i ) / ( 1 + dt·(c·v·d_i + γ + c·max(0, B_i)) )
 *
 *     u_i = Σ_j S(i,j)·n_j                 (the neighbour mass that can arrive)
 *     d_i = Σ_j S(i,j)                     (its rate)
 *     s_i = dt·c·A_i / (1 + dt·c·A_i)      (Padé form of 1 − e^{−dt·c·A_i}: the triad source can only
 *                                           fill the remaining headroom, so it cannot overshoot)
 *     A_i = Σ_{j,k} max(T, 0)·n_j·n_k      (triad source)
 *     B_i = Σ_{j,k} T·(n_j + n_k)          (triad sink coefficient)
 *
 * With `0 ≤ n ≤ 1` assumed, the numerator is at most `n_i + dt·c·v·d_i + (1 − n_i) = 1 + dt·c·v·d_i`
 * and the denominator is at least that, so `n' ≤ 1`; every term in the numerator is non-negative, so
 * `n' ≥ 0`. Both hold for **any** `dt`, and `cascade-model.test.ts` asserts them across a sweep of
 * horizons, couplings and speeds rather than trusting the argument.
 *
 * ## Units
 *
 * The operator is stated **per second**: `dt` is converted from the millisecond horizon, and
 * `γ = 1000 / decayTimeConstant`, so the decay constant (milliseconds) and the transport speed
 * (hops per second) live on one clock. The previous implementation divided by a millisecond τ and
 * multiplied by a `dt` of hundreds, which is why the front crossed a 15-node graph in the first step.
 *
 * @module wave/cascade/cascade-model
 */

import type {
  AlertIntensity,
  CascadeResult,
  DecayCurve,
  ServiceCallGraph,
  WaveParams,
} from '@agentix-e/micro-kinetic-core';
import { invariant, invariantNonEmpty, invariantRange } from '@agentix-e/micro-kinetic-core';

import { buildTransportCoupling, laplacianSpectrum } from './graph-spectrum.js';

/** Default wave parameters. */
const DEFAULT_WAVE_PARAMS: WaveParams = {
  couplingStrength: 0.5,
  propagationSpeed: 1.0,
  decayTimeConstant: 60000, // 60 seconds
  cascadeThreshold: 0.1,
  timeHorizon: 300000, // 5 minutes
};

/** Number of simulation steps the horizon is divided into. */
const STEPS = 500;

/** Non-zero triads of the interaction tensor, in compressed form. */
interface TriadIndex {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly k: Int32Array;
  readonly t: Float64Array;
}

/**
 * Wave Cascade Model — WKE-based alert cascade simulation.
 *
 * Implements IWavePropagationModel.simulateCascade() using the discretized wave kinetic equation.
 */
export class WaveCascadeModel {
  /**
   * Simulate an alert cascade from a source service.
   *
   * **Algorithm:**
   * 1. Initialize n(source, 0) = 1, n(s, 0) = 0 elsewhere
   * 2. Build the symmetric transport coupling and the triad index
   * 3. For each step: neighbour mass, saturating triad source, implicit sink
   * 4. Report the farthest service the cascade ever reached above `cascadeThreshold`
   *
   * @param source - Source service ID where cascade originates
   * @param graph - Service call graph topology
   * @param params - Wave propagation parameters
   * @returns Cascade simulation result
   */
  public simulateCascade(
    source: string,
    graph: ServiceCallGraph,
    params?: WaveParams,
  ): CascadeResult {
    invariantNonEmpty(source, 'source');
    invariant(graph.nodes.size > 0, 'graph must contain nodes');
    invariant(graph.nodes.has(source), `Source "${source}" not found in graph`);

    const p = { ...DEFAULT_WAVE_PARAMS, ...params };
    invariantRange(p.couplingStrength, 0, 1, 'couplingStrength');
    invariant(p.propagationSpeed > 0, 'propagationSpeed must be positive');
    invariant(p.decayTimeConstant > 0, 'decayTimeConstant must be positive');
    invariant(p.timeHorizon > 0, 'timeHorizon must be positive');
    invariant(p.cascadeThreshold > 0, 'cascadeThreshold must be positive');

    const serviceIds = Array.from(graph.nodes.keys());
    const n = serviceIds.length;
    const index = new Map(serviceIds.map((id, at) => [id, at]));

    const coupling = buildTransportCoupling(
      graph.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        callRate: edge.callRate,
        errorRate: edge.errorRate,
      })),
      index,
      n,
    );

    const degrees = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let degree = 0;
      for (let j = 0; j < n; j++) degree += coupling[i * n + j]!;
      degrees[i] = degree;
    }

    const triads = this.buildTriads(coupling, n, p.couplingStrength);

    // Seconds on both sides of the equation: the horizon and τ are milliseconds in the API.
    const horizonSeconds = p.timeHorizon / 1000;
    const dt = horizonSeconds / STEPS;
    const gamma = 1000 / p.decayTimeConstant;
    const transport = p.couplingStrength * p.propagationSpeed;

    const sourceIdx = index.get(source);
    invariant(sourceIdx !== undefined, `Source service "${source}" index not found`);

    const trajectories: Float64Array[] = Array.from(
      { length: n },
      () => new Float64Array(STEPS + 1),
    );
    for (let i = 0; i < n; i++) trajectories[i]![0] = i === sourceIdx ? 1 : 0;

    const current = new Float64Array(n);
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) current[i] = trajectories[i]![0]!;

    let dissipated = false;
    let dissipationTime: number | undefined;
    // The peak includes t = 0, where the source sits at 1: a cascade's peak is its initial condition
    // when nothing amplifies it, and the field is bounded by that initial value.
    let peakIntensity = 1;

    for (let t = 0; t < STEPS; t++) {
      for (let i = 0; i < n; i++) {
        let neighbourMass = 0;
        for (let j = 0; j < n; j++) neighbourMass += coupling[i * n + j]! * current[j]!;

        let source = 0;
        let sink = 0;
        for (let at = 0; at < triads.i.length; at++) {
          if (triads.i[at] !== i) continue;
          const value = triads.t[at]!;
          const nj = current[triads.j[at]!]!;
          const nk = current[triads.k[at]!]!;
          if (value > 0) source += value * nj * nk;
          sink += value * (nj + nk);
        }

        const scaledSource = dt * p.couplingStrength * source;
        const triadSource = scaledSource / (1 + scaledSource);
        const numerator =
          current[i]! + dt * transport * neighbourMass + (1 - current[i]!) * triadSource;
        const denominator =
          1 + dt * (transport * degrees[i]! + gamma + p.couplingStrength * Math.max(0, sink));
        next[i] = numerator / denominator;
      }

      for (let i = 0; i < n; i++) {
        current[i] = next[i]!;
        trajectories[i]![t + 1] = next[i]!;
      }

      let stepMax = 0;
      for (let i = 0; i < n; i++) stepMax = Math.max(stepMax, next[i]!);
      peakIntensity = Math.max(peakIntensity, stepMax);

      if (!dissipated && stepMax < p.cascadeThreshold) {
        dissipated = true;
        dissipationTime = (t + 1) * dt * 1000;
      }
    }

    const propagationDistance = this.computePropagationDistance(
      source,
      coupling,
      n,
      trajectories,
      serviceIds,
      p.cascadeThreshold,
    );

    const intensityTrajectories = new Map<string, readonly AlertIntensity[]>();
    for (let i = 0; i < n; i++) {
      const serviceId = serviceIds[i]!;
      const trajectory: AlertIntensity[] = [];
      for (let t = 0; t <= STEPS; t++) {
        trajectory.push({ serviceId, time: t * dt * 1000, intensity: trajectories[i]![t]! });
      }
      intensityTrajectories.set(serviceId, trajectory);
    }

    return {
      sourceServiceId: source,
      intensityTrajectories,
      propagationDistance,
      peakIntensity,
      timeToPeak: this.computeTimeToPeak(trajectories, n, sourceIdx!, dt),
      dissipated,
      dissipationTime,
    };
  }

  /**
   * Compute the correlation decay curve from the transport operator's spectral gap.
   *
   * The slowest non-constant mode of `dn/dt = −speed · L n` decays as `exp(−λ₂ · t)`, so the
   * correlation decay constant is `τ = 1/λ₂` — in seconds, published in milliseconds to match the
   * time axis of the curve. The gap comes from the same Laplacian the trajectory is integrated with,
   * which is what makes this curve a property of the cascade rather than of a different matrix.
   *
   * @param graph - Service call graph
   * @param timeHorizon - Time horizon for the decay curve (ms)
   * @returns Correlation decay curve
   */
  public computeDecayCurve(graph: ServiceCallGraph, timeHorizon: number): DecayCurve {
    invariant(timeHorizon > 0, 'timeHorizon must be positive');
    invariant(graph.nodes.size > 0, 'graph must contain nodes');

    const serviceIds = Array.from(graph.nodes.keys());
    const n = serviceIds.length;
    const index = new Map(serviceIds.map((id, at) => [id, at]));
    const coupling = buildTransportCoupling(
      graph.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        callRate: edge.callRate,
        errorRate: edge.errorRate,
      })),
      index,
      n,
    );

    const { gap } = laplacianSpectrum(coupling, n);

    // A graph with no transport at all (one node, or no surviving edge) does not decorrelate across
    // anything, so the only finite statement is that the horizon is shorter than the decay.
    const tauSeconds = gap > 1e-10 ? 1 / gap : timeHorizon / 1000;
    const tau = tauSeconds * 1000;

    const numPoints = 100;
    const timePoints = new Float64Array(numPoints);
    const correlationValues = new Float64Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      const t = (i / (numPoints - 1)) * timeHorizon;
      timePoints[i] = t;
      correlationValues[i] = Math.exp(-t / tau);
    }

    return {
      timePoints,
      correlationValues,
      decayConstant: tau,
      // The curve IS the exponential of the operator's gap: there is nothing fitted, so the residual
      // is zero by construction rather than by a regression that could have failed.
      fitQuality: 1.0,
    };
  }

  // ── Internal helpers ────────────────────────────────────

  /**
   * Compress the three-wave tensor into its non-zero entries.
   *
   * `T(i,j,k) = c · S(i,j) · S(i,k) · S(j,k)` is symmetric under permutation of its modes, and the
   * index is built by skipping any triple with `S(j,k) = 0` — the triads that exist, rather than an
   * N³ array that is almost entirely zeros on a service graph with 13 edges.
   *
   * @param coupling - Symmetric coupling matrix
   * @param n - Matrix dimension
   * @param couplingStrength - Global coupling multiplier
   * @returns Non-zero triads
   */
  private buildTriads(coupling: Float64Array, n: number, couplingStrength: number): TriadIndex {
    const i: number[] = [];
    const j: number[] = [];
    const k: number[] = [];
    const t: number[] = [];

    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const sab = coupling[a * n + b]!;
        if (sab === 0) continue;
        for (let c = 0; c < n; c++) {
          const sac = coupling[a * n + c]!;
          if (sac === 0) continue;
          const sbc = coupling[b * n + c]!;
          if (sbc === 0) continue;
          i.push(a);
          j.push(b);
          k.push(c);
          t.push(couplingStrength * sab * sac * sbc);
        }
      }
    }

    return {
      i: Int32Array.from(i),
      j: Int32Array.from(j),
      k: Int32Array.from(k),
      t: Float64Array.from(t),
    };
  }

  /**
   * Farthest service the cascade ever reached above the cascade threshold.
   *
   * The distance is a BFS hop count over the transport coupling, and the membership test is the
   * **peak** of the trajectory. The previous implementation read intensity on the LAST step, which
   * is below the threshold for every node on every graph as soon as the horizon exceeds a few decay
   * constants — so the field was structurally zero, and a cascade that clearly happened reported 0.
   *
   * @param source - Source service
   * @param coupling - Symmetric coupling matrix
   * @param n - Matrix dimension
   * @param trajectories - Intensity trajectories
   * @param serviceIds - Ordered service IDs
   * @param threshold - Intensity a service must ever exceed to count as reached
   * @returns Maximum propagation distance
   */
  private computePropagationDistance(
    source: string,
    coupling: Float64Array,
    n: number,
    trajectories: readonly Float64Array[],
    serviceIds: readonly string[],
    threshold: number,
  ): number {
    const index = new Map(serviceIds.map((id, at) => [id, at]));
    const distances = new Int32Array(n).fill(-1);
    const start = index.get(source);
    invariant(start !== undefined, 'source index missing');
    distances[start!] = 0;

    const queue: number[] = [start!];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (let to = 0; to < n; to++) {
        if (coupling[at * n + to]! > 0 && distances[to] === -1) {
          distances[to] = distances[at]! + 1;
          queue.push(to);
        }
      }
    }

    let maxDist = 0;
    for (let i = 0; i < n; i++) {
      if (distances[i]! <= maxDist) continue;
      const peak = trajectories[i]!.reduce((best, value) => Math.max(best, value), 0);
      if (peak >= threshold) maxDist = distances[i]!;
    }
    return maxDist;
  }

  /**
   * Time at which the cascade OUTSIDE the source is at its largest.
   *
   * The source starts at 1 and only decays, so a peak taken over all services is always at t = 0 and
   * the field reported 0 for every graph. The informative instant is the one where the mass that
   * left the source is largest: 0 for an isolated source, and strictly positive for a cascade that
   * has a front.
   *
   * @param trajectories - Intensity trajectories
   * @param n - Node count
   * @param sourceIdx - Source index
   * @param dt - Step size in seconds
   * @returns Time of the off-source peak, in milliseconds
   */
  private computeTimeToPeak(
    trajectories: readonly Float64Array[],
    n: number,
    sourceIdx: number,
    dt: number,
  ): number {
    const steps = trajectories[0]!.length;
    let best = 0;
    let bestTime = 0;
    for (let t = 0; t < steps; t++) {
      let total = 0;
      for (let i = 0; i < n; i++) {
        if (i === sourceIdx) continue;
        total += trajectories[i]![t]!;
      }
      if (total > best) {
        best = total;
        bestTime = t * dt * 1000;
      }
    }
    return bestTime;
  }
}
