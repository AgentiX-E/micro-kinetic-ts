/**
 * The term marginal ledger, on the pool the engine itself hands over.
 *
 * ## Why a marginal rather than a weight
 *
 * Every published number in this programme is an accuracy, and every term in the score is a weight times a value.
 * Those two facts have never been joined: a term can carry a large weight and decide nothing (its value is constant
 * on the corpus), and a term can carry a tiny weight and decide a case (it is the only number separating two
 * candidates). The marginal — the change in Top-1 when one term is removed from the sum and the pool is re-ordered —
 * is the only reading that answers "what does this implementation contribute" in the units the target is measured in.
 *
 * ## Why the tie count is printed beside it
 *
 * Removing a term can turn a decision into a tie, and a tie is settled by whatever order the pool arrived in — the
 * engine's own. A positive marginal is therefore **not** a gain until the ties it created are counted separately: the
 * term may have been replaced by the engine's published order rather than by evidence. The ledger reports
 * `tiesGained` on every row and classifies such a term `tie-maker` instead of `load-bearing`, so no reader can quote
 * the number without the caveat that produced it.
 *
 * ## Why the score identity is asserted here
 *
 * The ledger recomputes every candidate's score from its own terms. If that sum ever disagreed with the artifact's
 * `score` column, every marginal below would be a property of this module rather than of the engine. `scoreDrift`
 * carries the largest disagreement seen, and the caller prints it: a non-zero value is a defect in the artifact, not
 * a rounding note.
 *
 * @module benchmarks/term-marginal
 */

/** One term of one candidate, exactly as the term dump carries it: a name and two nullable measurements. */
export interface TermRow {
  readonly name: string;
  /** The term's weight, or `null` when the term was never computed for this candidate. */
  readonly weight: number | null;
  /** The term's value, or `null` for the same reason as the weight. */
  readonly value: number | null;
}

/** One candidate of one pool, with the score the engine published for it. */
export interface MarginalCandidate {
  readonly id: string;
  readonly score: number;
  readonly terms: readonly TermRow[];
}

/** One case: the labelled services any of which is correct, and the pool the engine ordered. */
export interface MarginalCase {
  readonly datapack: string;
  readonly truth: readonly string[];
  readonly candidates: readonly MarginalCandidate[];
}

/**
 * What a term is on this corpus.
 *
 * The classification is entirely measured — it is the marginal and the tie count, nothing else. An earlier draft
 * derived a `decorative` bound from the median decision gap, and running it on the real dump refuted the bound in the
 * most direct way available: `lat` carries at most 0.5615, below the corpus's median gap of 0.6277, and removing it
 * still costs 58 cases, because the cases it decides are the ones with a gap *smaller* than the median. A statistic
 * over the whole corpus cannot classify a term that decides a sub-population, so the bound is now context in the
 * printed table and not a classifier.
 */
export type TermRole = 'inert' | 'decorative' | 'tie-maker' | 'harmful' | 'load-bearing';

/** One row of the ledger. */
export interface MarginalRow {
  /** The term's name, as the dump spells it. */
  readonly term: string;
  /** Every distinct weight the term carried, ascending — one value for a shipped configuration. */
  readonly weights: readonly number[];
  /** How many cases carry at least one candidate on which the term was measured. */
  readonly present: number;
  /** The largest absolute contribution the term made on any candidate of the corpus. */
  readonly maxContribution: number;
  /** How many cases the term's own contribution decided: the base top-1 carries it, non-zero. */
  readonly decided: number;
  /** How many of those `decided` cases are correct. */
  readonly correct: number;
  /** Accuracy with the term removed from every sum, minus accuracy with it present. */
  readonly marginal: number;
  /** How many cases were decided uniquely before the removal and are ties after it. */
  readonly tiesGained: number;
  /** The classification: `inert` → `load-bearing` → `decorative` → `tie-maker` → `harmful`, in that order of test. */
  readonly role: TermRole;
}

