/**
 * Two instruments that make a MISS readable, and the reason both were needed.
 *
 * A Top-1 accuracy is a single number, and it hides two completely different failures. A benchmark whose
 * root cause never entered the candidate set cannot be improved by ranking, and one whose root cause entered
 * it and was placed second can be. The distinction is not academic: the framework this project is measured
 * against reports `Avg@5`, so a miss there may be a retrieval miss or a reranking miss and the published
 * table cannot say which — and a competitor's recent decomposition of exactly that question is why this
 * module exists.
 *
 * **Neither instrument is a new measurement.** Both read what a run already produced:
 *
 * - {@link formatRankingLadder} renders a ranked list, and it exists because the shipped renderer printed a
 *   quantity that is not the one the order came from, which made every ladder line unverifiable.
 * - {@link classifyLoss} consumes a {@link LossRecord} — one case, its candidate pool, and where the truth
 *   was placed in it — and names the failure. {@link summarizeLoss} counts them per (suite, system).
 *
 * **The pool is the graph.** A case's candidate set is the node set of the call graph this pipeline
 * constructed for it, which is the set the ranker can output; a truth that is not a node cannot be returned
 * by any ranking of it, however good. {@link LossRecord.pool} records the size of that set beside
 * {@link LossRecord.truthInGraph}, because a fraction without a denominator is not a rate.
 *
 * @module benchmarks/loss-census
 */

/**
 * One entry of a ranked candidate list, as the diagnostic carries it.
 *
 * `finalScore` is the value the ranking sorted by; `confidence` is a display value that folds in
 * propagation-depth and error-bound penalties and therefore does NOT have to decrease with rank. Both are
 * carried, and the ladder prints the one it ordered by.
 */
export interface RankedService {
  /** The candidate service. */
  readonly serviceId: string;
  /** The display confidence, which need not be monotone in rank. */
  readonly confidence: number;
  /**
   * The exact value the ranking sorted by, or `undefined` when the artifact predates this field.
   *
   * Optional rather than defaulted, because substituting `confidence` for a missing sort key is precisely
   * the defect this field was added to remove.
   */
  readonly finalScore?: number | undefined;
  /** Propagation depth from the root, as the engine reported it. */
  readonly depth: number;
}

/** The decimal places the ladder prints for a ranking score. */
export const LADDER_SCORE_DECIMALS = 3;

/**
 * Render a ranked list as one line.
 *
 * **The contract is that the printed number is the sort key.** `finalScore` decreases with rank by
 * construction — the engine sorts by it, tie-broken on service id — so a reader can check the line against
 * itself, and a line whose numbers rise is a bug rather than a puzzle. Where the score is absent the cell
 * reads `-`, which is a statement that this artifact does not carry it: never a silent substitution of the
 * display value, because a reader has no way to tell a substituted quantity from a measured one.
 *
 * @param entries - The ranked candidates, best first.
 * @returns The rendered line, ending without a newline.
 */
export function formatRankingLadder(entries: readonly RankedService[]): string {
  const cells = entries.map((e) => {
    const score = e.finalScore === undefined ? '-' : e.finalScore.toFixed(LADDER_SCORE_DECIMALS);
    return `${e.serviceId}(${score},d${e.depth})`;
  });
  return `    Top-K: ${cells.join(' | ')}`;
}

/** How deep in the ranking a miss still counts as a *shallow* one. */
export const DEFAULT_SHALLOW_DEPTH = 5;

/**
 * Why a case was missed.
 *
 * `RETRIEVAL` means the truth is not in the set the engine ranked, so **no ranking of that set could have
 * returned it** — the definition is about the pool and not about the mechanism that emptied it of the truth.
 * Why it is absent is reported separately (see {@link LossRow.retrievalNotInGraph} and
 * {@link LossRow.retrievalNotRanked}), because the two mechanisms have different owners and the record cannot
 * always tell them apart; asserting one of them here would be asserting more than was measured.
 */
export type LossClass = 'CORRECT' | 'ENGINE_ERROR' | 'RETRIEVAL' | 'RERANK_SHALLOW' | 'RERANK_DEEP';

