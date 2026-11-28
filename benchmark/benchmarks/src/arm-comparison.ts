/**
 * Two artifacts, one delta — and the four ways that delta is not a measurement.
 *
 * Iteration 346 published a **236-case drift in a single arm** between two days and hung a retraction of this
 * programme's standing on it. Neither the drift nor the retraction was real. The two files called "the free arm" were
 * dispatched under different harness configurations: the 2026-11-22 artifact ran `gate contrast, fallback engine`
 * with the resolvers on and settled **287 of its 532 sampled cases without the model at all** (155 by the prior, 71 by
 * the entry-prior rule, 61 by the interface witness), while the 2026-11-25 artifact ran all three off and answered
 * every case from the model. Of the 244-case gap, **186 cases were never a model answer in either run**, and the
 * remaining 58 are the model's own answers changing under a different final-turn instruction.
 *
 * Nothing about the supplier had to move to explain it, and no field of either file said so.
 *
 * So a paired delta needs a gate, and this module is it. Before it prints a number it requires the two artifacts to
 * agree on **everything that is not the axis**: the model, the budget, the revision of the harness, and every flag
 * that changes what the model is shown — with the axis itself named by the caller, so "these two files differ in
 * `fleet` and in nothing else" becomes a checked claim instead of a reader's assumption.
 *
 * The statistics are stated twice on purpose. The figure earlier sections quote is McNemar's **continuity-corrected
 * chi-square**, which is asymptotic and reproduces `p = 0.243` for 22 against 14. The **exact conditional binomial**
 * is the same test without the normal approximation and is the one this module leads with, because the discordant
 * counts in this programme are often small enough (8, 13, 36) that the approximation is the larger error.
 *
 * @module benchmarks/src/arm-comparison
 */

import type { RunMetadata } from './run-metadata.js';

/** One row of an arm artifact, in the two fields a paired comparison reads. */
export interface ArmRow {
  readonly datapack: string;
  readonly correct: boolean;
}

/** The 2 × 2 the two artifacts make when they are read on the same cases. */
export interface PairedCounts {
  /** Cases both files carry — the only denominator any figure here uses. */
  readonly shared: number;
  /** Cases only the first file carries. Always 0: a difference raises rather than being dropped. */
  readonly onlyFirst: number;
  /** Cases only the second file carries. Always 0, for the same reason. */
  readonly onlySecond: number;
  readonly bothRight: number;
  /** The first artifact answered correctly and the second did not. */
  readonly firstOnly: number;
  /** The second artifact answered correctly and the first did not. */
  readonly secondOnly: number;
  /** `secondOnly − firstOnly`, in cases. */
  readonly delta: number;
  /** Exact two-sided McNemar (conditional binomial). */
  readonly pExact: number;
  /** McNemar's continuity-corrected chi-square, the figure earlier sections quote. */
  readonly pAsymptotic: number;
}

/** The natural log of `n!`, by a running sum — exact enough at the sizes this corpus reaches and free of tables. */
function logFactorial(n: number): number {
  let total = 0;
  for (let i = 2; i <= n; i += 1) total += Math.log(i);
  return total;
}

/** The natural log of the binomial coefficient, in log space so a 1 422-case test cannot overflow. */
function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * The complementary error function, Chebyshev form (Numerical Recipes 6.2.2).
 *
 * Used only by the asymptotic tail, where a fractional error of 1.2 × 10⁻⁷ moves no digit a reader is shown.
 *
 * @param x - A finite real number.
 * @returns `erfc(x)`, in (0, 2).
 */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? ans : 2 - ans;
}

/**
 * The exact two-sided McNemar test: the conditional binomial on the discordant pairs.
 *
 * With `b` and `c` the two discordant counts and `n = b + c`, the null says each discordant case is equally likely to
 * fall either way, so `b ~ Binomial(n, ½)` and the two-sided p is `2 · P(X ≤ min(b, c))`, capped at 1.
 *
 * @param firstOnly - Discordant cases the first artifact alone got right.
 * @param secondOnly - Discordant cases the second artifact alone got right.
 * @returns The p-value, in (0, 1].
 */