/** The whole ledger, plus the corpus-level numbers its classifications are read against. */
export interface MarginalTable {
  /** Cases with a non-empty accepted set — the population every accuracy below is over. */
  readonly cases: number;
  /** Top-1 over the ranks the artifact's own scores produce. */
  readonly base: number;
  /** The median gap between the first and second score, or `null` when no case has two candidates. */
  readonly medianGap: number | null;
  /** The largest disagreement between the artifact's score column and this module's recomputation. */
  readonly scoreDrift: number;
  readonly rows: readonly MarginalRow[];
}

/** The smallest number of cases a positive marginal has to buy before this module will call it a gain. */
export const MIN_MARGINAL_GAIN = 1;

/**
 * The terms that carry evidence about the component rather than a deviation of it.
 *
 * `log` is the component's own success/failure evidence, `podState` its pod's state, `failedEdge` a failing dependency
 * edge, `lat` its latency channel and `dualFamily` the two-family agreement. On this corpus they are the only terms
 * with weight besides the kinetic onset term, which is why the partition below is drawn here: it separates the cases
 * where *something observed* points at the answer from the cases where only the deviation magnitude does.
 */
export const EVIDENCE_TERMS: readonly string[] = [
  'log',
  'podState',
  'failedEdge',
  'lat',
  'dualFamily',
];

/** One side of the evidence partition. */
export interface PartitionSide {
  readonly cases: number;
  readonly correct: number;
}

/** The corpus split by whether any candidate carries evidence, and the score-order Top-1 on each side. */
export interface EvidencePartition {
  readonly withEvidence: PartitionSide;
  readonly kineticOnly: PartitionSide;
}

/**
 * Split the corpus by whether the pool contains any evidence at all.
 *
 * The partition is **structural** — it asks whether any candidate carries a non-zero evidence contribution, not
 * whether the winner does. Drawing it on the winner would make the split a function of the outcome and the reading
 * circular. What it measures is the one thing a marginal cannot: the score is a sum, and a sum can hide a term that
 * is the only thing working in a small population (§ the `lat` defect in the module doc).
 */
export function evidencePartition(corpus: readonly MarginalCase[]): EvidencePartition {
  const withEvidence = { cases: 0, correct: 0 };
  const kineticOnly = { cases: 0, correct: 0 };
  for (const one of corpus) {
    if (one.truth.length === 0) continue;
    const carries = one.candidates.some((candidate) =>
      candidate.terms.some(
        (row) =>
          EVIDENCE_TERMS.includes(row.name) &&
          contributionOf(row) !== null &&
          contributionOf(row) !== 0,
      ),
    );
    const side = carries ? withEvidence : kineticOnly;
    side.cases += 1;
    if (isCorrect(topOneOf(one.candidates).id, one.truth)) side.correct += 1;
  }
  return { withEvidence, kineticOnly };
}

/** How the engine's published order and the score's own order compare on one corpus. */
export interface PublishedReading {
  readonly cases: number;
  /** Cases whose published first choice is correct — the engine's own headline. */
  readonly published: number;
  /** Cases whose highest scoring candidate is correct — the order the sum alone produces. */
  readonly scoreOrder: number;
  /** Cases where the two orders disagree about the first choice. */
  readonly replaced: number;
}

/**
 * Compare the engine's published order with the sum's own order.
 *
 * The two are not the same number and the difference is not rounding: two relational passes reorder the list *after*
 * scoring, so the engine publishes 1 156 correct first choices while the written sum's maximum is right on 1 073. A
 * marginal is a property of the sum, and printing it beside the published headline is what stops the one being read
 * as the other.
 */