/** One case, as the census records it. */
export interface LossRecord {
  /** Stable case identifier. */
  readonly caseId: string;
  /** System-level cell key, e.g. `RE1:OnlineBoutique`. */
  readonly cell: string;
  /** Lowercase fault type. */
  readonly faultType: string;
  /** Ground-truth root-cause service id. */
  readonly truth: string;
  /** The engine's top-1 prediction, or `undefined` when it produced none. */
  readonly predicted?: string | undefined;
  /** Whether the top-1 prediction is the ground truth. */
  readonly correct: boolean;
  /** How many services the ranker could choose between. */
  readonly pool: number;
  /** Whether the ground truth is a node of the case's constructed graph. */
  readonly truthInGraph: boolean;
  /**
   * The truth's 1-based rank in the engine's FULL ranking, or `undefined` when it does not appear.
   *
   * Full, and not a top-5 prefix: a prefix cannot tell a truth at rank 6 from one at rank 40, and the
   * difference between those two is most of what a reranking fix is worth.
   */
  readonly truthRank?: number | undefined;
  /**
   * Whether the engine threw before producing a ranking.
   *
   * Its own class rather than a kind of miss, because such a case has no candidate pool to be inside or
   * outside of — `truthInGraph` would be a statement about a graph that was never built.
   */
  readonly errored?: boolean | undefined;
  /**
   * The truth's OWN evidence, as the engine recorded it, or absent when the ranking never surfaced it.
   *
   * The field that lets a `RERANK_DEEP` miss say whether the origin deviated AT ALL. A rank cannot: a truth
   * ranked 26th of 68 because 25 services moved and it did not is a signal problem, and one ranked 26th among
   * comparably-moving candidates is a ranking problem — and only the second is reachable by a ranking change.
   *
   * **Mirrored by LITERAL from `packages/kinetic`'s `TruthEvidence`**, because `benchmarks` does not depend on
   * that package and a cross-package import typechecks-fails (the vitest alias resolves it for tests only).
   * The agreement of the two declarations is fenced by test rather than assumed; a field renamed on one side
   * and not the other would otherwise leave this record describing a shape nothing produces.
   */
  readonly truthEvidence?: TruthEvidence | undefined;
  /**
   * The WINNER's `finalScore` broken into its named terms, as the engine emitted them.
   *
   * The other half of an attribution, and the reason this record can now answer a question it could only raise
   * before: a rank says a case was lost; the two breakdowns together say what it was lost TO. "Which term did
   * the truth lose on" is a question about a GAP, and the gap is `Σ (winner_i − truth_i)` — so one side is a
   * list of contributions to an unknown difference and both are needed.
   *
   * A literal mirror of the runner's `ScoreTerm`, fenced by test like `TruthEvidence` is.
   */
  readonly top1Terms?: readonly ScoreTerm[] | undefined;
}

/**
 * WHY a term contributed exactly zero — one value per mechanism the ranking formula actually has.
 *
 * The six are the point of recording one: a zero produced by any of them is the SAME NUMBER and a different
 * problem, and a table of contributions cannot separate them because a difference between two zeros is zero.
 *
 * The `INPUT_` prefix is the union's own convention and means "this cause names the OPTIONAL source it read in
 * `ScoreTerm.source`", which is what lets this module read the name by PREFIX rather than by enumerating the
 * family — see `summarizeTermZeroes`.
 */
export type TermZeroCause =
  /** The term's configured weight is 0, so the zero is a CONFIGURATION fact and licenses no corpus inference. */
  | 'WEIGHT_ZERO'
  /** The whole OPTIONAL source the term reads is ABSENT from the graph. */
  | 'INPUT_MAP_ABSENT'
  /** The OPTIONAL source is present and carries NO candidates at all: a producer that ran and emitted nothing. */
  | 'INPUT_MAP_EMPTY'
  /** The OPTIONAL source is present but carries no entry for this candidate. */
  | 'INPUT_ENTRY_ABSENT'
  /** The weight and the input are present, and a gate in the formula overrode a non-zero value. */
  | 'MASKED'
  /** The weight and the input are present, no gate applies, and the value read is exactly 0. */
  | 'VALUE_ZERO';

/**
 * One named contribution to a ranking score, weight already applied.
 *
 * A literal mirror of the producer's declaration — see `LossRecord.truthEvidence` for why `benchmarks` copies
 * the shape instead of importing it, and for the fence that holds the two declarations together.
 */
export interface ScoreTerm {
  /** The term's name, as the ranking formula spells it. */
  readonly name: string;
  /** Its contribution to the total score, weight already applied. May be negative. */
  readonly contribution: number;
  /** Present only when `contribution === 0`, naming the mechanism that made it zero. */
  readonly cause?: TermZeroCause;
  /** For every `INPUT_*` cause: the OPTIONAL source that was absent, so the field is named. */
  readonly source?: string;
  /** For `MASKED`: the gate that forced the zero. */
  readonly mask?: string;
}

