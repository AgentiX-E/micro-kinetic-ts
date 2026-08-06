/**
 * Bayesian Online Change Point Detection (BOCPD).
 *
 * Streaming algorithm that computes the posterior probability
 * distribution over run lengths — the time since the most recent
 * changepoint — at each observation. Used to detect the precise
 * onset of anomalous behavior in metric time series.
 *
 * Mathematical basis (Adams & MacKay 2007):
 *   P(r_t | x_{1:t}) ∝ P(x_t | r_{t-1}, x_{1:t-1}) × P(r_t | r_{t-1})
 *
 * where:
 *   r_t = run length at time t (current segment length)
 *   P(x_t | ...) = predictive likelihood under Student-T model
 *   P(r_t | r_{t-1}) = changepoint prior (hazard function)
 *
 * Hazard function H controls expected segment length:
 *   Constant hazard (default): P(changepoint) = 1/λ, λ = expected segment length
 *   This is equivalent to a geometric run length distribution.
 *
 * Key properties:
 *   - O(n²) time naive, O(n × maxRunLength) with truncation
 *   - Student-T predictive: robust to outliers (heavier tails than Gaussian)
 *   - Streaming: processes one observation at a time, no batch needed
 *   - Run-length posterior peaks at changepoint onset → probabilistic onset detection
 *
 * References:
 *   - Adams, R. P., & MacKay, D. J. C. (2007). Bayesian Online
 *     Changepoint Detection. arXiv:0710.3742.
 *   - Turner, R. (2011). Gaussian Process Change Point Models.
 *     (BOCPD with Gaussian Process predictive — reference only)
 *
 * @module kinetic/signals/bocpd-detector
 */

/**
 * Configuration for BOCPD onset detection.
 */
export interface BOCPDConfig {
  /**
   * Hazard rate — probability of a changepoint at each step.
   * Constant hazard: P(changepoint) = 1 / expectedRunLength.
   *
   * Default 1/250 ≈ 0.004 — expects a changepoint roughly every
   * 250 observations. Lower = fewer detected changepoints.
   */
  hazardRate: number;

  /**
   * Maximum run length to track (truncation for O(n·L) complexity).
   * Default 1000. Longer histories have lower recall but cover
   * larger segments.
   */
  maxRunLength: number;

  /**
   * Student-T degrees of freedom. Higher = more Gaussian-like,
   * lower = heavier tails (more robust to outliers).
   * Default 3 (moderate robustness).
   */
  degreesOfFreedom: number;

  /**
   * Student-T scale parameter. Controls expected variance.
   * Default 1.0.
   */
  scale: number;

  /**
   * Minimum confidence threshold for changepoint detection.
   * Run-length probability must drop below this to trigger detection.
   * Default 0.1. Lower = more sensitive (more detections).
   */
  changepointThreshold: number;

  /**
   * Minimum run length before a changepoint can be detected.
   * Prevents spurious detection from initial observations.
   * Default 3.
   */
  minRunLength: number;
}

export const DEFAULT_BOCPD_CONFIG: BOCPDConfig = {
  hazardRate: 1 / 250,
  maxRunLength: 1000,
  degreesOfFreedom: 3,
  scale: 1.0,
  changepointThreshold: 0.1,
  minRunLength: 3,
};

/**
 * Result of BOCPD onset detection.
 */
export interface BOCPDResult {
  /**
   * Index (0-based) of the detected changepoint onset.
   * -1 if no changepoint was detected.
   */
  onsetIndex: number;

  /**
   * Confidence [0, 1] of the detected changepoint.
   * Computed as 1 - min(runLengthProb[t]) / max(runLengthProb[t]).
   */
  confidence: number;

  /**
   * Run-length probability distribution at the final observation.
   * P[ri] = probability that the current run is ri observations long.
   * Only populated if includeFullDistribution is true.
   */
  runLengthDistribution?: Float64Array;
}

/**
 * Student-T log predictive probability.
 *
 * Computes log P(x | μ_n, σ_n², ν) for a Student-T distribution
 * with updated sufficient statistics.
 *
 * This is the core likelihood used in BOCPD to evaluate how
 * well each run-length hypothesis predicts the next observation.
 */