export function publishedReading(
  corpus: readonly MarginalCase[],
  published: ReadonlyMap<string, readonly string[]>,
): PublishedReading {
  let cases = 0;
  let hit = 0;
  let scoreOrder = 0;
  let replaced = 0;
  for (const one of corpus) {
    if (one.truth.length === 0) continue;
    cases += 1;
    const first = published.get(one.datapack)?.[0] ?? null;
    if (isCorrect(first, one.truth)) hit += 1;
    const top = topOneOf(one.candidates);
    if (isCorrect(top.id, one.truth)) scoreOrder += 1;
    if (first !== top.id) replaced += 1;
  }
  return { cases, published: hit, scoreOrder, replaced };
}

/**
 * The contribution of one term: `weight × value`, or `null` when the term was not measured.
 *
 * `null` is not zero. A term that was never computed contributes nothing to the sum, but it also cannot be a
 * decision, and a ledger that folded the two would report "we measured this and it did not matter" for a channel
 * that was never read. The dump writes the pair `(null, null)` for that case and no other, so the distinction is
 * exact rather than inferred.
 */
export function contributionOf(row: TermRow): number | null {
  if (row.weight === null || row.value === null) return null;
  if (!Number.isFinite(row.weight) || !Number.isFinite(row.value)) return null;
  return row.weight * row.value;
}

/** One candidate's score, recomputed from its own terms, optionally with one term removed. */
export function recomputedScore(candidate: MarginalCandidate, drop?: string): number {
  let total = 0;
  for (const row of candidate.terms) {
    if (row.name === drop) continue;
    const contribution = contributionOf(row);
    if (contribution !== null) total += contribution;
  }
  return total;
}

/** The first candidate at the highest score, and whether another candidate shares that score. */
export interface TopOne {
  readonly id: string | null;
  readonly tied: boolean;
}

/**
 * The first candidate of the highest score, and whether another candidate shares it.
 *
 * Keeping the first maximum rather than the last is what makes the reading reproducible: the dump's pool arrives in
 * the engine's published order, so a tie under the recomputed score is settled the way the product settles it.
 */