/**
 * The ground truth's own score and the evidence the engine recorded for it, in the engine's own terms.
 *
 * A literal mirror of `packages/kinetic`'s interface of the same name — see `LossRecord.truthEvidence` for why
 * it is copied rather than imported, and for the fence that holds the two declarations together.
 */
export interface TruthEvidence {
  /** The truth's `rca_score`: the self-anomaly term of its `finalScore`. */
  readonly rcaScore?: number | undefined;
  /** The threshold `rca_score` was judged against, AS THE ENGINE RECORDED IT. */
  readonly rcaThreshold?: number | undefined;
  /** The truth's collision contribution, when the collision term produced one. */
  readonly collisionGain?: number | undefined;
  /** The truth's `finalScore` — the value the ranking sorted by. */
  readonly finalScore?: number | undefined;
  /**
   * The truth's `finalScore` broken into its named terms, as the engine emitted them.
   *
   * The side of the gap that belongs to the truth. Kept on the evidence object rather than as a sibling field
   * because it IS evidence about the truth, and a reader asking "what did the truth score on each term" should
   * not have to know which of two top-level fields holds it.
   */
  readonly terms?: readonly ScoreTerm[] | undefined;
  /** The truth's propagation depth, as the ranking reported it. */
  readonly depth: number;
  /** Whether the ranking found the truth by tree search rather than in the full graph. */
  readonly viaTreeSearch: boolean;
  /** How many evidence metrics the engine recorded for the truth. */
  readonly metricCount: number;
}

/**
 * Which of the two problems a `RERANK_DEEP` miss is, decided by the ENGINE'S OWN threshold.
 *
 * `RERANK_DEEP` says the truth was in the pool and placed beyond the shallow depth. It does not say whether the
 * origin's telemetry moved, and the two cases want opposite work: a fully-saturated recall problem wants the
 * ranking fixed, and an origin that never deviated wants the signal found — no reweighting of a candidate
 * whose self-anomaly term did not clear the engine's own bar will lift it, because there is nothing there to
 * weight.
 *
 * The boundary is `rcaScore > rcaThreshold`, where **both values are the engine's**: the threshold travels in
 * the record rather than being restated here, so this module cannot silently disagree with the cut the engine
 * applied. `UNSTATED` is a class rather than a default — a row whose engine produced no `rca_score`, or no
 * threshold with it, is one this split CANNOT decide, and filing it under either answer would be the defect
 * this repository keeps recording: naming a mechanism the instrument cannot see.
 */
export type DeepEvidenceClass = 'LOCAL_EVIDENCE_PRESENT' | 'NO_LOCAL_EVIDENCE' | 'UNSTATED';

/**
 * Decide a deep miss's evidence class, from the truth's own recorded score and threshold.
 *
 * @param evidence - The truth's evidence, or `undefined` when the ranking never surfaced it.
 * @returns The class. `UNSTATED` whenever the engine did not record the value or its threshold.
 */
export function classifyDeepEvidence(evidence: TruthEvidence | undefined): DeepEvidenceClass {
  if (evidence === undefined) return 'UNSTATED';
  const { rcaScore, rcaThreshold } = evidence;
  if (rcaScore === undefined || rcaThreshold === undefined) return 'UNSTATED';
  return rcaScore > rcaThreshold ? 'LOCAL_EVIDENCE_PRESENT' : 'NO_LOCAL_EVIDENCE';
}

/**
 * The term the WINNER won on: the largest contribution advantage it held over the truth.
 *
 * ## The question this answers, and the one it refuses to
 *
 * `finalScore` is a sum, so the margin between two candidates is `Σ (winner_i − truth_i)`. The term with the
 * largest POSITIVE difference is the one that decided the case in the winner's favour — the term the truth
 * "lost on" in the only sense a ranking supports.
 *
 * **It is not a claim about causality, and the name does not pretend otherwise.** A term can be the largest gap
 * for two different reasons: the winner earned more there, or the truth was penalised there. The two are not
 * separated by this function, so it returns the NAME and the caller may report the shares — but no caller may
 * turn it into "this term is the bug", because a gap has two ends and this measures the difference rather than
 * either end. The field the doc points at is the terms themselves, which are both on the record.
 *
 * `undefined` when either side is missing, or when the two sides do not share a single term name — which would
 * mean the record carries breakdowns of two different scores, and a gap between those is not a quantity.
 *
 * @param truthTerms - The truth's breakdown, when the ranking surfaced it.
 * @param winnerTerms - The winner's breakdown.
 * @returns The term name with the largest positive truth-to-winner gap, or `undefined`.
 */