export function mcnemarExact(firstOnly: number, secondOnly: number): number {
  if (!Number.isInteger(firstOnly) || !Number.isInteger(secondOnly)) {
    throw new Error('mcnemar: the discordant counts must be integers');
  }
  if (firstOnly < 0 || secondOnly < 0) {
    throw new Error('mcnemar: a discordant count cannot be negative');
  }
  const n = firstOnly + secondOnly;
  // No discordant pair carries no evidence: every split of zero cases is the null, so the p is 1 rather than 0.
  if (n === 0) return 1;
  const tail = Math.min(firstOnly, secondOnly);
  let logSum = -Infinity;
  for (let i = 0; i <= tail; i += 1) {
    const term = logChoose(n, i) - n * Math.LN2;
    logSum =
      logSum === -Infinity
        ? term
        : Math.max(logSum, term) + Math.log1p(Math.exp(-Math.abs(logSum - term)));
  }
  return Math.min(1, 2 * Math.exp(logSum));
}

/**
 * McNemar's continuity-corrected chi-square, the asymptotic form earlier sections of this programme quote.
 *
 * `χ² = (|b − c| − 1)² / (b + c)`, and for one degree of freedom the survival function is `erfc(√(χ²/2))`. It reads
 * 0.243 for 22 against 14 and 0.055 for 16 against 30, which are the two figures `sota-comparison.md` publishes.
 *
 * @param firstOnly - Discordant cases the first artifact alone got right.
 * @param secondOnly - Discordant cases the second artifact alone got right.
 * @returns The p-value, in (0, 1].
 */
export function mcnemarAsymptotic(firstOnly: number, secondOnly: number): number {
  const n = firstOnly + secondOnly;
  if (n === 0) return 1;
  const chiSquare = Math.max(0, Math.abs(firstOnly - secondOnly) - 1) ** 2 / n;
  return Math.min(1, erfc(Math.sqrt(chiSquare / 2)));
}

/** Index one artifact by case, refusing the two reads that would silently change the denominator. */
function indexOf(rows: readonly ArmRow[], label: string): Map<string, boolean> {
  if (rows.length === 0) throw new Error(`${label}: no rows — an empty artifact measures nothing`);
  const byId = new Map<string, boolean>();
  for (const row of rows) {
    if (typeof row.correct !== 'boolean') {
      throw new Error(
        `${label}: case ${row.datapack} has a non-boolean \`correct\` (${String(row.correct)})`,
      );
    }
    // A duplicate id would let the last row win, which is a rule no artifact states.
    if (byId.has(row.datapack)) throw new Error(`${label}: case ${row.datapack} appears twice`);
    byId.set(row.datapack, row.correct);
  }
  return byId;
}

/**
 * Read two artifacts as one paired comparison.
 *
 * @param first - The control's rows.
 * @param second - The arm's rows.
 * @returns The 2 × 2 and both p-values, over the cases both files carry.
 * @throws When either file is empty, repeats a case, or the two do not cover the same cases — because a delta over
 * the intersection is a movement on a denominator neither file states.
 */
export function pairedComparisonOf(
  first: readonly ArmRow[],
  second: readonly ArmRow[],
): PairedCounts {
  const a = indexOf(first, 'first');
  const b = indexOf(second, 'second');
  const onlyFirst = [...a.keys()].filter((id) => !b.has(id)).sort();
  const onlySecond = [...b.keys()].filter((id) => !a.has(id)).sort();
  if (onlyFirst.length > 0 || onlySecond.length > 0) {
    const example = onlyFirst[0] ?? onlySecond[0]!;
    throw new Error(
      `paired comparison: the two artifacts do not cover the same cases — ${String(onlyFirst.length)} only in the first, ` +
        `${String(onlySecond.length)} only in the second (for example \`${example}\`)`,
    );
  }
  let bothRight = 0;
  let firstOnly = 0;
  let secondOnly = 0;
  for (const [id, rightInFirst] of a) {
    const rightInSecond = b.get(id)!;
    if (rightInFirst && rightInSecond) bothRight += 1;
    else if (rightInFirst) firstOnly += 1;
    else if (rightInSecond) secondOnly += 1;
  }
  return {
    shared: a.size,
    onlyFirst: 0,
    onlySecond: 0,
    bothRight,
    firstOnly,
    secondOnly,
    delta: secondOnly - firstOnly,
    pExact: mcnemarExact(firstOnly, secondOnly),
    pAsymptotic: mcnemarAsymptotic(firstOnly, secondOnly),
  };
}