function studentTLogPredictive(
  x: number,
  count: number,
  mean: number,
  sumSq: number,
  dof: number,
  scale: number,
  priorMean: number,
): number {
  if (count === 0) {
    // No prior observations → use prior predictive
    // log P(x | prior) = log StudentT(x; dof, mu_0, scale)
    const scaledVar = scale * scale;
    const error = x - priorMean;
    return -0.5 * (dof + 1) * Math.log(1 + (error * error) / (dof * scaledVar))
      - 0.5 * Math.log(dof * Math.PI * scaledVar)
      - lgammaRatio(dof, dof + 1);
  }

  // Posterior predictive: Student-T with updated parameters
  // See Murphy (2007), "Conjugate Bayesian Analysis of the Gaussian Distribution"
  // Eq. (19): p(x|D) = T_{ν_n}(x | μ_n, (κ_n+1)σ_n²/(κ_n ν_n))
  const kappa = count;
  const kappaPlus1 = kappa + 1;
  const dofN = dof + count;

  // Posterior mean (Murphy Eq. 14-15)
  const meanN = (kappa * mean) / kappaPlus1;

  // Posterior variance = (prior_scale * prior_factor + SS) / (kappa + prior_factor)
  // prior_factor = 1, scaleSq = prior variance estimate
  const priorScaleSq = scale * scale;
  // Posterior σ_n² = (priorScaleSq + sumSq) / dofN  (approximate)
  // More precisely: β_n = β_0 + 0.5 * (sum_{i=1}^n x_i² - κ_n μ_n²)
  // For predictive: σ̂² = β_n / (α_n) where α_n = (dof + n)/2
  // Predictive scale: (κ_n + 1) * σ̂² / κ_n
  const alphaN = dofN / 2;
  // β_n = prior β_0 + 0.5 * (Σx² - κ μ_n²)
  // prior β_0 = dof * scale² / 2
  const priorBeta = dof * priorScaleSq / 2;
  // Σx² = sumSq + n * mean_n² — but we have sumSq from Welford which is
  // Σ(x_i - mean)² = Σx_i² - n·mean², so Σx_i² = sumSq + n·mean²
  // Then Σx² - κ·μ_n² = sumSq
  const betaN = priorBeta + 0.5 * sumSq;

  // Predictive scale factor: (κ_n + 1) * (β_n / α_n) / κ_n
  const sigmaPosteriorSq = betaN / alphaN;
  const predictiveVar = (kappaPlus1 * sigmaPosteriorSq) / kappa;

  const error = x - meanN;

  return -0.5 * (dofN + 1) * Math.log(1 + (error * error) / (dofN * predictiveVar))
    - 0.5 * Math.log(dofN * Math.PI * predictiveVar)
    - lgammaRatio(dofN, dofN + 1);
}

/**
 * Log-gamma ratio: log(Γ(a) / Γ(b)).
 *
 * Avoids computing full Γ values; uses recurrence or lookup
 * for small integer arguments.
 */
function lgammaRatio(a: number, b: number): number {
  // For integer args, use product relationship
  if (a === b) return 0;
  if (b - a === 1) return -Math.log(a); // log(Γ(a) / Γ(a+1)) = -log(a)
  // Fallback: use built-in lgamma
  // Note: Math.lgamma is not standard; fall back to approximation
  return simpleLgammaApprox(a) - simpleLgammaApprox(b);
}

/**
 * Simple log-gamma approximation using Stirling's formula.
 * Accurate enough for BOCPD's likelihood comparison.
 */
function simpleLgammaApprox(z: number): number {
  if (z <= 0) return 0;
  if (z < 0.5) {
    // Reflection formula not needed for BOCPD (dof ≥ 1)
    return 0;
  }
  // Stirling: log(Γ(z)) ≈ (z - 0.5)log(z) - z + 0.5log(2π)
  return (z - 0.5) * Math.log(z) - z + 0.9189385332046727; // 0.5*log(2π)
}