export function dominantLostTerm(
  truthTerms: readonly ScoreTerm[] | undefined,
  winnerTerms: readonly ScoreTerm[] | undefined,
): string | undefined {
  if (truthTerms === undefined || winnerTerms === undefined) return undefined;
  const winner = new Map(winnerTerms.map((t) => [t.name, t.contribution]));
  let best: { name: string; gap: number } | undefined;
  for (const t of truthTerms) {
    const w = winner.get(t.name);
    if (w === undefined) continue;
    const gap = w - t.contribution;
    // ONLY a positive difference is a candidate, and the condition is in the guard rather than in a later
    // filter: a term the truth LEADS on is not a term it lost on, and an implementation that seeded `best`
    // with the first term regardless of sign would name it whenever the truth happened to lead everywhere.
    //
    // Strictly greater, so ties resolve to the FIRST term in the formula's order rather than to whichever the
    // iteration reached last: a tie broken by map order is a different answer on a different engine.
    if (gap > 0 && (best === undefined || gap > best.gap)) best = { name: t.name, gap };
  }
  return best?.name;
}

/**
 * Name the failure in one case.
 *
 * @param record - One case's census row.
 * @param shallowDepth - The deepest rank still called *shallow*.
 * @returns The class.
 */
export function classifyLoss(
  record: LossRecord,
  shallowDepth: number = DEFAULT_SHALLOW_DEPTH,
): LossClass {
  if (record.errored === true) return 'ENGINE_ERROR';
  if (record.correct) return 'CORRECT';
  // The pool is the set the engine ranked, so absence is decided by the rank and not by the graph: a truth the
  // graph holds but the ranking never surfaces is still one no ranking of THIS pool could have returned.
  if (record.truthRank === undefined) return 'RETRIEVAL';
  return record.truthRank <= shallowDepth ? 'RERANK_SHALLOW' : 'RERANK_DEEP';
}

/** The counts for one (suite, system) group. */
export interface LossRow {
  /** Suite name, as the case id declared it. */
  readonly suite: string;
  /** System name. */
  readonly system: string;
  /** Cases in the group. */
  readonly cases: number;
  /** Cases answered correctly. */
  readonly correct: number;
  /** Cases whose analysis threw: no ranking exists, so they are neither retrieved nor reranked. */
  readonly engineError: number;
  /** Misses whose truth is not in the candidate pool: no ranking of that pool could have returned it. */
  readonly retrieval: number;
  /** Of those, the truth was never a node of the case's graph. */
  readonly retrievalNotInGraph: number;
  /**
   * Of those, the truth IS a node of the case's graph and the ranking never surfaces it.
   *
   * Reported as a mechanism rather than as a verdict: the pruner may legitimately have removed the node from
   * what it scored, and separating that from a ranker that dropped a candidate it was handed needs the scored
   * set, which this record does not carry. Both are retrieval failures; only one would be a defect.
   */
  readonly retrievalNotRanked: number;
  /** Misses whose truth was in the pool and placed inside the shallow depth. */
  readonly rerankShallow: number;
  /** Misses whose truth was in the pool and placed deeper than the shallow depth. */
  readonly rerankDeep: number;
  /**
   * Of the deep half, how many had NO local evidence above the engine's own threshold.
   *
   * The origin's self-anomaly did not clear the bar the engine judged it against, so it was ranked deep among
   * candidates that did — a signal problem, and not one a reweighting recovers.
   */
  readonly deepNoLocalEvidence: number;
  /** Of the deep half, how many DID clear the bar and were still placed deep: a ranking problem. */
  readonly deepLocalEvidencePresent: number;
  /**
   * Of the deep half, how many this split cannot decide.
   *
   * Non-zero means the engine did not record `rca_score` or the threshold it was judged against, and it is
   * reported rather than folded into either answer for the reason {@link DeepEvidenceClass} gives.
   */
  readonly deepEvidenceUnstated: number;
  /**
   * Of the deep half, which TERM the winner won on, by count.
   *
   * The attribution the block was missing: the truth carried local evidence, was scored, was placed deep — and
   * this says which contribution the candidate that beat it was ahead on. Sorted by count descending and, on a
   * tie, by term NAME rather than by insertion order: a distribution whose order depends on the iteration order
   * of a map is a different table on a different engine, and an artifact that changes when nothing changed is
   * one nobody can diff.
   *
   * Deep cases whose breakdowns are absent from the record are NOT counted here — they appear in
   * {@link deepAttributionUnavailable} — because a case that could not be attributed is a fact about the
   * record, and folding it into a term would read as one.
   */
  readonly deepLostOn: readonly { readonly term: string; readonly count: number }[];
  /** Deep cases this module could not attribute, because the record lacks one side's breakdown. */
  readonly deepAttributionUnavailable: number;
  /** The median candidate-pool size, so the retrieval half has a denominator. */
  readonly poolMedian: number;
}