export function topOneOf(candidates: readonly MarginalCandidate[], drop?: string): TopOne {
  let best: { score: number; id: string } | null = null;
  let tied = false;
  for (const candidate of candidates) {
    const score = recomputedScore(candidate, drop);
    if (best === null || score > best.score) {
      best = { score, id: candidate.id };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }
  return { id: best === null ? null : best.id, tied };
}

/** The median of a population, or `null` when it is empty. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The term names of a corpus, in the order the dump first mentions them. */
export function termVocabulary(corpus: readonly MarginalCase[]): readonly string[] {
  const seen = new Set<string>();
  for (const one of corpus) {
    for (const candidate of one.candidates) {
      for (const row of candidate.terms) seen.add(row.name);
    }
  }
  return [...seen];
}

/** Whether a published answer counts as correct: any member of the accepted set is right. */
function isCorrect(id: string | null, truth: readonly string[]): boolean {
  return id !== null && truth.includes(id);
}

/**
 * Classify one row from its own measurements.
 *
 * The four non-inert roles are the four things a marginal can mean, and each is a statement the reader can check
 * against the columns beside it: a term whose removal changes nothing is decorative; one whose removal helps outright
 * is harmful; one whose removal helps only by creating a tie is a tie-maker (the gain is the pool's own order, not
 * evidence); and one whose removal costs cases is load-bearing.
 */
function roleOf(row: Omit<MarginalRow, 'role'>): TermRole {
  if (row.maxContribution === 0) return 'inert';
  if (row.marginal < 0) return 'load-bearing';
  if (row.marginal === 0) return 'decorative';
  return row.tiesGained > 0 ? 'tie-maker' : 'harmful';
}

/** Build the ledger for a corpus. */
export function marginalTable(corpus: readonly MarginalCase[]): MarginalTable {
  const graded = corpus.filter((one) => one.truth.length > 0);
  const gaps: number[] = [];
  let base = 0;
  let scoreDrift = 0;

  // The base surface, and the gap the decorative bound is read against. Both are properties of the artifact's own
  // scores, so they are computed once rather than per term.
  const baseTop = new Map<string, TopOne>();
  for (const one of graded) {
    const scores = one.candidates.map((candidate) => {
      const recomputed = recomputedScore(candidate);
      scoreDrift = Math.max(scoreDrift, Math.abs(recomputed - candidate.score));
      return recomputed;
    });
    const top = topOneOf(one.candidates);
    baseTop.set(one.datapack, top);
    if (isCorrect(top.id, one.truth)) base += 1;
    if (scores.length >= 2) {
      const ordered = [...scores].sort((a, b) => b - a);
      gaps.push(ordered[0]! - ordered[1]!);
    }
  }
  const medianGap = median(gaps);

  const rows: MarginalRow[] = [];
  for (const term of termVocabulary(graded)) {
    const weights = new Set<number>();
    let present = 0;
    let maxContribution = 0;
    let decided = 0;
    let correct = 0;
    let dropped = 0;
    let tiesGained = 0;

    for (const one of graded) {
      let carries = false;
      for (const candidate of one.candidates) {
        const row = candidate.terms.find((entry) => entry.name === term);
        if (row === undefined) continue;
        const contribution = contributionOf(row);
        if (contribution === null) continue;
        carries = true;
        weights.add(row.weight!);
        maxContribution = Math.max(maxContribution, Math.abs(contribution));
      }
      if (carries) present += 1;

      const top = baseTop.get(one.datapack)!;
      if (top.id !== null) {
        const winner = one.candidates.find((candidate) => candidate.id === top.id);
        const row = winner?.terms.find((entry) => entry.name === term);
        const contribution = row === undefined ? null : contributionOf(row);
        if (contribution !== null && contribution !== 0) {
          decided += 1;
          if (isCorrect(top.id, one.truth)) correct += 1;
        }
      }

      const after = topOneOf(one.candidates, term);
      if (isCorrect(after.id, one.truth)) dropped += 1;
      if (!top.tied && after.tied) tiesGained += 1;
    }

    const row = {
      term,
      weights: [...weights].sort((a, b) => a - b),
      present,
      maxContribution,
      decided,
      correct,
      marginal: dropped - base,
      tiesGained,
    };
    rows.push({ ...row, role: roleOf(row) });
  }

  return { cases: graded.length, base, medianGap, scoreDrift, rows };
}

/** One decimal-free accuracy, so a table cell cannot imply more precision than 1 422 cases carry. */
function share(value: number, total: number): string {
  if (total === 0) return '(0.00 %)';
  return `(${((100 * value) / total).toFixed(2)} %)`;
}

/** Render the ledger as a fixed-width table plus the two bounds it was classified against. */
export function formatMarginals(table: MarginalTable): string {
  const head = [
    'term',
    'weight(s)',
    'present',
    'max |c|',
    'decided',
    'correct',
    'marginal',
    'ties',
    'role',
  ];
  const body = table.rows.map((row) => [
    row.term,
    row.weights.length === 0 ? '—' : row.weights.map((weight) => weight.toFixed(4)).join(','),
    String(row.present),
    row.maxContribution.toFixed(4),
    String(row.decided),
    `${row.correct} ${share(row.correct, row.decided)}`,
    row.marginal > 0 ? `+${String(row.marginal)}` : String(row.marginal),
    String(row.tiesGained),
    row.role,
  ]);
  const widths = head.map((cell, column) =>
    Math.max(cell.length, ...body.map((cells) => cells[column]!.length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join('  ')
      .trimEnd();
  const gap = table.medianGap === null ? '—' : table.medianGap.toFixed(4);
  return [
    line(head),
    line(widths.map((width) => '-'.repeat(width))),
    ...body.map(line),
    '',
    `cases ${String(table.cases)}, score-order Top-1 ${String(table.base)} ${share(table.base, table.cases)}`,
    `median top-2 gap ${gap} | score drift ${table.scoreDrift.toExponential(3)}`,
  ].join('\n');
}