/**
 * BOCPD onset detector using the Student-T predictive model.
 *
 * Processes a metric time series sequentially, maintaining the
 * run-length posterior distribution. Returns the index of the
 * first detected changepoint along with its confidence.
 *
 * Algorithm:
 *   1. Initialize run-length P(r₀=0) = 1
 *   2. For each observation x_t:
 *      a. Compute predictive probability P(x_t | r) for all r
 *      b. Compute growth probabilities: P(r_t = r+1 | ...)
 *      c. Compute changepoint probability: P(r_t = 0 | ...)
 *      d. Normalize
 *      e. If P(r=0) > 1 - changepointThreshold → return t as onset
 *   3. If no changepoint meets threshold, return onsetIndex = -1
 *
 * @param values - Metric time series values.
 * @param config - BOCPD configuration.
 * @returns BOCPD result with onset index and confidence.
 */
export function bocpdDetectOnset(
  values: Float64Array | number[],
  config: Partial<BOCPDConfig> = {},
): BOCPDResult {
  const merged = { ...DEFAULT_BOCPD_CONFIG, ...config };
  const {
    hazardRate,
    maxRunLength,
    degreesOfFreedom: dof,
    scale,
    changepointThreshold,
    minRunLength,
  } = merged;

  const n = values.length;
  if (n < minRunLength) {
    return { onsetIndex: -1, confidence: 0 };
  }

  // Use data-driven prior: initialize scale from first minRunLength observations
  // This avoids the pathological case where ALL hypotheses find the data unlikely
  let dataDrivenScale = scale;
  let priorMean = 0;
  if (n >= minRunLength) {
    let initSum = 0, initSumSq = 0;
    for (let i = 0; i < minRunLength; i++) {
      initSum += values[i]!;
    }
    priorMean = initSum / minRunLength;
    for (let i = 0; i < minRunLength; i++) {
      const d = values[i]! - priorMean;
      initSumSq += d * d;
    }
    // Set scale to sample stddev (at minimum, keep original scale)
    // Wide prior: use at least 10× sample stddev to give the changepoint
    // hypothesis reasonable coverage of extreme values.
    // Minimum scale of 10 ensures even stationary data can detect large jumps.
    const sampleVar = initSumSq / Math.max(1, minRunLength - 1);
    dataDrivenScale = Math.max(10, Math.sqrt(sampleVar) * 10);
  }

  // Use data-driven scale
  const effectiveScale = dataDrivenScale;

  // Initialize run-length posterior
  // P[ri] = probability that current run length = ri
  let runLengths: number[] = [1.0]; // P(r₀=0) = 1
  let maxProb = 1.0;

  // Sufficient statistics for each run-length hypothesis
  // count[ri] = number of observations in segment starting at ri
  // mean[ri] = running mean of segment
  // sumSq[ri] = running sum of squared values
  const counts: number[] = [0];
  const means: number[] = [0];
  const sumSqs: number[] = [0];

  for (let t = 0; t < n; t++) {
    const x = values[t]!;
    const newRunLengths: number[] = [];
    const newCounts: number[] = [];
    const newMeans: number[] = [];
    const newSumSqs: number[] = [];

    // 1. Compute predictive probabilities
    const predictives: number[] = [];
    for (let ri = 0; ri < runLengths.length; ri++) {
      const logPred = studentTLogPredictive(x, counts[ri]!, means[ri]!, sumSqs[ri]!, dof, effectiveScale, priorMean);
      predictives.push(Math.exp(logPred));
    }

    // 2. Growth probabilities (no changepoint)
    let growthSum = 0;
    for (let ri = 0; ri < Math.min(runLengths.length, maxRunLength - 1); ri++) {
      const prob = runLengths[ri]! * predictives[ri]! * (1 - hazardRate);
      newRunLengths.push(prob);
      growthSum += prob;

      // Updated sufficient statistics: add x to segment
      const newCount = counts[ri]! + 1;
      newCounts.push(newCount);
      const delta = x - means[ri]!;
      newMeans.push(means[ri]! + delta / newCount);
      newSumSqs.push(sumSqs[ri]! + delta * (x - newMeans[newMeans.length - 1]!));
    }

    // 3. Changepoint probability (r = 0)
    let cpProb = 0;
    for (let ri = 0; ri < runLengths.length; ri++) {
      cpProb += runLengths[ri]! * predictives[ri]! * hazardRate;
    }

    newRunLengths.unshift(cpProb);
    newCounts.unshift(0);
    newMeans.unshift(0);
    newSumSqs.unshift(0);

    growthSum += cpProb;

    // 4. Normalize
    if (growthSum > 0) {
      for (let ri = 0; ri < newRunLengths.length; ri++) {
        newRunLengths[ri] /= growthSum;
      }
    }

    runLengths = newRunLengths;
    counts.length = 0;
    means.length = 0;
    sumSqs.length = 0;
    // Sync arrays
    for (let ri = 0; ri < newCounts.length; ri++) {
      counts.push(newCounts[ri]!);
      means.push(newMeans[ri]!);
      sumSqs.push(newSumSqs[ri]!);
    }

    // Recompute maxProb for confidence estimate
    maxProb = Math.max(...runLengths);

    // 5. Check for changepoint detection using likelihood ratio
    // Rather than relying solely on P(r=0) (which is bounded by hazard rate),
    // we use the Bayes factor: P_prior(x_t) / max_{r>0} P_posterior(x_t | r)
    // A large ratio indicates x_t is much more likely under the changepoint hypothesis.
    const r0Prob = runLengths[0]!; // P(r_t = 0)
    const priorPred = predictives[0]!; // P(x_t | r=0) — prior predictive
    const grownPreds = predictives.slice(1);
    const bestGrownPred = grownPreds.length > 0 ? Math.max(...grownPreds) : 0;

    // Bayes factor: how much more likely is x_t under changepoint vs best growth hypothesis
    const logBayesFactor = bestGrownPred > 0
      ? Math.log(priorPred) - Math.log(bestGrownPred)
      : 0;

    // Detection trigger: absolute probability OR strong likelihood ratio
    if (t >= minRunLength && (
      r0Prob > (1 - changepointThreshold)
      || (logBayesFactor > 1.0 && r0Prob > 0.01)
    )) {
      const confidence = Math.max(0, Math.min(1, Math.max(r0Prob, Math.min(1, logBayesFactor / 10))));
      return {
        onsetIndex: t,
        confidence,
      };
    }
  }

  // No changepoint detected — return best guess from final distribution
  // Confidence based on how peaked the distribution is
  const finalMaxProb = Math.max(...runLengths);
  const finalConfidence = runLengths.length > 1 ? 1 - finalMaxProb : 0;

  return {
    onsetIndex: -1,
    confidence: finalConfidence,
  };
}

/**
 * Detect all changepoints in a time series using BOCPD.
 *
 * Similar to bocpdDetectOnset but continues past the first
 * detection, tracking all changepoints with their confidence.
 *
 * @param values - Metric time series values.
 * @param config - BOCPD configuration.
 * @returns Array of BOCPD results, one per detected changepoint.
 */
export function bocpdDetectAllChangepoints(
  values: Float64Array | number[],
  config: Partial<BOCPDConfig> = {},
): BOCPDResult[] {
  const results: BOCPDResult[] = [];
  const merged = { ...DEFAULT_BOCPD_CONFIG, ...config };
  let offset = 0;

  while (offset < values.length) {
    const segment = values.slice(offset);
    // Wrap as Float64Array to avoid copy overhead in bocpdDetectOnset
    const segmentArray = Array.isArray(segment)
      ? new Float64Array(segment)
      : segment as Float64Array;
    const result = bocpdDetectOnset(segmentArray, merged);

    if (result.onsetIndex < 0) break;

    const globalIndex = offset + result.onsetIndex;
    results.push({
      onsetIndex: globalIndex,
      confidence: result.confidence,
    });

    // Skip past detected changepoint + min gap
    offset = globalIndex + merged.minRunLength;
  }

  return results;
}