/** The suite and system a cell key declares, or `('unrecognised', 'unrecognised')`. */
export function splitCell(cell: string): readonly [string, string] {
  const at = cell.indexOf(':');
  if (at <= 0 || at === cell.length - 1) return ['unrecognised', 'unrecognised'];
  return [cell.slice(0, at), cell.slice(at + 1)];
}

/**
 * Count the classes per (suite, system).
 *
 * @param records - Every case's census row.
 * @param shallowDepth - The deepest rank still called *shallow*.
 * @returns One row per group, ordered by suite then system.
 */
export function summarizeLoss(
  records: readonly LossRecord[],
  shallowDepth: number = DEFAULT_SHALLOW_DEPTH,
): LossRow[] {
  const groups = new Map<string, LossRecord[]>();
  for (const r of records) {
    const at = groups.get(r.cell);
    if (at === undefined) groups.set(r.cell, [r]);
    else at.push(r);
  }
  const rows: LossRow[] = [];
  for (const cell of [...groups.keys()].sort()) {
    const members = groups.get(cell)!;
    const [suite, system] = splitCell(cell);
    const counts: Record<LossClass, number> = {
      CORRECT: 0,
      ENGINE_ERROR: 0,
      RETRIEVAL: 0,
      RERANK_SHALLOW: 0,
      RERANK_DEEP: 0,
    };
    let notInGraph = 0;
    // The deep half's evidence split, accumulated in the SAME pass as the class counts: a second walk of
    // `members` would be a second answer to "which rows are DEEP", and the two agree until one is edited.
    const deepEvidence: Record<DeepEvidenceClass, number> = {
      LOCAL_EVIDENCE_PRESENT: 0,
      NO_LOCAL_EVIDENCE: 0,
      UNSTATED: 0,
    };
    // The attribution, accumulated in the same pass for the same reason.
    const lostOn = new Map<string, number>();
    let deepUnattributed = 0;
    const bump = (m: Map<string, number>, k: string): void => {
      m.set(k, (m.get(k) ?? 0) + 1);
    };
    for (const m of members) {
      const cls = classifyLoss(m, shallowDepth);
      counts[cls]++;
      if (cls === 'RETRIEVAL' && !m.truthInGraph) notInGraph++;
      if (cls === 'RERANK_DEEP') {
        deepEvidence[classifyDeepEvidence(m.truthEvidence)]++;
        const term = dominantLostTerm(m.truthEvidence?.terms, m.top1Terms);
        if (term === undefined) deepUnattributed++;
        else bump(lostOn, term);
      }
    }
    rows.push({
      suite,
      system,
      cases: members.length,
      correct: counts.CORRECT,
      engineError: counts.ENGINE_ERROR,
      retrieval: counts.RETRIEVAL,
      retrievalNotInGraph: notInGraph,
      retrievalNotRanked: counts.RETRIEVAL - notInGraph,
      rerankShallow: counts.RERANK_SHALLOW,
      rerankDeep: counts.RERANK_DEEP,
      deepNoLocalEvidence: deepEvidence.NO_LOCAL_EVIDENCE,
      deepLocalEvidencePresent: deepEvidence.LOCAL_EVIDENCE_PRESENT,
      deepEvidenceUnstated: deepEvidence.UNSTATED,
      deepLostOn: [...lostOn.entries()]
        .map(([term, count]) => ({ term, count }))
        .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : 1)),
      deepAttributionUnavailable: deepUnattributed,
      poolMedian: median(members.map((m) => m.pool)),
    });
  }
  return rows;
}

/** Ascending numeric order, named so the comparator is a value rather than an inline closure. */
function ascending(a: number, b: number): number {
  return a - b;
}

