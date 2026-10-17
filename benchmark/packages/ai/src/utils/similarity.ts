/**
 * Cosine similarity between two numeric vectors.
 *
 * Assumes both vectors are L2-normalized (unit length).
 * Under this assumption, cosine similarity equals dot product.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns Cosine similarity in [0, 1] (clamped for float precision).
 */
export function cosineSimilarity(
  a: readonly number[] | Float32Array,
  b: readonly number[] | Float32Array,
): number {
  const len = Math.min(a.length, b.length);
  let dotProduct = 0;
  for (let i = 0; i < len; i++) {
    // Dense-array contract: both inputs are plain `number[]` or `Float32Array`,
    // so every index in `[0, len)` holds a defined value.
    dotProduct += a[i]! * b[i]!;
  }
  // Clamp to [0, 1] to handle float precision edge cases
  return Math.max(0, Math.min(1, dotProduct));
}

/**
 * Cosine distance = 1 - cosine similarity.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns Cosine distance in [0, 1].
 */
export function cosineDistance(
  a: readonly number[] | Float32Array,
  b: readonly number[] | Float32Array,
): number {
  return 1 - cosineSimilarity(a, b);
}

/**
 * Jaccard similarity between two sets represented as arrays.
 *
 * J(A, B) = |A ∩ B| / |A ∪ B|
 *
 * @param a - First set elements.
 * @param b - Second set elements.
 * @returns Jaccard similarity in [0, 1].
 */
export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  // Union is always ≥ 1 here: the early return above handles the both-empty
  // case, so at least one set is non-empty and `intersection ≤ min(sizeA, sizeB)`.
  return intersection / union;
}

/**
 * L2-normalize a vector in-place.
 *
 * After normalization, the vector has unit length:
 *   sqrt(Σ v[i]²) = 1
 *
 * Returns a new Float32Array (does not mutate input).
 *
 * @param vec - Input vector (a dense `number[]` or `Float32Array`).
 * @returns L2-normalized vector (new allocation).
 */
export function normalizeL2(vec: readonly number[] | Float32Array): Float32Array {
  const len = vec.length;
  let sumSquares = 0;
  for (let i = 0; i < len; i++) {
    // Dense-array contract: `vec` is a plain `number[]` or `Float32Array`.
    const val = vec[i]!;
    sumSquares += val * val;
  }
  const norm = Math.sqrt(sumSquares);
  const result = new Float32Array(len);
  if (norm === 0) {
    return result; // zero vector → return zeros
  }
  for (let i = 0; i < len; i++) {
    result[i] = vec[i]! / norm;
  }
  return result;
}