/** Parse the `arms` string of a metadata record into the flags it names. */
export function armTokensOf(arms: string): Map<string, string> {
  const tokens = new Map<string, string>();
  if (arms.trim() === '' || arms.trim() === 'free') return tokens;
  for (const part of arms.split('+')) {
    const [name, value, ...rest] = part.split('=');
    if (name === undefined || value === undefined || rest.length > 0 || name === '') {
      throw new Error(`arms: \`${part}\` is not \`name=value\``);
    }
    tokens.set(name.trim(), value.trim());
  }
  return tokens;
}

/**
 * Why two artifacts may not be compared, or `null` when they may.
 *
 * The axis is the list of `arms` keys the caller intends to vary — `fleet`, `onset`, `fallback`. Everything outside it
 * has to match, including the model, the budget, the revision and the flags that are ABSENT from one file: a name
 * present in one record and missing from the other is a difference, not a default.
 *
 * @param first - The control's metadata.
 * @param second - The arm's metadata.
 * @param axis - The `arms` keys the comparison is allowed to vary.
 * @returns A sentence naming every difference, or `null`.
 */
export function comparisonRefusal(
  first: RunMetadata,
  second: RunMetadata,
  axis: readonly string[],
): string | null {
  const differences: string[] = [];
  if (first.model !== second.model) {
    differences.push(`model: \`${first.model}\` vs \`${second.model}\``);
  }
  const budgetOf = (meta: RunMetadata): string =>
    `${String(meta.budget.maxRounds)} rounds / ${String(meta.budget.maxToolCalls)} calls`;
  if (budgetOf(first) !== budgetOf(second)) {
    differences.push(`budget: ${budgetOf(first)} vs ${budgetOf(second)}`);
  }
  // The transcript cap sits inside the budget because that is where a runner states it, but it is compared
  // SEPARATELY: rounds and calls are the investigation's shape and must match, while the cap is allowed to be the axis
  // of a comparison — that is the whole point of dispatching one. Named `transcript` so a caller can declare it.
  const charsOf = (meta: RunMetadata): string =>
    meta.budget.transcriptChars === undefined
      ? 'default chars'
      : `${String(meta.budget.transcriptChars)} chars`;
  if (charsOf(first) !== charsOf(second) && !axis.includes('transcript')) {
    differences.push(`transcript: ${charsOf(first)} vs ${charsOf(second)}`);
  }
  // The revision is the harness itself. Two artifacts from different commits are a comparison of CODE, which is a
  // legitimate experiment (a bisect) and never an arm effect — so it is refused unless the caller says so.
  if ((first.revision ?? null) !== (second.revision ?? null) && !axis.includes('revision')) {
    differences.push(
      `revision: \`${first.revision ?? 'unrecorded'}\` vs \`${second.revision ?? 'unrecorded'}\``,
    );
  }
  const a = armTokensOf(first.arms);
  const b = armTokensOf(second.arms);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  for (const key of keys) {
    if (axis.includes(key)) continue;
    const left = a.get(key) ?? 'absent';
    const right = b.get(key) ?? 'absent';
    if (left !== right) differences.push(`arm \`${key}\`: \`${left}\` vs \`${right}\``);
  }
  if (differences.length === 0) return null;
  return `refusing the comparison — the two artifacts differ in ${differences.length} field(s) outside the axis \`${axis.join(',') || '(none)'}\`: ${differences.join('; ')}`;
}

/** Render a p-value the way the rest of this programme does: three decimals, or `< 0.001`. */
export function formatP(p: number): string {
  return p < 0.001 ? '< 0.001' : p.toFixed(3);
}

/**
 * The comparison as a reader sees it: the 2 × 2, the delta in cases and points, and both p-values.
 *
 * @param first - The label the first artifact is printed under.
 * @param second - The label the second artifact is printed under.
 * @param counts - The paired counts.
 * @returns A multi-line report.
 */
export function formatComparison(first: string, second: string, counts: PairedCounts): string {
  const points = (counts.delta / counts.shared) * 100;
  const signed = (value: number): string => (value >= 0 ? `+${String(value)}` : String(value));
  const lines = [
    `paired on ${String(counts.shared)} cases · ${first} -> ${second}`,
    `  both right ${String(counts.bothRight)} · only ${first} ${String(counts.firstOnly)} · only ${second} ${String(counts.secondOnly)}`,
    `  delta ${signed(counts.secondOnly)} - ${String(counts.firstOnly)} = ${signed(counts.delta)} cases (${signed(Number(points.toFixed(2)))} pp)`,
    `  p exact ${formatP(counts.pExact)} · p asymptotic ${formatP(counts.pAsymptotic)}`,
  ];
  return lines.join('\n');
}