/**
 * The median of a NON-EMPTY list of numbers.
 *
 * The precondition is real rather than defensive, and it is stated here because the obvious guard is an arm no
 * input can reach: the only caller passes a group's members, and a group is created by pushing its first
 * member — so there is no empty group to take the median of, and a `values.length === 0` branch would be dead
 * code that the coverage gate would then be reporting as an uncovered arm.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort(ascending);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const pct = (hit: number, of: number): string =>
  of === 0 ? 'n/a' : `${((hit / of) * 100).toFixed(1)}%`;

/**
 * The report, as lines. Pure, so every arm of it is testable without a corpus.
 *
 * The two totals are the reading: **retrieval** is the part of the loss no ranking change can recover, and
 * **reranking** is the part a ranking change can. A report that printed only the accuracy would make the
 * two indistinguishable — which is the whole reason this module exists.
 *
 * @param rows - The per-group counts.
 * @param shallowDepth - The deepest rank still called *shallow*.
 * @returns The report lines.
 */
export function formatLossReport(
  rows: readonly LossRow[],
  shallowDepth: number = DEFAULT_SHALLOW_DEPTH,
): string[] {
  if (rows.length === 0) {
    return ['no cases found: nothing to census, and saying so beats printing a zero.'];
  }
  const lines = [
    `  loss decomposition (a miss at rank <= ${shallowDepth} is RERANK_SHALLOW; beyond it, RERANK_DEEP)`,
    `  ${'suite'.padEnd(6)} ${'system'.padEnd(15)} ${'cases'.padStart(6)} ${'correct'.padStart(8)} ` +
      `${'RETRIEVAL'.padStart(10)} ${'shallow'.padStart(8)} ${'deep'.padStart(6)} ` +
      `${'notG'.padStart(5)} ${'ERR'.padStart(5)} ${'pool'.padStart(6)}   ` +
      `deep: ${'noGain'.padStart(6)} ${'hasGain'.padStart(7)} ${'unstated'.padStart(8)}`,
  ];
  let cases = 0;
  let correct = 0;
  let engineError = 0;
  let retrieval = 0;
  let shallow = 0;
  let deep = 0;
  let notInGraph = 0;
  let deepNo = 0;
  let deepHas = 0;
  let deepUnstated = 0;
  const lostOnTotal = new Map<string, number>();
  let deepUnattributedTotal = 0;
  for (const r of rows) {
    cases += r.cases;
    correct += r.correct;
    engineError += r.engineError;
    retrieval += r.retrieval;
    shallow += r.rerankShallow;
    deep += r.rerankDeep;
    notInGraph += r.retrievalNotInGraph;
    deepNo += r.deepNoLocalEvidence;
    deepHas += r.deepLocalEvidencePresent;
    deepUnstated += r.deepEvidenceUnstated;
    deepUnattributedTotal += r.deepAttributionUnavailable;
    for (const e of r.deepLostOn) lostOnTotal.set(e.term, (lostOnTotal.get(e.term) ?? 0) + e.count);
    lines.push(
      `  ${r.suite.padEnd(6)} ${r.system.padEnd(15)} ${String(r.cases).padStart(6)} ` +
        `${String(r.correct).padStart(8)} ${String(r.retrieval).padStart(10)} ` +
        `${String(r.rerankShallow).padStart(8)} ${String(r.rerankDeep).padStart(6)} ` +
        `${String(r.retrievalNotInGraph).padStart(5)} ${String(r.engineError).padStart(5)} ` +
        `${r.poolMedian.toFixed(1).padStart(6)}   ` +
        `${String(r.deepNoLocalEvidence).padStart(11)} ${String(r.deepLocalEvidencePresent).padStart(7)} ` +
        `${String(r.deepEvidenceUnstated).padStart(8)}`,
    );
  }
  const misses = cases - correct;
  lines.push(
    `  ${'TOTAL'.padEnd(6)} ${''.padEnd(15)} ${String(cases).padStart(6)} ${String(correct).padStart(8)} ` +
      `${String(retrieval).padStart(10)} ${String(shallow).padStart(8)} ${String(deep).padStart(6)} ` +
      `${String(notInGraph).padStart(5)} ${String(engineError).padStart(5)}`,
    // The convention is named BEFORE the reading, because it is the context the reading is in — and the
    // reading line stays LAST, which is where a caller that reads only the final line expects it.
    //
    // This line and the published cell `AVERAGE` are the same word for two different quantities, and they
    // differ on one suite. Every case is weighted equally here; the published `AVERAGE` column is the
    // UNWEIGHTED MEAN OF THE FAULT-TYPE ACCURACIES (`docs/accuracy-aggregation.md`), which agrees with this
    // to the printed precision on RE1 and RE2 and separates on RE3, whose fault types do not carry equal case
    // counts: **53.33% case-level against 58.69% per fault type**. Two conventions that disagree on one of
    // three suites, under one noun, is the shape an instrument must not contribute to — so the reading states
    // which one it is and where the other lives.
    '  "case-level" weights every case equally. The published cell AVERAGE is the unweighted mean of the',
    '  fault-type accuracies and differs from this on RE3 (53.33% case-level vs 58.69% per fault type);',
    '  see `docs/accuracy-aggregation.md`, and read the SPLIT below against either.',
    // The deep half split, and the sentence it exists for: a deep miss whose origin never cleared the
    // engine's OWN threshold is not reachable by reweighting, and the two blocks want opposite work.
    `  of the ${deep} DEEP misses: NO local evidence above the engine's own threshold ${deepNo}, ` +
      `local evidence PRESENT and still ranked deep ${deepHas} (a ranking problem), ` +
      `undecidable ${deepUnstated} (the record lacks rca_score or its threshold)`,
    // WHICH TERM the winner won on, over the deep half — the attribution, printed beside the split because a
    // split says where the work is and this says what to change. Names only, and the doc states why: a gap has
    // two ends and this measures the difference, so the name is a lead the terms themselves must confirm.
    `  of those ${deep}: the winner's largest per-term advantage was ` +
      (lostOnTotal.size === 0
        ? 'not attributable — no deep case carried both breakdowns'
        : [...lostOnTotal.entries()]
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
            .slice(0, 6)
            .map(([term, count]) => `${term} ${count}`)
            .join(' · ')) +
      (deepUnattributedTotal > 0 ? ` · unattributable ${deepUnattributedTotal}` : ''),
    `  accuracy ${pct(correct, cases)} CASE-LEVEL · of ${misses} misses: RETRIEVAL ${pct(retrieval, misses)} ` +
      `(no ranking change can recover these; ${notInGraph} were never a graph node and ` +
      `${retrieval - notInGraph} a node the ranking does not surface), ` +
      `RERANKING ${pct(shallow + deep, misses)} (shallow ${pct(shallow, misses)}, deep ${pct(deep, misses)}), ` +
      `ENGINE ERROR ${pct(engineError, misses)}`,
  );
  return lines;
}

/**
 * How the zero terms came about, one row per (term, cause, named detail).
 *
 * A term's zero has six possible mechanisms and a table of contributions cannot separate them, because a
 * difference between two zeros is zero. This is that separation.
 */
export interface TermZeroRow {
  /** The term's name, as the ranking formula spells it. */
  readonly term: string;
  /** The mechanism that produced the zero. */
  readonly cause: TermZeroCause;
  /**
   * For every `INPUT_*` cause the absent source, for `MASKED` the gate; `''` for the others.
   *
   * Determined by the cause's PREFIX rather than by enumerating the family: see `summarizeTermZeroes`.
   */
  readonly detail: string;
  /** How many term instances in the read population carried exactly this (term, cause, detail). */
  readonly count: number;
}

/** The zero-term table and the population it was read from. */
export interface TermZeroSummary {
  /** How many reranking misses carried a breakdown on the requested side — the table's denominator. */
  readonly cases: number;
  /** Which side's breakdown was read, carried so the report cannot print a heading for the other one. */
  readonly side: 'truth' | 'winner';
  /** One row per distinct (term, cause, detail). */
  readonly rows: readonly TermZeroRow[];
}

/**
 * Count WHY each zero term is zero, over the reranking misses of the records given.
 *
 * The population is the reranking misses and not every case, and that is a decision rather than a filter: a
 * term that is zero on a case the engine already got right is not a loss, and including it would let 600
 * correct cases dilute the mechanism that decides the 159 that are lost. `LossClass` is asked rather than
 * re-derived so "a miss" has one definition in this repository.
 *
 * The truth's side is the default and the winner's is available, because the two answers differ for the causes
 * that are facts about the corpus (`INPUT_MAP_ABSENT`, `INPUT_MAP_EMPTY`, `INPUT_ENTRY_ABSENT`, `VALUE_ZERO`)
 * and coincide for the one that is a fact about the configuration (`WEIGHT_ZERO`, which no candidate can
 * escape).
 *
 * @param records - The census rows.
 * @param opts - `shallowDepth` as `classifyLoss` takes it, and which side's breakdown to read.
 * @returns The denominator and one row per distinct (term, cause, detail), in a stable order.
 */
export function summarizeTermZeroes(
  records: readonly LossRecord[],
  opts: {
    readonly shallowDepth?: number;
    readonly side?: 'truth' | 'winner';
  } = {},
): TermZeroSummary {
  const depth = opts.shallowDepth ?? DEFAULT_SHALLOW_DEPTH;
  const side = opts.side ?? 'truth';
  // Keyed by the row's whole identity, so two causes of the same term are two rows and two DETAILS of one
  // cause are also two — a missing `topoScores` and a missing `logScores` are different absences.
  const tally = new Map<
    string,
    { term: string; cause: TermZeroCause; detail: string; count: number }
  >();
  let cases = 0;
  for (const r of records) {
    const cls = classifyLoss(r, depth);
    if (cls !== 'RERANK_SHALLOW' && cls !== 'RERANK_DEEP') continue;
    const terms = side === 'truth' ? r.truthEvidence?.terms : r.top1Terms;
    // A miss with no breakdown on this side contributes to NEITHER the denominator nor a row. Counting it in
    // the denominator would make every row's share read low for a reason that is about the artifact rather
    // than about the term.
    if (terms === undefined) continue;
    cases += 1;
    for (const t of terms) {
      // A term that contributed something has no cause, and the table is OF zeros: a term with no cause is
      // not filed under one.
      const cause = t.cause;
      if (cause === undefined) continue;
      // The name a cause carries: the absent FIELD for the source-bearing family, the GATE for the decline, and
      // nothing for the two that name nothing.
      //
      // The family is read by its `INPUT_` PREFIX rather than by enumerating its members, because the members
      // are three levels of one absence and a fourth would be a legitimate addition: an enumerated read here
      // would file every row of a new member under `''`, printing an empty parenthesis in a report that looks
      // like a term with no detail rather than like a mis-read. The producer guarantees the name, and the
      // convention is pinned on BOTH sides by `loss-census.test.ts`.
      //
      // The `!` is a stated precondition rather than a hope — the producer sets `source` on every `INPUT_*`
      // cause and `mask` on every `MASKED` one (`buildTerm` in `packages/tree`) — and a `?? ''` in its place
      // would be a guard no input can reach. The coverage gate reports such a guard as an untaken branch, and a
      // report would print an empty parenthesis rather than the mismatch it actually is.
      const detail = cause.startsWith('INPUT_') ? t.source! : cause === 'MASKED' ? t.mask! : '';
      const key = `${t.name}\u0000${cause}\u0000${detail}`;
      const found = tally.get(key);
      if (found === undefined) tally.set(key, { term: t.name, cause, detail, count: 1 });
      else found.count += 1;
    }
  }
  const rows = [...tally.values()].sort(compareTermZeroRows);
  return { cases, side, rows };
}

/**
 * The order the zero-term rows are reported in: term, then cause, then the named detail.
 *
 * Exported and named rather than left inline in the sort, for the reason this repository extracts reports as
 * pure functions: **a comparator whose arms are reachable only through `Array.sort` is a comparator nobody
 * checks** — the arms that happen to be taken depend on the engine's sort implementation and on the arrival
 * order of the rows, so a missing arm reads as covered on one engine and as untaken on another. Tested
 * directly, every arm is asserted, including the two equality arms that only a hand-built pair can reach.
 *
 * @param a - One row.
 * @param b - Another row.
 * @returns Negative, positive or zero, as `Array.prototype.sort` expects.
 */
export function compareTermZeroRows(a: TermZeroRow, b: TermZeroRow): number {
  if (a.term !== b.term) return a.term < b.term ? -1 : 1;
  if (a.cause !== b.cause) return a.cause < b.cause ? -1 : 1;
  if (a.detail !== b.detail) return a.detail < b.detail ? -1 : 1;
  return 0;
}

/**
 * Render the zero-term table, grouped by term so a term's causes read together.
 *
 * @param summary - The output of {@link summarizeTermZeroes}.
 * @returns The report lines, in the same shape as the other census reports.
 */
export function formatTermZeroes(summary: TermZeroSummary): readonly string[] {
  const lines = [
    `  why the zero terms are zero — ${summary.cases} reranking misses, terms on the ${summary.side}'s side`,
  ];
  let term = '';
  let parts: string[] = [];
  const flush = (): void => {
    if (term === '') return;
    lines.push(`    ${term.padEnd(18)} ${parts.join(' · ')}`);
  };
  for (const r of summary.rows) {
    if (r.term !== term) {
      flush();
      term = r.term;
      parts = [];
    }
    const label = r.detail === '' ? r.cause : `${r.cause}(${r.detail})`;
    parts.push(`${label} ${pct(r.count, summary.cases)}`);
  }
  flush();
  if (summary.rows.length === 0)
    lines.push('    none — every term contributed something on every miss');
  return lines;
}
